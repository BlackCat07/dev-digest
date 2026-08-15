import { describe, it, expect } from 'vitest';
import { PrBlastRadius } from '@devdigest/shared';
import { BlastService } from '../src/modules/blast/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';
import type { BlastDeps, BlastStore } from '../src/modules/blast/types.js';

/**
 * L04 — the service that assembles the impact map.
 *
 * Hermetic by name and by construction: no Postgres, no queue, no provider, no
 * clone. The store is a structural fixture whose UNREACHABLE methods throw rather
 * than returning an empty value — the shape `smart-diff-service.test.ts` set — so a
 * future edit that starts reading files before the workspace check fails loudly
 * here instead of silently succeeding.
 *
 * Four cases carry more than their length:
 *
 *  - **The workspace check is the FIRST await.** `pr_files` carries no
 *    `workspace_id`, and neither do `symbols` / `references` / `file_edges`, so a PR
 *    belonging to another workspace must 404 before any of them is read. The
 *    throwing fixture is what proves the order.
 *  - **`PrBlastRadius.parse` on the assembled object.** No route in this server
 *    declares a `response:` schema, so the contract is otherwise a compile-time
 *    claim only — and this codebase has already shipped a cast-not-parsed response
 *    that reached the client as `$NaN` (`server/INSIGHTS.md`, 2026-08-02).
 *  - **The no-model claim is measured, not asserted in prose.** A `Proxy` over the
 *    deps throws on any key the service is not entitled to, so reaching for an LLM
 *    is a test failure rather than a review comment.
 *  - **An empty map always says why.** Three different empties — no changed files,
 *    no index, a partial index — must arrive with three different `status`/`reason`
 *    pairs, because that distinction is the feature.
 */

const WORKSPACE = 'ws-1';
const PR = 'pr-1';
const REPO = 'repo-1';
const SHA = 'abc1234';
/** The file both changed symbols are declared in. */
const LIMITER = 'src/middleware/ratelimit.ts';

/** A store whose every method throws until the test opts in to it. */
function store(over: Partial<BlastStore> = {}): BlastStore {
  return {
    getPull: () => {
      throw new Error('getPull was not stubbed for this case');
    },
    getPrFiles: () => {
      throw new Error('getPrFiles must not be reached in this case');
    },
    ...over,
  };
}

/**
 * Deps behind a `Proxy` that throws on any key other than the two ports
 * `BlastDeps` declares.
 *
 * This is the "structurally incapable of a model call" claim, enforced. Reading
 * `deps.llm`, `deps.featureModel`, `deps.github` or `deps.git` from the service
 * would throw here — so the acceptance criterion "the main path calls no LLM"
 * cannot silently regress into "does not happen to, today".
 */
function deps(reviewRepo: BlastStore, blast: BlastResult | (() => BlastResult)): BlastDeps {
  const allowed = new Set(['reviewRepo', 'repoIntel']);
  const target: BlastDeps = {
    reviewRepo,
    repoIntel: {
      getBlastRadius: async () => (typeof blast === 'function' ? blast() : blast),
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (!allowed.has(prop)) {
        throw new Error(`BlastService reached for a port it must not have: ${String(prop)}`);
      }
      return t[prop as keyof BlastDeps];
    },
  });
}

function serviceWith(
  over: Partial<BlastStore>,
  blast: BlastResult | (() => BlastResult) = indexed(),
): BlastService {
  return new BlastService(deps(store(over), blast));
}

const PULL = { id: PR, repoId: REPO, headSha: SHA };

/** The PR from the design: a shared limiter plus the files around it. */
function pull(paths = ['src/middleware/ratelimit.ts', 'src/config.ts']): Partial<BlastStore> {
  return {
    getPull: async () => PULL,
    getPrFiles: async () => paths.map((path) => ({ path })),
  };
}

/**
 * A realistic persistent-index result: two changed symbols, `rateLimit` with four
 * callers and `bucketKey` with two, three endpoints and one cron.
 */
function indexed(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [
      { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
      { file: 'src/middleware/ratelimit.ts', name: 'bucketKey', kind: 'function' },
    ],
    callers: [
      { file: 'src/api/public/index.ts', symbol: 'router', viaSymbol: 'rateLimit', viaFile: LIMITER, line: 23, rank: 90 },
      { file: 'src/api/public/webhooks.ts', symbol: 'webhookHandler', viaSymbol: 'rateLimit', viaFile: LIMITER, line: 45, rank: 80 },
      { file: 'src/api/public/health.ts', symbol: 'health', viaSymbol: 'rateLimit', viaFile: LIMITER, line: 11, rank: 70 },
      { file: 'src/server.ts', symbol: 'buildServer', viaSymbol: 'rateLimit', viaFile: LIMITER, line: 88, rank: 60 },
      { file: 'src/middleware/quota.ts', symbol: 'quota', viaSymbol: 'bucketKey', viaFile: LIMITER, line: 9, rank: 50 },
      { file: 'src/jobs/reset.ts', symbol: 'resetBuckets', viaSymbol: 'bucketKey', viaFile: LIMITER, line: 4, rank: 40 },
    ],
    impactedEndpoints: [
      'GET /api/public/items',
      'POST /api/public/webhooks',
      'GET /api/public/health',
    ],
    factsByFile: {
      'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      'src/api/public/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: [] },
      'src/api/public/health.ts': { endpoints: ['GET /api/public/health'], crons: [] },
      'src/jobs/reset.ts': { endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
    },
    reachedFiles: [],
    callerCounts: [
      { symbol: 'rateLimit', file: LIMITER, total: 4 },
      { symbol: 'bucketKey', file: LIMITER, total: 2 },
    ],
    indexStatus: 'full',
    indexedSha: SHA,
    degraded: false,
    ...over,
  };
}

describe('BlastService — authorization', () => {
  it('404s for a PR that is not in this workspace, before reading anything', async () => {
    const service = serviceWith({ getPull: async () => undefined });
    // `getPrFiles` throws, so reaching it would fail with ITS message rather than
    // NotFoundError — which is how this asserts the order.
    await expect(service.build(WORKSPACE, PR)).rejects.toThrow(NotFoundError);
  });

  it('passes the workspace to the lookup, so the scope cannot be dropped', async () => {
    const seen: string[] = [];
    const service = serviceWith({
      getPull: async (workspaceId) => {
        seen.push(workspaceId);
        return undefined;
      },
    });
    await expect(service.build(WORKSPACE, PR)).rejects.toThrow(NotFoundError);
    expect(seen).toEqual([WORKSPACE]);
  });
});

describe('BlastService — the assembled response', () => {
  it('satisfies the PrBlastRadius contract at runtime', async () => {
    const result = await serviceWith(pull()).build(WORKSPACE, PR);
    expect(() => PrBlastRadius.parse(result)).not.toThrow();
  });

  it('reaches for no port other than the review repo and the index', async () => {
    // The Proxy in `deps` throws on anything else, so a clean build IS the
    // assertion: this service cannot call a model, GitHub, git or the job queue.
    await expect(serviceWith(pull()).build(WORKSPACE, PR)).resolves.toBeDefined();
  });

  it('groups callers under the symbol they reach, most-impacted symbol first', async () => {
    const { downstream } = await serviceWith(pull()).build(WORKSPACE, PR);
    expect(downstream.map((d) => d.symbol)).toEqual(['rateLimit', 'bucketKey']);
    expect(downstream[0]!.callers.map((c) => c.file)).toEqual([
      'src/api/public/index.ts',
      'src/api/public/webhooks.ts',
      'src/api/public/health.ts',
      'src/server.ts',
    ]);
    expect(downstream[1]!.callers).toHaveLength(2);
  });

  it('carries the file:line of every caller, which is what the UI links on', async () => {
    const { downstream } = await serviceWith(pull()).build(WORKSPACE, PR);
    expect(downstream[0]!.callers[0]).toEqual({
      name: 'router',
      file: 'src/api/public/index.ts',
      line: 23,
    });
    // Every caller has a positive line: a link to `file:0` would open the wrong place.
    for (const d of downstream) for (const c of d.callers) expect(c.line).toBeGreaterThan(0);
  });

  it('attributes endpoints and crons to the symbol whose callers declare them', async () => {
    const { downstream } = await serviceWith(pull()).build(WORKSPACE, PR);
    const rateLimit = downstream.find((d) => d.symbol === 'rateLimit')!;
    const bucketKey = downstream.find((d) => d.symbol === 'bucketKey')!;
    expect(rateLimit.endpoints_affected).toEqual([
      'GET /api/public/health',
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(rateLimit.crons_affected).toEqual([]);
    // The cron belongs to bucketKey — its caller `src/jobs/reset.ts` declares it.
    expect(bucketKey.crons_affected).toEqual(['reset-rate-buckets (hourly)']);
  });

  it('counts endpoints DISTINCT across the map, not once per symbol that reaches them', async () => {
    // The same endpoint reached through both changed symbols is one endpoint at
    // risk. Without a distinct count the stat row would double it.
    const shared = indexed({
      factsByFile: {
        'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
        'src/middleware/quota.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      },
    });
    const { counts } = await serviceWith(pull(), shared).build(WORKSPACE, PR);
    expect(counts.endpoints).toBe(1);
    expect(counts.symbols).toBe(2);
    // Pre-cap totals: 4 + 2.
    expect(counts.callers).toBe(6);
  });

  it('reports the pre-cap caller count, so "14 callers" over a shorter list is honest', async () => {
    const capped = indexed({
      callerCounts: [
        { symbol: 'rateLimit', file: LIMITER, total: 14 },
        { symbol: 'bucketKey', file: LIMITER, total: 2 },
      ],
    });
    const { downstream, counts } = await serviceWith(pull(), capped).build(WORKSPACE, PR);
    const rateLimit = downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.caller_count).toBe(14);
    expect(rateLimit.callers).toHaveLength(4);
    expect(rateLimit.truncated).toBe(true);
    expect(counts.callers).toBe(16);
    // A symbol whose list is complete must NOT claim truncation.
    expect(downstream.find((d) => d.symbol === 'bucketKey')!.truncated).toBe(false);
  });

  it('does not give two same-named symbols each other’s callers', async () => {
    // Found on a real PR: `createTask` was changed in BOTH `repo.ts` and `service.ts`.
    // Grouping callers by NAME gave both rows the same two callers and counted every
    // caller twice — the card showed two identical `createTask()` rows and a caller
    // total of 20 for 10 real callers.
    const sameName = indexed({
      changedSymbols: [
        { file: 'src/modules/tasks/repo.ts', name: 'createTask', kind: 'function' },
        { file: 'src/modules/tasks/service.ts', name: 'createTask', kind: 'function' },
      ],
      callers: [
        {
          file: 'src/modules/tasks/service.ts',
          symbol: 'createTask',
          viaSymbol: 'createTask',
          viaFile: 'src/modules/tasks/repo.ts',
          line: 11,
          rank: 90,
        },
        {
          file: 'src/modules/tasks/routes.ts',
          symbol: 'taskRoutes',
          viaSymbol: 'createTask',
          viaFile: 'src/modules/tasks/service.ts',
          line: 10,
          rank: 80,
        },
      ],
      callerCounts: [
        { symbol: 'createTask', file: 'src/modules/tasks/repo.ts', total: 1 },
        { symbol: 'createTask', file: 'src/modules/tasks/service.ts', total: 1 },
      ],
      factsByFile: {},
    });

    const { downstream, counts } = await serviceWith(pull(), sameName).build(WORKSPACE, PR);

    expect(downstream).toHaveLength(2);
    const fromRepo = downstream.find((d) => d.file === 'src/modules/tasks/repo.ts')!;
    const fromService = downstream.find((d) => d.file === 'src/modules/tasks/service.ts')!;
    // Each row gets ONLY the callers that resolved to its own declaring file.
    expect(fromRepo.callers.map((c) => c.file)).toEqual(['src/modules/tasks/service.ts']);
    expect(fromService.callers.map((c) => c.file)).toEqual(['src/modules/tasks/routes.ts']);
    expect(fromRepo.caller_count).toBe(1);
    expect(fromService.caller_count).toBe(1);
    // Two real callers, reported as two — not four.
    expect(counts.callers).toBe(2);
  });

  it('keeps a changed symbol with no callers out of the tree but inside changed_symbols', async () => {
    const lonely = indexed({
      callers: [],
      callerCounts: [],
      factsByFile: {},
      impactedEndpoints: [],
    });
    const result = await serviceWith(pull(), lonely).build(WORKSPACE, PR);
    expect(result.downstream).toEqual([]);
    expect(result.changed_symbols).toHaveLength(2);
    // Two symbols were really found and really have no callers: that is `ok`, and
    // it is the one empty map that IS a finding rather than a gap.
    expect(result.status).toBe('ok');
    expect(result.reason).toBeNull();
  });

  it('orders the tree deterministically when two symbols tie on impact', async () => {
    // Fed in reverse alphabetical order on purpose: `Array.prototype.sort` is
    // stable, so an already-ordered fixture would pass with the tiebreaker deleted
    // (`mcp-server/INSIGHTS.md`, 2026-08-13).
    const tied = indexed({
      changedSymbols: [
        { file: 'src/z.ts', name: 'zebra', kind: 'function' },
        { file: 'src/a.ts', name: 'alpha', kind: 'function' },
      ],
      callers: [
        { file: 'src/one.ts', symbol: 'one', viaSymbol: 'zebra', viaFile: 'src/z.ts', line: 1, rank: 10 },
        { file: 'src/two.ts', symbol: 'two', viaSymbol: 'alpha', viaFile: 'src/a.ts', line: 2, rank: 10 },
      ],
      callerCounts: [
        { symbol: 'zebra', file: 'src/z.ts', total: 1 },
        { symbol: 'alpha', file: 'src/a.ts', total: 1 },
      ],
      factsByFile: {},
    });
    const { downstream } = await serviceWith(pull(), tied).build(WORKSPACE, PR);
    expect(downstream.map((d) => d.symbol)).toEqual(['alpha', 'zebra']);
  });
});

describe('BlastService — an empty map always says why', () => {
  it('degrades with no_changed_files, and does NOT consult the index', async () => {
    // `pr_files` is written only by `GET /pulls/:id`, so this is the state of any PR
    // whose detail has never been opened. The index read must not even be attempted:
    // analysing zero files would answer "no impact" for a PR nobody has looked at.
    let asked = 0;
    const service = new BlastService({
      reviewRepo: store({ getPull: async () => PULL, getPrFiles: async () => [] }),
      repoIntel: {
        getBlastRadius: async () => {
          asked += 1;
          return indexed();
        },
      },
    });
    const result = await service.build(WORKSPACE, PR);
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('no_changed_files');
    expect(asked).toBe(0);
    expect(() => PrBlastRadius.parse(result)).not.toThrow();
  });

  it('reports partial when the index covers only part of the repository', async () => {
    const partial = indexed({ indexStatus: 'partial' });
    const result = await serviceWith(pull(), partial).build(WORKSPACE, PR);
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('index_partial');
    // Partial still carries real data — it is a caveat, not an erasure.
    expect(result.downstream.length).toBeGreaterThan(0);
  });

  it('reports degraded with index_missing when nothing usable was read', async () => {
    const fallback: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const result = await serviceWith(pull(), fallback).build(WORKSPACE, PR);
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('index_missing');
    expect(result.indexed_sha).toBeNull();
  });

  it('passes the flag_off reason through rather than calling it a missing index', async () => {
    const off: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'flag_off',
    };
    const result = await serviceWith(pull(), off).build(WORKSPACE, PR);
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('flag_off');
  });

  it('echoes the changed files back, so an empty map is attributable', async () => {
    const paths = ['src/b.ts', 'src/a.ts', 'src/a.ts'];
    const result = await serviceWith(pull(paths)).build(WORKSPACE, PR);
    // Deduped and sorted: the same list the index was actually asked about.
    expect(result.changed_files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('asks the index about exactly the PR’s changed files, and for the PR’s repo', async () => {
    const seen: Array<{ repoId: string; files: string[] }> = [];
    const service = new BlastService({
      reviewRepo: store(pull()),
      repoIntel: {
        getBlastRadius: async (repoId, files) => {
          seen.push({ repoId, files });
          return indexed();
        },
      },
    });
    await service.build(WORKSPACE, PR);
    expect(seen).toEqual([
      { repoId: REPO, files: ['src/config.ts', 'src/middleware/ratelimit.ts'] },
    ]);
  });
});

describe('BlastService — endpoints reached through the import graph', () => {
  it('includes a route whose file imports the change but names none of its symbols', async () => {
    // The case symbol callers cannot see: a router mounts the changed module, so no
    // reference to `rateLimit` resolves into it, yet its endpoint is squarely in the
    // blast radius. Depth 2 is reported as such.
    const viaGraph = indexed({
      factsByFile: {},
      reachedFiles: [
        {
          file: 'src/api/mounted.ts',
          depth: 2,
          viaFile: 'src/middleware/ratelimit.ts',
          endpoints: ['GET /api/mounted'],
          crons: [],
        },
      ],
    });
    const { downstream, counts } = await serviceWith(pull(), viaGraph).build(WORKSPACE, PR);
    const rateLimit = downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.endpoints_affected).toEqual(['GET /api/mounted']);
    expect(rateLimit.impacted[0]).toEqual({
      label: 'GET /api/mounted',
      kind: 'endpoint',
      file: 'src/api/mounted.ts',
      depth: 2,
    });
    expect(counts.endpoints).toBe(1);
  });

  it('reports an endpoint found both ways once, at its shallowest attribution', async () => {
    const both = indexed({
      factsByFile: {
        'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      },
      reachedFiles: [
        {
          file: 'src/api/public/index.ts',
          depth: 2,
          viaFile: 'src/middleware/ratelimit.ts',
          endpoints: ['GET /api/public/items'],
          crons: [],
        },
      ],
    });
    const { downstream } = await serviceWith(pull(), both).build(WORKSPACE, PR);
    const rateLimit = downstream.find((d) => d.symbol === 'rateLimit')!;
    const items = rateLimit.impacted.filter((e) => e.label === 'GET /api/public/items');
    expect(items).toHaveLength(1);
    expect(items[0]!.depth).toBe(1);
  });

  it('reports the endpoints the changed file DECLARES ITSELF, at depth 0', async () => {
    // Found on a real PR that edited both a helpers file and a routes file. The routes
    // file is a changed file, so it is correctly excluded from its own downstream —
    // and its endpoints, the ones the diff touches most directly, appeared nowhere.
    const ownRoutes = indexed({
      factsByFile: {},
      reachedFiles: [],
      changedFileFacts: [
        {
          file: 'src/api/public/routes.ts',
          endpoints: ['GET /api/public/items'],
          crons: ['nightly-sweep'],
        },
      ],
    });
    const { impacted, counts } = await serviceWith(pull(), ownRoutes).build(WORKSPACE, PR);
    expect(impacted).toEqual([
      { label: 'nightly-sweep', kind: 'cron', file: 'src/api/public/routes.ts', depth: 0 },
      {
        label: 'GET /api/public/items',
        kind: 'endpoint',
        file: 'src/api/public/routes.ts',
        depth: 0,
      },
    ]);
    expect(counts.endpoints).toBe(1);
    expect(counts.crons).toBe(1);
  });

  it('counts an endpoint reached from a changed file that declares no symbols', async () => {
    // The other half of the same gap: this endpoint is attributed to no symbol,
    // because the symbols live in a different changed file. Counting only per-symbol
    // impact would report zero.
    const viaOtherFile = indexed({
      factsByFile: {},
      reachedFiles: [
        {
          file: 'src/app.ts',
          depth: 2,
          viaFile: 'src/config.ts', // a changed file, but not either symbol's home
          endpoints: ['GET /health'],
          crons: [],
        },
      ],
    });
    const { impacted, counts, downstream } = await serviceWith(pull(), viaOtherFile).build(
      WORKSPACE,
      PR,
    );
    expect(impacted.map((e) => e.label)).toEqual(['GET /health']);
    expect(counts.endpoints).toBe(1);
    // Still not attributed to a symbol — the map-level list is where it belongs.
    for (const d of downstream) expect(d.endpoints_affected).toEqual([]);
  });

  it('does not present a test file’s endpoint as a route at risk', async () => {
    // Measured on a real PR: an integration test that exercises an API records that
    // API in its own `file_facts`, because the extractor cannot tell "declares this
    // route" from "calls this route". A test is a consumer that will re-run, not a
    // live surface the change could break.
    const withTest = indexed({
      factsByFile: {},
      reachedFiles: [],
      changedFileFacts: [
        {
          file: 'test/agents-versions.it.test.ts',
          endpoints: ['GET /agents/${agentId}/versions'],
          crons: [],
        },
        { file: 'src/api/routes.ts', endpoints: ['GET /agents'], crons: [] },
      ],
    });
    const { impacted, counts } = await serviceWith(pull(), withTest).build(WORKSPACE, PR);
    expect(impacted.map((e) => e.file)).toEqual(['src/api/routes.ts']);
    expect(counts.endpoints).toBe(1);
  });

  it('reports an endpoint once at its shallowest depth across all three directions', async () => {
    const overlapping = indexed({
      factsByFile: {
        'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      },
      reachedFiles: [
        {
          file: 'src/api/public/index.ts',
          depth: 2,
          viaFile: 'src/middleware/ratelimit.ts',
          endpoints: ['GET /api/public/items'],
          crons: [],
        },
      ],
      changedFileFacts: [
        { file: 'src/api/public/index.ts', endpoints: ['GET /api/public/items'], crons: [] },
      ],
    });
    const { impacted } = await serviceWith(pull(), overlapping).build(WORKSPACE, PR);
    expect(impacted).toHaveLength(1);
    expect(impacted[0]!.depth).toBe(0);
  });

  it('does not attribute a reached file to a symbol declared in another file', async () => {
    const elsewhere = indexed({
      factsByFile: {},
      reachedFiles: [
        {
          file: 'src/api/other.ts',
          depth: 1,
          viaFile: 'src/config.ts', // a changed file, but not either symbol's home
          endpoints: ['GET /api/other'],
          crons: [],
        },
      ],
    });
    const { downstream } = await serviceWith(pull(), elsewhere).build(WORKSPACE, PR);
    for (const d of downstream) expect(d.endpoints_affected).toEqual([]);
  });
});
