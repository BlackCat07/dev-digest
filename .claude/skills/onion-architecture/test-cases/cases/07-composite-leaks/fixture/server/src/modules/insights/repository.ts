import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { AgentRunRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
import type { InsightWindow, RepoReliability } from '@devdigest/shared';

/** L07 — insights data-access over `agent_runs` and `insight_snapshots`. */
export class InsightsRepository {
  constructor(private readonly db: Db) {}

  runsInWindow(window: InsightWindow): Promise<AgentRunRow[]> {
    return this.db
      .select()
      .from(t.agentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
      .where(
        and(
          eq(t.pullRequests.repoId, window.repoId),
          gte(t.agentRuns.createdAt, new Date(window.from)),
          lt(t.agentRuns.createdAt, new Date(window.to)),
        ),
      )
      .orderBy(desc(t.agentRuns.createdAt))
      .then((rows) => rows.map((r) => r.agent_runs));
  }

  async activeRepoIds(from: string, to: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ repoId: t.pullRequests.repoId })
      .from(t.agentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
      .where(and(gte(t.agentRuns.createdAt, new Date(from)), lt(t.agentRuns.createdAt, new Date(to))));
    return rows.map((r) => r.repoId);
  }

  /**
   * Write the figure and its per-agent breakdown. Both statements land or
   * neither does, so a snapshot never exists without the rows it summarises.
   */
  async recordSnapshot(window: InsightWindow, row: RepoReliability): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [snap] = await tx
        .insert(t.insightSnapshots)
        .values({
          repoId: row.repoId,
          windowFrom: new Date(window.from),
          windowTo: new Date(window.to),
          reliability: row.reliability,
          runs: row.runs,
        })
        .returning({ id: t.insightSnapshots.id });

      if (row.worstAgent) {
        await tx.insert(t.insightAgents).values({
          snapshotId: snap.id,
          agentId: row.worstAgent,
        });
      }
    });
  }

  async markWindowClosed(window: InsightWindow): Promise<void> {
    await this.db
      .update(t.insightWindows)
      .set({ closedAt: new Date() })
      .where(
        and(
          eq(t.insightWindows.repoId, window.repoId),
          eq(t.insightWindows.windowFrom, new Date(window.from)),
        ),
      );
  }

  async snapshotsFor(repoIds: string[]): Promise<{ repoId: string; reliability: number }[]> {
    return this.db
      .select({ repoId: t.insightSnapshots.repoId, reliability: t.insightSnapshots.reliability })
      .from(t.insightSnapshots)
      .where(inArray(t.insightSnapshots.repoId, repoIds));
  }
}
