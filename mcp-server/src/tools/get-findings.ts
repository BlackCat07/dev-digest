/**
 * tools/get-findings.ts — `devdigest_get_findings`, plus the findings view every
 * tool that answers with findings shares.
 *
 * ## The two addressing paths, and why they are not symmetric
 *
 * `run_id` names exactly one agent's pass. `repo` + `pr` names a pull request,
 * which a review fans out over N agents — so that path has to REDUCE before it
 * can answer, and the reduction is three journal entries deep
 * (`latestReviewPerAgent` in `shape.ts` carries them: `kind` is not filtered by
 * the server, the server's ordering has no tiebreaker, and `reviews.agent_id` is
 * nullable with no FK). The verdict is then the worst across agents and the score
 * the lowest, which is the same basis the DevDigest studio shows for the same
 * pull request.
 *
 * ## Why a bare `run_id` needs a per-process index
 *
 * The DevDigest API has **no run-scoped read of a review**. Its routes are
 * `GET /pulls/:id/reviews` (by pull request) and `GET /runs/:id/trace` (which
 * carries a findings COUNT and the raw model output, not the persisted findings).
 * So a run id cannot be turned into a request without knowing which pull request
 * it belongs to, and the only place that mapping exists is here: `runOrigins`,
 * written by `run_agent_on_pr` when it starts a run. That closes the pair the
 * `running` path depends on — the run id this server hands out is one it can
 * still look up — and a run id from a previous process gets an instruction
 * naming the `repo` + `pr` path rather than a failure it cannot act on.
 *
 * ## Every response is a projection
 *
 * `shape.ts` does the ordering, the dismissed-finding filter, the counts (taken
 * BEFORE the page) and the caps. This file only decides which of its fields the
 * two `response_format`s carry, and joins `file` + `lines` into the single
 * `file: "src/api/users.ts:13"` string the tool contract publishes.
 */
import { z } from 'zod';
import type { FindingCategory, FindingRecord, ReviewRecord, Severity } from '@devdigest/shared';
import { instructionFor } from '../errors.js';
import {
  aggregateScore,
  aggregateVerdict,
  latestReviewPerAgent,
  shapeFindings,
  type ResponseFormat,
  type ShapedFinding,
} from '../shape.js';
import {
  FindingsPrArg,
  FindingsRepoArg,
  FindingsResponseFormatArg,
  LimitArg,
  OffsetArg,
  PrIdArg,
  RunIdArg,
  describeIssues,
  invalidArgumentsMessage,
  toolFailure,
  type ToolDeps,
  type ToolHandler,
  type ToolPayload,
} from './schemas.js';

/** Longest per-agent `summary` a response carries, in characters. */
export const MAX_SUMMARY_CHARS = 600;

/**
 * The either/or message.
 *
 * It names BOTH paths and spells out what each one is, because "invalid input"
 * on a tool with two addressing modes tells the model nothing it can act on -
 * the most common mistake here is passing `repo` without `pr`, and the fix is a
 * different ARGUMENT, not a different tool.
 */
export const EITHER_OR_MESSAGE =
  'Provide either run_id (the id devdigest_run_agent_on_pr returned), or pr_id (the pull ' +
  'request uuid from a DevDigest studio URL), or BOTH repo and pr (repo as "owner/name" or a ' +
  'bare unique name, pr as the GitHub pull request number). Passing repo without pr, or none ' +
  'of them, cannot address a review - retry devdigest_get_findings with one of those three ' +
  'combinations.';

/** The flat argument shape. Six fields, every one a primitive. */
export const GET_FINDINGS_INPUT_SHAPE = {
  run_id: RunIdArg,
  pr_id: PrIdArg,
  repo: FindingsRepoArg,
  pr: FindingsPrArg,
  response_format: FindingsResponseFormatArg,
  offset: OffsetArg,
  limit: LimitArg,
} as const;

/**
 * The cross-field rule a raw shape cannot express — which is why every handler
 * re-parses its arguments rather than trusting the SDK's schema check alone.
 *
 * Deliberately NOT an exclusive or: a model that passes `run_id` AND `repo`/`pr`
 * has given a usable address, and failing that call would waste a round trip.
 * `run_id` wins, and the answer echoes the pull request it actually read, so the
 * response is self-describing either way.
 */
const ArgsSchema = z.object(GET_FINDINGS_INPUT_SHAPE).refine(
  (args) =>
    args.run_id !== undefined ||
    args.pr_id !== undefined ||
    (args.repo !== undefined && args.pr !== undefined),
  { message: EITHER_OR_MESSAGE },
);

// --------------------------------------------------------------------------
// The findings view, shared with run_agent_on_pr
// --------------------------------------------------------------------------

/**
 * One finding as any tool answers it.
 *
 * `file` carries the line reference (`"src/api/users.ts:13"`, or `:13-19` for a
 * range) rather than a separate `lines` key: it is the published contract shape,
 * it is how a citation is written everywhere else, and it costs one key instead
 * of two on every finding of every response.
 *
 * `concise` is `severity`, `title`, `file`, `rationale` — the four fields that
 * make a finding actionable. `detailed` adds `category`, `confidence` and
 * `suggestion`. It never adds ROWS, only fields.
 */
export type ToolFinding = {
  readonly severity: Severity;
  readonly category?: FindingCategory;
  readonly title: string;
  readonly file: string;
  readonly confidence?: number;
  readonly rationale: string;
  readonly suggestion?: string;
};

/** The paged, ordered, counted findings block. */
export interface ToolFindingsBlock {
  readonly total: number;
  readonly counts: { readonly CRITICAL: number; readonly WARNING: number; readonly SUGGESTION: number };
  readonly offset: number;
  readonly findings: readonly ToolFinding[];
  readonly truncated?: string;
}

function projectToolFinding(finding: ShapedFinding, format: ResponseFormat): ToolFinding {
  const detailed = format === 'detailed';
  return {
    severity: finding.severity,
    ...(detailed ? { category: finding.category } : {}),
    title: finding.title,
    file: `${finding.file}:${finding.lines}`,
    ...(detailed ? { confidence: finding.confidence } : {}),
    // `shapeFindings` is always called in `detailed` mode below, so `rationale`
    // is present; the fallback keeps the type honest rather than guarding a case.
    rationale: finding.rationale ?? '',
    ...(detailed && finding.suggestion !== undefined ? { suggestion: finding.suggestion } : {}),
  };
}

export interface ToolFindingsOptions {
  readonly format?: ResponseFormat;
  readonly offset?: number;
  readonly limit?: number;
}

/**
 * `FindingRecord[]` to the block a tool answers with.
 *
 * `shape.ts` is asked for `detailed` on both paths and the projection above
 * narrows it, because `rationale` belongs in the CONCISE tool response (it is
 * what makes a finding readable) while it is a `detailed`-only field of
 * `ShapedFinding`. One call, one order, one set of counts either way.
 */
export function toolFindingsBlock(
  findings: readonly FindingRecord[],
  options: ToolFindingsOptions = {},
): ToolFindingsBlock {
  const format = options.format ?? 'concise';
  const shaped = shapeFindings(findings, {
    format: 'detailed',
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return {
    total: shaped.total,
    counts: shaped.counts,
    offset: shaped.offset,
    findings: shaped.findings.map((finding) => projectToolFinding(finding, format)),
    ...(shaped.truncated === undefined ? {} : { truncated: shaped.truncated }),
  };
}

// --------------------------------------------------------------------------
// Per-agent header
// --------------------------------------------------------------------------

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

type AgentOutcome = {
  readonly name: string;
  readonly verdict: string | null;
  readonly score: number | null;
  readonly summary?: string;
};

/**
 * Who reviewed, and what each of them concluded.
 *
 * `agent_name` is nullish in the contract and an agent can be deleted after its
 * review is written, so the fallback is "(deleted agent)" rather than an empty
 * string — a nameless row in this list reads as a bug in the tool.
 */
function agentOutcome(review: ReviewRecord): AgentOutcome {
  const summary = review.summary === null ? '' : review.summary.trim();
  return {
    name: review.agent_name ?? '(deleted agent)',
    verdict: review.verdict,
    score: review.score,
    ...(summary === '' ? {} : { summary: cap(summary, MAX_SUMMARY_CHARS) }),
  };
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/** Verbatim from the tool contract: the pull request has never been reviewed. */
export const NEVER_REVIEWED_NEXT_STEP =
  'No completed review exists for this pull request yet. Call devdigest_run_agent_on_pr ' +
  'with the same repo and pr, and an agent id from devdigest_list_agents, to produce one.';

/**
 * A run id this process did not hand out. Not a data problem and not the model's
 * mistake, so the message says what this server can and cannot look up, and
 * names the path that always works.
 */
function unknownRunIdMessage(runId: string): string {
  return (
    `This MCP server does not recognise run id "${runId}". It can look a run up only when ` +
    'devdigest_run_agent_on_pr produced it in this same session - the DevDigest API has no ' +
    'run-scoped read, so the id is held in this process, not fetched. Retry ' +
    'devdigest_get_findings with repo and pr instead (repo as "owner/name", pr as the GitHub ' +
    'pull request number); that reads the latest review of that pull request, whichever ' +
    'session produced it.'
  );
}

/** The run is known, its review row is not there. */
function noReviewForRunNextStep(runId: string): string {
  return (
    `DevDigest holds no completed review for run ${runId}. Either the run is still going, or ` +
    'it failed before writing one. Retry this tool in a minute; if it stays empty, call ' +
    'devdigest_get_findings with repo and pr to see whatever the pull request does have, and ' +
    'check the API log (the terminal running ./scripts/dev.sh) for that run.'
  );
}

// --------------------------------------------------------------------------

/** The `run_id` path: exactly one agent's pass, no reduction needed. */
async function byRunId(runId: string, deps: ToolDeps, options: ToolFindingsOptions) {
  const origin = deps.runOrigins.get(runId);
  if (origin === undefined) return toolFailure(unknownRunIdMessage(runId));

  const reviews = await deps.client.listReviews(origin.prId);
  if (!reviews.ok) return toolFailure(instructionFor(reviews.failure));

  const review = reviews.data.find(
    (candidate) => candidate.kind === 'review' && candidate.run_id === runId,
  );
  if (review === undefined) {
    const payload: ToolPayload = {
      reviewed: false,
      repo: origin.repo,
      pr: origin.pr,
      run_id: runId,
      agent: origin.agentName,
      findings: [],
      next_step: noReviewForRunNextStep(runId),
    };
    return { ok: true as const, payload };
  }

  const block = toolFindingsBlock(review.findings, options);
  const payload: ToolPayload = {
    reviewed: true,
    repo: origin.repo,
    pr: origin.pr,
    run_id: runId,
    verdict: review.verdict,
    score: review.score,
    counts: block.counts,
    total: block.total,
    offset: block.offset,
    agents: [agentOutcome(review)],
    findings: block.findings,
    ...(block.truncated === undefined ? {} : { truncated: block.truncated }),
  };
  return { ok: true as const, payload };
}

/** The `repo` + `pr` path: reduce to one review per agent, then aggregate. */
async function byRepoAndPr(
  repoSpec: string,
  prNumber: number,
  deps: ToolDeps,
  options: ToolFindingsOptions,
) {
  const pull = await deps.resolver.resolvePull(repoSpec, prNumber);
  if (!pull.ok) return toolFailure(pull.message);
  return byPull(pull.data.id, pull.data.number, pull.data.repo.fullName, deps, options);
}

/**
 * The `pr_id` path: the pull request's row uuid, straight from a studio URL.
 *
 * `repo` can come back `null` here — `PrMeta` carries no `repo_id`, and finding it
 * would cost one live GitHub sync per repository (`resolvePullById`). The reviews
 * route needs only the id, so the name is the one thing that may be missing, and it
 * is omitted from the payload rather than invented.
 */
async function byPrId(prId: string, deps: ToolDeps, options: ToolFindingsOptions) {
  const pull = await deps.resolver.resolvePullById(prId);
  if (!pull.ok) return toolFailure(pull.message);
  return byPull(pull.data.id, pull.data.number, pull.data.repo?.fullName ?? null, deps, options);
}

/** Everything both pull-addressed paths share, once the ids are known. */
async function byPull(
  prId: string,
  prNumber: number,
  repoName: string | null,
  deps: ToolDeps,
  options: ToolFindingsOptions,
) {
  const reviews = await deps.client.listReviews(prId);
  if (!reviews.ok) return toolFailure(instructionFor(reviews.failure));

  const latest = latestReviewPerAgent(reviews.data);
  // Omitted rather than nulled: a `repo` key holding a placeholder is worse than its
  // absence, because a model will quote it back.
  const repoField = repoName === null ? {} : { repo: repoName };

  if (latest.length === 0) {
    const payload: ToolPayload = {
      reviewed: false,
      ...repoField,
      pr: prNumber,
      findings: [],
      next_step: NEVER_REVIEWED_NEXT_STEP,
    };
    return { ok: true as const, payload };
  }

  const block = toolFindingsBlock(
    latest.flatMap((review) => review.findings),
    options,
  );
  const payload: ToolPayload = {
    reviewed: true,
    ...repoField,
    pr: prNumber,
    verdict: aggregateVerdict(latest),
    score: aggregateScore(latest),
    counts: block.counts,
    total: block.total,
    offset: block.offset,
    agents: latest.map(agentOutcome),
    findings: block.findings,
    ...(block.truncated === undefined ? {} : { truncated: block.truncated }),
  };
  return { ok: true as const, payload };
}

export const getFindings: ToolHandler = async (rawArgs, deps) => {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    // The refine's own message is the useful one; a shape problem falls back to
    // the generic text, which still names every accepted argument.
    const issues = describeIssues(parsed.error);
    const refined = parsed.error.issues.find((issue) => issue.message === EITHER_OR_MESSAGE);
    return toolFailure(
      refined === undefined
        ? invalidArgumentsMessage('devdigest_get_findings', issues)
        : EITHER_OR_MESSAGE,
    );
  }

  const args = parsed.data;
  const options: ToolFindingsOptions = {
    format: args.response_format,
    ...(args.offset === undefined ? {} : { offset: args.offset }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
  };

  if (args.run_id !== undefined) return byRunId(args.run_id, deps, options);
  // `pr_id` before the pair for the same reason `run_id` is before both: the more
  // specific address wins, and a uuid names exactly one row.
  if (args.pr_id !== undefined) return byPrId(args.pr_id, deps, options);
  // The refine guarantees both are present on this path; the explicit check is
  // what makes that guarantee visible to the type system without an assertion.
  if (args.repo !== undefined && args.pr !== undefined) {
    return byRepoAndPr(args.repo, args.pr, deps, options);
  }
  return toolFailure(EITHER_OR_MESSAGE);
};
