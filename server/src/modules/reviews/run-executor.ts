import type { Container } from '../../platform/container.js';
import type { PrIntent, Provider, Review, RunTrace, ToolCall, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * The PR's intent, resolved ONCE for every queued run (L03).
 *
 * Two things travel together because they are produced by the same call and
 * consumed in two different places: `block` is the pre-rendered prompt slot
 * (`assemblePrompt` wraps it as untrusted and the engine never learns Intent's
 * shape), and `call` is the leading `derive_intent` entry of the run trace's
 * `tool_calls`, so one trace document shows both model calls in order.
 */
type ResolvedIntent = {
  block: string;
  call: ToolCall;
};

/**
 * A derivation started alongside the diff load, and the moment it started.
 *
 * Already folded into a settled shape — the promise NEVER rejects — because the
 * review may stop waiting for it (see {@link INTENT_INLINE_BUDGET_MS}), and an
 * abandoned rejecting promise is how this API has died twice
 * (`server/INSIGHTS.md`, 2026-08-06 / 2026-08-07).
 */
type IntentAttempt = { ok: true; intent: PrIntent } | { ok: false; error: string };

type PendingIntent = {
  attempt: Promise<IntentAttempt>;
  startedAt: number;
};

/**
 * How long a review is willing to WAIT for an intent it does not have yet.
 *
 * The derivation runs CONCURRENTLY with the diff load rather than after it, so
 * on the normal path it costs a review nothing at all — by the time the diff is
 * assembled the classifier has usually answered, and a PR whose intent is
 * already fresh returns without a model call.
 *
 * This budget is what bounds the abnormal path. `INTENT_CALL_DEADLINE_MS` is
 * 45s, sized for the JOB path where nobody is waiting; `executeRuns` runs
 * outside `JobRunner`, so before this constant existed a slow classifier held
 * EVERY queued agent for up to 45s before the first one started. 10s is roughly
 * one model round-trip — the most a review should pay for a slot that is, by the
 * feature's own rule, optional.
 *
 * Losing the race is not a failure and nothing is cancelled: the derivation
 * keeps running under its own deadline, records itself on the `pr_intent` row
 * (ok / partial / failed), and the next review of this PR finds it already
 * there. The row cannot be left stuck on `running` by this path — the writer is
 * the derivation, not the waiter — and `INTENT_STALE_AFTER_MS` remains the guard
 * against a dead PROCESS, not against a routine timeout.
 */
const INTENT_INLINE_BUDGET_MS = 10_000;

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff and derives the intent
 * once — concurrently, and the intent only until the review's own budget runs
 * out — then map-reduces each agent, streaming events over the runBus and
 * persisting each review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff and derives the intent once, concurrently, then map-reduces
   * each agent, streaming events over the runBus and persisting each review.
   * Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        // Trace BEFORE the terminal status: readers poll agent_runs.status and
        // fetch the trace the moment it turns terminal, so the trace row must
        // already be committed by then.
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    // The run's FIRST model call, started HERE — before the diff load and
    // CONCURRENTLY with it, not after it. Both are shared pre-work for every
    // queued agent, neither needs the other's result, and the intent is by the
    // feature's own rule optional; awaiting it in sequence made every agent of
    // every review wait for a classifier that has its own 45s ceiling.
    //
    // Nothing is awaited yet and nothing can throw: `startIntent` folds both
    // outcomes into a resolved value.
    const pendingIntent = this.startIntent(workspaceId, pull);

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      // The derivation outlives this function on purpose: it records its own
      // outcome on the `pr_intent` row, and abandoning it cannot reject.
      return;
    }

    // Collect what the concurrent derivation produced, bounded by the review's
    // own budget. Fanned out over every queued run like the diff above, so both
    // model calls are visible in one Live Log and one trace.
    //
    // Deliberately NOT wrapped in failAll: `resolveIntent` never throws, and a
    // review without an intent is a worse review, not a broken one.
    const intent = await runLog.step(
      'Deriving PR intent',
      () => this.resolveIntent(pendingIntent, runLog),
      { kind: 'tool' },
    );

    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          intent,
          agent,
          runId,
          runLog,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    intent: ResolvedIntent | undefined,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // L02 — the agent's enabled skills, in link order. Resolution (enabled
      // filter + untrusted-source wrapping) belongs to the skills service; this
      // module only decides that a run wants them.
      const skills = await this.resolveSkills(agent.id, runLog);

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // L03 — the PR's derived intent and scope, PRE-RENDERED above. Same
        // omit-when-empty contract as every slot around it: an agent with no
        // intent produces a byte-identical prompt to the pre-L03 one, because
        // assemblePrompt drops the whole "## Stated intent and scope" section
        // (and with it the scope-labelling rule) rather than emitting an empty
        // heading. The block is wrapped as untrusted THERE, in the one place
        // this repo does that — never by hand here.
        ...(intent ? { intent: intent.block } : {}),
        // L02 — linked skill bodies, same omit-when-empty contract. An agent
        // with no enabled skills therefore produces a byte-identical prompt to
        // the pre-L02 one: assemblePrompt drops the whole "## Skills / rules"
        // section rather than emitting an empty heading.
        ...(skills.bodies.length ? { skills: skills.bodies } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      const keptFindings = outcome.review.findings;

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, keptFindings);
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // L02 — record which skills this run actually carried, so per-skill stats
      // read from what happened rather than from today's links. Written on the
      // success path only: a run that never reached the model carried nothing.
      await this.container.skills.recordRunSkills(runId, skills.used);

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: ONE run_traces document + agent_runs --------------
      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: outcome.assembly,
        // The intent derivation LEADS the list, ahead of the review calls, so
        // one trace document shows the run's two distinct model calls in the
        // order they happened. Absent when no intent was resolved.
        tool_calls: [
          ...(intent ? [intent.call] : []),
          ...outcome.chunks.map((c) => ({
            tool: 'review_file',
            args: c.label,
            meta: outcome.mode,
            ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
          })),
        ],
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      // Trace first, terminal status second: anything polling agent_runs.status
      // (the UI, the integration tests) fetches the trace as soon as the run
      // reads `done`, so the trace row must already be committed at that point.
      await this.repo.saveRunTrace(runId, trace);
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
      });
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      // Same ordering rule as the success path: trace before terminal status.
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * L03 — start the PR's derivation, without waiting for it.
   *
   * Called before the diff load so the two run concurrently. The staleness
   * decision stays inside `IntentService.derive`, reached through the container:
   * that method claims the row, bounds its one model call, records its own
   * failure, and returns a fresh intent for the current head SHA without calling
   * a model at all.
   *
   * Both outcomes are folded into a RESOLVED value here, at the moment the work
   * starts, so that whoever stops waiting for it (or never waits at all, when
   * the diff load fails) leaves behind a promise that cannot reject.
   */
  private startIntent(workspaceId: string, pull: PullRow): PendingIntent {
    const startedAt = Date.now();
    const attempt = this.container.intent.derive(workspaceId, pull.id).then(
      (intent): IntentAttempt => ({ ok: true, intent }),
      (err: Error): IntentAttempt => ({ ok: false, error: err.message }),
    );
    return { attempt, startedAt };
  }

  /**
   * L03 — the PR's derived intent and scope, for the prompt and for the trace.
   *
   * Best-effort, exactly like `buildCallersDigest`, `buildRepoMapDigest` and
   * `resolveSkills`: anything short of a usable intent emits ONE `runLog.info`
   * and returns `undefined`. It must NEVER reach `failAll` — a review without an
   * intent is a worse review, not a broken one, and the prompt then omits the
   * section entirely.
   *
   * Three ways to end with no slot, all of them normal: the derivation failed,
   * it produced a row with no intent text, or it had not answered within
   * {@link INTENT_INLINE_BUDGET_MS}. Only the last one leaves work behind, and
   * that work finishes on its own and writes the row.
   */
  private async resolveIntent(
    pending: PendingIntent,
    runLog: RunLogger,
  ): Promise<ResolvedIntent | undefined> {
    const settled = await Promise.race([pending.attempt, deadline(INTENT_INLINE_BUDGET_MS)]);
    if (settled === null) {
      runLog.info(
        `intent: not derived within ${INTENT_INLINE_BUDGET_MS}ms — reviewing without it; ` +
          `the derivation continues in the background and the next review will find it`,
      );
      return undefined;
    }
    if (!settled.ok) {
      runLog.info(`intent: derivation failed — ${settled.error}`);
      return undefined;
    }
    const intent = settled.intent;
    const ms = Date.now() - pending.startedAt;

    const block = renderIntentBlock(intent);
    if (!block) {
      runLog.info(`intent: none available (status=${intent.status}) — reviewing without it`);
      return undefined;
    }

    const provider = intent.provider ?? 'unknown';
    const model = intent.model ?? 'unknown';
    const promptTokens = this.container.tokenizer.count(block);
    // Provider, model, a token estimate, two counts and a status. NOTHING else:
    // no prompt text, no source body, no diff line, no secret. `RunLogger.event`
    // forwards this object VERBATIM into pino and this server configures no
    // `redact` anywhere, so what is passed here is what lands in the log.
    runLog.info(
      `intent: ${provider}/${model} — ~${promptTokens} prompt token(s), ${intent.sources.length} source(s), status=${intent.status}`,
      {
        provider,
        model,
        promptTokens,
        sources: intent.sources.length,
        status: intent.status,
        confidence: intent.confidence,
        ms,
      },
    );

    return {
      block,
      call: {
        tool: 'derive_intent',
        args: `${provider}/${model}`,
        meta: `sources=${intent.sources.length} status=${intent.status}`,
        ms,
      },
    };
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  /**
   * L02 — the agent's enabled skill bodies, in link order, plus the provenance
   * to record against the run.
   *
   * Best-effort like its repo-intel siblings: a skills lookup that fails must not
   * fail the review. Degrading to no skills reproduces the pre-L02 prompt exactly,
   * which is a strictly worse review, not a broken one — and it is visible,
   * because the run trace then shows no "## Skills / rules" block.
   */
  private async resolveSkills(
    agentId: string,
    runLog: RunLogger,
  ): Promise<{ bodies: string[]; used: Array<{ skillId: string; version: number; order: number }> }> {
    try {
      const resolved = await this.container.skills.resolveBodiesForAgent(agentId);
      if (resolved.bodies.length > 0) {
        runLog.info(`skills: ${resolved.bodies.length} enabled skill(s) attached to the prompt`);
      }
      return resolved;
    } catch (err) {
      runLog.info(`skills: resolution failed — ${(err as Error).message}`);
      return { bodies: [], used: [] };
    }
  }

  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}

/**
 * Resolves to `null` after `ms`, to be raced against work a run must not wait on.
 *
 * The timer is `unref`'d so a pending deadline can never hold the process open
 * after the run has moved on — the loser of the race is abandoned, not
 * cancelled, and Node would otherwise wait for it at shutdown.
 */
function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
}

/**
 * Render a stored intent into the compact markdown block the prompt slot takes.
 *
 * Returns `undefined` when there is no intent TEXT — a row that is still
 * `running`, or one that only exists to record a failure, has nothing to say to
 * the reviewer, and an empty block would add a heading and the scope-labelling
 * rule for no content.
 *
 * Deliberately description only: not one line of it instructs the model. The
 * labelling instruction is `SCOPE_LABEL_RULE` in `reviewer-core`, appended to
 * the system message when this slot is present — this text reaches the model
 * inside the prompt builder's untrusted-data delimiters and is read as data,
 * which is what makes the classifier's own output safe to re-inject. The
 * delimiters are applied THERE, in the one place this repo applies them, and
 * never by hand in this file.
 */
function renderIntentBlock(intent: PrIntent): string | undefined {
  const text = intent.intent?.trim();
  if (!text) return undefined;

  const sections: string[] = [text];
  const list = (heading: string, items: string[]) => {
    const kept = items.map((i) => i.trim()).filter((i) => i.length > 0);
    if (kept.length > 0) sections.push([`${heading}:`, ...kept.map((i) => `- ${i}`)].join('\n'));
  };
  list('In scope', intent.in_scope);
  list('Out of scope', intent.out_of_scope);
  // What we could not read, stated plainly — so the reviewer treats the scope
  // above as incomplete rather than authoritative.
  list('Context the classifier did not have', intent.missing_context);
  sections.push(
    `Derivation: confidence ${intent.confidence.toFixed(2)}, ` +
      `${intent.sources.length} source(s), status ${intent.status}.`,
  );
  return sections.join('\n\n');
}
