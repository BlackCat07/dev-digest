/**
 * tools/schemas.ts — the vocabulary every tool shares: the argument schemas the
 * model sees, and the small result/dependency types the five handlers speak.
 *
 * ## Why the argument schemas are FLAT
 *
 * Every field is a `string`, a `number` or an `enum`. There is no `z.object`
 * inside a field and no array anywhere. That is a hard rule rather than a style:
 * a nested argument turns one tool call into a small serialisation exercise, and
 * a model that has to build `{target:{repo:{owner,name}}}` gets it wrong often
 * enough to matter. `MAX_TOOL_INPUT_FIELDS` caps the width for the same reason.
 *
 * ## Why every field carries a non-empty `.describe()`
 *
 * `.describe()` is the ONLY place a field's meaning reaches the model — the JSON
 * Schema in `tools/list` carries the description and nothing else. An undescribed
 * `pr: number` is read as "some pull request identifier", which is exactly the
 * mistake `pr` exists to prevent (it is the GitHub NUMBER, never a row id).
 * `test/budget.test.ts` asserts the non-emptiness over every field of every tool,
 * so this cannot rot.
 *
 * ## Why several near-identical constants instead of one shared field
 *
 * `RepoArg` and `ConventionsRepoArg` differ by one clause. They are separate
 * because the DESCRIPTIONS are the deliverable here: the plan fixes each tool's
 * wording, and collapsing two texts into one to save a constant would silently
 * rewrite a published contract.
 */
import { z } from 'zod';
import type { McpConfig } from '../config.js';
import type { Logger } from '../log.js';
import type { ApiClient } from '../api/client.js';
import type { Resolver } from '../resolve.js';

// --------------------------------------------------------------------------
// Arguments
// --------------------------------------------------------------------------

/** `repo` on `run_agent_on_pr` and `get_blast_radius`. */
export const RepoArg = z
  .string()
  .min(1)
  .describe('Repository as owner/name (e.g. octocat/hello), or just the name if unambiguous.');

/** `repo` on `get_conventions`. */
export const ConventionsRepoArg = z
  .string()
  .min(1)
  .describe('Repository as owner/name, or just the name if unambiguous.');

/**
 * `pr` — the GitHub pull request number.
 *
 * `.int().positive()` is not decoration: the API addresses pull requests by an
 * internal uuid, and a model that has seen one is tempted to pass it here. A
 * non-integer or non-positive value is rejected before any HTTP call happens.
 */
export const PrArg = z
  .number()
  .int()
  .positive()
  .describe('Pull request number (e.g. 42), not an internal id.');

/**
 * The uuid escape hatch, and why it exists at all.
 *
 * Semantic addressing (`repo` + `pr`) is still the recommended path and still what
 * every description leads with: it is stable, human-checkable, and it is what a
 * model can construct from a GitHub URL. But the DevDigest studio's own URLs and
 * several external walkthroughs address a pull request by its ROW UUID, and a
 * caller holding one previously had no way in — `PrArg` rejects it by design, so
 * the only outcome was an argument error telling them to go and find the number.
 *
 * Accepting both costs one optional field per tool and removes a dead end. When a
 * uuid is given it WINS, because it is unambiguous: it names exactly one row, while
 * a bare repository name may not.
 *
 * **`.min(1)` and not `.uuid()`**, deliberately, even though every DevDigest id is a
 * uuid today (`uuid('id').primaryKey().defaultRandom()`). Validating the FORMAT here
 * would make this package an authority on how the API spells its ids, which it is
 * not — and it buys almost nothing, because the only thing a format check catches
 * beyond zod's type check is a non-uuid string, which `GET /pulls/:id` answers 404
 * for and `unknownPullIdMessage` turns into a sentence naming both address forms.
 * The API stays the authority on whether an id exists; this field only says one was
 * supplied.
 */
export const PrIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Pull request uuid, as shown in a DevDigest studio URL. Alternative to repo + pr; ' +
      'wins if both are given.',
  );

/** The repository's row uuid — same rationale as `PrIdArg`, including `.min(1)`. */
export const RepoIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Repository uuid, as shown in a DevDigest studio URL. Alternative to repo; wins if ' +
      'both are given.',
  );

/**
 * `agent_id` — an id from `devdigest_list_agents`, and never a name.
 *
 * The field is `agent_id` and not `agent` so the INPUT name matches the `pr_id` /
 * `repo_id` pair beside it — every uuid-valued argument on this surface now ends
 * in `_id`. The response keeps a plain `agent`, which carries the agent's NAME;
 * the two never collide because one is an argument and the other an answer.
 *
 * `agents.name` carries no unique constraint (`server/src/db/schema/agents.ts`),
 * so two agents may legally share a name and a name-addressed run would silently
 * hit the wrong one. Hence "do not guess" in the text the model reads.
 */
export const AgentArg = z
  .string()
  .min(1)
  .describe('Agent id from devdigest_list_agents. Do not guess - list agents first.');

/** `run_id` on `get_findings` — optional half of the either/or. */
export const RunIdArg = z
  .string()
  .min(1)
  .optional()
  .describe('Run id from devdigest_run_agent_on_pr. Prefer this when you have it.');

/**
 * The other half. Both fields carry the SAME text on purpose: they are one
 * addressing mode, and describing them apart would suggest either could stand
 * alone (`.refine()` in `get-findings.ts` rejects exactly that).
 */
const PR_PATH_DESCRIPTION =
  'Alternative to run_id: identify the PR by repo (owner/name) and pr number; ' +
  'returns the latest review.';

export const FindingsRepoArg = z.string().min(1).optional().describe(PR_PATH_DESCRIPTION);

export const FindingsPrArg = z.number().int().positive().optional().describe(PR_PATH_DESCRIPTION);

/**
 * `response_format` — this exact name, not `detail`.
 *
 * `.default('concise')` rather than `.optional()`: the default belongs in the
 * schema so the JSON Schema the model reads shows it, and so a handler never has
 * to remember which way round the fallback goes.
 */
export const FindingsResponseFormatArg = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe(
    '"concise" (default): severity, title, file:line, rationale. "detailed": also ' +
      'suggestion, confidence, ids, line range.',
  );

export const ConventionsResponseFormatArg = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe(
    '"concise" (default): rule, file, confidence, accepted. "detailed": also the ' +
      'evidence snippet.',
  );

export const BlastResponseFormatArg = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe(
    '"concise" (default): up to 5 callers per symbol. "detailed": every caller the ' +
      'server returned, up to 20 per symbol.',
  );

const PAGINATION_DESCRIPTION = 'Pagination over findings; defaults keep the response small.';

export const OffsetArg = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(PAGINATION_DESCRIPTION);

export const LimitArg = z.number().int().min(1).optional().describe(PAGINATION_DESCRIPTION);

// --------------------------------------------------------------------------
// What a tool answers with
// --------------------------------------------------------------------------

/**
 * A tool's answer body.
 *
 * A `type` alias rather than an `interface` deliberately: an interface has no
 * implicit index signature, so a named payload type would not be assignable to
 * this without a cast — and this package has none.
 */
export type ToolPayload = { readonly [key: string]: unknown };

/**
 * The result of a tool call: an ordered projection, or an INSTRUCTION.
 *
 * There is no third branch and no error code. Every failure — an unreachable
 * API, a mistyped repository, an agent id that does not exist — leaves through
 * `instruction`, which is a sentence naming the next action (R7). `server.ts`
 * turns that branch into an MCP error result carrying exactly that sentence.
 */
export type ToolOutcome =
  | { readonly ok: true; readonly payload: ToolPayload }
  | { readonly ok: false; readonly instruction: string };

/** Where a run came from, so `get_findings` can be given a bare `run_id`. */
export interface RunOrigin {
  /** Internal id of the pull request the run belongs to. */
  readonly prId: string;
  /** `owner/name`, as DevDigest spells it. */
  readonly repo: string;
  /** GitHub pull request number. */
  readonly pr: number;
  readonly agentName: string;
}

/**
 * Everything the five handlers need, built once by the composition root.
 *
 * `runOrigins` is a per-process index of the runs THIS server started, keyed by
 * run id. It exists because the DevDigest API has no run-scoped read: findings
 * are reachable only through `GET /pulls/:id/reviews`, so a bare `run_id` cannot
 * be turned into a request without remembering which pull request it belongs to.
 * See the header of `get-findings.ts` for what happens when a run id is not in
 * it.
 */
export interface ToolDeps {
  readonly client: ApiClient;
  readonly resolver: Resolver;
  readonly config: McpConfig;
  readonly logger: Logger;
  readonly runOrigins: Map<string, RunOrigin>;
}

/**
 * One tool's behaviour. Takes the RAW arguments: the SDK has already validated
 * them against the flat input schema, and each handler re-parses them with its
 * own object schema (plus any cross-field `.refine()`, which a raw shape cannot
 * express) to get a typed value out of `unknown` without an `as`.
 *
 * Never throws on an expected condition — `ApiClient` returns failures, and so
 * does this.
 */
export type ToolHandler = (rawArgs: unknown, deps: ToolDeps) => Promise<ToolOutcome>;

/** `ok: false` with a sentence. The only way a tool reports a problem. */
export function toolFailure(instruction: string): ToolOutcome {
  return { ok: false, instruction };
}

/**
 * The message for arguments this server could not read at all.
 *
 * Rarely reached — the SDK validates the input schema before the handler runs —
 * so it fires mainly when a handler's own `.refine()` rejects a combination the
 * flat schema allows. It therefore has to name the accepted combinations rather
 * than say "invalid input".
 */
export function invalidArgumentsMessage(tool: string, problems: readonly string[]): string {
  const detail = problems.length === 0 ? '' : ` (${problems.join('; ')})`;
  return (
    `${tool} could not read the arguments it was given${detail}. Check them against the ` +
    "tool's schema and retry: repo is \"owner/name\" or a bare name, pr is the GitHub pull " +
    'request number, and agent is an id from devdigest_list_agents.'
  );
}

/** `<field path>: <message>` lines from a rejected parse, capped. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 3).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(arguments)';
    return `${where}: ${issue.message}`;
  });
}
