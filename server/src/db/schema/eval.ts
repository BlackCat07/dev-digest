import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    /**
     * What the case asserts about the agent's output (L06).
     *
     * A first-class column rather than something inferred from
     * `expected_output`: the UI filters and counts by it, and a batch's metrics
     * aggregate by it — a `must_not_flag` case contributes false positives where
     * a `must_find` case contributes true positives and false negatives.
     *
     * NULLABLE, like every other column this lesson adds to an already-shipped
     * table: the table is empty today and nothing backfills history, so no
     * default has to be invented for rows that do not exist. The read path
     * supplies the contract's non-null `EvalExpectation` when it maps Row → DTO.
     *
     * As with `reviews.kind` and `pr_intent.status`, `text(..., { enum: [...] })`
     * emits a PLAIN `text` column — drizzle generates NO CHECK constraint from
     * it and the enum is TypeScript-level only. Do not hand-add a CHECK to the
     * generated SQL.
     */
    expectation: text('expectation', { enum: ['must_find', 'must_not_flag'] }),
    /**
     * The finding this case was derived from — provenance, and deliberately
     * carrying NO foreign key, exactly as `reviews.agent_id` does.
     *
     * A case outlives the finding that produced it: deleting a review (and its
     * findings with it) must neither delete the case nor blank the only trace of
     * where its expectation came from. A real FK would force one of those two.
     */
    sourceFindingId: uuid('source_finding_id'),
    /**
     * Whether a human has changed the case since it was derived, so a derived
     * case and a hand-tuned one are distinguishable. NOT NULL with a
     * non-volatile default, so the ALTER does not rewrite the table.
     */
    edited: boolean('edited').notNull().default(false),
    createdAt: now(),
  },
  (t) => ({
    // Postgres does not index a FK column on its own, and every read of a set is
    // "this workspace's cases for this owner" — the set read, the set-size count
    // behind the 50-case limit, and the anchor-conflict lookup.
    ownerIdx: index('eval_cases_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
    // The duplicate-source-finding check is a point lookup on this column, run on
    // every "turn this finding into a case".
    sourceFindingIdx: index('eval_cases_source_finding_idx').on(t.sourceFindingId),
    // The set is rendered in a TOTAL order — name asc, then id asc. Ordering on
    // `name` alone returns tied rows in physical heap order and an update moves
    // one, which is a list that reorders under the reader; `id` is the unique
    // tiebreaker that makes the order stable.
    ownerNameIdx: index('eval_cases_owner_name_idx').on(t.ownerId, t.name, t.id),
  }),
);

/**
 * One on-demand execution of a whole eval set (L06) — the unit two runs compare
 * as, which `eval_runs` cannot be: that table is one row per case execution and
 * carries no batch identity, so "compare these two runs" and "which prompt
 * produced this number" are not expressible from it.
 *
 * Three shape decisions carry the feature:
 *
 *  - **`agent_id` is nullable, `ON DELETE SET NULL`,** matching
 *    `agent_runs.agent_id`. Deleting an agent leaves its batches readable with
 *    the agent presented as unavailable, rather than deleting the history.
 *    Anything grouping batches by agent therefore needs a fallback key — keying
 *    a map on the raw nullable value collapses every agent-deleted row into one
 *    bucket, and a cost sum then drops all but one of them with no error.
 *  - **The prompt and the model are SNAPSHOT text, not a version join.** An
 *    `agent_versions` row is deleted with its agent, so a comparison rendering
 *    "the prompt that produced this" from a row which may be gone is a
 *    comparison that can start lying. `agent_version` sits beside them as the
 *    number a reader recognises and the promote path acts on.
 *  - **Every metric and count is nullable, and null means "not measured".** A
 *    batch is `running` before it has any; a metric over a zero denominator is
 *    null and never 0; and `cost_usd` is null — not a smaller sum — when any
 *    executed case's cost is unavailable.
 *
 * `text(..., { enum: [...] })` on `status` emits a PLAIN `text` column, as
 * `reviews.kind` does: no CHECK constraint is generated from it and the enum is
 * TypeScript-level only. Do not hand-add a CHECK to the generated SQL.
 */
export const evalBatches = pgTable(
  'eval_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** The agent config version this batch ran, recorded once at creation. */
    agentVersion: integer('agent_version').notNull(),
    /** The prompt text that produced these numbers; never re-read from the agent. */
    systemPromptSnapshot: text('system_prompt_snapshot').notNull(),
    /** The model text that produced these numbers; never re-read from the agent. */
    modelSnapshot: text('model_snapshot').notNull(),
    status: text('status', { enum: ['running', 'complete', 'error'] }).notNull(),
    /** Caller-supplied name for the run; unset unless a caller supplies one. */
    label: text('label'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Every case the batch set out to cover — a `not_run` case counts here. */
    casesCovered: integer('cases_covered'),
    /** Cases that passed — a `not_run` case does NOT count here. */
    casesPassed: integer('cases_passed'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    /** The tallies the metrics were computed from, kept so a null metric is auditable. */
    truePositives: integer('true_positives'),
    falseNegatives: integer('false_negatives'),
    falsePositives: integer('false_positives'),
    /** USD. Null = at least one executed case had no cost — NOT a free batch (0). */
    costUsd: doublePrecision('cost_usd'),
    /** Why the BATCH itself ended in `error` (a deadline), never a case's failure. */
    error: text('error'),
  },
  (t) => ({
    // The per-agent history is rendered started_at desc, then id desc — a TOTAL
    // order, because ordering on started_at alone returns ties in physical heap
    // order and an update moves one. The same index serves the retention scan
    // that keeps only the 50 most recent batches per agent, and `agent_id` is
    // ON DELETE SET NULL, so deleting an agent rewrites matching rows.
    agentStartedIdx: index('eval_batches_agent_started_idx').on(
      t.agentId,
      t.startedAt.desc(),
      t.id.desc(),
    ),
    // The workspace dashboard's cross-agent recent-batch list.
    workspaceStartedIdx: index('eval_batches_workspace_started_idx').on(
      t.workspaceId,
      t.startedAt.desc(),
    ),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    /**
     * The batch this execution belongs to (L06). Nullable, because the rows this
     * table shipped with carry no batch, and `ON DELETE CASCADE`, so the
     * 50-per-agent retention delete takes a dropped batch's case rows with it
     * rather than leaving them orphaned and growing without bound.
     */
    batchId: uuid('batch_id').references(() => evalBatches.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    /**
     * How this execution ended. Three values and not the `pass` boolean above: a
     * case that never executed is neither passed nor failed, and it still counts
     * in its batch's covered total. `pass` is left exactly as it shipped.
     *
     * PLAIN `text` — no CHECK is generated from the enum (see `eval_batches.status`).
     */
    outcome: text('outcome', { enum: ['passed', 'failed', 'not_run'] }),
    /** Present whenever `outcome` is `not_run`, null otherwise. */
    notRunReason: text('not_run_reason', {
      enum: ['deadline', 'provider_error', 'diff_unparseable', 'not_scorable', 'cancelled'],
    }),
    /** Anchors the case expected, and findings it actually produced. Null when nothing ran. */
    expectedCount: integer('expected_count'),
    actualCount: integer('actual_count'),
    /** The grounding gate's own counts for this case — where citation accuracy comes from. */
    keptCount: integer('kept_count'),
    droppedCount: integer('dropped_count'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // Postgres does not index a FK column on its own, and a batch's result list
    // is read exactly this way.
    batchIdx: index('eval_runs_batch_idx').on(t.batchId),
    // The set read joins each case to its MOST RECENT execution: filter case_id,
    // order ran_at desc.
    caseRanIdx: index('eval_runs_case_ran_idx').on(t.caseId, t.ranAt.desc()),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
