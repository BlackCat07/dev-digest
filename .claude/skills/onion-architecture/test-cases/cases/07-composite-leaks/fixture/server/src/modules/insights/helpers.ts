import type { AgentRunRow } from '../../db/rows.js';
import type { RunOutcome } from '@devdigest/reviewer-core';
import type { RepoReliability } from '@devdigest/shared';
import type { InsightRow } from './types.js';

/** Row -> the shape the scorer works in. */
export function toRunOutcome(row: AgentRunRow): RunOutcome {
  return { agentId: row.agentId, status: row.status };
}

/** Snapshot row -> the wire object the report renders. */
export function toInsightDto(row: InsightRow): RepoReliability {
  return {
    repoId: row.repoId,
    runs: row.runs,
    reliability: row.reliability,
    worstAgent: row.worstAgent ?? null,
  };
}
