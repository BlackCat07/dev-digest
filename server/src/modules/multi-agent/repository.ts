import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { MULTI_RUN_STARTING_MS } from './constants.js';
import { MultiAgentNotes } from './schemas.js';
import type {
  CreatedMultiAgentRun,
  MultiAgentStore,
  StoredMultiAgentColumn,
  StoredMultiAgentFinding,
  StoredMultiAgentRun,
} from './types.js';

/**
 * Data access for Multi-Agent Review. The ONLY file in this module that touches
 * `db/schema` or `drizzle-orm`; everything above it sees {@link MultiAgentStore},
 * which — like every port and persisted shape this module declares — lives in
 * `types.ts` rather than beside this implementation.
 *
 * Five things it is arranged to guarantee.
 *
 *  - **Every read is workspace-scoped by parameter.** A multi-run, its runs and
 *    its notes are all reachable by uuid alone otherwise, and "the caller sent a
 *    valid uuid" is not authorization. The pull request outside the caller's
 *    workspace therefore produces no row, which the service turns into this
 *    module's own `not_found` rather than into someone else's data.
 *  - **Every ordering is TOTAL.** `ORDER BY <x> DESC` with no tiebreaker is not
 *    an order at all: tied rows come back in physical heap order and an UPDATE
 *    physically moves one, which reads as "the row I clicked moved down"
 *    (`server/INSIGHTS.md`, 2026-08-06). It bites hardest on
 *    {@link latestForPull}, where every candidate of one insert shares a
 *    transaction-scoped `now()` and `ran_at` alone cannot break the tie.
 *  - **The score comes from `reviews`, never from `agent_runs`.** The run column
 *    arrived with no backfill (`server/INSIGHTS.md`, 2026-08-03), so it is null
 *    on every run older than itself while the review row holds the real figure.
 *    `agent_runs.score` is not selected here at all, so the wrong one cannot be
 *    picked up by accident higher in the stack.
 *  - **The stored notes are PARSED on the way out, never cast.** The column is
 *    untyped jsonb — deliberately, so that its reader parses it — and an `as` on
 *    a boundary has already shipped `$NaN` to a client from this codebase
 *    (`server/INSIGHTS.md`, 2026-08-02). A blob this schema rejects reads back as
 *    `null`, which is the same state as "not synthesised yet" and already has a
 *    rendering (AC-38).
 *  - **It reaches into no sibling module and opens no transaction.** `agents`
 *    belongs to the agents repository and `reviews`/`findings` to the reviews
 *    repository; importing either would be a `no-cross-module-internals`
 *    violation that `import type` does not exempt, so the two joins below go
 *    through `db/schema` — the shared persistence ring — rather than through a
 *    neighbour's code. And every method here is a single statement, so there is
 *    no atomicity for a caller to have to ask for; when the create path needs the
 *    parent record and its runs to land together, the boundary belongs in that
 *    service, not in this ring, which cannot see the use case.
 */
export class MultiAgentRepository implements MultiAgentStore {
  constructor(private db: Db) {}

  /**
   * Insert the parent record one fan-out's runs will be stamped with.
   *
   * Returns the id and the timestamp rather than the whole row: those are the
   * two values the create path's response needs, and a narrower return is one
   * less field a fake has to build.
   */
  /**
   * Insert the parent record — but only while this pull request has no fan-out
   * still running (AC-9). Answers `null` when it does, which the caller turns
   * into the `409`.
   *
   * **The check and the insert are ONE statement-sequence inside ONE
   * transaction, and that is the whole point of this method.** The service used
   * to read "is there a live predecessor?" and then insert, as two awaited
   * calls; two requests for the same pull request could both complete the read
   * before either reached the insert, so both passed the guard and two fan-outs
   * ran — billing the workspace twice, and leaving the earlier one invisible to
   * `GET /pulls/:id/multi-agent`, which reports only the most recent parent.
   *
   * `FOR UPDATE` on the PULL-REQUEST row is what serialises them. It is the one
   * row both callers name, it already exists (a fan-out cannot be started for a
   * pull request that does not), and locking it is cheaper and narrower than a
   * table-level lock. `multi_agent_runs` has no unique constraint to fall back
   * on: `multi_agent_runs_pr_ran_idx` is a plain `(pr_id, ran_at DESC)` index.
   *
   * This transaction is NOT the one the module's `discard` compensates for —
   * that one cannot exist because `runReview` fires background work inside it.
   * This one closes before any run is created, so no background connection can
   * be waiting on rows it cannot see.
   */
  async createIfIdle(workspaceId: string, prId: string): Promise<CreatedMultiAgentRun | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from pull_requests where id = ${prId} for update`);

      const [latest] = await tx
        .select({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt })
        .from(t.multiAgentRuns)
        .where(
          and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)),
        )
        .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
        .limit(1);

      if (latest) {
        const runs = await tx
          .select({ status: t.agentRuns.status })
          .from(t.agentRuns)
          .where(
            and(
              eq(t.agentRuns.workspaceId, workspaceId),
              eq(t.agentRuns.multiAgentRunId, latest.id),
            ),
          );

        // Still executing. `running` only — a row with a status nobody
        // recognises must not wedge the pull request into refusing forever.
        if (runs.some((run) => run.status === 'running')) return null;

        // No runs YET. This is the window the caller cannot close: the parent is
        // committed before its runs are, so for a moment the newest fan-out
        // looks like nothing at all. Bounded, so a create killed between the two
        // writes cannot block this pull request permanently.
        const startingFor = Date.now() - latest.ranAt.getTime();
        if (runs.length === 0 && startingFor < MULTI_RUN_STARTING_MS) return null;
      }

      const [row] = await tx
        .insert(t.multiAgentRuns)
        .values({ workspaceId, prId })
        .returning({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt });
      return row!;
    });
  }

  /**
   * Delete the parent record, workspace-scoped — the create path's compensating
   * write. `MultiAgentRecorder.discard` in `./types.ts` carries the reason it
   * exists at all, and why it is compensation rather than atomicity.
   *
   * One statement, like everything else in this file, and idempotent by
   * construction: a parent that is already gone, or that belongs to another
   * workspace, matches nothing and is not an error. That matters because the
   * only caller is an error path, which has nothing useful to do with a second
   * failure and must not let one hide the first.
   *
   * The runs stamped with this id are deliberately left behind rather than
   * deleted with it: `agent_runs.multi_agent_run_id` references this table
   * `ON DELETE SET NULL`, so each becomes an ordinary single-agent run.
   */
  async discard(workspaceId: string, id: string): Promise<void> {
    await this.db
      .delete(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
  }

  /**
   * The pull request's most recent multi-run (AC-16).
   *
   * `desc(ranAt), desc(id)` — the id is not decoration. Two multi-runs created
   * inside one transaction share `now()` to the microsecond, and without the
   * second key which of them is "most recent" is whatever the heap returns.
   *
   * The join to `pull_requests` is what supplies `pr_number`; `pr_id` is
   * `NOT NULL` and cascades with the pull request, so an inner join can never
   * hide a multi-run that exists.
   */
  async latestForPull(
    workspaceId: string,
    prId: string,
  ): Promise<StoredMultiAgentRun | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        prNumber: t.pullRequests.number,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(
        and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)),
      )
      .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
      .limit(1);
    return row;
  }

  /**
   * Every run the multi-run created, and nothing else (AC-15, AC-18).
   *
   * A single-agent run started while the fan-out is in flight carries a null
   * `multi_agent_run_id` and therefore cannot appear here — the filter is the
   * exclusion, so there is no rule to remember elsewhere.
   *
   * TWO statements rather than one three-way join, on purpose: `reviews.run_id`
   * carries no unique constraint, so a left join to it multiplies the run row
   * once per matching review and would silently render one agent as two columns.
   * The second statement takes the newest `review` per run instead — `created_at
   * desc, id desc`, a total order — and the map keeps the first it sees.
   */
  async runsOf(workspaceId: string, multiAgentRunId: string): Promise<StoredMultiAgentColumn[]> {
    const runs = await this.db
      .select({
        runId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        status: t.agentRuns.status,
        error: t.agentRuns.error,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.multiAgentRunId, multiAgentRunId),
        ),
      )
      // A total order, for the reason every client-rendered list needs one: the
      // columns must not swap places between two polls of an unchanged multi-run.
      .orderBy(asc(t.agentRuns.ranAt), asc(t.agentRuns.id));

    if (runs.length === 0) return [];

    const reviews = await this.db
      .select({
        id: t.reviews.id,
        runId: t.reviews.runId,
        score: t.reviews.score,
        summary: t.reviews.summary,
        verdict: t.reviews.verdict,
      })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.kind, 'review'),
          inArray(
            t.reviews.runId,
            runs.map((run) => run.runId),
          ),
        ),
      )
      .orderBy(desc(t.reviews.createdAt), desc(t.reviews.id));

    const byRun = new Map<string, (typeof reviews)[number]>();
    for (const review of reviews) {
      if (review.runId && !byRun.has(review.runId)) byRun.set(review.runId, review);
    }

    return runs.map((run) => {
      const review = byRun.get(run.runId);
      return {
        ...run,
        reviewId: review?.id ?? null,
        score: review?.score ?? null,
        summary: review?.summary ?? null,
        verdict: review?.verdict ?? null,
      };
    });
  }

  /**
   * The findings of the given reviews (AC-24).
   *
   * An empty id list issues NO query — `inArray(col, [])` is a degenerate
   * predicate and the answer is known without asking. Ordered totally so a
   * column's rows do not reshuffle between polls.
   */
  async findingsOf(reviewIds: readonly string[]): Promise<StoredMultiAgentFinding[]> {
    if (reviewIds.length === 0) return [];
    return this.db
      .select({
        id: t.findings.id,
        reviewId: t.findings.reviewId,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        rationale: t.findings.rationale,
        suggestion: t.findings.suggestion,
        confidence: t.findings.confidence,
        kind: t.findings.kind,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, [...reviewIds]))
      .orderBy(asc(t.findings.file), asc(t.findings.startLine), asc(t.findings.id));
  }

  /**
   * The persisted synthesis output, parsed (AC-37).
   *
   * `null` for a multi-run outside the workspace, for one that does not exist,
   * for one whose column is null, and for one whose blob does not parse. All
   * four are the same state to every reader — "there is no synthesis" — and each
   * renders identically: every stance note empty, every group title falling back
   * to the deterministic rule (AC-38).
   */
  async readNotes(workspaceId: string, multiAgentRunId: string): Promise<MultiAgentNotes | null> {
    const [row] = await this.db
      .select({ notes: t.multiAgentRuns.notes })
      .from(t.multiAgentRuns)
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.multiAgentRuns.id, multiAgentRunId),
        ),
      )
      .limit(1);
    if (!row || row.notes === null) return null;
    return MultiAgentNotes.safeParse(row.notes).data ?? null;
  }

  /**
   * Persist the one synthesis output for a multi-run.
   *
   * Workspace-scoped in the `where`, so a synthesis can never be written onto
   * another tenant's multi-run even if an id leaks. There is one writer (the
   * synthesis task, once every run is terminal) and one reader
   * ({@link readNotes}).
   */
  async saveNotes(
    workspaceId: string,
    multiAgentRunId: string,
    notes: MultiAgentNotes,
  ): Promise<void> {
    await this.db
      .update(t.multiAgentRuns)
      .set({ notes })
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.multiAgentRuns.id, multiAgentRunId),
        ),
      );
  }
}
