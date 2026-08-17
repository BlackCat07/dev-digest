import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq, ne } from 'drizzle-orm';
import { PrPriorPrs } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * L04 — `GET /pulls/:id/prior-prs` over real rows.
 *
 * What only this suite can cover: that the module is registered at all (a missing
 * entry in `modules/index.ts` is a silent 404), that the body really satisfies
 * `PrPriorPrs` at runtime — no route in this server declares a `response:` schema,
 * so nothing else checks it — that the SQL half of the feature works (the join, the
 * `ne` that keeps a pull request out of its own history, and the two coverage
 * aggregates), and that the workspace scope holds.
 *
 * The coverage story is the reason this file is worth its Docker: `status` is
 * computed from counts of rows the service never sees, so a hermetic test can only
 * assert the mapping, not that the counts are the right counts.
 *
 * Also proved here, the way `blast.it.test.ts` proves it: **no model request is
 * made** — by RECORDING (every provider is a `MockLLMProvider` whose `calls` must
 * stay empty, and the `jobs` table must not grow) and by IMPOSSIBILITY (the same
 * request against an app built with no `llm` override at all answers identically).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' });

/** A file the seeded PR #482 changes — the overlap every case below is built on. */
const SHARED = 'src/middleware/ratelimit.ts';
/** A file no seeded PR touches, for the "touched nothing in common" case. */
const UNRELATED = 'docs/adr/0007-queues.md';

d('L04 prior-prs route (Testcontainers pg)', () => {
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

  /** Every case builds its own history; none inherits the previous one's rows. */
  beforeEach(async () => {
    await pg.handle.db
      .delete(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), ne(t.pullRequests.id, prId)));
  });

  /** An earlier pull request, with or without an imported file list. */
  async function addPull(
    number: number,
    files: readonly string[],
    updatedAt: Date | null,
  ): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number,
        title: `Earlier work ${number}`,
        author: 'hubot',
        branch: `feat/${number}`,
        base: 'main',
        headSha: `sha${number}`,
        updatedAt,
      })
      .returning();
    if (files.length > 0) {
      await pg.handle.db
        .insert(t.prFiles)
        .values(files.map((path) => ({ prId: row!.id, path })));
    }
    return row!.id;
  }

  async function get(id = prId) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    try {
      return await app.inject({ method: 'GET', url: `/pulls/${id}/prior-prs` });
    } finally {
      await app.close();
    }
  }

  it('is registered, and answers the published contract', async () => {
    await addPull(300, [SHARED, UNRELATED], new Date('2026-08-01T00:00:00Z'));

    const res = await get();

    expect(res.statusCode).toBe(200);
    const body = PrPriorPrs.parse(res.json());
    expect(body.pr_id).toBe(prId);
    expect(body.prs.map((p) => p.number)).toEqual([300]);
    expect(body.status).toBe('ok');
    expect(body.reason).toBeNull();
  });

  it('reports the overlap, not the other PR’s whole file list', async () => {
    await addPull(300, [SHARED, UNRELATED], new Date('2026-08-01T00:00:00Z'));

    const [row] = PrPriorPrs.parse((await get()).json()).prs;

    expect(row?.shared_files).toEqual([SHARED]);
    expect(row?.shared_file_count).toBe(1);
  });

  it('never lists the pull request in its own history', async () => {
    await addPull(300, [SHARED], new Date('2026-08-01T00:00:00Z'));

    const body = PrPriorPrs.parse((await get()).json());

    expect(body.prs.map((p) => p.id)).not.toContain(prId);
  });

  it('leaves out a pull request that shares no file', async () => {
    await addPull(300, [UNRELATED], new Date('2026-08-01T00:00:00Z'));

    const body = PrPriorPrs.parse((await get()).json());

    // Coverage is full, so the empty answer is a finding and says so.
    expect(body.prs).toEqual([]);
    expect(body.status).toBe('ok');
    expect(body.reason).toBeNull();
  });

  it('orders the real rows newest first', async () => {
    await addPull(300, [SHARED], new Date('2026-06-01T00:00:00Z'));
    await addPull(301, [SHARED], new Date('2026-08-09T00:00:00Z'));
    await addPull(302, [SHARED], new Date('2026-07-04T00:00:00Z'));

    const body = PrPriorPrs.parse((await get()).json());

    expect(body.prs.map((p) => p.number)).toEqual([301, 302, 300]);
  });

  it('counts coverage over real rows, and degrades to partial when a file list is missing', async () => {
    await addPull(300, [SHARED], new Date('2026-08-01T00:00:00Z'));
    // Imported into DevDigest but never opened, so it has no `pr_files` rows —
    // the state a fresh workspace is almost entirely in.
    await addPull(301, [], new Date('2026-08-02T00:00:00Z'));

    const body = PrPriorPrs.parse((await get()).json());

    expect(body.coverage).toEqual({ with_file_lists: 2, total: 3 });
    expect(body.status).toBe('partial');
    expect(body.reason).toBe('incomplete_file_lists');
    expect(body.prs.map((p) => p.number)).toEqual([300]);
  });

  it('degrades when no other pull request has an imported file list', async () => {
    await addPull(300, [], new Date('2026-08-01T00:00:00Z'));

    const body = PrPriorPrs.parse((await get()).json());

    expect(body.prs).toEqual([]);
    expect(body.status).toBe('degraded');
    expect(body.reason).toBe('no_file_lists');
  });

  it('404s for a pull request in another workspace', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'repo',
        fullName: 'other/repo',
        defaultBranch: 'main',
      })
      .returning();
    const [otherPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Not yours',
        author: 'nobody',
        branch: 'x',
        base: 'main',
        headSha: 'sha',
      })
      .returning();

    const res = await get(otherPr!.id);

    expect(res.statusCode).toBe(404);
  });

  it('makes no model call and queues no job', async () => {
    await addPull(300, [SHARED], new Date('2026-08-01T00:00:00Z'));

    const providers = {
      openai: new MockLLMProvider('openai'),
      anthropic: new MockLLMProvider('anthropic'),
      openrouter: new MockLLMProvider('openai'),
    };
    // `JobRunner.enqueue` inserts a row before queueing, so the table not growing
    // is what proves nothing was scheduled to happen later either.
    const jobsBefore = (await pg.handle.db.select().from(t.jobs)).length;

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient(), llm: providers },
    });
    let recorded: unknown;
    try {
      recorded = (await app.inject({ method: 'GET', url: `/pulls/${prId}/prior-prs` })).json();
    } finally {
      await app.close();
    }

    for (const [id, provider] of Object.entries(providers)) {
      expect(provider.calls, `${id} was called`).toEqual([]);
    }
    expect((await pg.handle.db.select().from(t.jobs)).length).toBe(jobsBefore);

    // ...and by impossibility: with no `llm` override at all, the same answer.
    expect(recorded).toEqual(PrPriorPrs.parse((await get()).json()));
  });
});
