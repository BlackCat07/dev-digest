import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { BFS_DEPTH, MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { FullSymbolRow } from '../src/modules/repo-intel/repository.js';

/**
 * L04 — `RepoIntel.getBlastRadius` on the PERSISTENT path.
 *
 * Hermetic: no Postgres and no clone. The service's `repo` is patched with plain
 * functions, the way `repo-intel-facade-degraded.test.ts` does, so what is under
 * test is the read logic — the per-symbol cap, the ordering, and the direction of
 * the graph walk.
 *
 * Three of these tests exist because the code they cover was WRONG in a way nothing
 * else would have caught:
 *
 *  - The cap was one `slice` over the merged caller list, so it bounded the response
 *    rather than each symbol — one popular helper starved every other changed symbol
 *    in the same PR, and each starved symbol rendered exactly like a symbol nobody
 *    calls.
 *  - The sort was `rank DESC` with no tiebreaker, the shape `server/INSIGHTS.md`
 *    (2026-08-06) records. Here ties are the norm — every unranked file shares `0` —
 *    and because the list is then truncated, a tie decides which callers a reviewer
 *    is shown at all.
 *  - Endpoints came only from files holding a resolved symbol caller, which is one
 *    hop and the wrong question. Blast radius asks who depends ON the change.
 *
 * Every ordering test here feeds its fixture SHUFFLED. `Array.prototype.sort` is
 * stable in V8, so a pre-sorted fixture passes with the comparator's tiebreakers
 * deleted and the test is theatre (`mcp-server/INSIGHTS.md`, 2026-08-13).
 */

interface Patch {
  indexStatus?: 'full' | 'partial' | 'degraded' | 'failed';
  declRows?: FullSymbolRow[];
  callerRows?: Array<{
    fromPath: string;
    toSymbol: string;
    line: number;
    rank: number;
    declFile?: string;
  }>;
  callerSymRows?: FullSymbolRow[];
  facts?: Array<{ filePath: string; endpoints: string[]; crons: string[] }>;
  /** Reverse edges as the DB holds them: `fromFile` imports `toFile`. */
  edges?: Array<{ fromFile: string; toFile: string }>;
  onGetImporters?: (files: string[]) => void;
}

function sym(path: string, name: string, line = 1): FullSymbolRow {
  return { path, name, kind: 'function', line, endLine: line + 5, exported: true, signature: null };
}

function build(p: Patch): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  const declPaths = new Set((p.declRows ?? []).map((r) => r.path));
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({
      status: p.indexStatus ?? 'full',
      lastIndexedSha: 'sha-1',
    }),
    // Called twice: for the changed files, then for the caller files.
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      paths.some((path) => declPaths.has(path)) ? (p.declRows ?? []) : (p.callerSymRows ?? []),
    // `declFile` defaults to the one changed file these fixtures use, which is what
    // the real query guarantees (it filters `declFile` to the changed files).
    getResolvedCallers: async () =>
      (p.callerRows ?? []).map((r) => ({ declFile: CHANGED, ...r })),
    getFileFacts: async (_repoId: string, files: string[]) =>
      (p.facts ?? []).filter((f) => files.includes(f.filePath)),
    getImporters: async (_repoId: string, files: string[]) => {
      p.onGetImporters?.(files);
      return (p.edges ?? []).filter((e) => files.includes(e.toFile));
    },
    getRepoBasics: async () => null,
  };
  return svc;
}

const CHANGED = 'src/middleware/ratelimit.ts';

describe('getBlastRadius — the caller cap is PER SYMBOL', () => {
  /** One hot symbol with 25 callers, one quiet symbol with 2. */
  const declRows = [sym(CHANGED, 'rateLimit'), sym(CHANGED, 'bucketKey', 40)];
  const hot = Array.from({ length: 25 }, (_, i) => ({
    fromPath: `src/hot/f${String(i).padStart(2, '0')}.ts`,
    toSymbol: 'rateLimit',
    line: i + 1,
    rank: 100 - i,
  }));
  const quiet = [
    { fromPath: 'src/quiet/a.ts', toSymbol: 'bucketKey', line: 3, rank: 5 },
    { fromPath: 'src/quiet/b.ts', toSymbol: 'bucketKey', line: 4, rank: 4 },
  ];

  it('keeps the quiet symbol’s callers even when another symbol overflows the cap', async () => {
    const svc = build({ declRows, callerRows: [...hot, ...quiet] });
    const result = await svc.getBlastRadius('r1', [CHANGED]);

    const forHot = result.callers.filter((c) => c.viaSymbol === 'rateLimit');
    const forQuiet = result.callers.filter((c) => c.viaSymbol === 'bucketKey');
    // A single global slice(0, 20) would return 20 hot callers and ZERO quiet ones —
    // and "bucketKey has no callers" is indistinguishable from the truth.
    expect(forHot).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(forQuiet).toHaveLength(2);
  });

  it('reports the pre-cap count per symbol, so the truncation is visible', async () => {
    const svc = build({ declRows, callerRows: [...hot, ...quiet] });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.callerCounts).toEqual([
      { symbol: 'rateLimit', file: CHANGED, total: 25 },
      { symbol: 'bucketKey', file: CHANGED, total: 2 },
    ]);
  });

  it('keeps the HIGHEST-ranked callers when it truncates', async () => {
    const svc = build({ declRows, callerRows: [...hot].reverse() });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    const ranks = result.callers.filter((c) => c.viaSymbol === 'rateLimit').map((c) => c.rank);
    // Top 20 of 100..76, in descending order — not the first 20 the scan returned.
    expect(ranks).toEqual(Array.from({ length: 20 }, (_, i) => 100 - i));
  });
});

describe('getBlastRadius — a symbol is (name, declaring file)', () => {
  it('attributes a caller to the file its reference resolved to, not to every same name', async () => {
    // The real shape of the bug: one PR changes `createTask` in both `repo.ts` and
    // `service.ts`. `references.decl_file` says which one each call reaches, and
    // dropping it made both symbols claim both callers.
    const REPO_F = 'src/modules/tasks/repo.ts';
    const SERVICE_F = 'src/modules/tasks/service.ts';
    const svc = build({
      declRows: [sym(REPO_F, 'createTask'), sym(SERVICE_F, 'createTask')],
      callerRows: [
        { fromPath: SERVICE_F, toSymbol: 'createTask', line: 11, rank: 90, declFile: REPO_F },
        {
          fromPath: 'src/modules/tasks/routes.ts',
          toSymbol: 'createTask',
          line: 10,
          rank: 80,
          declFile: SERVICE_F,
        },
      ],
      callerSymRows: [sym(SERVICE_F, 'createTask'), sym('src/modules/tasks/routes.ts', 'taskRoutes')],
    });

    const result = await svc.getBlastRadius('r1', [REPO_F, SERVICE_F]);

    const viaRepo = result.callers.filter((c) => c.viaFile === REPO_F);
    const viaService = result.callers.filter((c) => c.viaFile === SERVICE_F);
    expect(viaRepo.map((c) => c.file)).toEqual([SERVICE_F]);
    expect(viaService.map((c) => c.file)).toEqual(['src/modules/tasks/routes.ts']);
    // One each, not two each — the double count this fixes.
    expect(result.callerCounts).toEqual([
      { symbol: 'createTask', file: REPO_F, total: 1 },
      { symbol: 'createTask', file: SERVICE_F, total: 1 },
    ]);
  });
});

describe('getBlastRadius — callers come back in a total order', () => {
  const declRows = [sym(CHANGED, 'rateLimit')];

  it('orders tied ranks by file then line, from a shuffled fixture', async () => {
    // Every rank identical — the state of any repo whose files the ranker never
    // scored, and of the whole fallback path.
    const shuffled = [
      { fromPath: 'src/b.ts', toSymbol: 'rateLimit', line: 9, rank: 0 },
      { fromPath: 'src/a.ts', toSymbol: 'rateLimit', line: 20, rank: 0 },
      { fromPath: 'src/c.ts', toSymbol: 'rateLimit', line: 1, rank: 0 },
      { fromPath: 'src/a.ts', toSymbol: 'rateLimit', line: 4, rank: 0 },
    ];
    const svc = build({
      declRows,
      callerRows: shuffled,
      // Distinct enclosing symbols, or the dedup key would collapse the two a.ts rows.
      callerSymRows: [
        sym('src/a.ts', 'aLow', 1),
        sym('src/a.ts', 'aHigh', 10),
        sym('src/b.ts', 'bee'),
        sym('src/c.ts', 'cee'),
      ],
    });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/a.ts:4',
      'src/a.ts:20',
      'src/b.ts:9',
      'src/c.ts:1',
    ]);
  });

  it('is stable across two reads of the same rows in different scan orders', async () => {
    const rows = [
      { fromPath: 'src/x.ts', toSymbol: 'rateLimit', line: 2, rank: 7 },
      { fromPath: 'src/y.ts', toSymbol: 'rateLimit', line: 3, rank: 7 },
      { fromPath: 'src/z.ts', toSymbol: 'rateLimit', line: 4, rank: 7 },
    ];
    const first = await build({
      declRows,
      callerRows: rows,
      callerSymRows: [sym('src/x.ts', 'ex'), sym('src/y.ts', 'why'), sym('src/z.ts', 'zed')],
    }).getBlastRadius('r1', [CHANGED]);
    const second = await build({
      declRows,
      callerRows: [...rows].reverse(),
      callerSymRows: [sym('src/x.ts', 'ex'), sym('src/y.ts', 'why'), sym('src/z.ts', 'zed')],
    }).getBlastRadius('r1', [CHANGED]);
    // Postgres may hand back a tie group in either physical order; the response
    // must not depend on which.
    expect(first.callers.map((c) => c.file)).toEqual(second.callers.map((c) => c.file));
  });
});

describe('getBlastRadius — the graph is walked BACKWARDS', () => {
  const declRows = [sym(CHANGED, 'rateLimit')];

  /**
   * `server.ts` imports the changed file; the changed file imports `config.ts`.
   * A blast radius must report the former and never the latter.
   */
  const edges = [
    { fromFile: 'src/server.ts', toFile: CHANGED },
    { fromFile: CHANGED, toFile: 'src/config.ts' },
  ];
  const facts = [
    { filePath: 'src/server.ts', endpoints: ['GET /health'], crons: [] },
    { filePath: 'src/config.ts', endpoints: ['GET /should-not-appear'], crons: [] },
  ];

  it('reports importers of the changed file, not the files it imports', async () => {
    const svc = build({ declRows, edges, facts });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.reachedFiles?.map((r) => r.file)).toEqual(['src/server.ts']);
    expect(result.impactedEndpoints).toEqual(['GET /health']);
    // The single most important negative in this feature: a dependency of the
    // changed file is NOT downstream of it, and listing it would invert the map.
    expect(result.impactedEndpoints).not.toContain('GET /should-not-appear');
  });

  it('stops at BFS_DEPTH hops', async () => {
    const deep = [
      { fromFile: 'src/h1.ts', toFile: CHANGED },
      { fromFile: 'src/h2.ts', toFile: 'src/h1.ts' },
      { fromFile: 'src/h3.ts', toFile: 'src/h2.ts' }, // one hop too far
    ];
    const svc = build({ declRows, edges: deep });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(BFS_DEPTH).toBe(2);
    expect(result.reachedFiles?.map((r) => r.file)).toEqual(['src/h1.ts', 'src/h2.ts']);
    expect(result.reachedFiles?.map((r) => r.depth)).toEqual([1, 2]);
  });

  it('makes at most BFS_DEPTH index queries, and never re-parses the repository', async () => {
    // The acceptance criterion "the server does not rebuild the AST or the import
    // graph during a request", stated as a measurement: the walk is a bounded number
    // of indexed reads. `codeIndex` (the ripgrep/parse path) is never touched,
    // because reaching it would mean the persistent branch was abandoned.
    const calls: string[][] = [];
    const svc = build({
      declRows,
      edges: [
        { fromFile: 'src/h1.ts', toFile: CHANGED },
        { fromFile: 'src/h2.ts', toFile: 'src/h1.ts' },
      ],
      onGetImporters: (files) => calls.push(files),
    });
    await svc.getBlastRadius('r1', [CHANGED]);
    expect(calls).toEqual([[CHANGED], ['src/h1.ts']]);
    expect(calls.length).toBeLessThanOrEqual(BFS_DEPTH);
  });

  it('terminates on a cyclic import graph', async () => {
    const cyclic = [
      { fromFile: 'src/a.ts', toFile: CHANGED },
      { fromFile: CHANGED, toFile: 'src/a.ts' },
      { fromFile: 'src/a.ts', toFile: 'src/a.ts' },
    ];
    const svc = build({ declRows, edges: cyclic });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.reachedFiles?.map((r) => r.file)).toEqual(['src/a.ts']);
  });

  it('never reports a changed file as its own downstream', async () => {
    const twoChanged = ['src/a.ts', 'src/b.ts'];
    const svc = build({
      declRows: [sym('src/a.ts', 'alpha')],
      edges: [
        { fromFile: 'src/b.ts', toFile: 'src/a.ts' }, // both files are in the PR
        { fromFile: 'src/c.ts', toFile: 'src/a.ts' },
      ],
    });
    const result = await svc.getBlastRadius('r1', twoChanged);
    expect(result.reachedFiles?.map((r) => r.file)).toEqual(['src/c.ts']);
  });

  it('records the nearest changed file each reached file came from', async () => {
    const svc = build({
      declRows,
      edges: [
        { fromFile: 'src/mounted.ts', toFile: CHANGED },
        { fromFile: 'src/deep.ts', toFile: 'src/mounted.ts' },
      ],
    });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    // Both attribute to the changed file the walk started from, which is what lets
    // the response tie an endpoint to the symbol whose file reached it.
    expect(result.reachedFiles?.every((r) => r.viaFile === CHANGED)).toBe(true);
  });
});

describe('getBlastRadius — index coverage travels with the answer', () => {
  it('passes a partial index status through instead of implying completeness', async () => {
    const svc = build({ indexStatus: 'partial', declRows: [sym(CHANGED, 'rateLimit')] });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.indexStatus).toBe('partial');
    expect(result.degraded).toBe(false);
    expect(result.indexedSha).toBe('sha-1');
  });

  it('answers a non-degraded empty map when the changed files declare no symbols', async () => {
    const svc = build({ declRows: [] });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.changedSymbols).toEqual([]);
    expect(result.callers).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it('still reports coverage when the changed files declare no symbols', async () => {
    // Found on a real PR: this early-return path omitted `indexStatus`, so a repo
    // with a FULL index answered `partial / index_missing` for any docs-only or
    // config-only change. The consumer is right to refuse to claim completeness it
    // was not told about — so the facade has to tell it.
    const svc = build({ indexStatus: 'full', declRows: [] });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.indexStatus).toBe('full');
    expect(result.indexedSha).toBe('sha-1');
  });

  it('still walks the graph when the changed files declare no symbols', async () => {
    // A config or barrel file can export nothing this index knows and still be
    // imported by a route. Skipping the walk here would report "no impact" for
    // exactly the changes whose impact is purely structural.
    const svc = build({
      declRows: [],
      edges: [{ fromFile: 'src/api/uses-config.ts', toFile: CHANGED }],
      facts: [{ filePath: 'src/api/uses-config.ts', endpoints: ['GET /configured'], crons: [] }],
    });
    const result = await svc.getBlastRadius('r1', [CHANGED]);
    expect(result.reachedFiles?.map((r) => r.file)).toEqual(['src/api/uses-config.ts']);
    expect(result.impactedEndpoints).toEqual(['GET /configured']);
  });
});
