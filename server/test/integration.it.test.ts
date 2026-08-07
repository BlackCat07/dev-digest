import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('GET /repos/:id/pulls imports PRs (mock GitHub) idempotently', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repoId = repos.json()[0]!.id;

    const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(first.statusCode).toBe(200);
    expect(first.json().length).toBeGreaterThan(0);
    // import again → still idempotent (unique repo_id+number)
    const second = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(second.json().length).toBe(first.json().length);
    await app.close();
  });

  it('GET /repos/:id/pulls sums COST + FINDINGS across agents and takes the MIN score', async () => {
    // A review fans out over N agents (one agent_runs + one reviews row each), so
    // the list's COST is a sum and its SCORE is the worst agent's — not whichever
    // agent finished last. Exercised here because the grouping is real SQL +
    // ordering; the pure reduction is covered hermetically in pulls-latest.test.ts.
    const { db } = pg.handle;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    const workspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'agg', name: 'sums', fullName: 'agg/sums' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 4821,
        title: 'Aggregate me',
        author: 'dev',
        branch: 'feat/agg',
        base: 'main',
        headSha: 'aggr0001',
        status: 'needs_review',
      })
      .returning();
    const agents = await db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    const [a1, a2] = agents;
    expect(a2).toBeDefined(); // the seed ships three built-in agents

    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    await db.insert(t.agentRuns).values([
      { workspaceId, prId: pr!.id, agentId: a1!.id, status: 'done', costUsd: 0.004, ranAt: at(0) },
      // newest for a1 — a re-run REPLACES its older figure rather than adding to it
      { workspaceId, prId: pr!.id, agentId: a1!.id, status: 'done', costUsd: 0.006, ranAt: at(90) },
      { workspaceId, prId: pr!.id, agentId: a2!.id, status: 'done', costUsd: 0.011, ranAt: at(1) },
      // a later FAILED run must not blank a2's column contribution
      { workspaceId, prId: pr!.id, agentId: a2!.id, status: 'failed', costUsd: null, ranAt: at(120) },
    ]);
    const reviewRows = await db
      .insert(t.reviews)
      .values([
        { workspaceId, prId: pr!.id, agentId: a1!.id, kind: 'review', score: 72, createdAt: at(0) },
        { workspaceId, prId: pr!.id, agentId: a1!.id, kind: 'review', score: 88, createdAt: at(90) },
        { workspaceId, prId: pr!.id, agentId: a2!.id, kind: 'review', score: 64, createdAt: at(1) },
        // A 'summary' row is excluded from every list aggregate.
        { workspaceId, prId: pr!.id, agentId: a2!.id, kind: 'summary', score: 10, createdAt: at(2) },
      ])
      .returning();
    const [r1Old, r1New, r2, rSummary] = reviewRows;

    // FINDINGS sums EVERY run, so a1's SUPERSEDED review still contributes — the
    // opposite of SCORE/COST above, which only see a1's newest row.
    const finding = (reviewId: string, severity: string) => ({
      reviewId,
      file: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      severity,
      category: 'bug',
      title: `${severity} finding`,
      rationale: 'because',
      confidence: 0.9,
    });
    await db.insert(t.findings).values([
      finding(r1Old!.id, 'CRITICAL'),
      finding(r1Old!.id, 'WARNING'),
      finding(r1New!.id, 'CRITICAL'),
      finding(r1New!.id, 'WARNING'),
      finding(r2!.id, 'WARNING'),
      // `severity` is a plain text column, so a stray value is storable — it must
      // land in no bucket rather than crashing or being guessed into one.
      finding(r2!.id, 'WEIRD'),
      // Belongs to the 'summary' review → excluded.
      finding(rSummary!.id, 'CRITICAL'),
    ]);

    // A second PR in the same repo, never reviewed: must report all-zero, not null.
    await db.insert(t.pullRequests).values({
      workspaceId,
      repoId: repo!.id,
      number: 4822,
      title: 'Never reviewed',
      author: 'dev',
      branch: 'feat/none',
      base: 'main',
      headSha: 'aggr0002',
      status: 'needs_review',
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const list = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    const row = list.json().find((p: { number: number }) => p.number === 4821);
    // LATEST-per-agent basis:
    expect(row.cost_usd).toBeCloseTo(0.017, 10); // 0.006 (a1 latest) + 0.011 (a2)
    expect(row.score).toBe(64); // min(88, 64), NOT a1's newer 88
    // ALL-runs basis — the two bases asserted side by side deliberately, because
    // the divergence is the design decision most likely to look like a bug later.
    expect(row.findings_by_severity).toEqual({
      CRITICAL: 2, // BOTH of a1's runs, superseded one included
      WARNING: 3, // a1 old + a1 new + a2 ('WEIRD' and the 'summary' row excluded)
      SUGGESTION: 0,
    });

    const unreviewed = list.json().find((p: { number: number }) => p.number === 4822);
    expect(unreviewed.findings_by_severity).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
    await app.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });
});
