import { describe, it, expect } from 'vitest';
import { pickLatestPerPr } from '../src/modules/pulls/latest.js';

/**
 * Hermetic cover for the PR-list aggregates' newest-per-PR collapse. The route
 * over-fetches ordered newest-first and reduces in JS, so this is where the
 * reduction is actually verified — the route itself needs Postgres.
 */
describe('pickLatestPerPr', () => {
  it('keeps the first row seen per PR (input is newest-first)', () => {
    const rows = [
      { prId: 'pr-1', costUsd: 0.014 }, // newest for pr-1
      { prId: 'pr-2', costUsd: 0.041 },
      { prId: 'pr-1', costUsd: 0.003 }, // older, must lose
    ];
    const latest = pickLatestPerPr(rows);
    expect(latest.get('pr-1')?.costUsd).toBe(0.014);
    expect(latest.get('pr-2')?.costUsd).toBe(0.041);
    expect(latest.size).toBe(2);
  });

  it('skips rows with a null prId', () => {
    // agent_runs.pr_id is nullable (onDelete: 'set null'), so a run outlives the
    // PR it reviewed and has nothing to be attributed to.
    const latest = pickLatestPerPr([
      { prId: null, costUsd: 9.99 },
      { prId: 'pr-1', costUsd: 0.014 },
    ]);
    expect(latest.size).toBe(1);
    expect(latest.get('pr-1')?.costUsd).toBe(0.014);
  });

  it('preserves a null value on the winning row', () => {
    // A "no cost data" run must still win its slot, so the column reads "—"
    // rather than falling through to an older run's figure.
    const latest = pickLatestPerPr([
      { prId: 'pr-1', costUsd: null },
      { prId: 'pr-1', costUsd: 0.02 },
    ]);
    expect(latest.get('pr-1')?.costUsd).toBeNull();
  });

  it('returns an empty map for no rows', () => {
    expect(pickLatestPerPr([]).size).toBe(0);
  });
});
