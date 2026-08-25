import type { Container } from '../../platform/container.js';
import type {
  AgentColumn,
  FindingActionKind,
  MultiAgentRun,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * The most agents one fan-out may name (AC-8).
 *
 * A refusal and never a truncation: a reviewer who asked for nine agents and
 * silently got eight would read the missing column as a crashed run. The bound
 * is a cost bound, not a technical one — the executor's own worker pool already
 * caps how many of them are in flight at once — so it is checked AFTER
 * duplicates are collapsed, because what it is really bounding is the number of
 * runs the request creates.
 */
export const MAX_MULTI_AGENT_RUN_AGENTS = 8;

/**
 * The whole of what this module asks of the multi-agent module: write the parent
 * record a fan-out's runs are stamped with, and say which parent record is this
 * pull request's most recent one.
 *
 * Declared HERE, by the consumer, and satisfied structurally by the composition
 * root (`container.multiAgentRecorder`). That is the `FeatureModelResolver`
 * shape, and it is the reason this module imports nothing from
 * `modules/multi-agent/`: an `import type` of a sibling module's internals is a
 * real `no-cross-module-internals` edge, not an exempt one (measured, 22 → 24
 * warnings), and a second edge in the other direction would close a cycle
 * through the DI root.
 *
 * `latestForPull` is a read rather than a write because the `409` refusal has to
 * start somewhere: WHICH multi-run is the most recent one is the other module's
 * question, and whether any of its runs is still in flight is this one's — a
 * query over `agent_runs`, which belongs to this module's own repository.
 */
export interface MultiRunRecorder {
  create(workspaceId: string, prId: string): Promise<{ id: string; ranAt: Date }>;
  latestForPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;
  /**
   * Undo {@link MultiRunRecorder.create} after the fan-out it was created for
   * failed to start. Called on one error path only, in
   * {@link ReviewService.createMultiAgentRun}, which explains the whole of what
   * it does and does not promise.
   */
  discard(workspaceId: string, id: string): Promise<void>;
}

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private multiRuns: MultiRunRecorder;
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    // Taken from the composition root rather than constructed here. Same class
    // over the same `db`, and the root already owns one — but a repository the
    // service builds for itself is a repository no test can replace, and every
    // create-path rule below (which agents resolve, what refuses, what is
    // written) is only observable through it.
    this.repo = container.reviewRepo;
    this.agents = container.agentsRepo;
    this.multiRuns = container.multiAgentRecorder;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run: an explicit subset, all enabled agents, or one.
   *
   * The three selectors are checked in the order they refuse, not in the order
   * they succeed, because every refusal here is a named one (AC-3, AC-4, AC-6)
   * and a named refusal only survives if nothing quieter runs first.
   *
   *  - `agentIds` together with `all` is refused rather than resolved. Both are
   *    "which agents", they disagree, and picking one silently would run a set
   *    the caller never asked for (AC-6).
   *  - An EMPTY `agentIds` is refused by name (AC-3). It is deliberately not
   *    expressible in `ReviewRunRequest`'s schema — a `.min(1)` there would turn
   *    this into an anonymous `422` from the validator that never reaches a
   *    handler, and the contract file says so in its own comment.
   *  - One id naming no agent in the caller's workspace refuses the WHOLE
   *    request (AC-4). Not "run the ones that resolved": a fan-out missing a
   *    column is indistinguishable from a fan-out whose agent crashed.
   *
   * `enabled` is NOT filtered on. Naming an agent explicitly is the same act as
   * naming one in `{agentId}`, which has never checked the flag either; only
   * `all` means "the enabled ones" (AC-5).
   *
   * Duplicates collapse to one run (EC-1), in first-seen order, so the columns
   * come back in the order the caller listed them.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean; agentIds?: string[] },
  ): Promise<AgentRow[]> {
    if (opts.agentIds !== undefined) {
      if (opts.all) {
        throw new AppError(
          'invalid_run_request',
          'Provide agentIds or all:true, not both',
          400,
        );
      }
      if (opts.agentIds.length === 0) {
        throw new AppError('invalid_run_request', 'agentIds must not be empty', 400);
      }
      const targets: AgentRow[] = [];
      for (const id of [...new Set(opts.agentIds)]) {
        const agent = await this.agents.getById(workspaceId, id);
        if (!agent) throw new NotFoundError(`Agent not found: ${id}`);
        targets.push(agent);
      }
      return targets;
    }
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId, agentIds or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
    /**
     * The multi-agent run every row created here is stamped with, or absent for
     * an ordinary single-agent or `all` review — which then belongs to no
     * multi-run and produces no parent record at all (AC-11).
     */
    multiAgentRunId?: string,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId: multiAgentRunId ?? null,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor
      .executeRuns(workspaceId, pull, repo, jobs, logger)
      .catch((err) => {
        logger?.error(
          { prId, err: (err as Error).message },
          'review: background execution crashed',
        );
      })
      // A fan-out's stance notes, once EVERY run of the set is terminal — which
      // is exactly what this settled promise means, on both the success path and
      // the `failAll` one. Appended here because the executor's completion is
      // the only place that knows it; never triggered from the read, which AC-23
      // pins as making no model call. The synthesis swallows its own failures,
      // and the `.catch` below is the second guard: a rejected promise discarded
      // in this shape has killed the API twice (`server/INSIGHTS.md`, 2026-08-06
      // and 2026-08-07), and `JobRunner`'s central `.catch` is not on this path.
      .then(() =>
        multiAgentRunId === undefined
          ? undefined
          : this.container.multiAgentNotes.synthesise(workspaceId, multiAgentRunId, logger),
      )
      .catch((err) => {
        logger?.error(
          { prId, multiAgentRunId, err: (err as Error).message },
          'multi-agent: note synthesis crashed',
        );
      });

    return { runs, reviews: [] };
  }

  /**
   * Fan one pull request out to an explicit set of agents, as ONE multi-agent
   * run (AC-7…AC-10).
   *
   * The order of the steps is the order of the refusals, and it is the whole
   * design of the method: **nothing is written until every reason to refuse has
   * been checked.** A parent record created before the agent list is resolved
   * would leave an empty fan-out behind on a `404`, and the results screen reads
   * "the pull request's most recent multi-run" — so that empty record would be
   * what the reviewer sees.
   *
   *  1. the cap (AC-8) — `422`, and no truncation;
   *  2. the pull request exists — `404`;
   *  3. every named agent resolves inside the workspace (AC-4) — `404`;
   *  4. the previous fan-out has finished (AC-9) — `409`, first one untouched;
   *  5. only now: the parent record, then the runs stamped with it.
   *
   * Step 5 is the one that cannot be made atomic, and the block below says why
   * at length: if creating the runs fails after the parent is committed, the
   * parent is DISCARDED and the original error is rethrown. Compensation, not a
   * transaction — a run already created survives as an ordinary single-agent
   * run, which is what it is once the fan-out it belonged to is gone.
   *
   * What comes back is the multi-run's INITIAL state, built from the rows this
   * call just created: one column per created run, every one `running`, no
   * findings, no totals. It is not read back through the multi-agent module's
   * read service — that service is the other direction of an edge that runs one
   * way only, and reaching for it here would close a cycle through the DI root.
   * AC-7 is satisfiable at creation time precisely because a run one millisecond
   * old has nothing to report but its own existence.
   */
  async createMultiAgentRun(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRun> {
    const requested = [...new Set(agentIds)];
    if (requested.length > MAX_MULTI_AGENT_RUN_AGENTS) {
      throw new AppError(
        'too_many_agents',
        `A multi-agent run may name at most ${MAX_MULTI_AGENT_RUN_AGENTS} agents; ${requested.length} were given`,
        422,
      );
    }

    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const targets = await this.resolveTargets(workspaceId, { agentIds: requested });

    // AC-9. `latestForPull` says WHICH multi-run is the most recent one (the
    // other module's question); `hasRunningRunForMultiRun` says whether it is
    // still going (this module's own table). Nothing is written on this path, so
    // the first multi-run is untouched by construction rather than by care.
    const previous = await this.multiRuns.latestForPull(workspaceId, prId);
    if (previous && (await this.repo.hasRunningRunForMultiRun(workspaceId, previous.id))) {
      throw new AppError(
        'multi_agent_run_in_flight',
        'This pull request already has a multi-agent run in progress',
        409,
      );
    }

    const parent = await this.multiRuns.create(workspaceId, prId);

    // The parent is committed and the runs are not, and the two writes cannot
    // be made one: `runReview` fires `void executeRuns(...)` before it returns,
    // so inside a `db.transaction` that background work would read and write
    // `agent_runs` on a different pooled connection against rows nothing else
    // can see yet, and `reviews.run_id` would point at an invisible
    // `agent_runs.id`. So the failure is COMPENSATED instead: the orphaned
    // parent is deleted and the original error travels on to the caller.
    //
    // **That is deliberately not atomicity, and the residue is documented.** A
    // run this call already created is left where it is — `agent_runs
    // .multi_agent_run_id` is `ON DELETE SET NULL`, so it simply stops belonging
    // to a fan-out and finishes (or is reaped) as an ordinary single-agent run,
    // which is what it now is. What the discard guarantees is narrower and is
    // the part the reviewer sees: no half-populated multi-run survives for the
    // results screen to read back as "the most recent fan-out", and the next
    // `POST` is not met by a `409` naming a fan-out that has no columns.
    let runs: { run_id: string; agent_id: string; agent_name: string }[];
    try {
      ({ runs } = await this.runReview(workspaceId, prId, targets, logger, parent.id));
    } catch (err) {
      // The cleanup is awaited inside its own `try`, and both halves are
      // load-bearing. AWAITED, because a discarded promise that rejects has
      // killed this API twice (`server/INSIGHTS.md`, 2026-08-06 and
      // 2026-08-07) and `JobRunner`'s central `.catch` is not on this path.
      // In its own `try` rather than behind a `.catch`, because a `.catch`
      // only covers a rejection — an implementation that threw synchronously
      // would escape it and REPLACE the error that actually caused the
      // request to fail, sending whoever reads the 500 to the wrong table.
      // The original `err` is what the caller sees, always.
      try {
        await this.multiRuns.discard(workspaceId, parent.id);
      } catch (discardErr) {
        logger?.error(
          { prId, multiAgentRunId: parent.id, err: (discardErr as Error).message },
          'multi-agent: discarding the orphaned parent record failed',
        );
      }
      throw err;
    }

    const byAgent = new Map(targets.map((agent) => [agent.id, agent]));
    const columns: AgentColumn[] = runs.map((run) => {
      const agent = byAgent.get(run.agent_id);
      return {
        run_id: run.run_id,
        agent_id: run.agent_id,
        agent_name: run.agent_name,
        provider: agent?.provider ?? null,
        model: agent?.model ?? null,
        status: 'running',
        // A run one millisecond old has recorded no failure reason, and `null`
        // is that state rather than an empty string.
        error: null,
        verdict: null,
        score: null,
        summary: null,
        duration_ms: null,
        // `null` and not `0`: nothing has been recorded yet, which is not the
        // same claim as "this run was free" (AC-21).
        cost_usd: null,
        findings: [],
      };
    });

    return {
      id: parent.id,
      pr_id: prId,
      pr_number: pull.number,
      ran_at: parent.ranAt.toISOString(),
      // One per run actually created, which after deduplication is also the
      // length of the list the caller sent (AC-7).
      agent_count: columns.length,
      total_duration_ms: 0,
      // Nothing has cost anything yet, and `0` would be a claim (AC-22).
      total_cost_usd: null,
      columns,
      // Groups are derived from findings on read, and there are none yet.
      conflicts: [],
    };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
