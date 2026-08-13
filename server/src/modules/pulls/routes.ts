import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type {
  PrMeta,
  PrDetail,
  FindingsBySeverity,
  GitHubClient,
  PrReviewComment,
} from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  countFindingsBySeverity,
  deriveReviewStatus,
  EMPTY_FINDINGS_BY_SEVERITY,
} from './status.js';
import { groupLatestPerAgent, minScore, sumCosts } from './latest.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      app.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
              // L03 — the BODY, too, and it costs nothing: this loop already has
              // the detail payload in hand. The PR-list payload carries no body
              // (`adapters/github/octokit.ts` omits it), and the only other writer
              // is `GET /pulls/:id` — so before this line the intent derivation
              // enqueued below ran on a row whose `body` was still null and
              // classified the PR from its TITLE alone, at the confidence floor.
              body: detail.body ?? null,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
          r.body = detail.body ?? null;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // L03 — NO intent derivation is triggered here, and that is deliberate.
    //
    // It used to be, and it was the bug: `pr_files` and `pull_requests.body` are
    // written by `GET /pulls/:id` and by NOTHING ELSE, so a derivation started
    // from this route could only ever see the title. It recorded `status: 'ok'`
    // with one source at the confidence floor, and because `needsDerivation` keys
    // on the head SHA it then cached that forever. Measured on real data before
    // the fix: 15 of 21 rows were title-only at 10%.
    //
    // The trigger now lives on the detail route, immediately after the writes it
    // depends on. Do not add a second one back here "for coverage": whichever
    // trigger fires first wins for that head SHA, so a list-route derivation
    // would re-create the same bug at a figure that merely LOOKS plausible.

    // SCORE + COST + FINDINGS per PR, all aggregated ACROSS AGENTS: a review fans
    // out over N agents, each writing its own reviews row and its own agent_runs
    // row, so no column is a single row's value. Computed on read (no FK denorm).
    //
    // The three do NOT share a basis, on purpose:
    //   SCORE    — WORST score over each agent's LATEST row (one blocker must not
    //              be hidden by a sibling that approved)
    //   COST     — SUM over each agent's LATEST completed run (a re-run REPLACES
    //              that agent's figure)
    //   FINDINGS — SUM over EVERY run, latest or not (a re-run ADDS to it)
    //
    // FINDINGS diverges because it has to equal the "Agent runs" tab badge on the
    // PR detail page, which counts every persisted review's findings. Keep that
    // equality in mind before "harmonising" it with the two columns beside it —
    // see the PrMeta doc-comment and `scores-and-costs.md`.
    const prIds = rows.map((r) => r.id);
    let reviewsByPr = new Map<string, { score: number | null }[]>();
    let runsByPr = new Map<string, { costUsd: number | null }[]>();
    let severityByPr = new Map<string, FindingsBySeverity>();
    if (prIds.length > 0) {
      // reviews.score, not agent_runs.score: the latter was added later (migration
      // 0006) with no backfill, so pre-0006 runs carry score=null while their
      // reviews row still has the real figure.
      const reviewRows = await container.db
        .select({
          prId: t.reviews.prId,
          agentId: t.reviews.agentId,
          id: t.reviews.id,
          score: t.reviews.score,
        })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      reviewsByPr = groupLatestPerAgent(reviewRows, (r) => r.id);

      // Each agent's latest COMPLETED run feeds the COST sum. Deliberately
      // status='done': failed/cancelled/running runs persist cost_usd=null and
      // zeroed tokens, so counting the newest run outright would drop an agent's
      // last real figure right after a quota error. It also keeps COST
      // aggregating over the same agent set as SCORE above, which likewise only
      // ever sees successful runs.
      const runRows = await container.db
        .select({
          prId: t.agentRuns.prId,
          agentId: t.agentRuns.agentId,
          id: t.agentRuns.id,
          costUsd: t.agentRuns.costUsd,
        })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
        .orderBy(desc(t.agentRuns.ranAt));
      runsByPr = groupLatestPerAgent(runRows, (r) => r.id);

      // FINDINGS per severity. Because this sums EVERY run there is no
      // per-agent latest-row collapse to do, so unlike the two queries above it
      // does NOT over-fetch and reduce in JS — Postgres groups it in one pass
      // and returns at most 3 rows per PR instead of every finding ever written.
      // `findings` has neither pr_id nor run_id: findings.review_id → reviews.id
      // is the only path to a PR, so the PR filter lives on the joined table.
      const severityRows = await container.db
        .select({
          prId: t.reviews.prId,
          severity: t.findings.severity,
          n: count(),
        })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .groupBy(t.reviews.prId, t.findings.severity);
      severityByPr = countFindingsBySeverity(severityRows);
    }

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      author: r.author,
      branch: r.branch,
      base: r.base,
      head_sha: r.headSha,
      additions: r.additions,
      deletions: r.deletions,
      files_count: r.filesCount,
      status: deriveReviewStatus({
        ghStatus: r.status,
        lastReviewedSha: r.lastReviewedSha,
        headSha: r.headSha,
        updatedAt: r.updatedAt,
        now,
      }),
      opened_at: r.openedAt?.toISOString() ?? null,
      updated_at: r.updatedAt?.toISOString() ?? null,
      score: minScore(reviewsByPr.get(r.id) ?? []),
      cost_usd: sumCosts(runsByPr.get(r.id) ?? []),
      findings_by_severity: severityByPr.get(r.id) ?? EMPTY_FINDINGS_BY_SEVERITY,
    }));
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    /**
     * L03 — derive this PR's intent in the background, from HERE.
     *
     * This route is the only writer of `pr_files` and of `pull_requests.body`, so
     * it is the only place where the classifier's full material — description,
     * changed-file list, `@@` hunk headers — is guaranteed to exist. Triggering
     * from the PR list instead meant deriving from the title alone and caching
     * that (see the note in the list handler above).
     *
     * Called on BOTH exits. The offline path serves persisted files and body,
     * which is real material and exactly the degradation the spec describes; a PR
     * in a repo with no token still deserves an intent.
     *
     * The route WIRES ONLY — the window, the dedup and the per-row failure
     * isolation are `IntentService`'s rules. Not awaited, so it cannot touch this
     * response's status, body or latency, and `.catch`'d because a floating
     * rejection would kill the process (`server/INSIGHTS.md`, 2026-08-06 /
     * 2026-08-07) even though the method itself never throws.
     */
    const triggerIntent = (headSha: string) => {
      void container.intent
        .enqueueDerivations(
          workspaceId,
          [{ id: pr.id, number: pr.number, headSha, updatedAt: pr.updatedAt }],
          app.log,
        )
        .catch((err: unknown) => app.log.warn({ err }, 'PR intent enqueue failed'));
    };

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // The head SHA too, alongside the files we just replaced. Without it the
          // row can claim head N while `pr_files` hold head N+1, and the intent
          // derived below would be stamped with a SHA that does not match the
          // material it read. Side effect worth knowing: `deriveReviewStatus`
          // compares `last_reviewed_sha` to this, so a reviewed PR whose head has
          // moved starts reading `stale` one detail-read sooner — which is what
          // `stale` already means.
          headSha: detail.head_sha,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      triggerIntent(detail.head_sha);
      return { ...detail, id: pr.id };
    } catch (err) {
      app.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      // The persisted head SHA, because nothing was refreshed on this path.
      triggerIntent(pr.headSha);
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch (err) {
        app.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
        return [];
      }
      try {
        return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
      } catch (err) {
        app.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch {
        throw new AppError(
          'github_unavailable',
          'Connect a GitHub token to post comments.',
          400,
        );
      }
      try {
        return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs (422).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
        throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );
}
