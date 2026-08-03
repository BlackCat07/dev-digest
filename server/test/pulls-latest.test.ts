import { describe, it, expect } from 'vitest';
import { groupLatestPerAgent, minScore, sumCosts } from '../src/modules/pulls/latest.js';

/**
 * Hermetic cover for the PR-list aggregates. The route over-fetches ordered
 * newest-first and reduces in JS, so this is where the reduction is actually
 * verified — the route itself needs Postgres.
 */
describe('groupLatestPerAgent', () => {
  it('keeps the newest row per (pr, agent), so a re-run replaces rather than doubles', () => {
    const rows = [
      { prId: 'pr-1', agentId: 'security', id: 'r4', costUsd: 0.006 }, // newest for security
      { prId: 'pr-1', agentId: 'perf', id: 'r3', costUsd: 0.011 },
      { prId: 'pr-1', agentId: 'security', id: 'r2', costUsd: 0.004 }, // older, must lose
      { prId: 'pr-2', agentId: 'security', id: 'r1', costUsd: 0.041 },
    ];
    const byPr = groupLatestPerAgent(rows, (r) => r.id);
    expect(byPr.get('pr-1')?.map((r) => r.id)).toEqual(['r4', 'r3']);
    expect(sumCosts(byPr.get('pr-1')!)).toBeCloseTo(0.017, 10);
    expect(sumCosts(byPr.get('pr-2')!)).toBe(0.041);
    expect(byPr.size).toBe(2);
  });

  it('skips rows with a null prId', () => {
    // agent_runs.pr_id is nullable (onDelete: 'set null'), so a run outlives the
    // PR it reviewed and has nothing to be attributed to.
    const byPr = groupLatestPerAgent(
      [
        { prId: null, agentId: 'security', id: 'r1', costUsd: 9.99 },
        { prId: 'pr-1', agentId: 'security', id: 'r2', costUsd: 0.014 },
      ],
      (r) => r.id,
    );
    expect(byPr.size).toBe(1);
    expect(sumCosts(byPr.get('pr-1')!)).toBe(0.014);
  });

  it('does NOT collapse rows with a null agentId into one bucket', () => {
    // agent_runs.agent_id is nullable too, so runs whose agent was deleted must
    // each keep their own slot — otherwise all but one drop out of the sum.
    const byPr = groupLatestPerAgent(
      [
        { prId: 'pr-1', agentId: null, id: 'r1', costUsd: 0.01 },
        { prId: 'pr-1', agentId: null, id: 'r2', costUsd: 0.02 },
      ],
      (r) => r.id,
    );
    expect(byPr.get('pr-1')).toHaveLength(2);
    expect(sumCosts(byPr.get('pr-1')!)).toBeCloseTo(0.03, 10);
  });

  it('returns an empty map for no rows', () => {
    expect(groupLatestPerAgent([], () => 'x').size).toBe(0);
  });
});

describe('sumCosts', () => {
  it('sums the non-null costs and ignores the nulls', () => {
    expect(sumCosts([{ costUsd: 0.006 }, { costUsd: null }, { costUsd: 0.011 }])).toBeCloseTo(
      0.017,
      10,
    );
  });

  it('returns null when every run lacks cost data', () => {
    // "No data" must stay null so the column reads "—", never "$0.00".
    expect(sumCosts([{ costUsd: null }, { costUsd: null }])).toBeNull();
    expect(sumCosts([])).toBeNull();
  });

  it('keeps a free run at 0 rather than folding it into null', () => {
    // 0 = a genuinely free model (renders "$0"); it is not absent data.
    expect(sumCosts([{ costUsd: null }, { costUsd: 0 }])).toBe(0);
  });
});

describe('minScore', () => {
  it('takes the worst agent score, not the newest', () => {
    expect(minScore([{ score: 88 }, { score: 64 }, { score: 91 }])).toBe(64);
  });

  it('ignores null scores', () => {
    expect(minScore([{ score: null }, { score: 72 }])).toBe(72);
  });

  it('returns null when nothing has a score', () => {
    expect(minScore([{ score: null }])).toBeNull();
    expect(minScore([])).toBeNull();
  });

  it('keeps a zero score, which is a real verdict', () => {
    expect(minScore([{ score: 0 }, { score: 50 }])).toBe(0);
  });
});
