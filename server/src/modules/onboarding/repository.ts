import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  OnboardingReason,
  OnboardingStatus,
  OnboardingTourSection,
  type OnboardingTour,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  OnboardingRepoRow,
  OnboardingStore,
  StoredTour,
  StoredTourWrite,
} from './types.js';

/**
 * Data access for the Onboarding Tour. The ONLY file in this module that
 * touches `db/schema` and `drizzle-orm`; everything above it sees
 * {@link OnboardingStore}, which — like every other port and row shape this
 * module declares — lives in `types.ts` rather than beside this implementation.
 *
 * Three things it is arranged to guarantee:
 *
 *  - **The stored body is PARSED on the way out, never cast** (EC-28). The
 *    `json` column carries a `$type<…>()`, which is a compile-time cast and
 *    nothing more: a document written before a field existed reads back with the
 *    key ABSENT rather than null, and an `as` there has already shipped `$NaN`
 *    to a client from this codebase (`server/INSIGHTS.md`, 2026-08-02 and
 *    2026-08-19). A body that fails the parse degrades to no sections with a
 *    reason rather than reaching the screen.
 *  - **The repository lookup is the authorization check.** `onboarding` carries
 *    no `workspace_id` of its own — its primary key FKs to the already-scoped
 *    `repos` — so {@link OnboardingRepository.getRepo} takes a `workspaceId` and
 *    filters on it, and the service calls it FIRST (AC-29). The tour reads
 *    themselves are by `repo_id` alone, which is safe only because nothing
 *    reaches them without that lookup having succeeded.
 *  - **It reaches into no sibling module.** The `repos` module has a repository
 *    of its own, and importing it would be a `no-cross-module-internals`
 *    violation that `import type` does not exempt (`server/INSIGHTS.md`,
 *    2026-08-14). The query here is narrower anyway: four columns, not a row.
 *    The sibling's path is deliberately not spelled out above: this module's
 *    Done-condition greps for those path strings and passes on zero lines, so
 *    a comment naming one produces output indistinguishable from a real import
 *    — and a gate whose failure has to be resolved by reading is a gate the
 *    next reader skips.
 */

/** The shape the `json` column is expected to hold. Parsed, never cast. */
const StoredBody = z.object({ sections: z.array(OnboardingTourSection) });

export class OnboardingRepository implements OnboardingStore {
  constructor(private readonly db: Db) {}

  /**
   * Resolve a repository inside the caller's workspace (AC-29).
   *
   * `undefined` rather than a throw: whether a missing repository is a 404 or a
   * silent completion depends on which path is asking, and that is the service's
   * decision to make — a generation whose repository was deleted mid-flight ends
   * quietly (EC-21) while a read of one answers not-found.
   */
  async getRepo(workspaceId: string, repoId: string): Promise<OnboardingRepoRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
      })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  /**
   * Is the repository still there?
   *
   * Asked immediately before a generation persists. `onboarding.repo_id` is
   * `ON DELETE cascade`, so a repository deleted while a job runs takes the
   * `running` row with it and BOTH write paths break at once — the completion
   * upsert violates the foreign key, and the bookkeeping write has no row to
   * land on. Unscoped by workspace on purpose: the workspace was already checked
   * when the generation was requested, and this asks a narrower question than
   * that one did.
   */
  async repoExists(repoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.id, repoId))
      .limit(1);
    return row !== undefined;
  }

  async get(repoId: string): Promise<StoredTour | undefined> {
    const [row] = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId))
      .limit(1);
    if (!row) return undefined;

    const body = StoredBody.safeParse(row.json);
    return {
      sections: body.success ? body.data.sections : [],
      bodyValid: body.success,
      state: row.state,
      status: OnboardingStatus.safeParse(row.status).data ?? 'degraded',
      // A reason the enum no longer recognises becomes null rather than reaching
      // the client as a literal it has no message for; the screen's own fallback
      // is a complete sentence, and an unexplained notice beats a leaked enum.
      reason: OnboardingReason.safeParse(row.reason).data ?? null,
      indexedSha: row.indexedSha,
      filesIndexed: row.filesIndexed,
      filesSkipped: row.filesSkipped,
      model: row.model,
      attempts: row.attempts,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costUsd: row.costUsd,
      generatedAt: row.generatedAt,
      startedAt: row.startedAt,
    };
  }

  /**
   * Claim the row for a generation, before any slow work.
   *
   * An upsert because `never_generated` is the ABSENCE of a row: the first
   * generation of a repository has nothing to update, and `json` is `NOT NULL`
   * with no default, so the insert supplies an empty body. The stored sections
   * of an existing tour are deliberately left alone — a running generation does
   * not blank the tour a colleague is reading; it replaces it only when it
   * succeeds (AC-28).
   */
  async markRunning(repoId: string, startedAt: Date): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: { sections: [] },
        state: 'running',
        status: 'degraded',
        startedAt,
        error: null,
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { state: 'running', startedAt, error: null },
      });
  }

  /**
   * Replace the repository's single stored tour (AC-28).
   *
   * `generated_at` is written explicitly rather than left to the column default,
   * so the value the response carries is the one the caller decided — the read
   * path compares it and a test can pin it.
   */
  async save(repoId: string, write: StoredTourWrite, generatedAt: Date): Promise<void> {
    const columns = {
      json: { sections: write.sections },
      generatedAt,
      state: 'ready' as const,
      status: write.status,
      reason: write.reason,
      indexedSha: write.indexedSha,
      filesIndexed: write.filesIndexed,
      filesSkipped: write.filesSkipped,
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
      .insert(t.onboarding)
      .values({ repoId, ...columns })
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: columns });
  }

  /**
   * Take a row out of `running` and record why, without touching the tour.
   *
   * The bookkeeping half of a failed job: the sections, the provenance and the
   * figures of whatever was last generated stay exactly as they were, because a
   * failed regeneration must not destroy the tour it failed to replace.
   * `WHERE repo_id = …` and nothing else, so a row that has since been deleted
   * updates nothing rather than erroring.
   */
  async clearRunning(
    repoId: string,
    message: string,
    reason: OnboardingTour['reason'],
  ): Promise<void> {
    await this.db
      .update(t.onboarding)
      .set({
        state: 'ready',
        status: 'degraded',
        reason,
        startedAt: null,
        error: message.slice(0, 500),
        // `generated_at` is deliberately absent from this patch: the stored
        // sections are untouched, so the caption beside the title must keep
        // reporting when the CONTENT was written, not when a generation ended.
      })
      .where(eq(t.onboarding.repoId, repoId));
  }
}
