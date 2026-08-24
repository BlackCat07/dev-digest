import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type {
  EvalAgentCase,
  EvalBatch,
  EvalBatchCaseResult,
  EvalOwnerKind,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  passFromOutcome,
  readExpectation,
  readExpectedAnchors,
  toEvalAgentCase,
  toEvalBatch,
  toEvalBatchCaseResult,
  withExpectedAnchors,
} from './helpers.js';
import type {
  EvalBatchInsert,
  EvalBatchPatch,
  EvalCaseAnchorSet,
  EvalCaseInsert,
  EvalCaseUpdate,
  EvalRunInsert,
  EvalStore,
  StoredEvalCase,
  StoredEvalCaseExecution,
} from './types.js';

/**
 * Data access for the Eval Pipeline. The ONLY file in this module that touches
 * `db/schema` and `drizzle-orm`; everything above it sees {@link EvalStore},
 * which — like every port and persisted shape this module declares — lives in
 * `types.ts` rather than beside this implementation.
 *
 * Six things it is arranged to guarantee.
 *
 *  - **Every list a client renders in order has a TOTAL order.** Ordering on a
 *    non-unique column returns tied rows in physical heap order, and an UPDATE
 *    physically moves one — reported here once as "the row I clicked moves down
 *    the list", and intermittent enough that "it stopped happening" was not
 *    evidence it was fixed. So the case list is `name asc, id asc`, the batch
 *    history is `started_at desc, id desc`, and every other ordering below ends
 *    in a unique tiebreaker. Each has a matching index
 *    (`eval_cases_owner_name_idx`, `eval_batches_agent_started_idx`).
 *  - **The stored `expected_output` is PARSED on the way out, never cast.** The
 *    column is untyped jsonb and it is where the expected anchors live, so a blob
 *    written by hand — or written before this feature existed — reads back as an
 *    empty anchor list rather than reaching a client as an unvalidated shape. An
 *    `as` on that boundary has already shipped `$NaN` to a client from this
 *    codebase. Same for the three nullable enum columns; the fallbacks and the
 *    reason each was chosen are in `helpers.ts`.
 *  - **It reaches into no sibling module.** `agents` belongs to the agents
 *    repository and `findings`/`pr_files` to the reviews repository; importing
 *    either would be a `no-cross-module-internals` violation that `import type`
 *    does not exempt. The one join here is to `agents.name`, one column, and the
 *    finding and pull-request reads the service needs arrive through the
 *    container-satisfied ports in `types.ts` instead.
 *  - **It opens no transaction.** The SERVICE owns the transaction boundary: a
 *    boundary inside this ring cannot see the use case, and a caller needing two
 *    writes to land together would then have no way to ask for it.
 *  - **No raw `sql` template anywhere.** Not a style preference: postgres-js
 *    rejects a `Date` interpolated into one at RUNTIME while the code typechecks
 *    cleanly, and Fastify swallows the throw into a generic `500 internal_error`.
 *    Every period filter below binds its `Date` through `gte()`, which Drizzle
 *    parameterises correctly, so the trap is unreachable rather than remembered.
 *  - **Every read is workspace-scoped by parameter**, including the two deletes.
 *    An agent id is globally unique, so `pruneAgentBatches` does not strictly need
 *    a workspace id — it takes one anyway, because a delete that cannot cross a
 *    tenant costs one extra predicate.
 */

/**
 * The batch columns every batch read selects, plus the agent's name.
 *
 * One object rather than five copies: `eval_batches.agent_id` is
 * `ON DELETE SET NULL`, so the join is a LEFT join and `agentName` is null both
 * for a deleted agent and for a row whose agent is gone — the same fact to a
 * reader, and the reason a batch outlives its agent instead of being deleted with
 * it. Five hand-written copies of that join is five chances for one of them to be
 * an inner join and silently drop the history this table exists to keep.
 */
const BATCH_COLUMNS = {
  id: t.evalBatches.id,
  workspaceId: t.evalBatches.workspaceId,
  agentId: t.evalBatches.agentId,
  agentName: t.agents.name,
  agentVersion: t.evalBatches.agentVersion,
  systemPromptSnapshot: t.evalBatches.systemPromptSnapshot,
  modelSnapshot: t.evalBatches.modelSnapshot,
  status: t.evalBatches.status,
  label: t.evalBatches.label,
  startedAt: t.evalBatches.startedAt,
  finishedAt: t.evalBatches.finishedAt,
  casesCovered: t.evalBatches.casesCovered,
  casesPassed: t.evalBatches.casesPassed,
  recall: t.evalBatches.recall,
  precision: t.evalBatches.precision,
  citationAccuracy: t.evalBatches.citationAccuracy,
  truePositives: t.evalBatches.truePositives,
  falseNegatives: t.evalBatches.falseNegatives,
  falsePositives: t.evalBatches.falsePositives,
  costUsd: t.evalBatches.costUsd,
  error: t.evalBatches.error,
};

export class EvalRepository implements EvalStore {
  constructor(private db: Db) {}

  // ---- cases -------------------------------------------------------------

  /**
   * One owner's whole set, each case carrying its most recent execution.
   *
   * `name asc, id asc` — a TOTAL order, matching `eval_cases_owner_name_idx`.
   * Ordering on `name` alone would return same-named cases in heap order, and an
   * edit to one would move it.
   */
  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalAgentCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
    return this.withExecutions(rows);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalAgentCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .limit(1);
    if (!row) return undefined;
    const [dto] = await this.withExecutions([row]);
    return dto;
  }

  /** The set's current size — the denominator behind `case_limit_reached`. */
  async countCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * Every owner's set size in one `GROUP BY` — the dashboard's `cases_total`.
   *
   * Aggregated in SQL rather than by fetching every case and reducing in JS: the
   * dashboard needs the count and nothing else, and Drizzle's `count()` maps to a
   * real `number` here, so there is no bigint to coerce.
   */
  async countCasesByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
  ): Promise<{ ownerId: string; count: number }[]> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, n: count() })
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, ownerKind)),
      )
      .groupBy(t.evalCases.ownerId);
    return rows.map((r) => ({ ownerId: r.ownerId, count: r.n }));
  }

  /**
   * The case already derived from this finding, if any — a point lookup on
   * `eval_cases_source_finding_idx`.
   *
   * `id asc, limit 1` so a duplicate refusal names the SAME existing case every
   * time it is retried. The column carries no unique constraint by design (a
   * finding's provenance must survive the finding's deletion), so the read cannot
   * assume there is at most one row.
   */
  async findCaseBySourceFinding(
    workspaceId: string,
    sourceFindingId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.evalCases.id, name: t.evalCases.name })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.sourceFindingId, sourceFindingId),
        ),
      )
      .orderBy(asc(t.evalCases.id))
      .limit(1);
    return row;
  }

  /**
   * Every case of a set with its expectation and its anchors — the input to the
   * `conflicting_anchor` check.
   *
   * The overlap PREDICATE stays in `helpers.ts` and is applied by the service. A
   * repository that decided what conflicts would have put a business rule in SQL,
   * where the scorer cannot agree with it — and the whole point of that refusal is
   * that it means exactly what a score means.
   */
  async listCaseAnchors(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseAnchorSet[]> {
    const rows = await this.db
      .select({
        id: t.evalCases.id,
        name: t.evalCases.name,
        expectation: t.evalCases.expectation,
        expectedOutput: t.evalCases.expectedOutput,
      })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
    return rows.map((row) => ({
      caseId: row.id,
      caseName: row.name,
      expectation: readExpectation(row.expectation),
      anchors: readExpectedAnchors(row.expectedOutput),
    }));
  }

  /**
   * Write a new case. The anchors are folded into `expected_output` here, which is
   * the only place that knows they live there.
   */
  async insertCase(values: EvalCaseInsert): Promise<EvalAgentCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles,
        inputMeta: values.inputMeta,
        expectedOutput: withExpectedAnchors(values.expectedOutput, values.expectedAnchors),
        expectation: values.expectation,
        sourceFindingId: values.sourceFindingId,
        sourceSeverity: values.sourceSeverity,
        sourceCategory: values.sourceCategory,
        edited: false,
      })
      .returning();
    // A case that was just created has no execution, so no join is needed and
    // `last_execution` is null — which is exactly what "never run" means.
    return toEvalAgentCase(row!);
  }

  /**
   * Save a hand-edited case, exactly as submitted.
   *
   * `edited: true` is set HERE rather than passed in: a save through this path IS
   * a human edit, and leaving the flag to the caller is how a derived case and a
   * hand-tuned one stop being distinguishable.
   */
  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: EvalCaseUpdate,
  ): Promise<EvalAgentCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        name: patch.name,
        inputDiff: patch.inputDiff,
        expectedOutput: withExpectedAnchors(patch.expectedOutput, patch.expectedAnchors),
        expectation: patch.expectation,
        edited: true,
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    if (!row) return undefined;
    const [dto] = await this.withExecutions([row]);
    return dto;
  }

  /**
   * Delete a case. Its `eval_runs` rows cascade with it; every BATCH keeps the
   * metrics and counts it recorded, because those are columns on `eval_batches`
   * and are never recomputed from the case rows.
   */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- batches -----------------------------------------------------------

  /**
   * Open a batch. The version, the prompt and the model arrive as VALUES and are
   * stored as text — never re-read from the agent, because an `agent_versions` row
   * is deleted with its agent and a comparison rendering "the prompt that produced
   * this" from a row which may be gone is a comparison that can start lying.
   */
  async insertBatch(values: EvalBatchInsert): Promise<EvalBatch> {
    const [row] = await this.db
      .insert(t.evalBatches)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        agentVersion: values.agentVersion,
        systemPromptSnapshot: values.systemPromptSnapshot,
        modelSnapshot: values.modelSnapshot,
        status: 'running',
        label: values.label,
      })
      .returning();
    // The insert cannot return the joined agent name, and re-reading through
    // `getBatch` would have an impossible "not found" branch. One narrow lookup
    // instead — and null is a real answer here, not a failure.
    const [agent] = await this.db
      .select({ name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.id, values.agentId))
      .limit(1);
    return toEvalBatch({ ...row!, agentName: agent?.name ?? null });
  }

  async getBatch(workspaceId: string, batchId: string): Promise<EvalBatch | undefined> {
    const [row] = await this.db
      .select(BATCH_COLUMNS)
      .from(t.evalBatches)
      .leftJoin(t.agents, eq(t.evalBatches.agentId, t.agents.id))
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.id, batchId)))
      .limit(1);
    return row ? toEvalBatch(row) : undefined;
  }

  /**
   * Record a batch's own outcome. Returns `undefined` when no such batch exists in
   * this workspace, which is a real answer and not an error — a caller writing to
   * a batch that has been pruned out from under it needs to know.
   */
  async updateBatch(
    workspaceId: string,
    batchId: string,
    patch: EvalBatchPatch,
  ): Promise<EvalBatch | undefined> {
    const written = await this.db
      .update(t.evalBatches)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch.casesCovered !== undefined ? { casesCovered: patch.casesCovered } : {}),
        ...(patch.casesPassed !== undefined ? { casesPassed: patch.casesPassed } : {}),
        ...(patch.recall !== undefined ? { recall: patch.recall } : {}),
        ...(patch.precision !== undefined ? { precision: patch.precision } : {}),
        ...(patch.citationAccuracy !== undefined
          ? { citationAccuracy: patch.citationAccuracy }
          : {}),
        ...(patch.truePositives !== undefined ? { truePositives: patch.truePositives } : {}),
        ...(patch.falseNegatives !== undefined ? { falseNegatives: patch.falseNegatives } : {}),
        ...(patch.falsePositives !== undefined ? { falsePositives: patch.falsePositives } : {}),
        ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      })
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.id, batchId)))
      .returning({ id: t.evalBatches.id });
    if (written.length === 0) return undefined;
    return this.getBatch(workspaceId, batchId);
  }

  /**
   * One agent's history, `started_at desc, id desc` — a TOTAL order, matching
   * `eval_batches_agent_started_idx`, and the order the retention scan uses too.
   */
  listAgentBatches(
    workspaceId: string,
    agentId: string,
    since: Date | null,
  ): Promise<EvalBatch[]> {
    return this.selectBatches([
      eq(t.evalBatches.workspaceId, workspaceId),
      eq(t.evalBatches.agentId, agentId),
      ...this.sinceFilter(since),
    ]);
  }

  /**
   * This agent's `running` batches, newest first.
   *
   * A list rather than one row: the caller decides which of them is stale. A
   * `running` batch older than the batch deadline is an orphan from a dead process
   * and must not block the agent's next run for ever, and that window is a use-case
   * rule, not a query.
   */
  listRunningBatches(workspaceId: string, agentId: string): Promise<EvalBatch[]> {
    return this.selectBatches([
      eq(t.evalBatches.workspaceId, workspaceId),
      eq(t.evalBatches.agentId, agentId),
      eq(t.evalBatches.status, 'running'),
    ]);
  }

  /**
   * Every agent's batches in ONE read, newest first — both the dashboard's
   * per-agent grouping and its cross-agent recent list.
   *
   * One query rather than one per agent, and bounded by the 50-batch-per-agent
   * retention cap even for `period=all`. The grouping is left to the caller
   * deliberately: `agent_id` is nullable, so a map keyed on the raw value collapses
   * every agent-deleted row into one bucket and a cost sum then drops all but one
   * of them with no error — the caller needs a fallback key, and that is a decision
   * for the ring that knows what it is summing.
   */
  listWorkspaceBatches(
    workspaceId: string,
    since: Date | null,
    limit?: number,
  ): Promise<EvalBatch[]> {
    return this.selectBatches(
      [eq(t.evalBatches.workspaceId, workspaceId), ...this.sinceFilter(since)],
      limit,
    );
  }

  // ---- per-case executions -----------------------------------------------

  /**
   * A batch's per-case results, in the case set's own order (`name asc, id asc`)
   * so the batch view and the case list never disagree about position.
   *
   * The join to `eval_cases` is what scopes this by workspace: `eval_runs` carries
   * no `workspace_id` of its own.
   */
  async listBatchCaseResults(
    workspaceId: string,
    batchId: string,
  ): Promise<EvalBatchCaseResult[]> {
    const rows = await this.db
      .select({
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        outcome: t.evalRuns.outcome,
        notRunReason: t.evalRuns.notRunReason,
        expectedCount: t.evalRuns.expectedCount,
        actualCount: t.evalRuns.actualCount,
        keptCount: t.evalRuns.keptCount,
        droppedCount: t.evalRuns.droppedCount,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(eq(t.evalRuns.batchId, batchId), eq(t.evalCases.workspaceId, workspaceId)),
      )
      .orderBy(
        asc(t.evalCases.name),
        asc(t.evalCases.id),
        desc(t.evalRuns.ranAt),
        desc(t.evalRuns.id),
      );
    return rows.map(toEvalBatchCaseResult);
  }

  /**
   * Record one case's execution.
   *
   * The shipped `pass` boolean is kept consistent with the `outcome` column beside
   * it — null for `not_run`, because a case that never executed neither passed nor
   * failed. Written per case as it resolves rather than in one batch at the end, so
   * a batch killed by its deadline still has the results it did produce.
   */
  async insertRun(values: EvalRunInsert): Promise<void> {
    await this.db.insert(t.evalRuns).values({
      caseId: values.caseId,
      batchId: values.batchId,
      actualOutput: values.actualOutput,
      pass: passFromOutcome(values.outcome),
      outcome: values.outcome,
      notRunReason: values.notRunReason,
      expectedCount: values.expectedCount,
      actualCount: values.actualCount,
      keptCount: values.keptCount,
      droppedCount: values.droppedCount,
      durationMs: values.durationMs,
      costUsd: values.costUsd,
    });
  }

  // ---- retention ---------------------------------------------------------

  /**
   * Keep the `keep` most recent batches of this agent and delete the rest, taking
   * their `eval_runs` rows with them (`batch_id` is `ON DELETE CASCADE`).
   *
   * The candidate scan uses the same total order as the history read, so "the 50
   * most recent" means the same thing in both places — on a tie of `started_at`,
   * an order without the `id desc` tiebreaker could keep a different 50 on every
   * call and delete a batch the history had just shown.
   *
   * Two statements and no transaction, deliberately: the service owns transaction
   * boundaries, and this delete is idempotent — a concurrent prune that removed a
   * candidate first simply makes the second `DELETE` match fewer rows.
   */
  async pruneAgentBatches(
    workspaceId: string,
    agentId: string,
    keep: number,
  ): Promise<number> {
    const doomed = await this.db
      .select({ id: t.evalBatches.id })
      .from(t.evalBatches)
      .where(
        and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.agentId, agentId)),
      )
      .orderBy(desc(t.evalBatches.startedAt), desc(t.evalBatches.id))
      .offset(keep);
    if (doomed.length === 0) return 0;
    const deleted = await this.db
      .delete(t.evalBatches)
      .where(
        inArray(
          t.evalBatches.id,
          doomed.map((d) => d.id),
        ),
      )
      .returning({ id: t.evalBatches.id });
    return deleted.length;
  }

  // ---- shared query shapes ------------------------------------------------

  /** `[]` for `all`, so the caller adds no predicate rather than one against a sentinel date. */
  private sinceFilter(since: Date | null): SQL[] {
    // Bound through `gte()`, which parameterises the Date correctly. Interpolating
    // one into a raw `sql` template throws inside postgres-js at runtime while
    // typechecking cleanly, and Fastify turns that into a generic 500.
    return since ? [gte(t.evalBatches.startedAt, since)] : [];
  }

  private async selectBatches(where: SQL[], limit?: number): Promise<EvalBatch[]> {
    const q = this.db
      .select(BATCH_COLUMNS)
      .from(t.evalBatches)
      .leftJoin(t.agents, eq(t.evalBatches.agentId, t.agents.id))
      .where(and(...where))
      .orderBy(desc(t.evalBatches.startedAt), desc(t.evalBatches.id));
    const rows = await (limit === undefined ? q : q.limit(limit));
    return rows.map(toEvalBatch);
  }

  /**
   * Attach each case's most recent execution.
   *
   * `DISTINCT ON (case_id) … ORDER BY case_id, ran_at DESC, id DESC` — the one
   * shape that returns a per-group LATEST row in SQL, which a `GROUP BY` cannot
   * do, and the read `eval_runs_case_ran_idx` exists for. `id desc` breaks a tie
   * on `ran_at`: two executions recorded in the same millisecond would otherwise
   * pick a winner in heap order.
   */
  private async withExecutions(rows: StoredEvalCase[]): Promise<EvalAgentCase[]> {
    const caseIds = rows.map((r) => r.id);
    if (caseIds.length === 0) return [];
    const latest = await this.db
      .selectDistinctOn([t.evalRuns.caseId], {
        caseId: t.evalRuns.caseId,
        outcome: t.evalRuns.outcome,
        notRunReason: t.evalRuns.notRunReason,
        expectedCount: t.evalRuns.expectedCount,
        actualCount: t.evalRuns.actualCount,
      })
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(asc(t.evalRuns.caseId), desc(t.evalRuns.ranAt), desc(t.evalRuns.id));
    const byCase = new Map<string, StoredEvalCaseExecution>(
      latest.map((r) => [
        r.caseId,
        {
          outcome: r.outcome,
          notRunReason: r.notRunReason,
          expectedCount: r.expectedCount,
          actualCount: r.actualCount,
        },
      ]),
    );
    return rows.map((row) => toEvalAgentCase(row, byCase.get(row.id)));
  }
}
