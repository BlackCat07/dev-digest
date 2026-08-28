import type { InsightsReport, RepoReliability } from '@devdigest/shared';
import { scoreReliability, worstAgent } from '@devdigest/reviewer-core';
import type { InsightsDeps } from './ports.js';
import { toRunOutcome } from './helpers.js';
import { MAX_REPOS_PER_REPORT } from './constants.js';

/**
 * L07 — insights service. Walks the repositories active in a window, scores each
 * from the runs it finds, and persists the result so the report is cheap to
 * re-read.
 */
export class InsightsService {
  constructor(private readonly deps: InsightsDeps) {}

  async report(from: string, to: string): Promise<InsightsReport> {
    const repoIds = (await this.deps.insights.activeRepoIds(from, to)).slice(
      0,
      MAX_REPOS_PER_REPORT,
    );

    const repos: RepoReliability[] = [];
    for (const repoId of repoIds) {
      repos.push(await this.scoreOne(repoId));
    }

    return {
      window: this.deps.clock.currentWindow(repoIds[0] ?? ''),
      repos,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Score one repository and persist it. The snapshot and the window's closed
   * flag are written together — a closed window whose snapshot is missing would
   * be skipped forever by the next pass.
   */
  private async scoreOne(repoId: string): Promise<RepoReliability> {
    const window = this.deps.clock.currentWindow(repoId);
    const rows = await this.deps.insights.runsInWindow(window);
    const outcomes = rows.map(toRunOutcome);

    const figure: RepoReliability = {
      repoId,
      runs: outcomes.length,
      reliability: scoreReliability(outcomes, window.weights),
      worstAgent: worstAgent(outcomes, window.weights),
    };

    await this.deps.insights.recordSnapshot(window, figure);
    await this.deps.insights.markWindowClosed(window);

    return figure;
  }
}
