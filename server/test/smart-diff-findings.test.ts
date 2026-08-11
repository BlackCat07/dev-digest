import { describe, it, expect } from 'vitest';
import {
  findingLinesByPath,
  latestFindingsPerAgent,
} from '../src/modules/smart-diff/findings.js';
import { MAX_FINDING_LINES_PER_FILE } from '../src/modules/smart-diff/constants.js';
import type {
  SmartDiffFindingRow,
  SmartDiffReviewRow,
} from '../src/modules/smart-diff/types.js';

/**
 * L03b — the findings overlay.
 *
 * The reduction is where this feature is most likely to be quietly wrong, because
 * every wrong version still returns findings and still renders badges. Three
 * shapes of quiet wrongness are pinned below:
 *
 *  1. Taking `rows[0]` as "the latest review" — one row per AGENT is written, so
 *     that shows whoever finished last and hides everyone else. The same mistake
 *     shipped once for the PR list's cost column (`server/INSIGHTS.md`, 2026-08-03).
 *  2. Keying the per-agent reduction on a raw `agentId` — the SEEDED review has it
 *     as `null`, so a null-collapsing key means a fresh install shows NO badges.
 *  3. Expanding `start_line..end_line` into `finding_lines` — the count then
 *     reports the size of the ranges rather than the number of findings.
 */

const CHANGED = ['src/config.ts', 'src/api/users.ts', 'src/middleware/ratelimit.ts'];

function finding(file: string, startLine: number): SmartDiffFindingRow {
  return { file, startLine };
}

/** Rows are handed over NEWEST-FIRST, the way `reviewsForPull` returns them. */
function review(
  id: string,
  agentId: string | null,
  findings: SmartDiffFindingRow[],
  kind = 'review',
): { review: SmartDiffReviewRow; findings: SmartDiffFindingRow[] } {
  return { review: { id, agentId, kind }, findings };
}

describe('latestFindingsPerAgent', () => {
  it('unions the newest row of EVERY agent, not just the newest row overall', () => {
    const out = latestFindingsPerAgent([
      review('r3', 'agent-perf', [finding('src/api/users.ts', 45)]),
      review('r2', 'agent-sec', [finding('src/config.ts', 12)]),
    ]);
    // Taking rows[0] would drop the security agent's finding entirely.
    expect(out.map((f) => f.file).sort()).toEqual(['src/api/users.ts', 'src/config.ts']);
  });

  it("keeps only an agent's newest row, so re-running one agent replaces its findings", () => {
    const out = latestFindingsPerAgent([
      review('r2', 'agent-sec', [finding('src/config.ts', 12)]),
      review('r1', 'agent-sec', [finding('src/config.ts', 99)]),
    ]);
    // Not both: a re-run replaces, it does not double.
    expect(out).toEqual([finding('src/config.ts', 12)]);
  });

  it('ignores summary rows, which reviewsForPull does not filter', () => {
    const out = latestFindingsPerAgent([
      review('r2', 'agent-sec', [finding('src/config.ts', 1)], 'summary'),
      review('r1', 'agent-sec', [finding('src/config.ts', 12)], 'review'),
    ]);
    // The summary row must not shadow the agent's real review row either.
    expect(out).toEqual([finding('src/config.ts', 12)]);
  });

  /**
   * The seeded review is exactly this shape — `agent_id` null, no FK, no
   * `notNull`. Keying on the raw value collapses every agent-less row into one
   * bucket, and on a fresh install that means the demo shows no badges at all.
   */
  it('keys an agent-less review on its own row id, so two of them both contribute', () => {
    const out = latestFindingsPerAgent([
      review('r2', null, [finding('src/api/users.ts', 45)]),
      review('r1', null, [finding('src/config.ts', 12)]),
    ]);
    expect(out.map((f) => f.file).sort()).toEqual(['src/api/users.ts', 'src/config.ts']);
  });

  it('cannot confuse a row id with an agent id', () => {
    // An agent literally named after a row id must still be its own bucket.
    const out = latestFindingsPerAgent([
      review('r1', null, [finding('src/config.ts', 12)]),
      review('other', 'r1', [finding('src/api/users.ts', 45)]),
    ]);
    expect(out).toHaveLength(2);
  });

  it('returns nothing for a PR with no reviews', () => {
    expect(latestFindingsPerAgent([])).toEqual([]);
  });
});

describe('findingLinesByPath', () => {
  it('records one line per finding, deduplicated and ascending', () => {
    const { byPath } = findingLinesByPath(
      [
        finding('src/config.ts', 12),
        finding('src/config.ts', 4),
        finding('src/config.ts', 12),
      ],
      CHANGED,
    );
    expect(byPath.get('src/config.ts')).toEqual([4, 12]);
  });

  /**
   * The reason `finding_lines` is not the expanded range. The seeded WARNING spans
   * lines 45–52 and is ONE finding; expanding it would render "8 finding-lines"
   * for a single problem, and a whole-file finding would contribute hundreds.
   */
  it('records a multi-line finding once, at its start line', () => {
    const { byPath } = findingLinesByPath([finding('src/api/users.ts', 45)], CHANGED);
    expect(byPath.get('src/api/users.ts')).toEqual([45]);
  });

  it('drops a finding on a file the PR no longer changes, and counts it', () => {
    const { byPath, unmatched } = findingLinesByPath(
      [finding('src/deleted-since.ts', 3), finding('src/config.ts', 12)],
      CHANGED,
    );
    expect(byPath.has('src/deleted-since.ts')).toBe(false);
    expect(unmatched).toBe(1);
    // The surviving finding is unaffected — one stale citation is not a failure.
    expect(byPath.get('src/config.ts')).toEqual([12]);
  });

  it('matches exactly, so a suffix cannot attach a finding to the wrong file', () => {
    // `endsWith` would land this on `src/api/users.ts`, which is a different file.
    const { byPath, unmatched } = findingLinesByPath([finding('api/users.ts', 45)], CHANGED);
    expect(byPath.size).toBe(0);
    expect(unmatched).toBe(1);
  });

  it('normalises both sides, so a differently-written path still joins', () => {
    const { byPath, unmatched } = findingLinesByPath(
      [finding('./src/config.ts', 12), finding('src\\config.ts', 13)],
      ['/src/config.ts'],
    );
    expect(byPath.get('src/config.ts')).toEqual([12, 13]);
    expect(unmatched).toBe(0);
  });

  it('drops a line number there is nothing to scroll to', () => {
    // A whole-file scanner can report 0. A badge that jumps nowhere is worse than
    // no badge — but the file still matched, so it is not `unmatched`.
    const { byPath, unmatched } = findingLinesByPath(
      [finding('src/config.ts', 0), finding('src/config.ts', -3)],
      CHANGED,
    );
    expect(byPath.has('src/config.ts')).toBe(false);
    expect(unmatched).toBe(0);
  });

  it('caps one file at MAX_FINDING_LINES_PER_FILE', () => {
    const many = Array.from({ length: MAX_FINDING_LINES_PER_FILE + 20 }, (_, i) =>
      finding('src/config.ts', i + 1),
    );
    const { byPath } = findingLinesByPath(many, CHANGED);
    expect(byPath.get('src/config.ts')).toHaveLength(MAX_FINDING_LINES_PER_FILE);
    // Truncated from the END, so the earliest lines survive.
    expect(byPath.get('src/config.ts')?.[0]).toBe(1);
  });

  it('returns an empty map when there are no findings at all', () => {
    const { byPath, unmatched } = findingLinesByPath([], CHANGED);
    expect(byPath.size).toBe(0);
    expect(unmatched).toBe(0);
  });
});
