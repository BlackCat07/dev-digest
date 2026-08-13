import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
// Type-only: erased before drizzle-kit's bundler ever resolves it, so the
// `@devdigest/shared` path alias never has to survive migration generation.
import type { IntentSource, Risk } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // Postgres does not index a FK column on its own. The PR list filters
    // `pr_id IN (…) AND kind = 'review'` and orders by created_at desc (see
    // modules/pulls/routes.ts), and `reviewsForPull` filters pr_id and orders the
    // same way — one composite index serves both, including the ORDER BY.
    prKindCreatedIdx: index('reviews_pr_kind_created_idx').on(
      t.prId,
      t.kind,
      t.createdAt.desc(),
    ),
    // The timeline joins a run to its review by run_id (reviews/repository/run.repo.ts).
    runIdx: index('reviews_run_idx').on(t.runId),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    /**
     * Whether the finding is about the job the PR claims to be doing (L03).
     *
     * NULLABLE on purpose. Null means "never labelled", which is NOT the same as
     * `in_scope`, and the UI shows an unlabelled finding under every filter.
     * Nothing is ever dropped on the strength of this column.
     *
     * A row is unlabelled whenever the run had no intent to judge against —
     * every row written before the Intent Layer existed, and every row from a
     * run whose prompt carried no intent block, whether because the PR has none
     * yet, the derivation failed, or it had not answered inside the review's
     * budget. The scope guard in `reviewer-core` runs ONLY when an intent block
     * was supplied, so those runs cannot label anything even by accident. A run
     * that DID carry an intent can still leave a finding null: the model labels,
     * the guard only floors.
     *
     * As with `reviews.kind`, `text(..., { enum: [...] })` emits a PLAIN `text`
     * column — drizzle generates NO CHECK constraint from it and the enum is
     * TypeScript-level only. Do not hand-add a CHECK to the generated SQL.
     *
     * Not indexed: `scope` is filtered client-side across one review's findings
     * (they are already fetched together), never in SQL.
     */
    scope: text('scope', { enum: ['in_scope', 'out_of_scope'] }),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // `findings` carries neither pr_id nor run_id, so every rollup travels
    // findings.review_id → reviews.id: the PR-list severity GROUP BY joins on it,
    // and a review delete cascades through it.
    reviewIdx: index('findings_review_idx').on(t.reviewId),
  }),
);

/**
 * One derivation of what a PR claims to be doing (L03, the Intent Layer).
 *
 * Widened from the placeholder this file shipped with — `intent` plus the two
 * scope arrays — while the table was still empty and read by nothing. The added
 * columns are the derivation's receipt: which sources were actually available,
 * which model produced it, what it cost, and when it ran against which head.
 *
 * `intent` LOSES its `.notNull()` here. The classifier runs in the background
 * and can be in flight (`status: 'running'`) or have failed (`'failed'`), and
 * both of those need a row to record themselves on — a PR with no derivable
 * intent is a worse review, never a broken one. `in_scope`/`out_of_scope` keep
 * their `'[]'::jsonb` default and arrive empty rather than absent in those
 * states, which is why they stay NOT NULL.
 *
 * Two absences that read as oversights and are not:
 *
 *  - **No `workspace_id`.** `pr_id` is the primary key and FKs to
 *    `pull_requests`, which is already workspace-scoped, and every read path
 *    resolves the PR through `getPull(workspaceId, prId)` before it touches the
 *    intent row. The column would denormalise for no query that exists.
 *  - **No index.** `pr_id` is the PRIMARY KEY, so the FK column already carries
 *    a unique B-tree — the usual "Postgres does not index a FK column on its
 *    own" rule stated on `reviews` above does not bite here, and there is no
 *    other access path: the table is only ever read one PR at a time.
 *
 * `text(..., { enum: [...] })` on `status` emits a PLAIN `text` column, exactly
 * as `reviews.kind` does: drizzle generates NO CHECK constraint from it and the
 * enum is TypeScript-level only. Do not hand-add a CHECK to the generated SQL.
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent'),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Head commit the derivation ran against; drives staleness. */
  headSha: text('head_sha'),
  /**
   * 0..1, DERIVED from which sources were actually available. The model's own
   * self-report may only lower it, never raise it.
   */
  confidence: doublePrecision('confidence').notNull().default(0),
  /** Audit trail of every input the classifier was offered — used or unfetched. */
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  /** What could not be read, stated plainly. Never filled in by guessing. */
  missingContext: jsonb('missing_context')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // L03 — `Risk[]` from the shared contract (contracts/brief.ts). Defaults to an
  // empty array, like the two jsonb columns above, so every row written before
  // this column existed reads back as "no risks" rather than null — the client
  // then needs no null branch for it.
  riskAreas: jsonb('risk_areas')
    .$type<Risk[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  status: text('status', { enum: ['running', 'ok', 'partial', 'failed'] })
    .notNull()
    .default('ok'),
  provider: text('provider'),
  model: text('model'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD. Null = no price is known for the model — NOT the same as a free call (0). */
  costUsd: doublePrecision('cost_usd'),
  derivedAt: timestamp('derived_at', { withTimezone: true }),
  /** Failure message when `status` is 'failed'; null otherwise. */
  error: text('error'),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
