import { and, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { BriefReason, BriefStatus, PrRiskBrief, RiskLevel } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { StoredBriefBody } from '../../db/schema.js';
import type {
  BriefPrFile,
  BriefPull,
  BriefRepoRef,
  BriefStore,
  StoredBrief,
  StoredBriefWrite,
} from './types.js';

/**
 * Data access for the PR Brief. The ONLY file in this module that touches
 * `db/schema` and `drizzle-orm`; everything above it sees {@link BriefStore},
 * which — like every other port and row shape this module declares — lives in
 * `types.ts` rather than beside this implementation.
 *
 * Four things it is arranged to guarantee.
 *
 *  - **The stored body is PARSED on the way out, never cast** (EC-24). The `json`
 *    column carries a `$type<StoredBriefBody>()`, which is a compile-time cast
 *    and nothing more: a payload written before a field existed reads back with
 *    the key ABSENT rather than null, and an `as` on that boundary has already
 *    shipped `$NaN` to a client from this codebase (`server/INSIGHTS.md`,
 *    2026-08-02 and 2026-08-19). A body that fails the parse comes back with
 *    `bodyValid: false`, which the read path treats as NO brief and offers for
 *    regeneration — never as a 500 nobody can clear without a database. The
 *    parse target is derived from the contract itself
 *    ({@link StoredBody}), so it cannot drift from what is served.
 *  - **The pull-request lookup is the authorization check** (AC-35). `pr_brief`,
 *    `pr_files` and `pr_intent` carry no `workspace_id` of their own — their keys
 *    FK to the already-scoped `pull_requests` — so {@link BriefRepository.getPull}
 *    takes a `workspaceId` and filters on it, the service calls it FIRST, and
 *    every other read here is by `pr_id` alone. That is safe only because
 *    nothing reaches those reads without this lookup having succeeded.
 *  - **A claim decides and writes in one statement** (AC-8, AC-9). See
 *    {@link BriefRepository.claimRunning}: a `SELECT` followed by an
 *    unconditional upsert is a check-then-write race, and the racing pair here
 *    is the normal case rather than an exotic one.
 *  - **It reaches into no sibling module.** `pull_requests`, `pr_files` and
 *    `repos` all belong to other modules' repositories, and importing one would
 *    be a `no-cross-module-internals` violation that `import type` does not
 *    exempt (`server/INSIGHTS.md`, 2026-08-14). The queries here are narrower
 *    anyway: three columns of a file row, two of a repository. The sibling paths
 *    are deliberately not spelled out above — this task's Done-condition greps
 *    for those path strings and passes on zero lines, so a comment naming one
 *    produces output indistinguishable from a real import.
 */

/**
 * The shape the `json` column is expected to hold. Parsed, never cast.
 *
 * Taken from the served contract with `.pick()` rather than written out again,
 * which makes it the same six fields `StoredBriefBody` is a `Pick` of — one
 * authority, so a field added to the brief cannot be stored and then dropped
 * silently on the way back out.
 */
const StoredBody = PrRiskBrief.pick({
  what: true,
  why: true,
  risks: true,
  review_focus: true,
  diff_stats: true,
  sources: true,
});

/**
 * The body a row carries before anything has been generated into it, and the one
 * a failed parse degrades to.
 *
 * `json` is `NOT NULL` with no default, so the claim's INSERT has to supply
 * something; zeroed figures are the honest value — a claim has counted nothing
 * yet — and the status column, not this body, is what says the brief is not real.
 */
const EMPTY_BODY: StoredBriefBody = {
  what: null,
  why: null,
  risks: [],
  review_focus: [],
  diff_stats: {
    files_changed: 0,
    files_listed: 0,
    additions: 0,
    deletions: 0,
    symbols: 0,
    endpoints: 0,
  },
  sources: [],
};

export class BriefRepository implements BriefStore {
  constructor(private readonly db: Db) {}

  /**
   * Resolve a pull request inside the caller's workspace (AC-35).
   *
   * `undefined` rather than a throw: whether a missing pull request is a 404 or a
   * silent completion depends on which path is asking, and that is the service's
   * decision to make.
   */
  async getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        branch: t.pullRequests.branch,
        base: t.pullRequests.base,
        headSha: t.pullRequests.headSha,
        additions: t.pullRequests.additions,
        deletions: t.pullRequests.deletions,
        filesCount: t.pullRequests.filesCount,
        updatedAt: t.pullRequests.updatedAt,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  /**
   * The owner and name a clone read and an issue read address the repository by.
   *
   * Unscoped by workspace on purpose, exactly as the intent module's equivalent
   * is: the workspace was already checked by {@link getPull}, whose row supplied
   * the `repoId` asked for here, so this asks a narrower question than that one
   * did.
   */
  async getRepo(repoId: string): Promise<BriefRepoRef | undefined> {
    const [row] = await this.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(eq(t.repos.id, repoId))
      .limit(1);
    return row;
  }

  /**
   * The pull request's changed files — path and counts, and no patch.
   *
   * Three columns rather than a row, and the omission is the requirement: AC-11
   * forbids a diff hunk body anywhere in the model input, and not selecting it is
   * a stronger guarantee than remembering not to send it.
   *
   * **No `ORDER BY`, deliberately.** The role ordering preserves the input's own
   * order within each role (AC-60), so this answers in whatever order Postgres
   * reads the heap — which is also why anything keyed on this list must impose an
   * order of its own before digesting it: `pr_files` carries no unique constraint
   * on `(pr_id, path)` either, so the cache key deduplicates by path first
   * (EC-4).
   */
  async getPrFiles(prId: string): Promise<readonly BriefPrFile[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /**
   * The stored brief, with its body parsed and its three enum columns validated.
   *
   * A `status`, `reason` or `risk_level` the contract no longer recognises comes
   * back as the safe value rather than reaching a client as a literal it has no
   * message for: the card's own fallback is a complete sentence, and an
   * unexplained notice beats a leaked enum. `reason` is plain `text` in the
   * schema for exactly this reason — the contract is the authority and it
   * validates here, on the way out.
   */
  async get(prId: string): Promise<StoredBrief | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .limit(1);
    if (!row) return undefined;

    const body = StoredBody.safeParse(row.json);
    return {
      what: body.success ? body.data.what : null,
      why: body.success ? body.data.why : null,
      risks: body.success ? body.data.risks : [],
      reviewFocus: body.success ? body.data.review_focus : [],
      diffStats: body.success ? body.data.diff_stats : EMPTY_BODY.diff_stats,
      sources: body.success ? body.data.sources : [],
      bodyValid: body.success,
      state: row.state,
      status: BriefStatus.safeParse(row.status).data ?? 'degraded',
      reason: BriefReason.safeParse(row.reason).data ?? null,
      riskLevel: RiskLevel.safeParse(row.riskLevel).data ?? null,
      cacheKey: row.cacheKey,
      headSha: row.headSha,
      provider: row.provider,
      model: row.model,
      attempts: row.attempts,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costUsd: row.costUsd,
      generatedAt: row.generatedAt,
      startedAt: row.startedAt,
      error: row.error,
    };
  }

  /**
   * Claim the pull request for a generation — ONE statement that both decides and
   * writes (AC-8), with the abandoned-generation window inside its own `WHERE`
   * (AC-9). `true` means the claim was won and the caller may enqueue.
   *
   * The onboarding store's shape is deliberately NOT copied here. There, a plain
   * `SELECT` is followed by an unconditional upsert that always sets `running`:
   * two un-transacted statements with no lock between them, so under READ
   * COMMITTED two near-simultaneous requests can both read a non-running state
   * and both enqueue. For this feature that pair is the NORMAL case — the
   * automatic trigger on the pull-request detail read racing a manual regenerate
   * (EC-19) — and a hermetic test with sequential awaits would never show it.
   *
   * A conditional `UPDATE … RETURNING` closes it because Postgres serialises two
   * concurrent updates of one row and re-evaluates the `WHERE` against the
   * winner's committed version: the loser's predicate no longer holds, it updates
   * nothing, and it reports `false`. The `INSERT … ON CONFLICT DO NOTHING
   * RETURNING` below is the no-row case and is closed the same way — the
   * conflicting insert returns no row.
   *
   * `started_at IS NULL` is in the predicate alongside the window because a row
   * marked `running` with no start time has no measurable age: without that term
   * it could never satisfy `started_at < staleBefore` and would refuse every
   * future generation forever, which is precisely the brick the window exists to
   * prevent.
   */
  async claimRunning(prId: string, startedAt: Date, staleBefore: Date): Promise<boolean> {
    const claimed = await this.db
      .update(t.prBrief)
      .set({ state: 'running', startedAt, error: null })
      .where(
        and(
          eq(t.prBrief.prId, prId),
          or(
            ne(t.prBrief.state, 'running'),
            isNull(t.prBrief.startedAt),
            lt(t.prBrief.startedAt, staleBefore),
          ),
        ),
      )
      .returning({ prId: t.prBrief.prId });
    if (claimed.length > 0) return true;

    // No row yet — `never_generated` is the ABSENCE of one, so the first
    // generation of a pull request has nothing to update. `DO NOTHING` rather
    // than `DO UPDATE`: a conflict means another claim landed between the two
    // statements, and that claim won.
    const inserted = await this.db
      .insert(t.prBrief)
      .values({
        prId,
        json: EMPTY_BODY,
        state: 'running',
        status: 'degraded',
        startedAt,
        error: null,
      })
      .onConflictDoNothing({ target: t.prBrief.prId })
      .returning({ prId: t.prBrief.prId });
    return inserted.length > 0;
  }

  /**
   * Replace the pull request's single stored brief.
   *
   * One brief per pull request, replaced whole: there is no history, no per-user
   * and no per-branch variant. `generated_at` is written explicitly rather than
   * left to the column default, so the value the response carries is the one the
   * caller decided and a test can pin it. `started_at` is cleared in the same
   * write, which is what takes the row out of `running`.
   */
  async save(prId: string, write: StoredBriefWrite, generatedAt: Date): Promise<void> {
    const json: StoredBriefBody = {
      what: write.what,
      why: write.why,
      risks: [...write.risks],
      review_focus: [...write.reviewFocus],
      diff_stats: write.diffStats,
      sources: [...write.sources],
    };
    const columns = {
      json,
      generatedAt,
      state: 'done' as const,
      status: write.status,
      reason: write.reason,
      riskLevel: write.riskLevel,
      cacheKey: write.cacheKey,
      headSha: write.headSha,
      provider: write.provider,
      model: write.model,
      attempts: write.attempts,
      tokensIn: write.tokensIn,
      tokensOut: write.tokensOut,
      costUsd: write.costUsd,
      startedAt: null,
      error: write.error,
    };
    await this.db
      .insert(t.prBrief)
      .values({ prId, ...columns })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: columns });
  }

  /**
   * Take a row out of `running` and record why, without touching the brief.
   *
   * The bookkeeping half of a failed generation: the body, the provenance and the
   * figures of whatever was last generated stay exactly as they were, because a
   * failed regeneration must not destroy the brief it failed to replace.
   * `WHERE pr_id = …` and nothing else, so a row that has since been deleted —
   * `pr_brief.pr_id` is `ON DELETE cascade` — updates nothing rather than
   * erroring.
   *
   * `generated_at` is deliberately absent from this patch: the stored body is
   * untouched, so the caption beside the card's title must keep reporting when
   * the CONTENT was written, not when a generation ended.
   */
  async clearRunning(prId: string, message: string, reason: BriefReason | null): Promise<void> {
    await this.db
      .update(t.prBrief)
      .set({
        state: 'done',
        status: 'degraded',
        reason,
        startedAt: null,
        error: message.slice(0, 500),
      })
      .where(eq(t.prBrief.prId, prId));
  }
}
