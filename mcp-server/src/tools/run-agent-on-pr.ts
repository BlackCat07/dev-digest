/**
 * tools/run-agent-on-pr.ts — `devdigest_run_agent_on_pr`, the only tool that
 * writes and the only one that spends a model call.
 *
 * ## Why this file exists at all
 *
 * "Create a review, wait for it, collect the findings" is not an API operation.
 * `POST /pulls/:id/review` is FIRE AND FORGET: `ReviewService.runReview` inserts
 * the `agent_runs` rows, calls `void this.executor.executeRuns(...)` and returns
 * `{runs, reviews: []}` immediately — whatever `ReviewRunResponse`'s doc-comment
 * says about a synchronous run. So the loop that turns three operations into one
 * RESULT lives here, and nowhere else.
 *
 * ## The loop, and each decision in it
 *
 *  - **The POST body is always `{agentId}`.** An empty body makes the server's
 *    `resolveTargets` throw `invalid_run_request` (400). One agent id means
 *    exactly one run, which is what keeps this tool's contract at three statuses.
 *  - **1500 ms before the first poll.** The executor has to insert its rows and
 *    start; polling instantly buys nothing and costs a request.
 *  - **Then `GET /pulls/:id/runs` every `pollIntervalMs`** (2000 ms by default).
 *    The API's rate limit is 120 req/min and it is SHARED with the studio in the
 *    browser, so 2 s (30 req/min) leaves room for a human clicking around.
 *  - **Terminal is `done` / `failed` / `cancelled`, and nothing else.**
 *    `RunSummary.status` is `z.string().nullable()`, so `null` and any
 *    unrecognised string are NOT terminal — treating "not one of the three I
 *    know" as finished would report a running review as complete.
 *  - **Three consecutive absences stop the loop.** `listRunsForPull` does not
 *    verify the pull request exists and answers `[]` for an unknown id, so a loop
 *    keyed on "no runs yet" would spin forever. This one keys on OUR `run_id`:
 *    missing three times running is reported, not waited out.
 *  - **On terminal, exactly ONE `GET /pulls/:id/reviews`.** That is race-free
 *    rather than lucky: `run-executor.ts` writes `insertReview` -> `saveRunTrace`
 *    -> `completeAgentRun`, so a terminal status is a promise that the review row
 *    already exists (`server/INSIGHTS.md`, 2026-08-07, which fixed the opposite
 *    order after a CI-only flake).
 *  - **On the budget, `{status:'running', run_id, next_step}` as a SUCCESS.** One
 *    review can legitimately outlast 120 s — `StructuredRequest.timeoutMs` is
 *    ignored and `maxRetries` defaults to 2, i.e. three attempts of up to 90 s
 *    (`server/INSIGHTS.md`, 2026-08-06) — so this is the NORMAL path, not an edge
 *    case, and it must not read as an error. Nothing is lost: the run id it
 *    returns is the one `devdigest_get_findings` takes.
 *
 * `setTimeout` comes from `node:timers/promises` so the whole loop is drivable
 * from a test without real waiting.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ReviewRecord, RunSummary } from '@devdigest/shared';
import { instructionFor } from '../errors.js';
import { toolFindingsBlock } from './get-findings.js';
import {
  AgentArg,
  PrArg,
  PrIdArg,
  RepoArg,
  describeIssues,
  invalidArgumentsMessage,
  toolFailure,
  type ToolDeps,
  type ToolHandler,
  type ToolOutcome,
  type ToolPayload,
} from './schemas.js';

/**
 * Three arguments, not five. `response_format` and the paging knobs are
 * deliberately absent: if the caller wants detail it already has
 * `devdigest_get_findings` and the `run_id` this tool returns — the same pair the
 * `running` path relies on — and a smaller schema is a cheaper tool to call.
 */
export const RUN_AGENT_INPUT_SHAPE = {
  repo: RepoArg.optional(),
  pr: PrArg.optional(),
  pr_id: PrIdArg,
  agent_id: AgentArg,
} as const;

/** Verbatim in the failure, so the caller is told both accepted combinations. */
export const EITHER_OR_MESSAGE =
  'devdigest_run_agent_on_pr needs `agent_id`, plus EITHER `pr_id` (the pull request uuid from a ' +
  'DevDigest studio URL) OR both `repo` ("owner/name") and `pr` (its GitHub number). Retry ' +
  'with one of those two ways of naming the pull request.';

const ArgsSchema = z
  .object(RUN_AGENT_INPUT_SHAPE)
  .refine((args) => args.pr_id !== undefined || (args.repo !== undefined && args.pr !== undefined), {
    message: EITHER_OR_MESSAGE,
  });

/** Grace period before the first poll, so the executor can get started. */
export const FIRST_POLL_DELAY_MS = 1_500;

/**
 * How many consecutive polls may fail to mention our run before this tool stops
 * and reports. Three, not one: a single absence is plausible mid-write.
 */
export const MAX_CONSECUTIVE_ABSENCES = 3;

/** Cap on the `error` a failed run reports, in characters. */
export const MAX_RUN_ERROR_CHARS = 300;

/**
 * The only statuses that end the wait. Anything else — including `null` and a
 * string this package has never seen — means "keep polling".
 */
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function isTerminal(status: string | null): boolean {
  return status !== null && TERMINAL_STATUSES.has(status);
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/**
 * The `note` for a DISABLED agent that was named explicitly.
 *
 * `resolveTargets` reaches an explicit `agentId` through `getById`, which does
 * **not** filter on `enabled` — only the "review with every agent" path does. So
 * a disabled agent named by id really runs, and the result is real. Saying so is
 * the difference between a surprising answer and a wrong conclusion about which
 * agents are active.
 */
function disabledAgentNote(agentName: string): string {
  return (
    `Agent "${agentName}" is disabled in DevDigest and still ran: naming an agent by id ` +
    'runs it regardless, and only a review across all agents skips disabled ones. These ' +
    'results are real. Enable the agent in the DevDigest studio if it should be part of ' +
    'normal reviews, or pick a different agent id from devdigest_list_agents.'
  );
}

function noRunCreatedMessage(repo: string, pr: number): string {
  return (
    `DevDigest accepted the review request for ${repo} #${pr} but created no run for the ` +
    'agent id given, so there is nothing to wait for. Call devdigest_list_agents and retry ' +
    'devdigest_run_agent_on_pr with an id from its output; if that fails too, check the API ' +
    'log (the terminal running ./scripts/dev.sh).'
  );
}

function stillRunningNextStep(input: {
  readonly runId: string;
  readonly repo: string;
  readonly pr: number;
  readonly waitedMs: number;
}): string {
  return (
    `The review is still running after ${Math.round(input.waitedMs / 1000)}s, which is normal ` +
    'for a large diff - nothing was lost and no work has to be repeated. Call ' +
    `devdigest_get_findings with run_id "${input.runId}" in a minute for the verdict and ` +
    `findings, or with repo "${input.repo}" and pr ${input.pr} if this session has ended by ` +
    'then. Do NOT call devdigest_run_agent_on_pr again for this pull request: that starts a ' +
    'second run and spends a second model call.'
  );
}

function failedNextStep(input: {
  readonly status: string;
  readonly repo: string;
  readonly pr: number;
}): string {
  if (input.status === 'cancelled') {
    return (
      'The run was cancelled, so no review was written. Retry devdigest_run_agent_on_pr for ' +
      `${input.repo} #${input.pr} if you still want the review, and check the DevDigest ` +
      'studio first in case somebody cancelled it deliberately.'
    );
  }
  return (
    'The run failed, so no review was written. Read the error above: a missing or rejected ' +
    'model API key and a rate-limited provider are the common causes, and both are fixed on ' +
    'the Settings screen in the DevDigest studio rather than by retrying. Check the API log ' +
    '(the terminal running ./scripts/dev.sh) for the full message, then retry ' +
    'devdigest_run_agent_on_pr once.'
  );
}

function vanishedRunNextStep(input: {
  readonly repo: string;
  readonly pr: number;
  readonly runId: string;
}): string {
  return (
    'The run was created and then disappeared from the pull request\'s run history, which ' +
    'usually means the API process restarted or the run was deleted in the studio. Check the ' +
    'API log (the terminal running ./scripts/dev.sh), then call devdigest_get_findings with ' +
    `repo "${input.repo}" and pr ${input.pr} to see whether a review was written anyway - ` +
    `retry devdigest_run_agent_on_pr only if it was not. The run id was ${input.runId}.`
  );
}

function missingReviewNextStep(runId: string): string {
  return (
    `The run finished but DevDigest holds no review row for ${runId}, which should not ` +
    'happen: the executor writes the review before it marks a run done. Call ' +
    'devdigest_get_findings with the same repo and pr to see what the pull request does ' +
    'have, and report this line with the run id if it stays empty.'
  );
}

// --------------------------------------------------------------------------
// Payloads
// --------------------------------------------------------------------------

/**
 * The pull request this run targets, by either address form.
 *
 * Returns a failure rather than a nullable repository, because everything
 * downstream — `runOrigins`, `noRunCreatedMessage`, `failedNextStep`, the payload —
 * treats the name as present. Refusing here, with the recommended address form named
 * in the message, is cheaper for a caller than a run reported against "unknown".
 */
type PullTarget =
  | { readonly ok: true; readonly prId: string; readonly repo: string; readonly prNumber: number }
  | { readonly ok: false; readonly message: string };

async function resolvePullTarget(
  // `| undefined` spelled out, not `?:` alone — `exactOptionalPropertyTypes` is on in
  // this package, so an optional property and one that may hold `undefined` are
  // different types, and the parsed args are the second kind.
  args: {
    readonly pr_id?: string | undefined;
    readonly repo?: string | undefined;
    readonly pr?: number | undefined;
  },
  deps: ToolDeps,
): Promise<PullTarget> {
  if (args.pr_id !== undefined) {
    const pull = await deps.resolver.resolvePullById(args.pr_id);
    if (!pull.ok) return { ok: false, message: pull.message };
    if (pull.data.repo === null) {
      return {
        ok: false,
        message:
          `Pull request ${args.pr_id} exists, but DevDigest could not tell which repository ` +
          'it belongs to, and a review has to be reported against one. Retry ' +
          'devdigest_run_agent_on_pr with `repo` as "owner/name" and `pr` as its GitHub ' +
          'number instead.',
      };
    }
    return {
      ok: true,
      prId: pull.data.id,
      repo: pull.data.repo.fullName,
      prNumber: pull.data.number,
    };
  }

  if (args.repo === undefined || args.pr === undefined) {
    return { ok: false, message: EITHER_OR_MESSAGE };
  }
  const pull = await deps.resolver.resolvePull(args.repo, args.pr);
  if (!pull.ok) return { ok: false, message: pull.message };
  return {
    ok: true,
    prId: pull.data.id,
    repo: pull.data.repo.fullName,
    prNumber: pull.data.number,
  };
}

interface RunContext {
  readonly repo: string;
  readonly pr: number;
  readonly agentName: string;
  readonly runId: string;
  /** `note` when a disabled agent was named explicitly; absent otherwise. */
  readonly note?: string;
}

/** `run_id`, `duration_ms` and `cost_usd` — what the run itself cost. */
function runBlock(runId: string, run: RunSummary | undefined) {
  return {
    run_id: runId,
    duration_ms: run?.duration_ms ?? null,
    cost_usd: run?.cost_usd ?? null,
  };
}

function completedPayload(
  context: RunContext,
  run: RunSummary,
  review: ReviewRecord | undefined,
): ToolPayload {
  const block = toolFindingsBlock(review?.findings ?? []);
  return {
    status: 'completed',
    repo: context.repo,
    pr: context.pr,
    agent: context.agentName,
    ...(context.note === undefined ? {} : { note: context.note }),
    verdict: review?.verdict ?? null,
    score: review?.score ?? null,
    counts: block.counts,
    run: runBlock(context.runId, run),
    findings: block.findings,
    summary: review?.summary ?? null,
    ...(block.truncated === undefined ? {} : { truncated: block.truncated }),
    ...(review === undefined ? { next_step: missingReviewNextStep(context.runId) } : {}),
  };
}

function failedPayload(context: RunContext, run: RunSummary): ToolPayload {
  const status = run.status ?? 'failed';
  const error =
    run.error === null || run.error.trim() === ''
      ? `The run ended as "${status}" and recorded no error message.`
      : cap(run.error.trim(), MAX_RUN_ERROR_CHARS);
  return {
    status: 'failed',
    repo: context.repo,
    pr: context.pr,
    agent: context.agentName,
    ...(context.note === undefined ? {} : { note: context.note }),
    run: runBlock(context.runId, run),
    error,
    next_step: failedNextStep({ status, repo: context.repo, pr: context.pr }),
  };
}

function runningPayload(context: RunContext, waitedMs: number): ToolPayload {
  return {
    status: 'running',
    run_id: context.runId,
    ...(context.note === undefined ? {} : { note: context.note }),
    next_step: stillRunningNextStep({
      runId: context.runId,
      repo: context.repo,
      pr: context.pr,
      waitedMs,
    }),
  };
}

/**
 * Our run stopped appearing in the pull request's run history. Reported as
 * `failed` — the three statuses are the whole contract, and `running` would
 * promise something this server can no longer observe.
 */
function vanishedPayload(context: RunContext, pollIntervalMs: number): ToolPayload {
  return {
    status: 'failed',
    repo: context.repo,
    pr: context.pr,
    agent: context.agentName,
    ...(context.note === undefined ? {} : { note: context.note }),
    run: runBlock(context.runId, undefined),
    error:
      `This MCP server could not find run ${context.runId} in the run history of ` +
      `${context.repo} #${context.pr}: it was missing from ${MAX_CONSECUTIVE_ABSENCES} ` +
      `consecutive polls, ${Math.round(pollIntervalMs / 1000)}s apart.`,
    next_step: vanishedRunNextStep({
      repo: context.repo,
      pr: context.pr,
      runId: context.runId,
    }),
  };
}

// --------------------------------------------------------------------------

/**
 * Is this agent disabled? Answered from the resolver's memoised `GET /agents`,
 * and a failure to answer is not a failure of the run: no note, and the review
 * still gets reported.
 */
async function disabledNote(agentId: string, deps: ToolDeps): Promise<string | undefined> {
  const agents = await deps.resolver.agents();
  if (!agents.ok) return undefined;
  const agent = agents.data.find((candidate) => candidate.id === agentId);
  if (agent === undefined || agent.enabled) return undefined;
  return disabledAgentNote(agent.name);
}

export const runAgentOnPr: ToolHandler = async (rawArgs, deps) => {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const refined = parsed.error.issues.find((issue) => issue.message === EITHER_OR_MESSAGE);
    return toolFailure(
      refined === undefined
        ? invalidArgumentsMessage('devdigest_run_agent_on_pr', describeIssues(parsed.error))
        : EITHER_OR_MESSAGE,
    );
  }
  const args = parsed.data;

  // A uuid wins when both are given — it names exactly one row. Unlike the two read
  // tools, this one cannot proceed without the repository NAME: it builds ten
  // sentences out of it and stores it in `runOrigins` for a later
  // `devdigest_get_findings`. `resolvePullById` pays to find it (see its comment), so
  // a null here means even that failed, and asking for the recommended address form
  // is better than a run whose every message says "unknown repository".
  const resolved = await resolvePullTarget(args, deps);
  if (!resolved.ok) return toolFailure(resolved.message);
  const { prId, repo, prNumber } = resolved;

  // Always `{agentId}`: an empty body is a 400 from `resolveTargets`.
  const started = await deps.client.startReview(prId, args.agent_id);
  if (!started.ok) {
    // A 404 here is the agent id, not the pull request - that was just resolved.
    // The resolver owns the text because it can name the ids that do exist.
    if (started.failure.kind === 'not_found') {
      return toolFailure(await deps.resolver.unknownAgentMessage(args.agent_id));
    }
    return toolFailure(instructionFor(started.failure));
  }

  const target = started.data.runs.find((run) => run.agent_id === args.agent_id) ?? started.data.runs[0];
  if (target === undefined) return toolFailure(noRunCreatedMessage(repo, prNumber));

  const note = await disabledNote(args.agent_id, deps);
  const context: RunContext = {
    repo,
    pr: prNumber,
    agentName: target.agent_name,
    runId: target.run_id,
    ...(note === undefined ? {} : { note }),
  };

  // Remember which pull request this run belongs to BEFORE waiting, not after
  // collecting: the whole point of the index is the `running` path, where this
  // tool hands the model a run id it will bring back to `devdigest_get_findings`.
  // Registering it at collection time would leave exactly that path unresolvable.
  // (The API has no run-scoped read of a review - see `get-findings.ts`.)
  deps.runOrigins.set(context.runId, {
    prId,
    repo: context.repo,
    pr: context.pr,
    agentName: context.agentName,
  });

  deps.logger.info('review started, waiting', {
    repo,
    pr: context.pr,
    run_id: context.runId,
    timeout_ms: deps.config.runTimeoutMs,
  });

  return waitForRun(context, prId, deps);
};

/** The wait loop. Returns one of the three statuses, never throws. */
async function waitForRun(
  context: RunContext,
  prId: string,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  const startedAt = Date.now();
  const deadline = startedAt + deps.config.runTimeoutMs;
  let absences = 0;

  await delay(FIRST_POLL_DELAY_MS);

  for (;;) {
    const runs = await deps.client.listRuns(prId);
    if (!runs.ok) return toolFailure(instructionFor(runs.failure));

    const run = runs.data.find((candidate) => candidate.run_id === context.runId);

    if (run === undefined) {
      absences += 1;
      if (absences >= MAX_CONSECUTIVE_ABSENCES) {
        deps.logger.warn('run vanished from the pull request run history', {
          run_id: context.runId,
          polls: absences,
        });
        return { ok: true, payload: vanishedPayload(context, deps.config.pollIntervalMs) };
      }
    } else {
      absences = 0;
      if (isTerminal(run.status)) return collect(context, prId, run, deps);
    }

    if (Date.now() >= deadline) {
      const waitedMs = Date.now() - startedAt;
      deps.logger.info('run budget exhausted, returning status running', {
        run_id: context.runId,
        waited_ms: waitedMs,
      });
      return { ok: true, payload: runningPayload(context, waitedMs) };
    }

    await delay(deps.config.pollIntervalMs);
  }
}

/**
 * The run is terminal. One read of `GET /pulls/:id/reviews`, and only on the
 * `done` path — a failed or cancelled run wrote no review, so asking would be a
 * request that can only answer "nothing".
 */
async function collect(
  context: RunContext,
  prId: string,
  run: RunSummary,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  if (run.status !== 'done') return { ok: true, payload: failedPayload(context, run) };

  const reviews = await deps.client.listReviews(prId);
  if (!reviews.ok) return toolFailure(instructionFor(reviews.failure));

  const review = reviews.data.find(
    (candidate) => candidate.kind === 'review' && candidate.run_id === context.runId,
  );

  return { ok: true, payload: completedPayload(context, run, review) };
}
