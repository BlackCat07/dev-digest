import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import {
  INTENT_JOB_KIND,
  INTENT_SCHEMA_NAME,
  INTENT_STALE_AFTER_MS,
} from '../src/modules/intent/constants.js';
import * as t from '../src/db/schema.js';

/**
 * L03 — the Intent Layer through its two routes, a real Postgres and a faked
 * model.
 *
 * What earns the container: every rule here is a decision made BETWEEN a model
 * answer and a database row, or between a row and an HTTP status. A PR resolved
 * in the wrong workspace, a `running` row that can never age out, a provider
 * error that escapes instead of landing on the row — none of them are visible
 * in a unit test of the pieces, because each piece is correct on its own.
 *
 * NO LIVE MODEL CALL IS POSSIBLE HERE. `review_intent` resolves to
 * `openrouter/deepseek-v4-flash` through `resolveFeatureModel`, so every app
 * below either injects an `openrouter` provider or injects an empty
 * `SecretsProvider` so the resolve fails deterministically. Nothing falls
 * through to a real `OpenRouterProvider`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** What the classifier answers. Keyed on the schema name, never on `structured`. */
const INTENT_FIXTURE = {
  intent: 'Add a token-bucket rate limiter in front of the public API.',
  in_scope: ['Rate limiting middleware', 'Public API routes'],
  out_of_scope: ['Authentication changes'],
  missing_context: ['No design document is linked.'],
  // Two risks on purpose, and the second one is the point: `src/config.ts` IS the
  // file this test seeds into `pr_files`, while `src/not/real.ts` is not. The
  // grounding gate must store the first and drop the second, so this fixture
  // exercises `groundRiskAreas` through the real derive path rather than only in
  // its own unit test.
  risk_areas: [
    {
      kind: 'security' as const,
      title: 'Public surface gains a gate',
      explanation: 'The limiter decides who reaches the public API.',
      severity: 'high' as const,
      file_refs: ['src/config.ts'],
    },
    {
      kind: 'perf' as const,
      title: 'Invented citation',
      explanation: 'Cites a file this PR never touched.',
      severity: 'low' as const,
      file_refs: ['src/not/real.ts'],
    },
  ],
  confidence: 0.8,
};

const PATCH = '@@ -10,3 +10,4 @@ export function loadConfig() {\n   port: 3000,\n+  limit: 100,';

d('L03 intent routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** An app whose classifier answers from a fixture and whose GitHub is faked. */
  async function appWithIntent(intent: unknown = INTENT_FIXTURE) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { [INTENT_SCHEMA_NAME]: intent },
          }),
        },
      },
    });
  }

  /**
   * An app with NO secrets and NO injected provider — the shape a workspace that
   * has configured no LLM key really has. `container.llm('openrouter')` then
   * throws `ConfigError` before any network client is constructed.
   */
  async function appWithNoKeys() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
      },
    });
  }

  let prSeq = 0;
  async function setupPr(
    ws: string,
    opts: { body?: string | null; withPatch?: boolean } = {},
  ) {
    const name = `intent-repo-${prSeq}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 900 + prSeq++,
        title: 'Add rate limiting to the public API',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'head-sha-1',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: opts.body === undefined ? 'Adds a token bucket limiter to the public API.' : opts.body,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: opts.withPatch === false ? null : PATCH,
    });
    return { repo: repo!, pr: pr! };
  }

  it('derives an intent on POST and serves the identical record on GET', async () => {
    const app = await appWithIntent();
    const { pr } = await setupPr(workspaceId);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(posted.statusCode).toBe(200);
    const derived = posted.json();

    expect(derived.status).toBe('ok');
    expect(derived.intent).toBe(INTENT_FIXTURE.intent);
    expect(derived.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    // Derived against the current head, which is what makes staleness readable.
    expect(derived.head_sha).toBe(pr.headSha);
    // R13 — the classifier's provider comes from the feature registry, not from
    // any agent, and its default is the OpenRouter flash model.
    expect(derived.provider).toBe('openrouter');
    expect(derived.model).toBeTruthy();
    // The derivation's receipt, straight off the (mocked) call.
    expect(derived.tokens_in).toBe(100);
    expect(derived.cost_usd).toBe(0.001);
    expect(derived.derived_at).not.toBeNull();
    // Sources are RECORDED, not implied: this PR offers exactly these three.
    expect(derived.sources.map((s: { kind: string }) => s.kind).sort()).toEqual([
      'file_list',
      'hunk_headers',
      'pr_body',
      'pr_title',
    ].sort());

    const fetched = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(fetched.statusCode).toBe(200);
    // Round-trip through jsonb and back: byte-for-byte the same record.
    expect(fetched.json()).toEqual(derived);

    await app.close();
  });

  /**
   * The IDOR defence. `pr_intent` carries no `workspace_id` of its own — its PK
   * FKs to the already-scoped `pull_requests` — so the ONLY thing standing
   * between a guessed PR id and another tenant's intent is that both routes
   * resolve the PR through `getPull(workspaceId, prId)` first. A read that
   * skipped that lookup would still return the row and every other test here
   * would stay green.
   */
  it('answers 404, not the intent, for a PR in another workspace', async () => {
    const app = await appWithIntent();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `tenant-${prSeq}` })
      .returning();
    const { pr } = await setupPr(other!.id);

    // Give the other tenant a real, populated intent row, so a leak would be a
    // leak of something rather than of `null`.
    await pg.handle.db.insert(t.prIntent).values({
      prId: pr.id,
      intent: 'TENANT B SECRET INTENT',
      headSha: pr.headSha,
      confidence: 0.5,
      status: 'ok',
    });

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(read.statusCode).toBe(404);
    expect(read.payload).not.toContain('TENANT B SECRET INTENT');

    const derive = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(derive.statusCode).toBe(404);

    await app.close();
  });

  /**
   * A workspace with no LLM key configured. `derive` records the failure on the
   * row and RETURNS NORMALLY — it does not throw — which is what stops
   * `JobRunner` retrying three times per PR forever on such a workspace.
   */
  it('records a ConfigError on the row, and the derivation job still resolves', async () => {
    const app = await appWithNoKeys();
    const { pr } = await setupPr(workspaceId);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(posted.statusCode).toBe(200);
    const failed = posted.json();
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('OPENROUTER_API_KEY is not configured');
    // The row exists precisely so the card can say what went wrong.
    expect(failed.intent).toBeNull();

    // The same failure through the background path: `done` RESOLVES. If `derive`
    // threw instead of recording, this would reject after three attempts.
    const job = await app.container.jobs.enqueue(workspaceId, INTENT_JOB_KIND, {
      workspaceId,
      prId: pr.id,
    });
    let rejection: unknown;
    await job.done.catch((err: unknown) => {
      rejection = err;
    });
    expect(rejection).toBeUndefined();

    const [row] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(row!.status).toBe('failed');

    await app.close();
  });

  /**
   * A process that dies mid-derivation leaves its row `running`, and treating
   * that as in flight forever bricks the PR — nothing in the UI can clear it.
   * Both halves are asserted, because a staleness window that is always open is
   * the same bug seen from the other side (a second derivation trampling a live
   * one).
   */
  it('re-derives a running row older than the staleness window, and leaves a fresh one alone', async () => {
    const app = await appWithIntent();

    const stale = await setupPr(workspaceId);
    await pg.handle.db.insert(t.prIntent).values({
      prId: stale.pr.id,
      headSha: stale.pr.headSha,
      status: 'running',
      derivedAt: new Date(Date.now() - INTENT_STALE_AFTER_MS - 60_000),
    });
    const revived = (
      await app.inject({ method: 'POST', url: `/pulls/${stale.pr.id}/intent` })
    ).json();
    expect(revived.status).toBe('ok');
    expect(revived.intent).toBe(INTENT_FIXTURE.intent);

    const fresh = await setupPr(workspaceId);
    await pg.handle.db.insert(t.prIntent).values({
      prId: fresh.pr.id,
      headSha: fresh.pr.headSha,
      status: 'running',
      derivedAt: new Date(),
    });
    const untouched = (
      await app.inject({ method: 'POST', url: `/pulls/${fresh.pr.id}/intent` })
    ).json();
    // A derivation is genuinely in flight: the stored row comes back as it is,
    // and no second classifier call is started.
    expect(untouched.status).toBe('running');
    expect(untouched.intent).toBeNull();

    await app.close();
  });

  /**
   * R14 — the degradation ladder's bottom rung. A PR with no description is the
   * NORMAL case, not an error case: the classifier still runs from the title,
   * the file list and the hunk headers, still fills the card, and lands at a
   * strictly lower confidence with `missing_context` saying why.
   */
  it('still derives an intent for a PR with no description, at a lower confidence', async () => {
    const app = await appWithIntent();
    const described = await setupPr(workspaceId);
    const bare = await setupPr(workspaceId, { body: null });

    const withBody = (
      await app.inject({ method: 'POST', url: `/pulls/${described.pr.id}/intent` })
    ).json();
    const withoutBody = (
      await app.inject({ method: 'POST', url: `/pulls/${bare.pr.id}/intent` })
    ).json();

    // An intent, not an error, and not an empty one.
    expect(withoutBody.status).toBe('ok');
    expect(withoutBody.intent).toBe(INTENT_FIXTURE.intent);
    // Strictly lower, with the same self-report — this is the ordering R14 asks
    // for and the first implementation of `deriveConfidence` falsified.
    expect(withoutBody.confidence).toBeLessThan(withBody.confidence);
    // And the gap is stated rather than papered over.
    expect(withoutBody.missing_context).toContain('The pull request has no description.');
    expect(withoutBody.sources.map((s: { kind: string }) => s.kind)).not.toContain('pr_body');

    await app.close();
  });
});
