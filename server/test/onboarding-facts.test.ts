/**
 * The Onboarding Tour's deterministic layer — `facts.ts`.
 *
 * Covers AC-5, AC-6, AC-7, AC-16, AC-18, AC-19 of `specs/onboarding-generator.md`.
 *
 * Hermetic: pure functions plus one fixture index reader. No Postgres, no clone,
 * no provider, and the filename carries no `.it.` segment — the two CI workflows
 * split the suite on exactly that substring (`DDG-TEST-001`).
 *
 * **AC-6, and which of the two readings this file asserts.** The junk filter is
 * NOT in the onboarding module: `collectOnboardingFacts` calls
 * `getTopFilesByRank` and adds nothing, deliberately, because a second filter
 * here would be a second opinion about what "a real source file" means. So the
 * criterion is asserted from both ends:
 *
 *  1. the fixture facade below reproduces the shipped facade's own rule —
 *     rank DESC, `JUNK_PATH_PATTERNS` substring match, over-fetch then filter
 *     (`src/modules/repo-intel/service.ts`, `getTopFilesByRank` / `isJunkPath`) —
 *     so AC-6's fixture (`src/a.test.ts` and `vitest.config.ts` as the two
 *     highest-ranked paths) yields neither; and
 *  2. a separate case pins that the module applies **no second filter**: a path
 *     the facade kept arrives in `rankedPaths` untouched and in the facade's own
 *     order.
 *
 * The first half is a stand-in and says so: `isJunkPath` is module-private in
 * `repo-intel` and cannot be imported, and importing that sibling from the
 * feature would be the `no-cross-module-internals` violation the module was
 * written to avoid. The pattern list here is copied verbatim from that file; if
 * the two ever drift, the half that matters — that this module adds nothing — is
 * still pinned by (2).
 */
import { describe, it, expect } from 'vitest';
import { OnboardingReason, OnboardingStatus } from '@devdigest/shared';
import {
  collectOnboardingFacts,
  mapIndexState,
  toOnboardingReason,
  toOnboardingStatus,
} from '../src/modules/onboarding/facts.js';
import { MAX_ENDPOINT_FACTS, MAX_PROMPT_PATHS } from '../src/modules/onboarding/constants.js';
import type {
  OnboardingFileFacts,
  OnboardingFileRank,
  OnboardingIndexReader,
  OnboardingIndexState,
} from '../src/modules/onboarding/types.js';

const REPO = 'repo-1';

/**
 * The shipped facade's exclusion list, copied verbatim from
 * `src/modules/repo-intel/service.ts` (`JUNK_PATH_PATTERNS`). See the file
 * doc-comment for why it is copied rather than imported.
 */
const JUNK_PATTERNS = [
  '.test.',
  '.spec.',
  '.d.ts',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/migrations/',
  '/__fixtures__/',
  '.config.',
  'vitest.',
  'jest.',
  'eslint',
  'prettier',
];

function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATTERNS.some((p) => lower.includes(p));
}

/** One row of the fixture index: a path and the rank the index holds for it. */
interface RankedRow {
  path: string;
  rank: number;
}

interface FixtureOptions {
  state?: Partial<OnboardingIndexState>;
  ranked?: RankedRow[];
  chains?: string[][];
  repoMap?: { text: string; tokens: number; degraded?: boolean };
  facts?: OnboardingFileFacts[];
  /** Set false to model the facade WITHOUT its junk filter — see AC-6, case (2). */
  filterJunk?: boolean;
}

/**
 * A stand-in for `RepoIntelService`, satisfying `OnboardingIndexReader`
 * structurally exactly as the real one does.
 *
 * `getTopFilesByRank` reproduces the facade's contract rather than returning a
 * canned list: it sorts by rank DESC, drops junk paths and caps at `n`. That is
 * what makes AC-5's and AC-6's fixtures mean anything — a canned array would
 * assert only that this file can hold an array in order.
 */
function indexReader(opts: FixtureOptions = {}): OnboardingIndexReader & { calls: string[] } {
  const ranked = opts.ranked ?? [];
  const filterJunk = opts.filterJunk ?? true;
  const calls: string[] = [];

  return {
    calls,
    async getIndexState(): Promise<OnboardingIndexState> {
      calls.push('getIndexState');
      return {
        status: 'full',
        filesIndexed: 300,
        filesSkipped: 0,
        lastIndexedSha: 'abc1234',
        ...opts.state,
      };
    },
    async getTopFilesByRank(_repoId: string, n: number): Promise<string[]> {
      calls.push('getTopFilesByRank');
      return [...ranked]
        .sort((a, b) => b.rank - a.rank)
        .map((row) => row.path)
        .filter((path) => (filterJunk ? !isJunkPath(path) : true))
        .slice(0, n);
    },
    async getCriticalPaths(): Promise<string[][]> {
      calls.push('getCriticalPaths');
      return opts.chains ?? [];
    },
    async getRepoMap() {
      calls.push('getRepoMap');
      return opts.repoMap ?? { text: 'src/index.ts — boot', tokens: 12 };
    },
    async getFileRank(_repoId: string, paths: string[]): Promise<OnboardingFileRank[]> {
      calls.push('getFileRank');
      const known = new Set(ranked.map((row) => row.path));
      return paths.filter((p) => known.has(p)).map((path) => ({ path, percentile: 0.5 }));
    },
    async getFileFacts(): Promise<OnboardingFileFacts[]> {
      calls.push('getFileFacts');
      return opts.facts ?? [];
    },
  };
}

describe('the reading path is the index’s ranking (AC-5)', () => {
  it('orders paths by rank descending, not alphabetically and not by date', async () => {
    // AC-5's own fixture: ranks 0.9 / 0.5 / 0.1 on paths that sort
    // alphabetically in the OPPOSITE order, so rank-first and alphabetical are
    // distinguishable rather than accidentally equal.
    const facts = await collectOnboardingFacts(
      indexReader({
        ranked: [
          { path: 'src/zebra.ts', rank: 0.9 },
          { path: 'src/middle.ts', rank: 0.5 },
          { path: 'src/alpha.ts', rank: 0.1 },
        ],
      }),
      REPO,
    );

    expect(facts.rankedPaths).toEqual(['src/zebra.ts', 'src/middle.ts', 'src/alpha.ts']);
    // Stated as its own assertion because the equality above would also hold for
    // a list that happened to be sorted: this one fails the moment anything
    // re-sorts by name.
    expect(facts.rankedPaths).not.toEqual([...facts.rankedPaths].sort());
    // No modification date is read anywhere on this path — the ranking is
    // `pagerank × (1 + hotness)` and nothing else (N6).
  });

  it('asks the index for at most the prompt’s path cap', async () => {
    const ranked = Array.from({ length: MAX_PROMPT_PATHS + 40 }, (_, i) => ({
      path: `src/f${String(i).padStart(4, '0')}.ts`,
      rank: 1 - i / 1000,
    }));

    const facts = await collectOnboardingFacts(indexReader({ ranked }), REPO);

    expect(facts.rankedPaths).toHaveLength(MAX_PROMPT_PATHS);
    expect(facts.rankedPaths[0]).toBe('src/f0000.ts');
  });
});

describe('the reading path excludes what the index classifies as junk (AC-6)', () => {
  it('yields neither of the two highest-ranked test and tool-config paths', async () => {
    // AC-6's own fixture, verbatim: the two highest-ranked paths are a test file
    // and a tool config, and the reading path must carry neither.
    const facts = await collectOnboardingFacts(
      indexReader({
        ranked: [
          { path: 'src/a.test.ts', rank: 0.99 },
          { path: 'vitest.config.ts', rank: 0.98 },
          { path: 'src/server.ts', rank: 0.4 },
          { path: 'src/db/migrations/0001_init.ts', rank: 0.35 },
          { path: 'src/types/global.d.ts', rank: 0.3 },
          { path: 'src/routes.ts', rank: 0.2 },
        ],
      }),
      REPO,
    );

    expect(facts.rankedPaths).toEqual(['src/server.ts', 'src/routes.ts']);
  });

  it('applies no second filter of its own', async () => {
    // The other half of AC-6, and the half this module actually owns: whatever
    // the facade kept arrives untouched, in the facade's order. A junk-shaped
    // path returned by a facade with the filter switched off must still come
    // through — because if it does not, this module is filtering too, which is
    // the drift AC-6 exists to prevent.
    const facts = await collectOnboardingFacts(
      indexReader({
        filterJunk: false,
        ranked: [
          { path: 'src/a.test.ts', rank: 0.99 },
          { path: 'src/server.ts', rank: 0.4 },
        ],
      }),
      REPO,
    );

    expect(facts.rankedPaths).toEqual(['src/a.test.ts', 'src/server.ts']);
  });
});

describe('the critical paths are the index’s dependency chains (AC-7)', () => {
  it('passes the chains through unchanged: at most five, each of two or three distinct paths', async () => {
    const chains = [
      ['src/server.ts', 'src/app.ts'],
      ['src/app.ts', 'src/modules/index.ts', 'src/modules/repos/routes.ts'],
      ['src/platform/container.ts', 'src/db/client.ts'],
      ['src/adapters/github/octokit.ts', 'src/platform/config.ts'],
      ['src/modules/pulls/routes.ts', 'src/modules/pulls/service.ts', 'src/db/schema.ts'],
    ];

    const facts = await collectOnboardingFacts(indexReader({ chains }), REPO);

    expect(facts.criticalChains).toEqual(chains);
    expect(facts.criticalChains.length).toBeLessThanOrEqual(5);
    for (const chain of facts.criticalChains) {
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain.length).toBeLessThanOrEqual(3);
      // Each path distinct within its chain.
      expect(new Set(chain).size).toBe(chain.length);
    }
  });

  it('reports no chains for a repository whose import graph has no edges', async () => {
    // EC-4: an edgeless repository is a value, never an error.
    const facts = await collectOnboardingFacts(indexReader({ chains: [] }), REPO);
    expect(facts.criticalChains).toEqual([]);
  });
});

describe('an unindexed repository (AC-16)', () => {
  it('is degraded with reason index_missing, and carries no SHA', async () => {
    // The facade always answers, synthesising `degraded / no_data` when there is
    // no index row (EC-2). `no_data` is the catch-all; from a reader's side that
    // is specifically a missing index, which is the actionable form.
    const facts = await collectOnboardingFacts(
      indexReader({
        state: {
          status: 'degraded',
          degraded: true,
          degradedReason: 'no_data',
          filesIndexed: 0,
          filesSkipped: 0,
          lastIndexedSha: '',
        },
        ranked: [],
      }),
      REPO,
    );

    expect(facts.status).toBe('degraded');
    expect(facts.reason).toBe('index_missing');
    // The facade's empty string becomes null, so nothing can render an empty SHA
    // as a link target.
    expect(facts.indexedSha).toBeNull();
    expect(facts.rankedPaths).toEqual([]);
  });
});

describe('a partial index still produces facts (AC-18)', () => {
  it('is labelled partial / index_partial with its material intact', async () => {
    const facts = await collectOnboardingFacts(
      indexReader({
        state: { status: 'partial', filesIndexed: 5000, filesSkipped: 7450 },
        ranked: [
          { path: 'src/server.ts', rank: 0.9 },
          { path: 'src/app.ts', rank: 0.8 },
        ],
        chains: [['src/server.ts', 'src/app.ts']],
      }),
      REPO,
    );

    expect(facts.status).toBe('partial');
    expect(facts.reason).toBe('index_partial');
    // Generated FROM what the index holds, not refused: the material is there.
    expect(facts.rankedPaths).toEqual(['src/server.ts', 'src/app.ts']);
    expect(facts.criticalChains).toHaveLength(1);
    // AC-40's figures are this generation's, recorded from the state it read.
    expect(facts.filesIndexed).toBe(5000);
    expect(facts.filesSkipped).toBe(7450);
  });
});

describe('the status and reason vocabulary (AC-19)', () => {
  it('maps every index-side coverage to one of ok | partial | degraded', () => {
    expect(toOnboardingStatus({ status: 'full', filesIndexed: 1, filesSkipped: 0, lastIndexedSha: 'a' })).toBe('ok');
    expect(toOnboardingStatus({ status: 'partial', filesIndexed: 1, filesSkipped: 1, lastIndexedSha: 'a' })).toBe('partial');
    expect(toOnboardingStatus({ status: 'failed', filesIndexed: 0, filesSkipped: 0, lastIndexedSha: '' })).toBe('degraded');
    expect(
      toOnboardingStatus({
        status: 'full',
        degraded: true,
        filesIndexed: 1,
        filesSkipped: 0,
        lastIndexedSha: 'a',
      }),
    ).toBe('degraded');
    // An ABSENT status is `partial`, not `ok`: refusing to claim a completeness
    // nobody demonstrated is what stopped a fully-indexed repository reporting
    // `index_missing` next door (`server/INSIGHTS.md`, 2026-08-14).
    expect(toOnboardingStatus({ filesIndexed: 1, filesSkipped: 0, lastIndexedSha: 'a' })).toBe('partial');

    for (const status of ['ok', 'partial', 'degraded'] as const) {
      expect(OnboardingStatus.options).toContain(status);
    }
  });

  it('maps the index’s degraded vocabulary onto the contract’s, unknowns included', () => {
    // The blast contract's five, spelled the same on purpose — two features must
    // not tell one user "the index is incomplete" in two vocabularies.
    expect(toOnboardingReason('flag_off')).toBe('flag_off');
    expect(toOnboardingReason('index_failed')).toBe('index_failed');
    expect(toOnboardingReason('index_partial')).toBe('index_partial');
    expect(toOnboardingReason('repo_too_large')).toBe('repo_too_large');
    expect(toOnboardingReason('no_data')).toBe('index_missing');
    expect(toOnboardingReason(undefined)).toBe('index_missing');
    // A reason the facade grows later cannot leak an unknown literal onto the
    // screen, so the cast here is the whole point of the case.
    expect(toOnboardingReason('something_new_entirely' as never)).toBe('index_missing');

    // Every value this mapping can produce is in the contract's enum.
    for (const reason of [
      'flag_off',
      'index_failed',
      'index_partial',
      'repo_too_large',
      'index_missing',
    ] as const) {
      expect(OnboardingReason.options).toContain(reason);
    }
  });

  it('pairs a non-ok status with a reason, and an ok status with none', () => {
    // A non-`ok` status with no reason is the state a screen cannot explain.
    expect(
      mapIndexState({ status: 'full', filesIndexed: 10, filesSkipped: 0, lastIndexedSha: 'a' }),
    ).toEqual({ status: 'ok', reason: null });
    expect(
      mapIndexState({ status: 'partial', filesIndexed: 10, filesSkipped: 3, lastIndexedSha: 'a' }),
    ).toEqual({ status: 'partial', reason: 'index_partial' });
    expect(
      mapIndexState({
        status: 'failed',
        degraded: true,
        degradedReason: 'index_failed',
        filesIndexed: 0,
        filesSkipped: 0,
        lastIndexedSha: '',
      }),
    ).toEqual({ status: 'degraded', reason: 'index_failed' });
  });
});

describe('endpoint facts feed the architecture section (N11)', () => {
  it('keeps only rows carrying a fact, in their files’ ranked order, capped', async () => {
    const ranked = Array.from({ length: MAX_ENDPOINT_FACTS + 5 }, (_, i) => ({
      path: `src/r${String(i).padStart(3, '0')}.ts`,
      rank: 1 - i / 1000,
    }));
    const facts = await collectOnboardingFacts(
      indexReader({
        ranked,
        // Deliberately handed back in a shuffled order carrying one factless row,
        // because the read makes no promise about row order.
        facts: [
          { filePath: 'src/r010.ts', endpoints: ['GET /ten'], crons: [] },
          { filePath: 'src/r000.ts', endpoints: [], crons: [] },
          { filePath: 'src/r001.ts', endpoints: [], crons: ['0 * * * *'] },
          ...ranked
            .slice(2, MAX_ENDPOINT_FACTS + 5)
            .map((row) => ({ filePath: row.path, endpoints: ['GET /x'], crons: [] })),
        ],
      }),
      REPO,
    );

    expect(factPaths(facts.endpointFacts)).not.toContain('src/r000.ts');
    expect(facts.endpointFacts).toHaveLength(MAX_ENDPOINT_FACTS);
    expect(facts.endpointFacts[0]?.filePath).toBe('src/r001.ts');
    expect(facts.endpointFacts[1]?.filePath).toBe('src/r002.ts');
  });
});

function factPaths(rows: readonly OnboardingFileFacts[]): string[] {
  return rows.map((row) => row.filePath);
}
