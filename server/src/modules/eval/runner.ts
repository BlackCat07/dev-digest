import { Provider } from '@devdigest/shared';
import type {
  EvalAgentCase,
  EvalAnchor,
  EvalBatch,
  EvalCaseOutcome,
  EvalExpectation,
  EvalTrialRunResult,
  LLMProvider,
  RunEventKind,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, scoreEvalBatch } from '@devdigest/reviewer-core';
import type {
  EvalCaseOutput,
  EvalCaseScore,
  EvalScoreCase,
  ReviewInput,
  ReviewOutcome,
} from '@devdigest/reviewer-core';
import {
  BATCH_DEADLINE_MS,
  CASE_CONCURRENCY,
  CASE_DEADLINE_MS,
  HEARTBEAT_MS,
} from './constants.js';
import type { DiffParser, EvalSkillSource, EvalStore } from './types.js';

/**
 * Batch execution: replay every stored case through the review engine, publish
 * one event per outcome, score once, and record what happened.
 *
 * **The engine is reached UNCHANGED.** `reviewPullRequest` is called exactly as
 * `modules/reviews/run-executor.ts` calls it, with the batch's snapshotted
 * prompt and model, the agent's enabled skill bodies and the provider off the
 * container. It gains no
 * eval-specific parameter and no eval-specific branch, because if it behaved
 * differently under evaluation the harness would be measuring the harness. The
 * stored diff — untrusted foreign text — reaches the model through the engine's
 * own `wrapUntrusted` and injection guard inside `assemblePrompt`, and there is
 * NO second prompt assembly here: the guard is a module-private const in
 * `reviewer-core`, so there is nothing to duplicate and nothing to re-implement.
 *
 * **Nothing here writes a `pull_requests`, `reviews`, `findings` or `agent_runs`
 * row, and nothing resolves a clone.** A batch is a replay of stored text; it
 * produces `eval_runs` rows and one `eval_batches` update, and that is all. The
 * only honest way to assert that is a fake whose every other port method throws
 * with its own name, which is what `test/eval-runner.test.ts` does.
 *
 * **An agent is a prompt, a model AND its linked skills.** The prompt and the
 * model are the batch's own snapshot; the skill bodies are resolved from the
 * agent's CURRENT links, through the same skills service the real review path
 * uses, once per batch. The asymmetry is not an oversight:
 * `agent_versions.config_json.skills` stores skill ids with no version numbers,
 * so an old batch cannot be replayed against the skills it actually ran with —
 * and "the skills as linked right now" is what makes editing a skill move
 * recall, precision and citation accuracy, which is one of the three levers this
 * whole feature exists to provide.
 *
 * **This is not a `JobRunner` job.** `JobRunner`'s timeout is a fixed 120 s and
 * a batch's deadline is fifteen minutes, so it runs detached from the request
 * that started it, with its failure recorded ON the batch row — a batch that
 * fails needs its row updated, not merely to survive.
 *
 * Three bounds, all of them the caller's:
 *
 *  - **the per-case deadline is raced here**, because the provider request's own
 *    `timeoutMs` field is silently ignored (the timeout is fixed when the client
 *    is constructed) and a deadline expressed in the request is a deadline that
 *    does not exist;
 *  - **the retry budget is set to 0 on every call**, because the default turns
 *    one bounded call into three unbounded ones behind a deadline the caller
 *    thinks it owns;
 *  - **concurrency is fixed at `CASE_CONCURRENCY` and never tuned.** Tuning a
 *    batch size against a live provider does not converge — 4 and 5 each both
 *    fit and overran on different runs of the same repository and model — and a
 *    wave-level deadline made it worse by discarding answers that had arrived.
 *    Bounded concurrency with per-call deadlines keeps whatever answered.
 */

/* ─── ports ───────────────────────────────────────────────────────────────── */

/**
 * The progress stream, narrowed to the two calls a batch makes on it.
 *
 * Satisfied structurally by `platform/sse.ts`'s `RunBus` — the same bus a review
 * run publishes to, keyed here on the BATCH id, so the SSE route needs no second
 * transport. Declared as a port rather than imported so a test can count events
 * without a subscriber.
 */
export interface EvalProgressBus {
  publish(streamId: string, kind: RunEventKind, msg: string, data?: unknown): unknown;
  complete(streamId: string): void;
}

/**
 * The review engine, as a call signature.
 *
 * `reviewPullRequest` itself is the only implementation, and it is the default
 * below — this type exists so a test can observe the call the runner makes
 * without a module mock (this package has none, and adding one for a single
 * seam would introduce a second testing dialect). The engine is still imported
 * and still reached unchanged: nothing about the call differs under evaluation,
 * which is the whole point of replaying through it.
 */
export type ReviewEngine = (input: ReviewInput) => Promise<ReviewOutcome>;

/** Everything one batch execution needs. */
export interface EvalRunnerDeps {
  store: EvalStore;
  parseDiff: DiffParser;
  llm: (id: Provider) => Promise<LLMProvider>;
  bus: EvalProgressBus;
  /**
   * The agent's enabled skill bodies. Required rather than optional: an eval
   * batch that quietly measured an agent without its skills would answer the
   * wrong question, and a missing wire should be a compile error rather than a
   * silently thinner prompt.
   */
  skills: EvalSkillSource;
  /** Injected clock, in milliseconds. */
  now?: () => number;
  /** Defaults to `reviewPullRequest`. Substituted only by a test. */
  review?: ReviewEngine;
  /**
   * The four bounds, defaulting to the module's constants. Overridable ONLY so a
   * test can exercise a deadline or a concurrency ceiling in milliseconds rather
   * than in minutes — production passes none of them and the constants are the
   * single place the figures live.
   */
  concurrency?: number;
  caseDeadlineMs?: number;
  batchDeadlineMs?: number;
  heartbeatMs?: number;
}

/**
 * The subset of a case this runner actually replays and scores.
 *
 * Narrower than `EvalAgentCase` on purpose: a TRIAL run has no stored row, so
 * there is no id to take, no owner and no `last_execution` — and a signature
 * demanding them would force the service to fabricate four fields to run a
 * draft. `EvalAgentCase` satisfies this structurally, so the batch path passes
 * its stored cases through unchanged.
 *
 * `id` is still required, because the scorer keys its per-case result on one.
 * A draft passes a constant; nothing persists it.
 */
export interface EvalRunnableCase {
  id: string;
  name: string;
  input_diff: string;
  expectation: EvalExpectation;
  expected_anchors: EvalAnchor[];
}

/**
 * The prompt identity one case is replayed under.
 *
 * A batch takes it from its own snapshot (`system_prompt_snapshot` /
 * `model_snapshot`), because a run's numbers belong to the prompt that produced
 * them. A trial takes it from the agent's CURRENT config, because the question
 * a trial answers is "does this reproduce against the agent as it is now".
 */
interface CaseExecConfig {
  systemPrompt: string;
  model: string;
  /** Prefixes the engine session id; the case id is appended. */
  sessionPrefix: string;
}

/**
 * One trial execution of an unsaved draft.
 *
 * There is no batch and no workspace here, and that is the shape of the promise:
 * this path writes no `eval_batches` row, no `eval_runs` row and publishes
 * nothing — so it needs neither an id to write under nor a workspace to scope a
 * write to. The service has already resolved the agent (which IS the
 * authorization check) before it builds one of these.
 */
export interface EvalTrialRunInput {
  /** Whose skills are resolved, and whose session id is derived. */
  agentId: string;
  systemPrompt: string;
  model: string;
  provider: string;
  evalCase: EvalRunnableCase;
}

/** What the service hands over when it opens a batch. */
export interface EvalBatchRunInput {
  workspaceId: string;
  /** The stored batch, carrying the prompt and model snapshots to replay with. */
  batch: EvalBatch;
  /** The agent's provider id as stored. Parsed here, never cast. */
  provider: string;
  /** Every case this batch sets out to cover. */
  cases: readonly EvalAgentCase[];
}

/**
 * The runner as the service sees it: fire and forget.
 *
 * `start` returns `void` and NEVER rejects. A discarded rejecting promise has
 * killed this API process before, and a batch's failure belongs on the batch row
 * where a reader will find it — not in an unhandled rejection warning.
 */
export interface EvalBatchRunner {
  start(input: EvalBatchRunInput): void;
  /**
   * Run ONE unsaved draft and answer with its outcome.
   *
   * Awaited rather than detached, which is the opposite of `start` and for the
   * opposite reason: a trial exists to be read, it is bounded by one
   * `CASE_DEADLINE_MS`, and there is no row for its answer to be recovered from
   * afterwards. It rejects only when the agent's skills cannot be resolved —
   * every failure of the case itself is an outcome, not a throw.
   */
  runTrial(input: EvalTrialRunInput): Promise<EvalTrialRunResult>;
}

/**
 * What a batch's `error` column says when the batch outlived its deadline.
 *
 * It lives HERE and is re-exported by nobody: `service.ts` imports it from this
 * file, and this file imports nothing from `service.ts`. The dependency between
 * the two rings runs one way only, because a cycle between a service and its
 * runner is two files that are really one — and `no-circular` would say so.
 */
export const BATCH_DEADLINE_ERROR = 'The batch exceeded its 15-minute deadline';

/* ─── internals ───────────────────────────────────────────────────────────── */

/** Raised by the per-case deadline race, and never by the engine. */
class CaseDeadlineError extends Error {
  constructor() {
    super('case deadline exceeded');
    this.name = 'CaseDeadlineError';
  }
}

/**
 * One case's execution, before it is scored.
 *
 * `output` is the scorer's own two-way marker: `output` with findings and the
 * grounding gate's kept/dropped counts, or `no_output` with a reason. The
 * distinction is what keeps "the agent ran and found nothing" (a `must_find`
 * failure) apart from "the case never reached an answer" (neither a pass nor a
 * failure), and it is why the counts live INSIDE the `output` variant — a case
 * that never executed structurally cannot contribute to citation accuracy.
 */
interface CaseRecord {
  readonly evalCase: EvalRunnableCase;
  readonly output: EvalCaseOutput;
  readonly durationMs: number;
  readonly costUsd: number | null;
}

/** The scorer's view of one executed case. */
function toScoreCase(record: CaseRecord): EvalScoreCase {
  return {
    case_id: record.evalCase.id,
    expectation: record.evalCase.expectation,
    expected_anchors: record.evalCase.expected_anchors,
    output: record.output,
  };
}

/**
 * The batch's total cost, or null.
 *
 * **Null, never a smaller sum.** One executed case with an unavailable cost makes
 * the whole total unmeasurable: a sum that silently skips the gaps is how a PR
 * list once reported `$0.00064` of a real `$0.0051`, and a cost that is quietly
 * wrong is worse than one that is absent. A batch where nothing executed
 * measured no cost at all, which is also null and not zero.
 */
function totalCost(records: readonly CaseRecord[]): number | null {
  let sum = 0;
  let executed = 0;
  for (const record of records) {
    if (record.output.kind !== 'output') continue;
    executed += 1;
    if (record.costUsd === null) return null;
    sum += record.costUsd;
  }
  return executed === 0 ? null : sum;
}

/**
 * Which stream kind one outcome is published as.
 *
 * `not_run` is an `error` frame rather than an `info` one: nothing was measured,
 * and a progress stream that reports that as ordinary progress is how an
 * infrastructure failure reads as a result.
 */
function eventKindFor(outcome: EvalCaseOutcome): RunEventKind {
  return outcome === 'not_run' ? 'error' : 'result';
}

/* ─── the runner ──────────────────────────────────────────────────────────── */

export class EvalRunner implements EvalBatchRunner {
  constructor(private readonly deps: EvalRunnerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private get engine(): ReviewEngine {
    return this.deps.review ?? reviewPullRequest;
  }

  /**
   * Detach the batch from the request that asked for it.
   *
   * The `.catch` is belt and braces: {@link execute} already records its own
   * failures and resolves either way, and this catches the case where recording
   * the failure is itself what failed.
   */
  start(input: EvalBatchRunInput): void {
    void this.execute(input).catch(() => undefined);
  }

  /**
   * Run one batch to completion. Awaitable, and it does not reject.
   *
   * The event stream is closed in `finally` whatever happened, because a
   * subscriber waiting on a stream that will never speak again is worse than a
   * batch that failed.
   */
  async execute(input: EvalBatchRunInput): Promise<void> {
    const batchId = input.batch.id;
    const deadline = this.now() + (this.deps.batchDeadlineMs ?? BATCH_DEADLINE_MS);
    const heartbeat = this.startHeartbeat(batchId, input.cases.length);

    try {
      // ONCE per batch, before the first case: every case in a batch shares one
      // agent and one set of links, so resolving per case would issue N
      // identical reads and make the call count meaningless as evidence.
      const skills = await this.resolveSkills(input.batch.agent_id);
      const records = await this.runCases(input, skills, deadline, heartbeat.touch);
      await this.recordCompletion(input, records, this.now() >= deadline);
    } catch (err) {
      await this.recordFailure(input, err);
    } finally {
      heartbeat.stop();
      this.deps.bus.complete(batchId);
    }
  }

  /**
   * One unsaved draft, run once against the agent as it is configured NOW.
   *
   * Everything this method does not do is the point of it. No `eval_batches`
   * row is opened, no `eval_runs` row is written, nothing is published to the
   * bus and no retention is trimmed — a reader pressing `Run case` four times
   * to see whether a finding reproduces must not move the agent's recall four
   * times, and a batch row per press would do exactly that. The only shared
   * machinery is the part that has to be shared: the same `runCase` the batch
   * path replays through, and the same pure `scoreEvalBatch` its outcomes come
   * from, so "passed" here and "passed" in a batch cannot come to mean two
   * different things.
   *
   * The skills are the agent's current links, resolved the same way a batch
   * resolves them, and a failure to resolve them REJECTS rather than degrading
   * to none — a trial measured without the agent's skills would answer a
   * question nobody asked, and quietly.
   *
   * Bounded by one `CASE_DEADLINE_MS`, which is what makes awaiting it inside a
   * request defensible where awaiting a whole batch is not.
   */
  async runTrial(input: EvalTrialRunInput): Promise<EvalTrialRunResult> {
    const skills = await this.resolveSkills(input.agentId);
    const record = await this.runCase(
      {
        systemPrompt: input.systemPrompt,
        model: input.model,
        sessionPrefix: `eval-trial:${input.agentId}`,
      },
      input.evalCase,
      skills,
      this.memoisedProvider(input.provider),
    );
    const score = this.scoreOne(record);
    const output = record.output;
    return {
      outcome: score.outcome,
      not_run_reason: score.not_run_reason,
      expected_count: score.expected_count,
      actual_count: score.actual_count,
      kept_count: output.kind === 'output' ? output.kept_count : null,
      dropped_count: output.kind === 'output' ? output.dropped_count : null,
      duration_ms: record.durationMs,
      cost_usd: record.costUsd,
      // What the agent actually SAID, so a reader can see why a run disagrees
      // with the expectation rather than only that it did. Null when nothing
      // was produced — never an empty findings array, which would claim the
      // agent answered and found nothing.
      actual_output: output.kind === 'output' ? { findings: output.findings } : null,
    };
  }

  /**
   * A heartbeat while nothing has resolved.
   *
   * A case can legitimately take the full per-case deadline, so "no event yet"
   * is indistinguishable from "the connection died" without one. `touch` is
   * called on every real outcome so a busy batch sends none.
   */
  private startHeartbeat(
    batchId: string,
    total: number,
  ): { touch: () => void; stop: () => void } {
    const every = this.deps.heartbeatMs ?? HEARTBEAT_MS;
    let last = this.now();
    const timer = setInterval(() => {
      if (this.now() - last < every) return;
      last = this.now();
      this.deps.bus.publish(batchId, 'info', 'Still running…', { total });
    }, every);
    // Never hold the process open for a heartbeat.
    timer.unref?.();
    return {
      touch: () => {
        last = this.now();
      },
      stop: () => clearInterval(timer),
    };
  }

  /**
   * Every case, at most `CASE_CONCURRENCY` at a time, each recorded and
   * published as it resolves.
   *
   * A fixed pool of workers pulling from one cursor rather than waves of
   * `Promise.all`: a wave finishes at its slowest member, so a set of one slow
   * case and eight fast ones spends most of its time with two idle slots.
   *
   * `results` is index-aligned with `input.cases`, so the batch is scored in the
   * set's own order however the workers interleaved.
   */
  private async runCases(
    input: EvalBatchRunInput,
    skills: readonly string[],
    deadline: number,
    touch: () => void,
  ): Promise<CaseRecord[]> {
    const cases = input.cases;
    const results = new Array<CaseRecord | undefined>(cases.length);
    const provider = this.memoisedProvider(input.provider);
    // The batch's OWN snapshot, never the agent's current config: a run's
    // numbers belong to the prompt that produced them.
    const exec: CaseExecConfig = {
      systemPrompt: input.batch.system_prompt_snapshot,
      model: input.batch.model_snapshot,
      sessionPrefix: `eval:${input.batch.id}`,
    };
    const total = cases.length;
    let cursor = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= cases.length) return;
        const evalCase = cases[index];
        if (!evalCase) return;

        // Past the batch deadline, no further case STARTS. The remaining ones
        // are still recorded — `cancelled`, in neither tally and inside the
        // covered total — because a batch that quietly dropped what it did not
        // reach is a batch that reports 4/5 for a set of five and looks improved.
        const record =
          this.now() >= deadline
            ? this.cancelled(evalCase)
            : await this.runCase(exec, evalCase, skills, provider);

        results[index] = record;
        done += 1;
        await this.recordCase(input, record, done, total);
        touch();
      }
    };

    const width = Math.max(1, Math.min(this.deps.concurrency ?? CASE_CONCURRENCY, cases.length));
    await Promise.all(Array.from({ length: width }, () => worker()));

    // Every slot was filled by the loop above; the filter satisfies the compiler
    // without a cast, and a missing slot would be a bug we do not paper over.
    return results.filter((r): r is CaseRecord => r !== undefined);
  }

  /**
   * The provider, resolved at most once per batch and only if a case gets far
   * enough to need it.
   *
   * Lazy on purpose: a batch whose every case has an unparseable diff must reach
   * the provider zero times, and the cheapest way to prove that is for the
   * factory itself never to be called.
   */
  private memoisedProvider(raw: string): () => Promise<LLMProvider> {
    let pending: Promise<LLMProvider> | undefined;
    return () => (pending ??= this.resolveProvider(raw));
  }

  /** Parse the stored provider id, never cast it. An unknown one is a case's `provider_error`. */
  private async resolveProvider(raw: string): Promise<LLMProvider> {
    const parsed = Provider.safeParse(raw);
    if (!parsed.success) throw new Error(`Unknown LLM provider '${raw}'`);
    return this.deps.llm(parsed.data);
  }

  /** A case the batch never started, because the batch ran out of time. */
  private cancelled(evalCase: EvalRunnableCase): CaseRecord {
    return {
      evalCase,
      output: { kind: 'no_output', reason: 'cancelled' },
      durationMs: 0,
      costUsd: null,
    };
  }

  /**
   * One case: parse, replay, and never anything else.
   *
   * The diff is parsed FIRST, and a diff that parses to no files is recorded
   * `not_run` / `diff_unparseable` with **zero** model calls — the provider is
   * not even resolved. That is a real case rather than a defensive branch:
   * `eval_cases.input_diff` is a nullable column mapping to `''` for a row that
   * predates this feature, and an empty diff must cost nothing and never pass.
   */
  private async runCase(
    exec: CaseExecConfig,
    evalCase: EvalRunnableCase,
    skills: readonly string[],
    provider: () => Promise<LLMProvider>,
  ): Promise<CaseRecord> {
    const started = this.now();
    const diff = this.parse(evalCase.input_diff);
    if (!diff) {
      return {
        evalCase,
        output: { kind: 'no_output', reason: 'diff_unparseable' },
        durationMs: this.now() - started,
        costUsd: null,
      };
    }

    try {
      const llm = await provider();
      const outcome = await this.withDeadline(() =>
        this.engine({
          // Whatever prompt identity the caller decided on — a batch's stored
          // snapshot, or the agent's current config for a trial. Neither is
          // chosen here: see {@link CaseExecConfig}.
          systemPrompt: exec.systemPrompt,
          model: exec.model,
          diff,
          llm,
          // R9 — the caller owns the deadline, so the provider must not multiply
          // the work behind it. The engine takes a retry-budget override for
          // exactly this reason.
          maxRetries: 0,
          sessionId: `${exec.sessionPrefix}:${evalCase.id}`,
          // The agent's enabled skill bodies, in link order, ALREADY wrapped by
          // the skills service where a body's source is untrusted — passed
          // through untouched, exactly as `run-executor.ts:350` passes them.
          //
          // Spread OMIT-WHEN-EMPTY, and that is load-bearing rather than
          // cosmetic: `assemblePrompt` drops the whole "## Skills / rules"
          // section when the field is absent, so an agent with no enabled skills
          // must produce a BYTE-IDENTICAL prompt to one where the key was never
          // passed. `skills: []` instead of an omitted key would make every
          // batch recorded before this line incomparable to every batch after
          // it — the one thing a regression harness may not do.
          ...(skills.length ? { skills: [...skills] } : {}),
        }),
      );
      return {
        evalCase,
        output: {
          kind: 'output',
          // The GROUNDED findings — what the agent actually said after the
          // citation gate, which is the output a reviewer accepted or dismissed.
          findings: outcome.review.findings,
          // The grounding gate's own counts. No second grounding pass, and no
          // new definition of "cited correctly".
          kept_count: outcome.review.findings.length,
          dropped_count: outcome.dropped.length,
        },
        durationMs: this.now() - started,
        costUsd: outcome.costUsd,
      };
    } catch (err) {
      return {
        evalCase,
        output: {
          kind: 'no_output',
          reason: err instanceof CaseDeadlineError ? 'deadline' : 'provider_error',
        },
        durationMs: this.now() - started,
        costUsd: null,
      };
    }
  }

  /**
   * The agent's enabled skill bodies, or none.
   *
   * **Not best-effort, unlike `run-executor.ts`'s own `resolveSkills`.** There, a
   * failed lookup makes for a worse review and never a broken one, so it degrades
   * to nothing and logs. Here, degrading silently would record a NUMBER against
   * an agent measured without its skills — a lie the dashboard cannot detect and
   * a comparison that then reads as a regression the prompt did not cause. So
   * nothing is caught: `execute` records the failure on the batch row with its
   * reason, where a reader will find it.
   *
   * `agent_id` is nullable because deleting an agent leaves its batches readable.
   * A batch whose agent is gone has no links to resolve, which is no skills — not
   * an error.
   */
  private async resolveSkills(agentId: string | null): Promise<readonly string[]> {
    if (!agentId) return [];
    const resolved = await this.deps.skills.resolveBodiesForAgent(agentId);
    return resolved.bodies;
  }

  /** The stored diff as files and hunks, or null when it carries none. */
  private parse(raw: string): UnifiedDiff | null {
    try {
      const parsed = this.deps.parseDiff(raw);
      return parsed.files.length > 0 ? parsed : null;
    } catch {
      // A parser is free to throw on garbage; to this caller that is the same
      // fact as "no files", and it is named `diff_unparseable` either way.
      return null;
    }
  }

  /**
   * Race one model call against the deadline this caller owns.
   *
   * The abandoned side of the race still settles, and an abandoned REJECTING
   * promise has taken this API process down twice, so it is neutralised here
   * rather than left to the runtime. The engine keeps running behind a lost
   * race; nothing reads its answer, and it holds no row open.
   */
  private async withDeadline<T>(work: () => Promise<T>): Promise<T> {
    const ms = this.deps.caseDeadlineMs ?? CASE_DEADLINE_MS;
    const running = work();
    void running.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CaseDeadlineError()), ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([running, expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Persist and publish one case as it resolves.
   *
   * Scored through the same pure `scoreEvalBatch` the batch's metrics come
   * from — a one-element batch — so the outcome on this row and the outcome
   * inside the totals cannot disagree. Nothing is recounted here: the expected
   * and actual counts are the scorer's, not a second reading of the same rule.
   */
  private async recordCase(
    input: EvalBatchRunInput,
    record: CaseRecord,
    done: number,
    total: number,
  ): Promise<void> {
    const score = this.scoreOne(record);
    const output = record.output;

    await this.deps.store.insertRun({
      caseId: record.evalCase.id,
      batchId: input.batch.id,
      actualOutput: output.kind === 'output' ? { findings: output.findings } : null,
      outcome: score.outcome,
      notRunReason: score.not_run_reason,
      expectedCount: score.expected_count,
      actualCount: score.actual_count,
      keptCount: output.kind === 'output' ? output.kept_count : null,
      droppedCount: output.kind === 'output' ? output.dropped_count : null,
      durationMs: record.durationMs,
      costUsd: record.costUsd,
    });

    this.deps.bus.publish(
      input.batch.id,
      eventKindFor(score.outcome),
      `${record.evalCase.name} — ${score.outcome}${
        score.not_run_reason ? ` (${score.not_run_reason})` : ''
      }`,
      {
        case_id: record.evalCase.id,
        case_name: record.evalCase.name,
        outcome: score.outcome,
        not_run_reason: score.not_run_reason,
        expected_count: score.expected_count,
        actual_count: score.actual_count,
        done,
        total,
      },
    );
  }

  private scoreOne(record: CaseRecord): EvalCaseScore {
    const scored = scoreEvalBatch([toScoreCase(record)]).cases[0];
    if (!scored) throw new Error('scoreEvalBatch returned no score for one case');
    return scored;
  }

  /**
   * Score the whole batch once, after the last case, and record it.
   *
   * **Zero model requests happen between the last case's response and this
   * write.** Scoring is arithmetic — file equality and line-range overlap — so
   * there is nothing here that could issue one, which is what makes that
   * criterion structural rather than remembered.
   *
   * Every count comes from the scorer, including `cases_covered`: a `not_run`
   * case counts in the covered total and in neither the passed nor the failed
   * one, and re-deriving that here is how the two would drift.
   */
  private async recordCompletion(
    input: EvalBatchRunInput,
    records: readonly CaseRecord[],
    overran: boolean,
  ): Promise<void> {
    const score = scoreEvalBatch(records.map(toScoreCase));
    await this.deps.store.updateBatch(input.workspaceId, input.batch.id, {
      // A batch that outlived its deadline is an `error` with its reason
      // recorded, even though every case it did reach was measured and kept.
      status: overran ? 'error' : 'complete',
      finishedAt: new Date(this.now()),
      casesCovered: score.cases_covered,
      casesPassed: score.cases_passed,
      recall: score.metrics.recall,
      precision: score.metrics.precision,
      citationAccuracy: score.metrics.citation_accuracy,
      truePositives: score.metrics.true_positives,
      falseNegatives: score.metrics.false_negatives,
      falsePositives: score.metrics.false_positives,
      costUsd: totalCost(records),
      error: overran ? BATCH_DEADLINE_ERROR : null,
    });
  }

  /**
   * The batch itself failed — a store that threw, or anything unforeseen.
   *
   * The row is updated with `status: 'error'` and the reason, and NO metric is
   * invented: a failure path that wrote zeroes would put a number on the
   * dashboard that nothing measured. If even this write fails there is nothing
   * left to do but let `start`'s catch swallow it; the stream still closes.
   */
  private async recordFailure(input: EvalBatchRunInput, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.deps.bus.publish(input.batch.id, 'error', `Batch failed: ${message}`);
    await this.deps.store.updateBatch(input.workspaceId, input.batch.id, {
      status: 'error',
      error: message,
      finishedAt: new Date(this.now()),
    });
  }
}
