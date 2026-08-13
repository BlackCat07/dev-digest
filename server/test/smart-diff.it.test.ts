import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, SEED_PR_FILES, SEED_PR_TOTALS } from '../src/db/seed.js';
import { MockLLMProvider, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * L03b — `GET /pulls/:id/smart-diff` over real rows.
 *
 * What only this suite can cover: that the module is registered at all (an absent
 * entry in `modules/index.ts` is a silent 404), that the route's body really
 * satisfies the `SmartDiff` contract at runtime — no route in this server declares
 * a `response:` schema, so nothing else checks it — and that the workspace scope
 * holds against a second workspace's PR.
 *
 * And the acceptance criterion no unit test can state: **no model request is made.**
 * Proved twice over, because each proof alone is weak. First by RECORDING: every
 * provider is a `MockLLMProvider`, which pushes onto `calls` for every
 * `listModels`/`complete`/`completeStructured`/`embed`, and all three must stay
 * empty — plus the `jobs` table must not grow, since `JobRunner.enqueue` inserts a
 * row before queueing and a smuggled background derivation would show up there.
 * Then by IMPOSSIBILITY: the same request is repeated against an app built with no
 * `llm` override at all, where a real provider cannot even be constructed, and it
 * must return byte-identical output.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' });

/** The two findings `seed.ts` writes, and the lines they must land on. */
const SEEDED_OVERLAY = [
  { path: 'src/config.ts', lines: [12] },
  { path: 'src/api/users.ts', lines: [45] },
];

d('L03b smart-diff route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
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
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /** An app whose every LLM provider is a recording mock. */
  function appWithRecordingProviders() {
    const providers = {
      openai: new MockLLMProvider('openai'),
      anthropic: new MockLLMProvider('anthropic'),
      openrouter: new MockLLMProvider('openai'),
    };
    return {
      providers,
      app: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: { llm: providers, github: new MockGitHubClient() },
      }),
    };
  }

  async function getSmartDiff(id = prId) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    try {
      return await app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });
    } finally {
      await app.close();
    }
  }

  it('answers the contract for the seeded PR', async () => {
    const res = await getSmartDiff();
    expect(res.statusCode).toBe(200);
    // The runtime contract check that stands in for the serializer this codebase
    // does not use. A cast-not-parsed response has reached the client as `$NaN`
    // here before (server/INSIGHTS.md, 2026-08-02).
    expect(() => SmartDiff.parse(res.json())).not.toThrow();
  });

  it('groups every changed file, core first and boilerplate last', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups.flatMap((g) => g.files)).toHaveLength(SEED_PR_TOTALS.filesCount);
  });

  it('puts the lock file in boilerplate', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    const boilerplate = body.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files.map((f) => f.path)).toContain('package-lock.json');
  });

  it('reports each file with the same stats the PR row was built from', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    const byPath = new Map(body.groups.flatMap((g) => g.files).map((f) => [f.path, f]));
    for (const seeded of SEED_PR_FILES) {
      expect(byPath.get(seeded.path), seeded.path).toMatchObject({
        additions: seeded.additions,
        deletions: seeded.deletions,
      });
    }
  });

  /**
   * The join, end to end, over the seeded review — which carries `agent_id: null`.
   * Without the row-id fallback key in `latestFindingsPerAgent` this returns no
   * overlay at all, so a fresh install would show the feature working and no badges.
   */
  it.each(SEEDED_OVERLAY)('overlays the seeded findings onto $path', async ({ path, lines }) => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    const file = body.groups.flatMap((g) => g.files).find((f) => f.path === path);
    expect(file, `${path} missing from the response`).toBeDefined();
    expect(file!.finding_lines).toEqual(lines);
  });

  it('leaves every other file overlay-free', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    const flagged = SEEDED_OVERLAY.map((f) => f.path);
    for (const file of body.groups.flatMap((g) => g.files)) {
      if (flagged.includes(file.path)) continue;
      expect(file.finding_lines, file.path).toEqual([]);
    }
  });

  it('quotes a summary out of the stored patch', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    const file = body.groups
      .flatMap((g) => g.files)
      .find((f) => f.path === 'src/middleware/ratelimit.ts')!;
    expect(file.pseudocode_summary).toBe('bucketKey, rateLimit');
  });

  it('does not suggest splitting a PR this size', async () => {
    const body = SmartDiff.parse((await getSmartDiff()).json());
    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: SEED_PR_TOTALS.additions + SEED_PR_TOTALS.deletions,
      proposed_splits: [],
    });
  });

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
        name: 'private-api',
        fullName: 'acme/private-api',
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

    const res = await getSmartDiff(pr!.id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers 200 with empty groups for a PR whose files were never imported', async () => {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `unopened-${Date.now()}`,
        fullName: `acme/unopened-${Date.now()}`,
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

    const res = await getSmartDiff(pr!.id);
    expect(res.statusCode).toBe(200);
    // Not a 404: the PR exists, there is simply no material yet. A 404 here would
    // break the tab for every PR nobody has opened.
    expect(res.json()).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
  });

  // The 422 needs no database — validation runs before the handler — so it lives
  // in `routes-smoke.test.ts`, in the hermetic lane that CI runs without Docker.

  describe('makes no model request', () => {
    it('records no provider call and enqueues no job', async () => {
      const jobsBefore = (await pg.handle.db.select().from(t.jobs)).length;

      const { app: appPromise, providers } = appWithRecordingProviders();
      const app = await appPromise;
      try {
        const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }

      for (const [id, provider] of Object.entries(providers)) {
        expect(provider.calls, `${id} was called`).toEqual([]);
      }

      const jobsAfter = (await pg.handle.db.select().from(t.jobs)).length;
      expect(jobsAfter, 'a job row appeared').toBe(jobsBefore);
    });

    it('returns the same answer with no provider configured at all', async () => {
      // The impossibility half: with no `llm` override a real provider would have
      // to be constructed from a key that is not there. Identical output means
      // nothing on this path ever reaches for one.
      const withMocks = await (async () => {
        const { app: appPromise } = appWithRecordingProviders();
        const app = await appPromise;
        try {
          const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
          return SmartDiff.parse(res.json());
        } finally {
          await app.close();
        }
      })();

      const withoutProviders = SmartDiff.parse((await getSmartDiff()).json());
      expect(withoutProviders).toEqual(withMocks);
    });
  });
});
