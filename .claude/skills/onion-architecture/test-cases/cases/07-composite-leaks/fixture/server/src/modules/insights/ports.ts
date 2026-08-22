import type { AgentRunRow } from '../../db/rows.js';
import type { InsightWindow, RepoReliability } from '@devdigest/shared';

/**
 * L07 — the capabilities this module needs, declared here rather than taken off
 * the container, so the dependencies are visible in the service's signature and
 * a test can supply its own.
 */
export interface InsightsRepositoryPort {
  /** Every run that started inside the window, newest first. */
  runsInWindow(window: InsightWindow): Promise<AgentRunRow[]>;
  /** Persist one repository's computed figure for the window. */
  recordSnapshot(window: InsightWindow, row: RepoReliability): Promise<void>;
  /** Mark the window as closed so a later pass does not recompute it. */
  markWindowClosed(window: InsightWindow): Promise<void>;
  /** Repositories with any activity in the window. */
  activeRepoIds(from: string, to: string): Promise<string[]>;
}

export interface WindowClockPort {
  /** The closed window ending at the most recent hour mark before `now`. */
  currentWindow(repoId: string): InsightWindow;
}

export interface InsightsDeps {
  insights: InsightsRepositoryPort;
  clock: WindowClockPort;
}
