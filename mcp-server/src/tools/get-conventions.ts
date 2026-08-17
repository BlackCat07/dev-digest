/**
 * tools/get-conventions.ts — `devdigest_get_conventions`.
 *
 * Two distinct jobs, and the description names both because they are reached from
 * opposite directions: JUSTIFYING a finding against the repository's own rules,
 * and READING those rules before proposing code for it. A model that only knows
 * the first never calls this tool at the moment it would help most.
 *
 * The projection itself is `shapeConventions` in `shape.ts`, which is where the
 * three properties this tool is judged on live:
 *
 *  - **All candidates, each with `accepted`** — not only the accepted ones.
 *    A repository whose candidates nobody has triaged yet would otherwise answer
 *    "no conventions" while holding twenty measured ones. Accepted sort up.
 *  - **No `scan` / `budget` envelope.** Twenty-odd counters about the scan itself,
 *    which the Conventions screen renders and a model cannot act on (and
 *    `scan.error` can carry a stack).
 *  - **No `evidence` in `concise`.** Verified snippets are the biggest token sink
 *    in this payload, and `file` + `lines` already say where to go and look.
 *
 * The two empty cases are also `shape.ts`'s: never scanned versus scanned and
 * nothing kept. They are different facts calling for different actions, and an
 * empty array cannot tell them apart — so each gets its own `next_step`.
 */
import { z } from 'zod';
import { instructionFor } from '../errors.js';
import { shapeConventions } from '../shape.js';
import {
  ConventionsRepoArg,
  ConventionsResponseFormatArg,
  RepoIdArg,
  describeIssues,
  invalidArgumentsMessage,
  toolFailure,
  type ToolHandler,
  type ToolPayload,
} from './schemas.js';

/**
 * Three fields, all primitives. `repo` is optional only because `repo_id` is an
 * alternative to it — the refine is what keeps "one of the two" mandatory.
 */
export const GET_CONVENTIONS_INPUT_SHAPE = {
  repo: ConventionsRepoArg.optional(),
  repo_id: RepoIdArg,
  response_format: ConventionsResponseFormatArg,
} as const;

/** Verbatim in the failure, so the caller is told both accepted combinations. */
export const EITHER_OR_MESSAGE =
  'devdigest_get_conventions needs either `repo` ("owner/name", or a bare name when it is ' +
  'unambiguous) or `repo_id` (the repository uuid from a DevDigest studio URL). Retry with ' +
  'one of them.';

const ArgsSchema = z
  .object(GET_CONVENTIONS_INPUT_SHAPE)
  .refine((args) => args.repo !== undefined || args.repo_id !== undefined, {
    message: EITHER_OR_MESSAGE,
  });

export const getConventions: ToolHandler = async (rawArgs, deps) => {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const refined = parsed.error.issues.find((issue) => issue.message === EITHER_OR_MESSAGE);
    return toolFailure(
      refined === undefined
        ? invalidArgumentsMessage('devdigest_get_conventions', describeIssues(parsed.error))
        : EITHER_OR_MESSAGE,
    );
  }
  const args = parsed.data;

  // A uuid wins when both are given: `GET /repos` carries `id` and `full_name`, so an
  // id names exactly one repository while a bare name may name several. The explicit
  // `!== undefined` on the second branch is what lets the refine's guarantee reach the
  // type system without an assertion — this package has none in `src/`.
  const repo =
    args.repo_id !== undefined
      ? await deps.resolver.resolveRepoById(args.repo_id)
      : args.repo !== undefined
        ? await deps.resolver.resolveRepo(args.repo)
        : null;
  if (repo === null) return toolFailure(EITHER_OR_MESSAGE);
  if (!repo.ok) return toolFailure(repo.message);

  const fetched = await deps.client.getConventions(repo.data.id);
  if (!fetched.ok) return toolFailure(instructionFor(fetched.failure));

  // `shapeConventions` already returns an ordered projection with its own
  // `truncated` / `next_step` keys, so this is a rename-free handover rather than
  // a second pass over the same data.
  const shaped = shapeConventions(fetched.data, { format: args.response_format });
  const payload: ToolPayload = { ...shaped };
  return { ok: true, payload };
};
