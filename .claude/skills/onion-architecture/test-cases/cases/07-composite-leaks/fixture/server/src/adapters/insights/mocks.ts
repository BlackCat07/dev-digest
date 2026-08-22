import type { AgentRunRow } from '../../db/rows.js';
import type { InsightWindow, RepoReliability } from '@devdigest/shared';

/**
 * Test double for the insights repository. Returns whatever the test hands it and
 * records what was written, so a test can assert on the sequence of writes.
 */
export interface MockInsightsOptions {
  runs?: { agentId: string | null; status: string }[];
  repoIds?: string[];
}

export class MockInsightsRepository {
  readonly snapshots: RepoReliability[] = [];
  readonly closed: InsightWindow[] = [];

  constructor(private readonly opts: MockInsightsOptions = {}) {}

  async runsInWindow(_window: InsightWindow): Promise<AgentRunRow[]> {
    return (this.opts.runs ?? []).map(
      (r) =>
        ({
          id: '00000000-0000-0000-0000-000000000000',
          agentId: r.agentId,
          status: r.status,
          prId: null,
          workspaceId: '00000000-0000-0000-0000-000000000000',
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
          costUsd: null,
          score: null,
          model: null,
          kind: 'review',
          error: null,
        }) as unknown as AgentRunRow,
    );
  }

  async activeRepoIds(): Promise<string[]> {
    return this.opts.repoIds ?? [];
  }

  async recordSnapshot(_window: InsightWindow, row: RepoReliability): Promise<void> {
    this.snapshots.push(row);
  }

  async markWindowClosed(window: InsightWindow): Promise<void> {
    this.closed.push(window);
  }
}
