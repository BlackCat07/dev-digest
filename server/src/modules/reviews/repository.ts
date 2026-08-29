import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, PrIntent, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull/intent). This class
 * composes them so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  /** L04 — other pull requests of the repo that touched one of `paths`. */
  listPriorPrOverlaps(
    repoId: string,
    prId: string,
    paths: readonly string[],
  ): Promise<pullRepo.PriorPrOverlapRow[]> {
    return pullRepo.listPriorPrOverlaps(this.db, repoId, prId, paths);
  }

  /** L04 — pull requests in the repo, and how many have an imported file list. */
  countPullCoverage(repoId: string): Promise<{ total: number; withFileLists: number }> {
    return pullRepo.countPullCoverage(this.db, repoId);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- intent (L03) -------------------------------------------------------
  //
  // The Intent module owns NO repository. `pr_intent` belongs to this one — it
  // is a row hanging off a pull request, in the same aggregate as the reviews
  // and findings around it — and every module reaches it through
  // `container.reviewRepo`. See the note above the queries in
  // `./repository/pull.repo.ts`.

  /** Write one derivation (insert-or-update on pr_id). */
  upsertIntent(prId: string, values: pullRepo.IntentUpsert): Promise<void> {
    return pullRepo.upsertIntent(this.db, prId, values);
  }

  /** Mark a derivation in flight against `headSha`, keeping the last good one. */
  markIntentRunning(prId: string, headSha: string, at?: Date): Promise<void> {
    return pullRepo.markIntentRunning(this.db, prId, headSha, at);
  }

  /** Record that a derivation did not complete; the row survives to say so. */
  failIntent(prId: string, error: string, at?: Date): Promise<void> {
    return pullRepo.failIntent(this.db, prId, error, at);
  }

  getIntent(prId: string): Promise<PrIntent | undefined> {
    return pullRepo.getIntent(this.db, prId);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** The multi-agent run this run belongs to; absent for a single-agent run. */
    multiAgentRunId?: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  /** Whether any run of one multi-agent run is still `running`. */
  hasRunningRunForMultiRun(workspaceId: string, multiAgentRunId: string): Promise<boolean> {
    return runRepo.hasRunningRunForMultiRun(this.db, workspaceId, multiAgentRunId);
  }

  completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed' | 'cancelled';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      /** USD cost; null when unknown. Required so failure paths must be explicit. */
      costUsd: number | null;
      findingsCount: number;
      grounding: string;
      /** Review score (0-100); null on failed/cancelled runs. */
      score?: number | null;
      /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
      blockers?: number | null;
      /** Failure reason (status='failed') / cancellation note. Null clears it. */
      error?: string | null;
    },
  ): Promise<void> {
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }
}
