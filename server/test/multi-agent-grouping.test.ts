import { describe, it, expect } from 'vitest';

import {
  MIN_TITLE_TOKEN_LENGTH,
  TITLE_SIMILARITY_THRESHOLD,
} from '../src/modules/multi-agent/constants.js';
import {
  agentKey,
  groupFindings,
  jaccard,
  normaliseRange,
  normaliseTitle,
  titlesSimilar,
  type GroupableColumn,
  type GroupableFinding,
} from '../src/modules/multi-agent/grouping.js';

/**
 * L07 — where the agents disagree, derived on read
 * (AC-25 … AC-34, AC-100, AC-103, EC-2, EC-7, EC-8, EC-9, EC-11, EC-12).
 *
 * Hermetic and pure: `grouping.ts` takes plain objects and returns plain objects,
 * so nothing here needs a database, a container or a clock, and this file carries
 * no `.it.` in its name.
 *
 * Two things this suite is deliberately built to catch:
 *
 *  - **The entry condition.** A single flagger is legal (AC-29) and a location
 *    every agent flagged emits nothing (AC-100). The stricter "two or more
 *    flagged" rule is the client's filter, not this module's, and restoring it
 *    here would turn the design's own reference screen into an empty block — so
 *    both halves are pinned.
 *  - **The order.** Asserting sorted keys over a pre-sorted fixture proves
 *    nothing: `Array.prototype.sort` is stable in V8, so such a test stays green
 *    with every tiebreaker deleted (`mcp-server/INSIGHTS.md`, 2026-08-13). Every
 *    ordering assertion below runs over a **shuffled** input, and two different
 *    shuffles must produce the same output (`server/INSIGHTS.md`, 2026-08-06).
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let nextId = 0;

function finding(over: Partial<GroupableFinding> = {}): GroupableFinding {
  nextId += 1;
  return {
    id: `f-${String(nextId).padStart(3, '0')}`,
    severity: 'WARNING',
    title: 'Magic number 3600',
    file: 'lib/rate-limit.ts',
    start_line: 28,
    end_line: 30,
    ...over,
  };
}

function column(
  name: string,
  findings: readonly GroupableFinding[],
  over: Partial<GroupableColumn> = {},
): GroupableColumn {
  return {
    run_id: `run-${name}`,
    agent_id: `agent-${name}`,
    agent_name: name,
    findings,
    ...over,
  };
}

/** `file:line:title`, which is what an ordering assertion compares. */
function keysOf(groups: ReturnType<typeof groupFindings>): string[] {
  return groups.map((group) => `${group.file}:${group.line}:${group.title}`);
}

/**
 * A deterministic shuffle — the columns and each column's findings, rotated by a
 * different amount. Deterministic because a flaky ordering test teaches nobody
 * anything; a rotation because the point is only that the input is not already
 * in the output's order.
 */
function shuffled(columns: readonly GroupableColumn[], by: number): GroupableColumn[] {
  const rotate = <T,>(items: readonly T[], n: number): T[] =>
    items.length === 0 ? [] : [...items.slice(n % items.length), ...items.slice(0, n % items.length)];
  return rotate(columns, by).map((col, index) => ({
    ...col,
    findings: rotate(col.findings, by + index),
  }));
}

// ---------------------------------------------------------------------------
// AC-27 — normalising a title
// ---------------------------------------------------------------------------

describe('normaliseTitle', () => {
  it('lowercases, splits on non-alphanumerics and drops only the short tokens', () => {
    expect([...normaliseTitle('Hard-coded 3600: a magic number!')].sort()).toEqual([
      '3600',
      'coded',
      'hard',
      'magic',
      'number',
    ]);
  });

  it('keeps digits and drops every token shorter than the length rule', () => {
    expect(MIN_TITLE_TOKEN_LENGTH).toBe(3);
    expect([...normaliseTitle('a an is 42 429 x')]).toEqual(['429']);
  });
});

// ---------------------------------------------------------------------------
// AC-26, AC-28 — the similarity test and its one threshold
// ---------------------------------------------------------------------------

describe('titlesSimilar', () => {
  it('groups two phrasings of the same magic number and separates unrelated titles', () => {
    // {magic, number, 3600} vs {hard, coded, 3600, magic, number}: 3 / 5 = 0.6.
    expect(jaccard(normaliseTitle('Magic number 3600'), normaliseTitle('Hard-coded 3600 magic number'))).toBeCloseTo(0.6);
    expect(titlesSimilar('Magic number 3600', 'Hard-coded 3600 magic number')).toBe(true);
    expect(jaccard(normaliseTitle('Magic number 3600'), normaliseTitle('Missing error handling'))).toBe(0);
    expect(titlesSimilar('Magic number 3600', 'Missing error handling')).toBe(false);
  });

  it('is inclusive at the threshold and excludes below it', () => {
    expect(TITLE_SIMILARITY_THRESHOLD).toBe(0.4);
    // Two shared tokens over a union of five is exactly the threshold.
    expect(jaccard(normaliseTitle('alpha bravo charlie'), normaliseTitle('alpha bravo delta echo'))).toBeCloseTo(
      TITLE_SIMILARITY_THRESHOLD,
    );
    expect(titlesSimilar('alpha bravo charlie', 'alpha bravo delta echo')).toBe(true);
    // One shared token over a union of five is below it.
    expect(titlesSimilar('alpha bravo charlie', 'alpha delta echo foxtrot')).toBe(false);
  });

  it('reads two titles that normalise to nothing as unrelated, not identical', () => {
    expect(jaccard(normaliseTitle('a b c'), normaliseTitle('x y z'))).toBe(0);
    expect(titlesSimilar('a b c', 'x y z')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-25, EC-9, EC-12 — what lands in one group
// ---------------------------------------------------------------------------

describe('groupFindings — what belongs together', () => {
  it('groups intersecting ranges in one file and separates the same pair across files', () => {
    const together = groupFindings([
      column('alpha', [finding({ start_line: 28, end_line: 30, title: 'Magic number 3600' })]),
      column('bravo', [
        finding({ start_line: 29, end_line: 34, title: 'Hard-coded 3600 magic number' }),
      ]),
      column('charlie', []),
    ]);
    expect(together).toHaveLength(1);
    expect(together[0]?.file).toBe('lib/rate-limit.ts');

    const apart = groupFindings([
      column('alpha', [finding({ start_line: 28, end_line: 30, title: 'Magic number 3600' })]),
      column('bravo', [
        finding({
          file: 'lib/other.ts',
          start_line: 29,
          end_line: 34,
          title: 'Hard-coded 3600 magic number',
        }),
      ]),
      column('charlie', []),
    ]);
    expect(apart).toHaveLength(2);
    expect(apart.map((group) => group.file)).toEqual(['lib/other.ts', 'lib/rate-limit.ts']);
  });

  it('keeps intersecting ranges with unrelated titles in separate groups (EC-9)', () => {
    const groups = groupFindings([
      column('alpha', [finding({ start_line: 28, end_line: 30, title: 'Magic number 3600' })]),
      column('bravo', [
        finding({ start_line: 28, end_line: 35, title: 'Missing error handling' }),
      ]),
      column('charlie', []),
    ]);
    expect(keysOf(groups)).toEqual([
      'lib/rate-limit.ts:28:Magic number 3600',
      'lib/rate-limit.ts:28:Missing error handling',
    ]);
  });

  it('normalises an inverted range before intersecting it (EC-12)', () => {
    expect(normaliseRange(34, 29)).toEqual({ start: 29, end: 34 });

    const groups = groupFindings([
      column('alpha', [finding({ start_line: 28, end_line: 30, title: 'Magic number 3600' })]),
      // start_line > end_line: un-normalised this range intersects nothing.
      column('bravo', [
        finding({ start_line: 34, end_line: 29, title: 'Hard-coded 3600 magic number' }),
      ]),
      column('charlie', []),
    ]);
    expect(groups).toHaveLength(1);
    // AC-103's lowest start line is taken from the normalised range.
    expect(groups[0]?.line).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// AC-29, AC-100, EC-8 — the entry condition
// ---------------------------------------------------------------------------

describe('groupFindings — the entry condition', () => {
  const location = { start_line: 28, end_line: 30, title: 'Magic number 3600' } as const;

  it('emits a group for a location one agent of four flagged, with three ignored stances', () => {
    const groups = groupFindings([
      column('alpha', [finding({ ...location, severity: 'SUGGESTION' })]),
      column('bravo', []),
      column('charlie', []),
      column('delta', []),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.takes).toEqual([
      { agent_id: 'agent-alpha', persona: 'alpha', verdict: 'SUGGESTION', note: '' },
      { agent_id: 'agent-bravo', persona: 'bravo', verdict: 'ignored', note: '' },
      { agent_id: 'agent-charlie', persona: 'charlie', verdict: 'ignored', note: '' },
      { agent_id: 'agent-delta', persona: 'delta', verdict: 'ignored', note: '' },
    ]);
  });

  it('emits no group for a location every agent flagged (AC-100)', () => {
    const groups = groupFindings([
      column('alpha', [finding({ ...location, severity: 'CRITICAL' })]),
      column('bravo', [finding({ ...location, title: 'Hard-coded 3600 magic number' })]),
      column('charlie', [finding({ ...location, title: 'Magic number 3600 again' })]),
      column('delta', [finding({ ...location, severity: 'SUGGESTION' })]),
    ]);
    expect(groups).toEqual([]);
  });

  it('still emits a group when three of four flagged and one stayed silent', () => {
    const groups = groupFindings([
      column('alpha', [finding({ ...location, severity: 'CRITICAL' })]),
      column('bravo', [finding({ ...location, title: 'Hard-coded 3600 magic number' })]),
      column('charlie', [finding({ ...location, severity: 'SUGGESTION' })]),
      column('delta', []),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.takes.map((take) => take.verdict)).toEqual([
      'CRITICAL',
      'WARNING',
      'SUGGESTION',
      'ignored',
    ]);
  });

  it('emits nothing for a one-agent multi-run, however much it flagged (EC-8)', () => {
    const groups = groupFindings([
      column('alpha', [finding(location), finding({ file: 'lib/other.ts', title: 'Unbounded retry loop' })]),
    ]);
    expect(groups).toEqual([]);
  });

  it('emits nothing when no agent flagged anything', () => {
    expect(groupFindings([column('alpha', []), column('bravo', [])])).toEqual([]);
    expect(groupFindings([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-30, AC-34, EC-2, EC-7, EC-11 — the stances
// ---------------------------------------------------------------------------

describe('groupFindings — one stance per agent of the multi-run', () => {
  it('gives an agent with two findings in one group a single stance at the higher severity (EC-11)', () => {
    const groups = groupFindings([
      column('alpha', [
        finding({ severity: 'SUGGESTION', title: 'Magic number 3600', start_line: 28, end_line: 30 }),
        finding({ severity: 'CRITICAL', title: 'Hard-coded 3600 magic number', start_line: 29, end_line: 31 }),
      ]),
      column('bravo', []),
      column('charlie', []),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.takes).toHaveLength(3);
    expect(groups[0]?.takes[0]).toMatchObject({ agent_id: 'agent-alpha', verdict: 'CRITICAL' });
  });

  it('names the agent behind every stance and prefixes the key of an agent-deleted run (EC-2)', () => {
    const groups = groupFindings([
      column('alpha', [finding({ severity: 'CRITICAL' })]),
      column('ghost', [], { agent_id: null, run_id: 'run-abc' }),
      column('bravo', []),
    ]);

    expect(agentKey({ agent_id: null, run_id: 'run-abc' })).toBe('run:run-abc');
    expect(groups[0]?.takes.map((take) => take.agent_id)).toEqual([
      'agent-alpha',
      'run:run-abc',
      'agent-bravo',
    ]);
    expect(groups[0]?.takes.every((take) => take.agent_id.length > 0)).toBe(true);
  });

  it('leaves every note empty — the sentences are the synthesis call output (AC-38)', () => {
    const groups = groupFindings([column('alpha', [finding()]), column('bravo', [])]);
    expect(groups[0]?.takes.map((take) => take.note)).toEqual(['', '']);
  });
});

// ---------------------------------------------------------------------------
// AC-31, AC-103 — the group's line and its fallback title
// ---------------------------------------------------------------------------

describe('groupFindings — line and fallback title', () => {
  it('reports the lowest start line and the highest-severity finding title', () => {
    const groups = groupFindings([
      column('alpha', [
        finding({ severity: 'SUGGESTION', start_line: 30, end_line: 32, title: 'Magic number 3600 suggestion' }),
      ]),
      column('bravo', [
        finding({ severity: 'WARNING', start_line: 28, end_line: 31, title: 'Magic number 3600 warning' }),
      ]),
      column('charlie', []),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.line).toBe(28);
    expect(groups[0]?.title).toBe('Magic number 3600 warning');
  });

  it('breaks a severity tie on the lowest start line', () => {
    const groups = groupFindings([
      column('alpha', [
        finding({ severity: 'WARNING', start_line: 30, end_line: 32, title: 'Magic number 3600 lower' }),
      ]),
      column('bravo', [
        finding({ severity: 'WARNING', start_line: 28, end_line: 31, title: 'Magic number 3600 upper' }),
      ]),
      column('charlie', []),
    ]);
    expect(groups[0]?.title).toBe('Magic number 3600 upper');
  });

  it('breaks a severity-and-line tie on the lowest finding id', () => {
    const groups = groupFindings([
      column('alpha', [
        { id: 'f-zzz', severity: 'WARNING', title: 'Magic number 3600 zulu', file: 'lib/rate-limit.ts', start_line: 28, end_line: 30 },
      ]),
      column('bravo', [
        { id: 'f-aaa', severity: 'WARNING', title: 'Magic number 3600 alpha', file: 'lib/rate-limit.ts', start_line: 28, end_line: 30 },
      ]),
      column('charlie', []),
    ]);
    expect(groups[0]?.title).toBe('Magic number 3600 alpha');
  });
});

// ---------------------------------------------------------------------------
// AC-32, AC-33 — a total order, and nothing written
// ---------------------------------------------------------------------------

describe('groupFindings — ordering and purity', () => {
  /**
   * Four groups, built so that **each** of AC-32's three keys is the only thing
   * putting them in the expected order — a fixture where two keys agree cannot
   * tell you that either of them is applied.
   *
   *  - the FILE key: `src/api/routes.ts:12` sorts last despite the lowest line;
   *  - the LINE key: `lib/rate-limit.ts:90` sorts last within its file despite
   *    the alphabetically first title;
   *  - the TITLE key: the two groups at `lib/rate-limit.ts:28` are ordered
   *    `Magic` before `Missing`, which is the opposite of their finding ids.
   */
  function fanOut(): GroupableColumn[] {
    return [
      column('alpha', [
        finding({ id: 'f-m1', file: 'lib/rate-limit.ts', start_line: 28, end_line: 30, title: 'Magic number 3600' }),
        finding({ id: 'f-u1', file: 'src/api/routes.ts', start_line: 12, end_line: 12, title: 'Unvalidated path parameter' }),
      ]),
      column('bravo', [
        finding({ id: 'f-a0', file: 'lib/rate-limit.ts', start_line: 28, end_line: 35, title: 'Missing error handling' }),
      ]),
      column('charlie', [
        finding({ id: 'f-c1', file: 'lib/rate-limit.ts', start_line: 90, end_line: 95, title: 'Absent retry ceiling' }),
      ]),
      column('delta', []),
    ];
  }

  const EXPECTED = [
    'lib/rate-limit.ts:28:Magic number 3600',
    'lib/rate-limit.ts:28:Missing error handling',
    'lib/rate-limit.ts:90:Absent retry ceiling',
    'src/api/routes.ts:12:Unvalidated path parameter',
  ];

  it('returns the groups in file, line, title order over a shuffled input', () => {
    // The fixture is deliberately NOT in output order: a pre-sorted one passes
    // with every tiebreaker deleted, because V8's sort is stable.
    for (const by of [1, 2, 3]) {
      expect(keysOf(groupFindings(shuffled(fanOut(), by)))).toEqual(EXPECTED);
    }
  });

  it('returns the same order for two different shuffles of the same multi-run', () => {
    expect(keysOf(groupFindings(shuffled(fanOut(), 1)))).toEqual(
      keysOf(groupFindings(shuffled(fanOut(), 3))),
    );
  });

  it('returns the same groups on two calls over one input', () => {
    const columns = shuffled(fanOut(), 2);
    expect(groupFindings(columns)).toEqual(groupFindings(columns));
  });

  it('orders two groups that tie on file, line and title by the lowest finding id', () => {
    // The one case AC-32's three keys leave open, and the only one that can
    // reach it: two titles that normalise to NOTHING are not similar to each
    // other (0 / 0 is read as 0), so they stay two groups at one file:line
    // carrying the same title. Without a fourth key the order is not total.
    const groups = groupFindings([
      column('alpha', [
        { id: 'f-zzz', severity: 'WARNING', title: 'x y', file: 'lib/rate-limit.ts', start_line: 28, end_line: 30 },
      ]),
      column('bravo', [
        { id: 'f-aaa', severity: 'WARNING', title: 'x y', file: 'lib/rate-limit.ts', start_line: 28, end_line: 30 },
      ]),
      column('charlie', []),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.takes[0]?.verdict)).toEqual(['ignored', 'WARNING']);
  });

  it('writes nothing: the input is byte-identical afterwards (AC-33)', () => {
    const columns = fanOut();
    const before = JSON.stringify(columns);
    groupFindings(columns);
    expect(JSON.stringify(columns)).toBe(before);
  });
});
