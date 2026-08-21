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
import type { IntentSource, PrRiskBrief, Risk } from '@devdigest/shared';
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


/**
 * The payload half of a stored brief: exactly the `PrRiskBrief` fields the
 * columns below do NOT carry.
 *
 * Declared as a `Pick` of the contract rather than spelled out again, so a field
 * added to `PrRiskBrief` cannot quietly stop being stored. `risk_level`,
 * `status`, `reason`, `head_sha`, `cache_key`, `generated_at` and the five
 * generation figures are columns and are therefore absent here; `pr_id` is the
 * primary key, and `stale` / `generation_state` are derived on read (from the
 * cache key and from `state` plus the row's existence) and are never stored.
 */
export type StoredBriefBody = Pick<
  PrRiskBrief,
  'what' | 'why' | 'risks' | 'review_focus' | 'diff_stats' | 'sources'
>;

/**
 * `pr_brief` — the single stored PR Brief per pull request (SPEC-03, Why + Risk).
 *
 * Widened from the `pr_id` + `json` placeholder this file shipped with. Shape
 * follows `onboarding` (`context.ts`), which follows `pr_intent` above:
 * parent-keyed PK, `jsonb` for the payload, and REAL columns for everything a
 * screen or a log line reads without opening the payload — the cache key, the
 * generation lifecycle, the honesty of the stored brief, provenance and price.
 *
 *  - **No index.** `pr_id` is the PRIMARY KEY, so the FK column already carries a
 *    unique B-tree, and every read of this table is by that key — one pull
 *    request at a time. The "Postgres does not index a FK column on its own"
 *    rule stated on `reviews` above does not bite here.
 *  - **No `workspace_id`.** As with `pr_intent`: `pr_id` FKs to `pull_requests`,
 *    which is already workspace-scoped, and every read path resolves the pull
 *    request through `getPull(workspaceId, prId)` before it touches this row.
 *  - **`never_generated` is the ABSENCE of a row**, not a `state` value — which
 *    is why `state` has two members where the contract's
 *    `BriefGenerationState` has three. That asymmetry is deliberate.
 *  - `text(..., { enum: [...] })` emits a PLAIN `text` column, exactly as
 *    `reviews.kind` and `pr_intent.status` do: drizzle generates NO CHECK
 *    constraint from it and the enum is TypeScript-level only. Do not hand-add a
 *    CHECK to the generated SQL.
 *  - Every column added after the placeholder is nullable or carries a
 *    NON-VOLATILE default (`now()` is stable), so the `ALTER TABLE` does not
 *    rewrite the table.
 */
export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  /**
   * The brief body: what, why, the risks, the review focus, the deterministic
   * diff figures and the source audit trail — and nothing the columns below
   * already carry. `$type` is a CAST, not a parse: the repository still
   * `safeParse`s this value on the way out, because a jsonb written before a
   * field existed reads back with the key ABSENT rather than null, and a payload
   * that does not parse is treated as no brief at all.
   */
  json: jsonb('json').$type<StoredBriefBody>().notNull(),
  /**
   * The digest over the nine values the pull request's state is made of, as of
   * the generation that wrote this row. The read path compares it against a
   * freshly computed key to answer `stale` — the head SHA alone is not enough,
   * because it is written by the pull-request LIST route while the description
   * and the changed files are written only by the DETAIL route.
   */
  cacheKey: text('cache_key'),
  /** Head commit this brief was generated against; travels with the brief. */
  headSha: text('head_sha'),
  /**
   * Generation lifecycle. Read by the read path to answer `running`, and by the
   * claim that decides whether a second generation may start.
   */
  state: text('state', { enum: ['running', 'done'] })
    .notNull()
    .default('done'),
  /** Honesty of the stored brief; served as `PrRiskBrief.status`. */
  status: text('status', { enum: ['ok', 'partial', 'degraded'] })
    .notNull()
    .default('degraded'),
  /**
   * Why the brief is not `ok`. Deliberately NOT a DB enum: `BriefReason` is the
   * authority and validates on the way out, and a DB enum would need its own
   * migration every time a reason is added — including the ones this brief
   * carries through from the blast map verbatim rather than re-deriving.
   */
  reason: text('reason'),
  /**
   * The whole pull request's risk level, DERIVED as the highest severity among
   * the risks that survived grounding — never taken from the model. A column
   * because the PR list and the log line read it without opening the payload.
   */
  riskLevel: text('risk_level'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  /** When the current generation started; the staleness window for a dead worker reads it. */
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** The model that wrote the brief, served with it and emitted in the log line. */
  provider: text('provider'),
  model: text('model'),
  /** Provider round-trips the one structured call took. Nothing else here records it. */
  attempts: integer('attempts'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD. Null = no price is known for the model — NOT the same as a free call (0). */
  costUsd: doublePrecision('cost_usd'),
  /** Free-text failure message; `reason` is the machine-readable half. */
  error: text('error'),
});
