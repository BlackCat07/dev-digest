import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { PrBlastRadius } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * L04 — `GET /pulls/:id/blast` over real rows.
 *
 * What only this suite can cover: that the module is registered at all (an absent
 * entry in `modules/index.ts` is a silent 404), that the route's body really
 * satisfies the `PrBlastRadius` contract at runtime — no route in this server
 * declares a `response:` schema, so nothing else checks it — that the workspace
 * scope holds against a second workspace's PR, and that the map is assembled from
 * INDEX ROWS written to Postgres rather than from anything parsed during the
 * request.
 *
 * The seeded fixture has no `repo_index_state`, so the seeded PR exercises the
 * degraded answer; the index rows for the ok/partial cases are written here by hand.
 * Writing them directly is the point rather than a shortcut: it is how the test
 * demonstrates that the route reads the index instead of building one.
 *
 * And the acceptance criterion no unit test can state at the HTTP boundary: **no
 * model request is made.** Proved the way `smart-diff.it.test.ts` proves it — by
 * RECORDING (every provider is a `MockLLMProvider` whose `calls` must stay empty,
 * and the `jobs` table must not grow, since `JobRunner.enqueue` inserts a row before
 * queueing) and by IMPOSSIBILITY (the same request against an app built with no
 * `llm` override at all must return byte-identical output).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' });

/** The changed file in the seeded PR that the hand-written index is built around. */
const CHANGED = 'src/middleware/ratelimit.ts';

d('L04 blast route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    repoId = pr!.repoId;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function getBlast(id = prId) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    try {
      return await app.inject({ method: 'GET', url: `/pulls/${id}/blast` });
    } finally {
      await app.close();
    }
  }

  /**
   * Write the index rows a real clone-time indexing pass would have produced:
   * two symbols in the changed file, four resolved callers of one of them, the
   * ranks that order them, an import edge into the changed file, and the endpoint
   * facts of the files involved.
   */
  async function writeIndex(status: 'full' | 'partial') {
    const db = pg.handle.db;
    await db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    await db.delete(t.references).where(eq(t.references.repoId, repoId));
    await db.delete(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    await db.delete(t.fileEdges).where(eq(t.fileEdges.repoId, repoId));
    await db.delete(t.fileFacts).where(eq(t.fileFacts.repoId, repoId));
    await db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));

    await db.insert(t.symbols).values([
      { repoId, path: CHANGED, name: 'rateLimit', kind: 'function', line: 24, endLine: 60, exported: true },
      { repoId, path: CHANGED, name: 'bucketKey', kind: 'function', line: 70, endLine: 80, exported: true },
      { repoId, path: 'src/api/public/index.ts', name: 'router', kind: 'function', line: 10, endLine: 40, exported: true },
      { repoId, path: 'src/api/public/webhooks.ts', name: 'webhookHandler', kind: 'function', line: 30, endLine: 60, exported: true },
      { repoId, path: 'src/server.ts', name: 'buildServer', kind: 'function', line: 70, endLine: 120, exported: true },
      { repoId, path: 'src/jobs/reset.ts', name: 'resetBuckets', kind: 'function', line: 1, endLine: 20, exported: true },
    ]);

    await db.insert(t.references).values([
      { repoId, fromPath: 'src/api/public/index.ts', toSymbol: 'rateLimit', declFile: CHANGED, line: 23 },
      { repoId, fromPath: 'src/api/public/webhooks.ts', toSymbol: 'rateLimit', declFile: CHANGED, line: 45 },
      { repoId, fromPath: 'src/server.ts', toSymbol: 'rateLimit', declFile: CHANGED, line: 88 },
      { repoId, fromPath: 'src/jobs/reset.ts', toSymbol: 'bucketKey', declFile: CHANGED, line: 4 },
    ]);

    // `pagerank` mirrors `rank` and `hotness` is 0, which is what the indexer
    // itself writes ("= pagerank under Option B", `db/schema/repo-intel.ts`).
    const ranked: Array<[string, number, number]> = [
      [CHANGED, 0.9, 99],
      ['src/api/public/index.ts', 0.8, 90],
      ['src/api/public/webhooks.ts', 0.7, 80],
      ['src/server.ts', 0.6, 70],
      ['src/jobs/reset.ts', 0.5, 60],
      ['src/api/mounted.ts', 0.4, 50],
    ];
    await db.insert(t.fileRank).values(
      ranked.map(([filePath, rank, percentile]) => ({
        repoId,
        filePath,
        pagerank: rank,
        hotness: 0,
        rank,
        percentile,
      })),
    );

    // `src/api/mounted.ts` imports the changed file and names none of its symbols —
    // reachable only through the reverse import walk.
    await db.insert(t.fileEdges).values([
      { repoId, fromFile: 'src/api/mounted.ts', toFile: CHANGED },
      // The changed file's OWN dependency. It must never appear downstream.
      { repoId, fromFile: CHANGED, toFile: 'src/lib/redis.ts' },
    ]);

    await db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/api/public/index.ts', endpoints: ['GET /api/public/items'], crons: [] },
      { repoId, filePath: 'src/api/public/webhooks.ts', endpoints: ['POST /api/public/webhooks'], crons: [] },
      { repoId, filePath: 'src/jobs/reset.ts', endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
      { repoId, filePath: 'src/api/mounted.ts', endpoints: ['GET /api/mounted'], crons: [] },
      { repoId, filePath: 'src/lib/redis.ts', endpoints: ['GET /should-never-appear'], crons: [] },
    ]);

    await db.insert(t.repoIndexState).values({
      repoId,
      status,
      lastIndexedSha: 'indexed-sha-1',
      indexerVersion: 2,
      filesIndexed: 6,
      filesSkipped: 0,
    });
  }

  describe('with a full index', () => {
    beforeAll(async () => {
      await writeIndex('full');
    });

    it('answers the contract for the seeded PR', async () => {
      const res = await getBlast();
      expect(res.statusCode).toBe(200);
      expect(() => PrBlastRadius.parse(res.json())).not.toThrow();
    });

    it('reports ok with no reason, and the sha the index was built at', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      expect(body.status).toBe('ok');
      expect(body.reason).toBeNull();
      expect(body.indexed_sha).toBe('indexed-sha-1');
    });

    it('finds at least two real callers and one HTTP endpoint', async () => {
      // The acceptance criterion, stated as an assertion.
      const body = PrBlastRadius.parse((await getBlast()).json());
      const rateLimit = body.downstream.find((d2) => d2.symbol === 'rateLimit');
      expect(rateLimit, 'rateLimit missing from the map').toBeDefined();
      expect(rateLimit!.callers.length).toBeGreaterThanOrEqual(2);
      expect(rateLimit!.endpoints_affected.length).toBeGreaterThanOrEqual(1);
      expect(body.counts.endpoints).toBeGreaterThanOrEqual(1);
    });

    it('orders callers by file rank, highest first', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      const rateLimit = body.downstream.find((d2) => d2.symbol === 'rateLimit')!;
      expect(rateLimit.callers.map((c) => c.file)).toEqual([
        'src/api/public/index.ts',
        'src/api/public/webhooks.ts',
        'src/server.ts',
      ]);
    });

    it('carries a file:line for every caller that matches the reference rows', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      const rateLimit = body.downstream.find((d2) => d2.symbol === 'rateLimit')!;
      expect(rateLimit.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
        'src/api/public/index.ts:23',
        'src/api/public/webhooks.ts:45',
        'src/server.ts:88',
      ]);
    });

    it('excludes the declaring file from its own callers', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      for (const d2 of body.downstream) {
        expect(d2.callers.map((c) => c.file)).not.toContain(d2.file);
      }
    });

    it('reaches an endpoint whose file imports the change but names no symbol', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      const all = body.downstream.flatMap((d2) => d2.endpoints_affected);
      expect(all).toContain('GET /api/mounted');
    });

    it('never reports a DEPENDENCY of the changed file as downstream', async () => {
      // The direction check: `src/lib/redis.ts` is imported BY the changed file, and
      // its endpoint must not appear anywhere in the map.
      const body = PrBlastRadius.parse((await getBlast()).json());
      const all = [
        ...body.downstream.flatMap((d2) => d2.endpoints_affected),
        ...body.downstream.flatMap((d2) => d2.impacted.map((e) => e.label)),
      ];
      expect(all).not.toContain('GET /should-never-appear');
    });

    it('attributes the cron to the symbol its caller schedules', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      const bucketKey = body.downstream.find((d2) => d2.symbol === 'bucketKey')!;
      expect(bucketKey.crons_affected).toEqual(['reset-rate-buckets (hourly)']);
      expect(body.counts.crons).toBe(1);
    });

    it('makes no model request and enqueues no job', async () => {
      const providers = {
        openai: new MockLLMProvider('openai'),
        anthropic: new MockLLMProvider('anthropic'),
        openrouter: new MockLLMProvider('openai'),
      };
      const before = await pg.handle.db.select().from(t.jobs);
      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: { llm: providers, github: new MockGitHubClient() },
      });
      try {
        const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }
      for (const [id, provider] of Object.entries(providers)) {
        expect(provider.calls, `${id} was called`).toEqual([]);
      }
      const after = await pg.handle.db.select().from(t.jobs);
      expect(after).toHaveLength(before.length);
    });

    it('returns the same body with no LLM provider configured at all', async () => {
      // By IMPOSSIBILITY: this app cannot construct a provider, so identical output
      // is proof the map does not depend on one.
      const withMock = (await getBlast()).json();
      const app = await buildApp({ config: config(), db: pg.handle.db });
      try {
        const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(withMock);
      } finally {
        await app.close();
      }
    });
  });

  describe('with a partial index', () => {
    beforeAll(async () => {
      await writeIndex('partial');
    });

    it('says partial and why, while still carrying the data it does have', async () => {
      const body = PrBlastRadius.parse((await getBlast()).json());
      expect(body.status).toBe('partial');
      expect(body.reason).toBe('index_partial');
      expect(body.downstream.length).toBeGreaterThan(0);
    });
  });

  describe('degraded and empty states', () => {
    it('404s for a PR in another workspace', async () => {
      const [other] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-${Date.now()}` })
        .returning();
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({
          workspaceId: other!.id,
          owner: 'acme',
          name: `private-${Date.now()}`,
          fullName: `acme/private-${Date.now()}`,
        })
        .returning();
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId: other!.id,
          repoId: repo!.id,
          number: 1,
          title: 'Secret work',
          author: 'someone',
          branch: 'feat/x',
          base: 'main',
          headSha: 'deadbeef',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'open',
        })
        .returning();

      const res = await getBlast(pr!.id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
    });

    it('answers 200 and no_changed_files for a PR whose files were never imported', async () => {
      const stamp = Date.now();
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({
          workspaceId,
          owner: 'acme',
          name: `unopened-${stamp}`,
          fullName: `acme/unopened-${stamp}`,
        })
        .returning();
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: 7,
          title: 'Never opened',
          author: 'someone',
          branch: 'feat/y',
          base: 'main',
          headSha: 'cafebabe',
          additions: 0,
          deletions: 0,
          filesCount: 0,
          status: 'open',
        })
        .returning();

      const res = await getBlast(pr!.id);
      expect(res.statusCode).toBe(200);
      const body = PrBlastRadius.parse(res.json());
      // NOT an empty ok: nothing was analysed, and the response says so.
      expect(body.status).toBe('degraded');
      expect(body.reason).toBe('no_changed_files');
      expect(body.changed_files).toEqual([]);
    });

    it('degrades rather than throwing when the repo has no index at all', async () => {
      const db = pg.handle.db;
      await db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
      const res = await getBlast();
      expect(res.statusCode).toBe(200);
      const body = PrBlastRadius.parse(res.json());
      expect(body.status).toBe('degraded');
      // The map is empty because nothing was read — never presented as "no impact".
      expect(body.reason).not.toBeNull();
    });
  });
});
