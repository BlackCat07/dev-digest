/**
 * tools/get-blast-radius.ts — `devdigest_get_blast_radius`.
 *
 * Answers the reviewer's first question about any diff: what ELSE could this touch?
 * Symbols the pull request changes, who calls them, and the HTTP endpoints and
 * scheduled jobs that could be reached from there.
 *
 * ## This was a stub until L04, and one thing unblocked it
 *
 * `RepoIntel.getBlastRadius` was fully implemented in the server all along, but no
 * route exposed it, so this tool shipped as a deliberate `implemented: false`
 * placeholder with the signature the real one would have (`../INSIGHTS.md`,
 * 2026-08-13). `GET /pulls/:id/blast` now exists and the signature did not move.
 *
 * One thing about the payload DID move, and it is worth stating because the stub
 * promised otherwise: the real answer groups callers BY SYMBOL (`symbols[]`) instead
 * of carrying one flat `callers` array. That grouping is the shape the server's own
 * contract had already defined (`DownstreamImpact` in `contracts/brief.ts`) and the
 * shape a reviewer reads — "which of my changed functions has 14 callers" is the
 * question, and a flat list cannot answer it without a group-by.
 *
 * ## Two costs it does not have
 *
 *  - **No model call.** The whole map is read from the codebase index; the server
 *    module is structurally incapable of an LLM request. This tool is free.
 *  - **No analysis at request time.** No AST parse and no import-graph build — the
 *    facts were computed when the repository was cloned or fetched.
 *
 * ## Why it makes TWO requests
 *
 * `GET /pulls/:id/blast` is a function of `pr_files`, and `GET /pulls/:id` is the
 * ONLY writer of that table (`../server/INSIGHTS.md`, 2026-08-11). A pull request
 * nobody has opened in the studio therefore has no changed files to analyse, and the
 * map would come back `degraded / no_changed_files` — a correct answer to the wrong
 * question, since the data is one cheap request away. So the detail route is called
 * first, for its WRITE rather than its body. It is not fatal if it fails: the map is
 * still requested, and it will then say for itself that it had nothing to work with.
 *
 * ## The one inference this tool must not invite
 *
 * An empty map is never presented as "no impact". `status` and `reason` lead the
 * payload and `next_step` names the wrong conclusion explicitly — the property the
 * stub was built around, kept now that there is real data behind it, because a
 * degraded index still produces empty arrays that look exactly like good news.
 */
import { z } from 'zod';
import { instructionFor } from '../errors.js';
import { shapeBlastRadius } from '../shape.js';
import {
  BlastResponseFormatArg,
  PrArg,
  PrIdArg,
  RepoArg,
  describeIssues,
  invalidArgumentsMessage,
  toolFailure,
  type ToolHandler,
  type ToolPayload,
} from './schemas.js';

/**
 * The signature the stub already had, plus the format knob every read tool has and
 * the `pr_id` escape hatch.
 *
 * `repo`/`pr` are OPTIONAL here only because `pr_id` is an alternative to them; the
 * refine below is what makes "one of the two ways" a real requirement rather than a
 * suggestion, since a raw shape cannot express a cross-field rule.
 */
export const GET_BLAST_RADIUS_INPUT_SHAPE = {
  repo: RepoArg.optional(),
  pr: PrArg.optional(),
  pr_id: PrIdArg,
  response_format: BlastResponseFormatArg,
} as const;

/** Verbatim in the failure, so the caller is told both accepted combinations. */
export const EITHER_OR_MESSAGE =
  'devdigest_get_blast_radius needs either `pr_id` (the pull request uuid from a DevDigest ' +
  'studio URL), or BOTH `repo` ("owner/name") and `pr` (its GitHub number). Retry with one ' +
  'of those two combinations.';

const ArgsSchema = z
  .object(GET_BLAST_RADIUS_INPUT_SHAPE)
  .refine((args) => args.pr_id !== undefined || (args.repo !== undefined && args.pr !== undefined), {
    message: EITHER_OR_MESSAGE,
  });

export const getBlastRadius: ToolHandler = async (rawArgs, deps) => {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    // The refine's own message is the useful one; a shape problem falls back to the
    // generic text, which still names every accepted argument.
    const refined = parsed.error.issues.find((issue) => issue.message === EITHER_OR_MESSAGE);
    return toolFailure(
      refined === undefined
        ? invalidArgumentsMessage('devdigest_get_blast_radius', describeIssues(parsed.error))
        : EITHER_OR_MESSAGE,
    );
  }
  const args = parsed.data;

  // Resolve first, so a mistyped address is a mistake the caller hears about rather
  // than one that hides behind an empty map. A uuid wins when both are given: it
  // names exactly one row, while a bare repository name may not.
  //
  // `repo` is null-able on the uuid path — `PrMeta` carries no `repo_id`, and
  // searching for it would cost one live GitHub sync per repository. The map itself
  // does not depend on it; only the echoed-back name does.
  let prId: string;
  let prNumber: number;
  let repoName: string | null;
  // Whether the `pr_files` backfill below is still owed. `resolvePullById` reaches
  // `GET /pulls/:id` to validate the uuid, which performs that write as a side
  // effect — so the uuid path arrives having already done it, and repeating the
  // request would be a second sync of the same rows for nothing.
  let detailLoaded = false;
  if (args.pr_id !== undefined) {
    const pull = await deps.resolver.resolvePullById(args.pr_id);
    if (!pull.ok) return toolFailure(pull.message);
    prId = pull.data.id;
    prNumber = pull.data.number;
    repoName = pull.data.repo?.fullName ?? null;
    detailLoaded = true;
  } else if (args.repo !== undefined && args.pr !== undefined) {
    const pull = await deps.resolver.resolvePull(args.repo, args.pr);
    if (!pull.ok) return toolFailure(pull.message);
    prId = pull.data.id;
    prNumber = pull.data.number;
    repoName = pull.data.repo.fullName;
  } else {
    return toolFailure(EITHER_OR_MESSAGE);
  }

  // For its write, not its body — see the header. A failure here is deliberately
  // NOT returned: the blast request below is still worth making, and its own
  // `status`/`reason` will report an empty `pr_files` far more precisely than a
  // transport error from an unrelated endpoint would.
  if (!detailLoaded) await deps.client.getPull(prId);

  const fetched = await deps.client.getBlast(prId);
  if (!fetched.ok) return toolFailure(instructionFor(fetched.failure));

  const shaped = shapeBlastRadius(
    fetched.data,
    { repo: repoName, pr: prNumber },
    { format: args.response_format },
  );
  const payload: ToolPayload = { ...shaped };
  return { ok: true, payload };
};
