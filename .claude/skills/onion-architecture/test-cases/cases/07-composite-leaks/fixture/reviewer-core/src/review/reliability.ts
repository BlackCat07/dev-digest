import type { OutcomeWeights } from '@devdigest/shared';
import { DEFAULT_WEIGHTS } from '@devdigest/shared';

/**
 * Reliability scoring.
 *
 * Given the outcomes of the runs in a window, produce a single 0-1 figure. The
 * calculation is deterministic and total: the same outcomes in a different order
 * give the same number, and an empty window scores 1 rather than 0, because
 * "nothing ran" is not evidence of unreliability.
 */
export interface RunOutcome {
  agentId: string | null;
  status: string;
}

export function scoreReliability(
  outcomes: readonly RunOutcome[],
  weights: OutcomeWeights = DEFAULT_WEIGHTS,
): number {
  if (outcomes.length === 0) return 1;

  const total = outcomes.reduce((acc, o) => acc + (weights[o.status] ?? 0.5), 0);
  return Math.min(1, Math.max(0, total / outcomes.length));
}

/** The agent carrying the most weight loss in the window, or null on a tie-free empty set. */
export function worstAgent(
  outcomes: readonly RunOutcome[],
  weights: OutcomeWeights = DEFAULT_WEIGHTS,
): string | null {
  const loss = new Map<string, number>();
  for (const o of outcomes) {
    if (o.agentId == null) continue;
    loss.set(o.agentId, (loss.get(o.agentId) ?? 0) + (1 - (weights[o.status] ?? 0.5)));
  }
  let worst: string | null = null;
  let worstLoss = 0;
  for (const [agentId, l] of [...loss.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (l > worstLoss) {
      worst = agentId;
      worstLoss = l;
    }
  }
  return worst;
}
