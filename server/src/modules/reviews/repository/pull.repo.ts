import { and, count, countDistinct, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { IntentSource, Risk, type PrIntent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

// ---- prior pull requests over the same files (L04) -------------------------

/** One (earlier pull request, shared path) pair. Grouping happens in the service. */
export interface PriorPrOverlapRow {
  id: string;
  number: number;
  title: string;
  author: string;
  updatedAt: Date | null;
  openedAt: Date | null;
  path: string;
}

/**
 * Every other pull request in the repository that touched one of `paths`, one row
 * per (pull request, shared path).
 *
 * Deliberately NOT grouped in SQL. The service needs both the overlap SIZE and the
 * overlapping paths themselves, and Postgres would hand those back as an aggregate
 * array this repository would then have to parse — for a result set bounded by
 * (files in one PR × pull requests that touched them), which is small. The
 * `ne(id)` is what keeps a pull request out of its own history.
 *
 * Unordered on purpose: ordering a joined row set by the PARENT's columns is not
 * the order the answer needs, so `PriorPrsService` sorts the grouped result.
 */
export async function listPriorPrOverlaps(
  db: Db,
  repoId: string,
  prId: string,
  paths: readonly string[],
): Promise<PriorPrOverlapRow[]> {
  if (paths.length === 0) return [];
  return db
    .select({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      updatedAt: t.pullRequests.updatedAt,
      openedAt: t.pullRequests.openedAt,
      path: t.prFiles.path,
    })
    .from(t.prFiles)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prFiles.prId))
    .where(
      and(
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, prId),
        inArray(t.prFiles.path, [...paths]),
      ),
    );
}

/**
 * How many pull requests the repository has, and how many of them have an imported
 * file list — the denominator that decides whether an empty overlap is a finding or
 * a gap.
 *
 * `pr_files` is written only by `GET /pulls/:id`, so the two figures routinely
 * differ on a fresh workspace and the difference is the whole reason this read
 * exists. Two aggregates rather than one `GROUP BY`: they count different things
 * (rows of `pull_requests` vs distinct parents in `pr_files`) and a single query
 * would need an outer join whose NULL row means "no files", which is the shape that
 * gets miscounted later.
 */
export async function countPullCoverage(
  db: Db,
  repoId: string,
): Promise<{ total: number; withFileLists: number }> {
  const [totals] = await db
    .select({ n: count() })
    .from(t.pullRequests)
    .where(eq(t.pullRequests.repoId, repoId));
  const [withFiles] = await db
    .select({ n: countDistinct(t.prFiles.prId) })
    .from(t.prFiles)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prFiles.prId))
    .where(eq(t.pullRequests.repoId, repoId));
  return { total: totals?.n ?? 0, withFileLists: withFiles?.n ?? 0 };
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent (L03) ---------------------------------------------------------
//
// `pr_intent` lives HERE, in the review domain's data layer, and the Intent
// module deliberately owns NO repository of its own. The table is reached
// through `container.reviewRepo`, exactly as `pull_requests` and `pr_files`
// are. Two repositories over one table is the failure onion layering exists to
// prevent: two places that both "own" the row shape, drift apart on the first
// column added, and neither of them is wrong on its own.

/**
 * Everything a derivation writes, minus the PK.
 *
 * Taken off the table's insert type so a column added to `pr_intent` cannot be
 * silently forgotten by a caller — a partial value set is legitimate (see
 * {@link markIntentRunning}), so the compiler is the only thing that would
 * notice.
 */
export type IntentUpsert = Omit<typeof t.prIntent.$inferInsert, 'prId'>;

/**
 * Write one derivation. Insert-or-update on the PK, so a re-derivation replaces
 * the previous row rather than accumulating history: a PR has exactly one
 * current intent, and the head SHA on the row says what it was derived from.
 *
 * Only the keys present in `values` are updated on conflict, which is what lets
 * the lifecycle writers below touch the status columns without disturbing the
 * last good derivation.
 */
export async function upsertIntent(
  db: Db,
  prId: string,
  values: IntentUpsert,
): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({ prId, ...values })
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

/**
 * Mark a derivation as in flight against `headSha`.
 *
 * The previous derivation's text, confidence and sources are LEFT ALONE on
 * purpose: a re-derivation that fails must not destroy the last good intent,
 * and `status` plus `head_sha` already tell a reader the text predates the
 * current head. `derived_at` is moved to the start of this attempt because it
 * is the only clock on the row, and `IntentService.needsDerivation` measures the
 * abandonment window from it (`INTENT_STALE_AFTER_MS`) — so a row left `running`
 * by a process that died is retried rather than bricking the PR forever.
 */
export async function markIntentRunning(
  db: Db,
  prId: string,
  headSha: string,
  at: Date = new Date(),
): Promise<void> {
  await upsertIntent(db, prId, {
    headSha,
    status: 'running',
    derivedAt: at,
    error: null,
  });
}

/** Longest failure message kept on the row; the rest is noise in a UI card. */
const MAX_ERROR_CHARS = 500;

/**
 * Record that a derivation did not complete.
 *
 * A failed derivation still has a row — that is the whole reason `intent` is
 * nullable — so the card can say what went wrong instead of showing nothing,
 * and so `needsDerivation` can see that this PR is worth trying again.
 */
export async function failIntent(
  db: Db,
  prId: string,
  error: string,
  at: Date = new Date(),
): Promise<void> {
  await upsertIntent(db, prId, {
    status: 'failed',
    error: error.slice(0, MAX_ERROR_CHARS),
    derivedAt: at,
  });
}

export async function getIntent(db: Db, prId: string): Promise<PrIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return toPrIntent(row);
}

const StringArray = z.string().array();

/**
 * Map the stored row to the contract the card and the reviewer both read.
 *
 * Every jsonb column is PARSED, never cast. `$type<T>()` on a jsonb column is a
 * compile-time assertion about bytes Postgres will hand back at runtime — it
 * proves nothing about a row written by an older shape of this code, by the
 * seed, or by hand. An `as` on exactly this kind of boundary already shipped
 * `$NaN` to the client once (`server/INSIGHTS.md`, 2026-08-02). A column that
 * fails to parse degrades to empty rather than throwing: a malformed audit
 * trail must not make the intent unreadable.
 */
function toPrIntent(row: typeof t.prIntent.$inferSelect): PrIntent {
  const sources = IntentSource.array().safeParse(row.sources);
  const missingContext = StringArray.safeParse(row.missingContext);
  const inScope = StringArray.safeParse(row.inScope);
  const outOfScope = StringArray.safeParse(row.outOfScope);
  // Parsed like every other jsonb column here, per the note above — even though
  // `Risk.kind` is an open string, the ARRAY shape and the severity enum are
  // still things a hand-written or older row can violate.
  const riskAreas = Risk.array().safeParse(row.riskAreas);
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: inScope.success ? inScope.data : [],
    out_of_scope: outOfScope.success ? outOfScope.data : [],
    head_sha: row.headSha,
    confidence: row.confidence,
    sources: sources.success ? sources.data : [],
    missing_context: missingContext.success ? missingContext.data : [],
    risk_areas: riskAreas.success ? riskAreas.data : [],
    status: row.status,
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    derived_at: row.derivedAt?.toISOString() ?? null,
    error: row.error,
  };
}
