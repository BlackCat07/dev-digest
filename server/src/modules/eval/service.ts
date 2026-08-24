import type {
  EvalAgentCase,
  EvalAnchor,
  EvalBatch,
  EvalBatchCaseResult,
  EvalCaseSave,
  EvalComparison,
  EvalDashboardRow,
  EvalExpectation,
  EvalPeriod,
  EvalRefusalReason,
  EvalRunAllResult,
  EvalWorkspaceDashboard,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { BATCH_DEADLINE_MS, BATCH_RETENTION, CASE_LIMIT, DIFF_MAX_BYTES } from './constants.js';
import {
  anchorsOverlap,
  diffByteLength,
  diffFragmentFor,
  normaliseAnchor,
  periodStart,
  toEvalBatchTrendPoint,
} from './helpers.js';
import { BATCH_DEADLINE_ERROR } from './runner.js';
import type { EvalBatchRunner } from './runner.js';
import type {
  DiffParser,
  EvalAgentFacts,
  EvalAgentSource,
  EvalFindingSource,
  EvalSourceFinding,
  EvalStore,
  Evals,
} from './types.js';

/**
 * The application ring of the Eval Pipeline: every use case, every refusal, and
 * every aggregate the dashboards render.
 *
 * What it does NOT contain is the point of the file. No query lives here (they
 * are all behind {@link EvalStore}), no SDK is named, no `db/schema` is imported,
 * and no sibling module is reached — findings, pull requests, agents and the diff
 * parser all arrive as the consumer-declared ports in `./types.js`, which the
 * composition root satisfies structurally. `routes.ts` is a thin mapper over
 * this class (`DDG-ARCH-001`): every decision below is one a route must not be
 * able to make differently.
 *
 * **A workspace id is the first argument of every method and it IS the
 * authorization check.** No eval read is reachable by id alone: an agent, a case
 * or a batch outside the caller's workspace answers with this module's own
 * `not_found` (the service envelope), never with Fastify's route-not-found and
 * never with someone else's data. A finding is reached through
 * `getPull(workspaceId, prId)` FIRST, and only then by id — see
 * {@link EvalFindingSource}.
 *
 * **On transactions.** The service owns the transaction boundary in this module,
 * and the honest answer for every use case below is that none needs one — which
 * is stated rather than assumed, because a service awaiting two repository calls
 * in sequence has written a two-statement transaction with no transaction, and
 * the failure only shows when the second throws. There are exactly three
 * multi-write paths here, and each is safe under a partial failure:
 *
 *  - **case creation** is a single `insertCase`. Every refusal above it is a
 *    read, so nothing is written before the check that would forbid it;
 *  - **`startBatch`** closes any STALE `running` batch, inserts the new batch,
 *    then trims the retention tail. A crash after the stale close leaves a batch
 *    marked `error` that was already dead; a crash after the insert leaves the
 *    tail untrimmed until the next run, which is what a cap of 50 tolerates by
 *    construction. Rolling either back would be worse than leaving it;
 *  - **`runAllAgents`** is a loop of independent `startBatch` calls, and a batch
 *    that started must not be undone because a later agent's did not.
 *
 * Nothing here awaits two writes that must land together, so `EvalStore` needs
 * no `tx` parameter and `repository.ts` opens no transaction of its own.
 */

/* ─── refusals ────────────────────────────────────────────────────────────── */

/**
 * A named refusal, carrying its {@link EvalRefusalReason} as the error CODE.
 *
 * The reason is the `code` and not a detail because that is what a client reads:
 * the error envelope is `{ error: { code, message, details } }`, the client's
 * `ApiError` carries `code`, and `messages/en/prReview.json` keys one sentence
 * per refusal member off exactly that value. A `ValidationError` would answer
 * the right STATUS with the fixed code `validation_error`, and a finding card
 * would have nothing to render but "422".
 *
 * `422` for every refusal that says "this input cannot become a case", `409` for
 * the duplicate — which is not a bad request at all: the case already exists,
 * and the refusal carries its id so the caller can go and look at it.
 */
export class EvalRefusal extends AppError {
  constructor(
    public readonly reason: EvalRefusalReason,
    message: string,
    statusCode = 422,
    details?: unknown,
  ) {
    super(reason, message, statusCode, details);
    this.name = 'EvalRefusal';
  }
}

/* ─── dependencies ────────────────────────────────────────────────────────── */

/**
 * Everything the service needs, as ports.
 *
 * Declared here rather than in `./types.js` because it is this ring's own
 * dependency list; `types.ts` declares the shapes the module is a CONSUMER of.
 * The composition root binds all five: `store` to `EvalRepository`, `findings`
 * to `container.reviewRepo`, `agents` to `container.agentsRepo`, `parseDiff` to
 * the container's own `diffParser` arrow property, and `runner` to
 * {@link EvalBatchRunner}.
 *
 * `now` is injected so the staleness window and the period filter give the same
 * answer twice: a service that reads the clock itself cannot be tested for a
 * boundary at all.
 */
export interface EvalDeps {
  store: EvalStore;
  findings: EvalFindingSource;
  agents: EvalAgentSource;
  parseDiff: DiffParser;
  runner: EvalBatchRunner;
  now?: () => Date;
}

/* ─── pure decisions, stated once ─────────────────────────────────────────── */

/**
 * What a decided finding asserts, or null when it is undecided.
 *
 * An accepted finding is something the agent SHOULD say (`must_find`); a
 * dismissed one is something it should not (`must_not_flag`). Acceptance wins if
 * a row somehow carries both timestamps — a finding a human accepted is one they
 * wanted, and the reading that keeps a real expectation is the one that measures
 * something.
 */
function expectationFor(finding: EvalSourceFinding): EvalExpectation | null {
  if (finding.acceptedAt) return 'must_find';
  if (finding.dismissedAt) return 'must_not_flag';
  return null;
}

/** Earlier first, by started-at then id — a total order, as every list here has. */
function chronological(a: EvalBatch, b: EvalBatch): [EvalBatch, EvalBatch] {
  const ta = Date.parse(a.started_at);
  const tb = Date.parse(b.started_at);
  if (ta !== tb) return ta < tb ? [a, b] : [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

/**
 * One metric, side by side. `change` is null whenever EITHER side is null, so
 * "not measured" can never render as "no movement".
 */
function delta(
  earlier: number | null,
  later: number | null,
): { earlier: number | null; later: number | null; change: number | null } {
  return { earlier, later, change: earlier === null || later === null ? null : later - earlier };
}

/** The three metrics an alert may name, in the order the UI lists them. */
const ALERT_METRICS = ['recall', 'precision', 'citation_accuracy'] as const;

/**
 * The regression alert for a pair of consecutive completed batches: the metric
 * that fell furthest, and by how much.
 *
 * Structured rather than a sentence — the server decides WHICH metric regressed
 * and by how much, the client owns the wording and the unit. Null when there is
 * no previous batch, or when nothing fell: a metric that improved is not an
 * alert, and a metric that is null on either side did not move, it was never
 * measured.
 */
function regressionAlert(
  latest: EvalBatch | null,
  previous: EvalBatch | null,
): EvalDashboardRow['alert'] {
  if (!latest || !previous) return null;
  let worst: NonNullable<EvalDashboardRow['alert']> | null = null;
  for (const metric of ALERT_METRICS) {
    const now = latest[metric];
    const before = previous[metric];
    if (now === null || before === null) continue;
    const change = now - before;
    if (change >= 0) continue;
    if (!worst || change < worst.change) worst = { metric, change };
  }
  return worst;
}

/**
 * One dashboard row from one agent (or one orphaned batch group) and its
 * batches, newest first.
 *
 * Only COMPLETED batches carry numbers, so only they feed `last_batch`, the
 * trend and the alert: a `running` batch has three null metrics and would draw a
 * hole in the chart, and an `error` batch's numbers are not final. `trend` is
 * reversed into chronological order because a chart reads left to right, and the
 * client counts its length to decide whether a sparkline is meaningful at all.
 */
function dashboardRow(input: {
  agentId: string | null;
  agentName: string | null;
  model: string;
  casesTotal: number;
  batches: readonly EvalBatch[];
}): EvalDashboardRow {
  const completed = input.batches.filter((b) => b.status === 'complete');
  const latest = completed[0] ?? null;
  const previous = completed[1] ?? null;
  return {
    agent_id: input.agentId,
    agent_name: input.agentName,
    model: input.model,
    cases_total: input.casesTotal,
    last_batch: latest
      ? {
          batch_id: latest.id,
          agent_version: latest.agent_version,
          started_at: latest.started_at,
          cases_covered: latest.cases_covered,
          cases_passed: latest.cases_passed,
          recall: latest.recall,
          precision: latest.precision,
          citation_accuracy: latest.citation_accuracy,
        }
      : null,
    trend: [...completed].reverse().map(toEvalBatchTrendPoint),
    alert: regressionAlert(latest, previous),
  };
}

/* ─── the service ─────────────────────────────────────────────────────────── */

export class EvalService implements Evals {
  constructor(private readonly deps: EvalDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /**
   * Resolve an agent INSIDE the caller's workspace, or refuse to admit it
   * exists.
   *
   * This is the authorization check for every agent-scoped read and write, and
   * the reason each of them starts with it: an agent id from another workspace
   * must answer `404` with this module's own envelope, which is observably
   * different from Fastify's route-not-found and is how "no eval read is
   * reachable by id alone" is checkable.
   */
  private async requireAgent(workspaceId: string, agentId: string): Promise<EvalAgentFacts> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireBatch(workspaceId: string, batchId: string): Promise<EvalBatch> {
    const batch = await this.deps.store.getBatch(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval batch not found');
    return batch;
  }

  /** The file paths a stored diff parses to, or none when it parses to nothing. */
  private filesIn(rawDiff: string): Set<string> {
    try {
      return new Set(this.deps.parseDiff(rawDiff).files.map((f) => f.path));
    } catch {
      // An unparseable diff contains no files, which is the same answer a caller
      // needs and one the parser is free to reach by throwing.
      return new Set<string>();
    }
  }

  // ---- cases --------------------------------------------------------------

  /**
   * Turn one decided finding into an eval case for the agent that produced it.
   *
   * The order of the checks is the requirement, not an implementation detail.
   * The two facts about the finding itself come first, because neither depends
   * on the set; the duplicate check comes before the size and the diff, because
   * a finding that is already a case is not a new case and must never be refused
   * as `case_limit_reached`; and the anchor conflict comes before the diff
   * assembly, because it is one read against rows we already need.
   *
   * The stored input is a ONE-FILE fragment of the pull request's diff — the
   * finding's own file, assembled in the shape `diffFromPrFiles` uses, so the
   * parser on the other end derives the same new-side line numbers the review
   * that produced the finding did. A fragment shaped differently would anchor at
   * lines the agent can never report.
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalAgentCase> {
    const context = await this.deps.findings.findingContext(findingId);
    if (!context) throw new NotFoundError('Finding not found');
    const { finding, review } = context;

    // AUTHORIZATION. `findingContext` is by id alone; this is the read that
    // scopes it, and everything below reaches the PR's files through `pull`.
    const pull = await this.deps.findings.getPull(workspaceId, review.prId);
    if (!pull) throw new NotFoundError('Finding not found');

    const agentId = review.agentId;
    if (!agentId) {
      throw new EvalRefusal(
        'review_has_no_agent',
        'The review this finding belongs to ran without an agent, so there is no eval set to file it under',
      );
    }

    const expectation = expectationFor(finding);
    if (!expectation) {
      throw new EvalRefusal(
        'finding_has_no_decision',
        'Accept or dismiss this finding before turning it into an eval case',
      );
    }

    const duplicate = await this.deps.store.findCaseBySourceFinding(workspaceId, finding.id);
    if (duplicate) {
      throw new EvalRefusal(
        'duplicate_source_finding',
        `This finding is already eval case '${duplicate.name}'`,
        409,
        { case_id: duplicate.id, case_name: duplicate.name },
      );
    }

    const size = await this.deps.store.countCases(workspaceId, 'agent', agentId);
    if (size >= CASE_LIMIT) {
      throw new EvalRefusal(
        'case_limit_reached',
        `This agent already holds ${CASE_LIMIT} eval cases, which is the limit`,
      );
    }

    const anchor = normaliseAnchor(finding.file, finding.startLine, finding.endLine);
    const conflict = await this.findConflict(workspaceId, agentId, expectation, anchor);
    if (conflict) {
      throw new EvalRefusal(
        'conflicting_anchor',
        `Eval case '${conflict.caseName}' already asserts the opposite for these lines`,
        422,
        { case_id: conflict.caseId, case_name: conflict.caseName },
      );
    }

    const files = await this.deps.findings.getPrFiles(pull.id);
    const inputDiff = diffFragmentFor(files, finding.file);
    if (inputDiff === null) {
      // The finding's file is not among the PR's patches (or GitHub omitted the
      // patch, as it does for a binary or very large file). There is no diff to
      // replay, so there is no case — named with the reason a reader can act on.
      throw new EvalRefusal(
        'anchor_not_in_diff',
        `The pull request carries no diff for '${finding.file}'`,
        422,
        { file: finding.file },
      );
    }

    const bytes = diffByteLength(inputDiff);
    if (bytes > DIFF_MAX_BYTES) {
      throw new EvalRefusal(
        'diff_too_large',
        `That file's diff is ${bytes} bytes, over the ${DIFF_MAX_BYTES}-byte limit for a stored eval case`,
        422,
        { bytes, limit: DIFF_MAX_BYTES },
      );
    }

    const repo = await this.deps.findings.getRepo(pull.repoId);

    return this.deps.store.insertCase({
      workspaceId,
      // `agent`, always: a case derived from a review's finding belongs to the
      // agent that produced it. `EvalOwnerKind`'s `skill` half stays unused.
      ownerKind: 'agent',
      ownerId: agentId,
      name: `${finding.file}:${anchor.low_line}-${anchor.high_line}`,
      inputDiff,
      // The one file the fragment carries, and the PR it was cut from — what the
      // case editor's `Files` and `PR meta` tabs read. Metadata, never an input
      // to a score.
      inputFiles: [{ path: finding.file }],
      inputMeta: {
        repo: repo ? repo.fullName : null,
        pr_number: pull.number,
        pr_title: pull.title,
        review_id: review.id,
      },
      expectedOutput: {},
      expectation,
      expectedAnchors: [anchor],
      sourceFindingId: finding.id,
      // Snapshotted, not joined: `source_finding_id` carries no foreign key by
      // design, so this call is the only moment what the finding WAS is still
      // reachable. A case whose review is deleted later still renders its chip.
      sourceSeverity: finding.severity,
      sourceCategory: finding.category,
    });
  }

  /**
   * The existing case whose anchors contradict this one, if any.
   *
   * "Contradict" is the OTHER expectation overlapping on the same file: two
   * `must_find` cases about the same lines are redundant but consistent, while a
   * `must_find` and a `must_not_flag` on overlapping lines cannot both be
   * satisfied and would make the set unscoreable. The predicate is
   * `anchorsOverlap` from `helpers.ts` — the same one the scorer decides "the
   * agent found it" with, stated once so the refusal and the score cannot mean
   * different things.
   */
  private async findConflict(
    workspaceId: string,
    agentId: string,
    expectation: EvalExpectation,
    anchor: EvalAnchor,
  ): Promise<{ caseId: string; caseName: string } | undefined> {
    const sets = await this.deps.store.listCaseAnchors(workspaceId, 'agent', agentId);
    return sets.find(
      (s) => s.expectation !== expectation && s.anchors.some((a) => anchorsOverlap(a, anchor)),
    );
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalAgentCase[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.deps.store.listCases(workspaceId, 'agent', agentId);
  }

  /**
   * Save a hand-edited case, as submitted.
   *
   * Two guards, and both are about the case staying runnable rather than about
   * taste. `anchor_not_in_diff` applies to a `must_not_flag` case because a
   * forbidden anchor on a file the diff does not contain forbids nothing: the
   * case would pass for free in every batch it appeared in and quietly raise the
   * pass count. A `must_find` anchor off the diff is a different thing — it
   * FAILS, loudly and correctly, so it is allowed to be saved and to fail.
   *
   * The byte budget is re-applied here because a bound that only holds at
   * creation is not a bound: the stored diff is replayed into a provider on
   * every run of the set, and the editor is a text area.
   */
  async saveCase(workspaceId: string, caseId: string, body: EvalCaseSave): Promise<EvalAgentCase> {
    const existing = await this.deps.store.getCase(workspaceId, caseId);
    if (!existing) throw new NotFoundError('Eval case not found');

    const bytes = diffByteLength(body.input_diff);
    if (bytes > DIFF_MAX_BYTES) {
      throw new EvalRefusal(
        'diff_too_large',
        `That diff is ${bytes} bytes, over the ${DIFF_MAX_BYTES}-byte limit for a stored eval case`,
        422,
        { bytes, limit: DIFF_MAX_BYTES },
      );
    }

    if (body.expectation === 'must_not_flag') {
      const paths = this.filesIn(body.input_diff);
      const missing = body.expected_anchors.find((a) => !paths.has(a.file));
      if (missing) {
        throw new EvalRefusal(
          'anchor_not_in_diff',
          `This case's diff contains no file '${missing.file}', so nothing there can be forbidden`,
          422,
          { file: missing.file },
        );
      }
    }

    const saved = await this.deps.store.updateCase(workspaceId, caseId, {
      name: body.name,
      inputDiff: body.input_diff,
      expectedOutput: body.expected_output,
      expectation: body.expectation,
      expectedAnchors: body.expected_anchors,
    });
    if (!saved) throw new NotFoundError('Eval case not found');
    return saved;
  }

  /**
   * Drop a case.
   *
   * Every stored batch keeps its recorded metrics and counts: they live on
   * `eval_batches`, computed when the batch completed, and nothing here
   * recomputes them. A number that changed because the set changed afterwards
   * would not be comparable with the number it was compared against.
   */
  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.deps.store.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError('Eval case not found');
  }

  // ---- batches ------------------------------------------------------------

  /**
   * Open a batch and hand it to the runner.
   *
   * Acknowledges with a `running` batch BEFORE the first case executes: a set of
   * fifty cases at two minutes each cannot be answered inside a request, and the
   * caller follows the event stream keyed on the id returned here.
   *
   * The agent's config version, system prompt and model are read ONCE, here, and
   * stored on the batch as text. Nothing re-reads them: an `agent_versions` row
   * is deleted with its agent, and a comparison that renders "the prompt that
   * produced this number" from a row which may be gone is a comparison that can
   * start lying.
   *
   * Staleness is a rule, not a query. `listRunningBatches` returns every
   * `running` batch of this agent and this method decides: one younger than
   * `BATCH_DEADLINE_MS` is genuinely in flight and refuses the request, while an
   * older one is an orphan from a dead process — it is closed as `error` with
   * its reason recorded, and the new run proceeds. Without that, one crashed
   * batch would block the agent for ever.
   */
  async startBatch(
    workspaceId: string,
    agentId: string,
    options?: { label?: string | null; caseId?: string | null },
  ): Promise<EvalBatch> {
    const agent = await this.requireAgent(workspaceId, agentId);

    const now = this.now();
    const running = await this.deps.store.listRunningBatches(workspaceId, agentId);
    const isStale = (b: EvalBatch): boolean =>
      now.getTime() - Date.parse(b.started_at) >= BATCH_DEADLINE_MS;

    if (running.some((b) => !isStale(b))) {
      throw new EvalRefusal(
        'batch_already_running',
        'A batch is already running for this agent',
        422,
      );
    }
    for (const orphan of running) {
      await this.deps.store.updateBatch(workspaceId, orphan.id, {
        status: 'error',
        error: BATCH_DEADLINE_ERROR,
        finishedAt: now,
      });
    }

    const cases = options?.caseId
      ? [await this.requireCaseOfAgent(workspaceId, options.caseId, agentId)]
      : await this.deps.store.listCases(workspaceId, 'agent', agentId);

    const batch = await this.deps.store.insertBatch({
      workspaceId,
      agentId,
      agentVersion: agent.version,
      systemPromptSnapshot: agent.systemPrompt,
      modelSnapshot: agent.model,
      label: options?.label ?? null,
    });

    // Retention runs on the way IN, so the cap is enforced by the act that
    // breaches it. A failure here leaves the tail for the next run to trim,
    // which is why it is not inside the insert's atomicity.
    await this.deps.store.pruneAgentBatches(workspaceId, agentId, BATCH_RETENTION);

    // Detached, deliberately: this is not a background JOB (`JobRunner`'s
    // timeout is a fixed 120 s and a batch's deadline is fifteen minutes), and
    // the request must return the `running` batch now. `start` never rejects —
    // it records its own failure on the batch row, because a batch that failed
    // needs its row updated and not merely to survive.
    this.deps.runner.start({
      workspaceId,
      batch,
      provider: agent.provider,
      cases,
    });

    return batch;
  }

  /** One case of THIS agent, or a `404` — a case id from another set is not a set. */
  private async requireCaseOfAgent(
    workspaceId: string,
    caseId: string,
    agentId: string,
  ): Promise<EvalAgentCase> {
    const found = await this.deps.store.getCase(workspaceId, caseId);
    if (!found || found.owner_kind !== 'agent' || found.owner_id !== agentId) {
      throw new NotFoundError('Eval case not found');
    }
    return found;
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ batch: EvalBatch; cases: EvalBatchCaseResult[] }> {
    const batch = await this.requireBatch(workspaceId, batchId);
    const cases = await this.deps.store.listBatchCaseResults(workspaceId, batchId);
    return { batch, cases };
  }

  async listBatches(
    workspaceId: string,
    agentId: string,
    period: EvalPeriod,
  ): Promise<EvalBatch[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.deps.store.listAgentBatches(workspaceId, agentId, periodStart(period, this.now()));
  }

  /**
   * Two batches of one agent, side by side.
   *
   * Refused unless both batches name the SAME, still-present agent. Two batches
   * whose `agent_id` is null are two batches whose agent was deleted, and
   * nothing left in either row can prove they were the same agent's — comparing
   * them would be a claim the data does not support.
   *
   * The arguments are named earlier/later for the caller's intent, and the
   * response is ordered by started-at regardless: a client that selected two
   * rows in either order still reads "earlier → later → change" the same way
   * round.
   */
  async compare(
    workspaceId: string,
    earlierBatchId: string,
    laterBatchId: string,
  ): Promise<EvalComparison> {
    const [a, b] = await Promise.all([
      this.requireBatch(workspaceId, earlierBatchId),
      this.requireBatch(workspaceId, laterBatchId),
    ]);

    if (a.agent_id === null || b.agent_id === null || a.agent_id !== b.agent_id) {
      throw new EvalRefusal(
        'cross_agent_compare',
        'Two batches of different agents cannot be compared',
      );
    }

    const [earlier, later] = chronological(a, b);
    return {
      earlier_batch_id: earlier.id,
      later_batch_id: later.id,
      earlier_agent_version: earlier.agent_version,
      later_agent_version: later.agent_version,
      earlier_system_prompt: earlier.system_prompt_snapshot,
      later_system_prompt: later.system_prompt_snapshot,
      // Both batches ran the same stored config, so the prompt-diff region has
      // nothing to draw and says so instead of rendering an empty box.
      same_config: earlier.agent_version === later.agent_version,
      recall: delta(earlier.recall, later.recall),
      precision: delta(earlier.precision, later.precision),
      citation_accuracy: delta(earlier.citation_accuracy, later.citation_accuracy),
      cost_usd: delta(earlier.cost_usd, later.cost_usd),
    };
  }

  // ---- dashboards ---------------------------------------------------------

  async agentDashboard(
    workspaceId: string,
    agentId: string,
    period: EvalPeriod,
  ): Promise<EvalDashboardRow> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const [batches, casesTotal] = await Promise.all([
      this.deps.store.listAgentBatches(workspaceId, agentId, periodStart(period, this.now())),
      this.deps.store.countCases(workspaceId, 'agent', agentId),
    ]);
    return dashboardRow({
      agentId: agent.id,
      agentName: agent.name,
      model: agent.model,
      casesTotal,
      batches,
    });
  }

  /**
   * One row per agent, plus a cross-agent list of recent batches.
   *
   * The per-agent grouping keys on `agent_id ?? 'row:' + id`, and the fallback
   * half is load-bearing rather than defensive: `eval_batches.agent_id` is
   * nullable with `ON DELETE SET NULL`, so a map keyed on the raw value collapses
   * every agent-deleted row into ONE bucket, and everything summed per bucket
   * then drops all but one of them — no error, no type failure, just a dashboard
   * quietly reporting a fraction of the truth.
   *
   * Every bucket that is not a live agent becomes its own row with a null agent
   * id and name and the model taken from the batch's own snapshot: a batch whose
   * agent has been deleted stays readable, with its agent presented as
   * unavailable, rather than vanishing along with the numbers it recorded.
   */
  async workspaceDashboard(
    workspaceId: string,
    period: EvalPeriod,
  ): Promise<EvalWorkspaceDashboard> {
    const since = periodStart(period, this.now());
    const [agents, batches, counts] = await Promise.all([
      this.deps.agents.list(workspaceId),
      this.deps.store.listWorkspaceBatches(workspaceId, since),
      this.deps.store.countCasesByOwner(workspaceId, 'agent'),
    ]);

    const casesByOwner = new Map(counts.map((c) => [c.ownerId, c.count]));
    const grouped = new Map<string, EvalBatch[]>();
    for (const batch of batches) {
      const key = batch.agent_id ?? `row:${batch.id}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(batch);
      else grouped.set(key, [batch]);
    }

    const rows = agents.map((agent) =>
      dashboardRow({
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        casesTotal: casesByOwner.get(agent.id) ?? 0,
        batches: grouped.get(agent.id) ?? [],
      }),
    );

    const live = new Set(agents.map((a) => a.id));
    for (const [key, bucket] of grouped) {
      if (live.has(key)) continue;
      const first = bucket[0];
      if (!first) continue;
      rows.push(
        dashboardRow({
          agentId: first.agent_id,
          agentName: first.agent_name,
          model: first.model_snapshot,
          // The agent is gone, so its set is gone with it. The batch's own
          // `cases_covered` still says what it measured.
          casesTotal: 0,
          batches: bucket,
        }),
      );
    }

    return { period, rows, recent_batches: batches.slice(0, BATCH_RETENTION) };
  }

  /**
   * Start a batch for every agent that can run one, and name every skip.
   *
   * A disabled agent and an agent holding no cases are the two skips the
   * contract enumerates, and each is named with its id and reason because a
   * reader cannot otherwise tell them apart — "nothing happened for this agent"
   * is not an answer.
   *
   * One case the `skipped` enum cannot express: an agent whose previous batch is
   * still genuinely in flight. Rather than invent a reason or drop the agent
   * silently, the batch already running for it is returned in `created` — the
   * postcondition "exactly one batch per eligible agent, and it is `running`"
   * still holds, no second row is written, and the client's per-agent progress
   * stream has an id to follow. See `## Deviations` in the implementation report.
   */
  async runAllAgents(workspaceId: string): Promise<EvalRunAllResult> {
    const [agents, counts] = await Promise.all([
      this.deps.agents.list(workspaceId),
      this.deps.store.countCasesByOwner(workspaceId, 'agent'),
    ]);
    const casesByOwner = new Map(counts.map((c) => [c.ownerId, c.count]));

    const created: EvalBatch[] = [];
    const skipped: EvalRunAllResult['skipped'] = [];

    for (const agent of agents) {
      if (!agent.enabled) {
        skipped.push({ agent_id: agent.id, reason: 'agent_disabled' });
        continue;
      }
      if ((casesByOwner.get(agent.id) ?? 0) === 0) {
        skipped.push({ agent_id: agent.id, reason: 'no_cases' });
        continue;
      }
      try {
        created.push(await this.startBatch(workspaceId, agent.id));
      } catch (err) {
        if (err instanceof EvalRefusal && err.reason === 'batch_already_running') {
          const running = await this.deps.store.listRunningBatches(workspaceId, agent.id);
          const inFlight = running[0];
          if (inFlight) created.push(inFlight);
          continue;
        }
        throw err;
      }
    }

    return { created, skipped };
  }
}
