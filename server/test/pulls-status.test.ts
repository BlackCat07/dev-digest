/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  countFindingsBySeverity,
  deriveReviewStatus,
  EMPTY_FINDINGS_BY_SEVERITY,
  rollupSeverities,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('countFindingsBySeverity', () => {
  it('sums the per-(pr, severity) count rows into one object per PR', () => {
    expect(
      countFindingsBySeverity([
        { prId: 'p1', severity: 'CRITICAL', n: 2 },
        { prId: 'p1', severity: 'WARNING', n: 3 },
        { prId: 'p1', severity: 'SUGGESTION', n: 1 },
      ]).get('p1'),
    ).toEqual({ CRITICAL: 2, WARNING: 3, SUGGESTION: 1 });
  });

  it('adds up repeated rows for the same bucket', () => {
    // The FINDINGS column sums EVERY run, so two runs of the same agent arrive as
    // separate group rows and must accumulate, not overwrite.
    expect(
      countFindingsBySeverity([
        { prId: 'p1', severity: 'CRITICAL', n: 2 },
        { prId: 'p1', severity: 'CRITICAL', n: 3 },
      ]).get('p1'),
    ).toEqual({ CRITICAL: 5, WARNING: 0, SUGGESTION: 0 });
  });

  it('buckets each PR independently', () => {
    const out = countFindingsBySeverity([
      { prId: 'p1', severity: 'CRITICAL', n: 1 },
      { prId: 'p2', severity: 'WARNING', n: 4 },
    ]);
    expect(out.get('p1')).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(out.get('p2')).toEqual({ CRITICAL: 0, WARNING: 4, SUGGESTION: 0 });
  });

  it('ignores severities outside the contract enum', () => {
    // `findings.severity` is plain text, so 'INFO'/'WEIRD' are storable. They land
    // in no bucket — which is why the three counts can sum to less than a PR's
    // total finding count.
    const out = countFindingsBySeverity([
      { prId: 'p1', severity: 'INFO', n: 5 },
      { prId: 'p1', severity: 'WEIRD', n: 2 },
      { prId: 'p1', severity: 'WARNING', n: 1 },
    ]);
    expect(out.get('p1')).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });

  it('yields no entry for a PR whose only rows are unknown severities', () => {
    expect(countFindingsBySeverity([{ prId: 'p1', severity: 'INFO', n: 5 }]).size).toBe(0);
  });

  it('is an empty map for no rows', () => {
    expect(countFindingsBySeverity([]).size).toBe(0);
  });

  it('never returns an alias of the shared frozen empty constant', () => {
    // The route hands EMPTY_FINDINGS_BY_SEVERITY to every never-reviewed PR in
    // the same response, so a returned alias would corrupt all of them at once.
    const counts = countFindingsBySeverity([{ prId: 'p1', severity: 'CRITICAL', n: 1 }]).get('p1')!;
    expect(counts).not.toBe(EMPTY_FINDINGS_BY_SEVERITY);
    counts.WARNING += 1;
    expect(EMPTY_FINDINGS_BY_SEVERITY.WARNING).toBe(0);
  });
});
