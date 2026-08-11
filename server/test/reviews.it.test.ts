import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
} from '../src/adapters/mocks.js';
import { INTENT_SCHEMA_NAME } from '../src/modules/intent/constants.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { ChatMessage, Review, StructuredRequest } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/**
 * L03 — what the intent classifier answers. Keyed on `INTENT_SCHEMA_NAME`
 * wherever it is injected, never on the generic `structured` fixture.
 */
const INTENT_FIXTURE = {
  intent: 'Add a token-bucket rate limiter in front of the public API.',
  in_scope: ['Rate limiting middleware', 'Public API routes'],
  out_of_scope: ['Authentication', 'Secret management'],
  missing_context: ['No design document is linked.'],
  // Empty on purpose: this suite is about scope labelling, not risk areas, and an
  // empty list is a legitimate classifier answer.
  risk_areas: [],
  confidence: 0.8,
};

/**
 * A review whose model deliberately labels BOTH findings out of scope, so one
 * test covers the label surviving the DB round-trip and the deterministic floor
 * overruling the model on the CRITICAL one. Both sit on line 11, the only line
 * `DIFF` adds, so grounding keeps both and the scope column is what differs.
 */
const SCOPED_REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'A secret and a drive-by rename.',
  score: 40,
  findings: [
    {
      id: 'f-critical',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
      // The model is WRONG here, and no filter may ever hide a CRITICAL.
      scope: 'out_of_scope',
    },
    {
      id: 'f-drive-by',
      severity: 'WARNING',
      category: 'style',
      title: 'Drive-by rename unrelated to rate limiting',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Renaming this field is not part of the stated intent.',
      confidence: 0.6,
      kind: 'finding',
      scope: 'out_of_scope',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  /**
   * Build the app with EVERY provider a review reaches faked — the agent's own
   * and the intent classifier's.
   *
   * The second one is not optional and its absence was a live-billing bug. L03
   * routes the classifier through
   * `resolveFeatureModel(root, workspaceId, 'review_intent')`, whose registry
   * default is now `openrouter/deepseek-v4-flash`, and NOT through the agent
   * under test. `Container.llm` keys its test seam per provider id
   * (`this.overrides.llm?.[id]`), so injecting only `{ openai: … }` left
   * `openrouter` falling through to a real `OpenRouterProvider` built from
   * `OPENROUTER_API_KEY`: on a machine that has one, every
   * `POST /pulls/:id/review` issued a real, billed HTTPS request; on CI, which
   * has none, the same call took the `ConfigError` path instead. The two
   * environments ran different code, and the local one also overran
   * `waitForPrRuns`' 10s budget — which returns non-terminal rows rather than
   * failing, so the symptom surfaced as a null `cost_usd` and a missing trace.
   *
   * The fixture MUST be keyed on `INTENT_SCHEMA_NAME`:
   * `MockLLMProvider.structuredBySchema` looks fixtures up by `schemaName` and
   * silently falls back to the generic `structured` one, which would then fail
   * `IntentClassification`'s parse instead of failing loudly here.
   *
   * `github` is injected for the same class of reason: the PR body below says
   * "Closes #471", so `collectSources` dereferences a same-repo issue and would
   * otherwise reach api.github.com with whatever real token the machine has.
   */
  async function appWithMocks(
    structured: unknown,
    provider: 'openai' | 'anthropic' = 'openai',
    opts: { intent?: unknown } = {},
  ) {
    const reviewLlm = new MockLLMProvider(provider, { structured });
    // The mock's own `id` is cosmetic — what resolves it is the key it is
    // injected under, which is the id `resolveFeatureModel` returns.
    const intentLlm = new MockLLMProvider('openai', {
      structuredBySchema: { [INTENT_SCHEMA_NAME]: opts.intent ?? INTENT_FIXTURE },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { [provider]: reviewLlm, openrouter: intentLlm },
      },
    });
    return { app, reviewLlm, intentLlm };
  }

  async function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return (await appWithMocks(structured, provider)).app;
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    const agentRuns = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    // Cost survives the whole write path: MockLLMProvider reports costUsd 0.001
    // per call and a single-pass review makes exactly one call.
    expect(agentRuns[0]!.costUsd).toBe(0.001);

    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.stats.cost_usd).toBe(0.001);
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  /**
   * L02 — a run carries its agent's enabled skills all the way into the
   * persisted trace, and records what it carried.
   *
   * This is the one link the unit tests cannot cover: reviewer-core proves
   * `assemblePrompt` renders the slot, and `skills.it.test.ts` proves the service
   * resolves the right bodies, but only a full run proves the executor actually
   * passes one to the other and writes `run_skills`.
   */
  it('injects an agent’s enabled skills into the prompt and records them on the run', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skilled', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    const first = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'first-rule', type: 'rubric', body: 'FIRST RULE BODY' },
      })
    ).json();
    const second = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'second-rule', type: 'custom', body: 'SECOND RULE BODY' },
      })
    ).json();
    // Linked but switched off — must reach neither the prompt nor run_skills.
    const off = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'off-rule', type: 'custom', body: 'OFF RULE BODY', enabled: false },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [second.id, first.id, off.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // The block exists, holds both enabled bodies, and holds them in LINK order
    // (second, then first) — not creation order, not alphabetical.
    expect(trace.prompt_assembly.skills).toBe('SECOND RULE BODY\n\nFIRST RULE BODY');
    expect(trace.prompt_assembly.skills).not.toContain('OFF RULE BODY');
    // And it reached the actual user message, ahead of the diff.
    const user = trace.prompt_assembly.user as string;
    expect(user).toContain('## Skills / rules');
    expect(user.indexOf('SECOND RULE BODY')).toBeLessThan(user.indexOf('## Diff to review'));

    // run_skills records exactly what was carried, with the version used.
    const carried = await pg.handle.db
      .select()
      .from(t.runSkills)
      .where(eq(t.runSkills.runId, runId));
    expect(carried.map((r) => r.skillId).sort()).toEqual([first.id, second.id].sort());
    expect(carried.every((r) => r.version === 1)).toBe(true);

    await app.close();
  });

  /** The other half: no skills ⇒ the section is absent, not empty. */
  it('omits the skills block entirely for an agent with none', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Bare', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Skills / rules');

    const carried = await pg.handle.db
      .select()
      .from(t.runSkills)
      .where(eq(t.runSkills.runId, runId));
    expect(carried).toHaveLength(0);

    await app.close();
  });

  // ---- L03: the Intent Layer, seen from a real run -------------------------

  /**
   * R10 + R9 — `scope` survives `insertFindings` → `reviewsForPull`, and the
   * deterministic floor overrules the model on a CRITICAL.
   *
   * Only a full run can show this: `reviewer-core` proves `applyScopeGuard`
   * relabels, and the repository proves it writes a column, but nothing else
   * proves the executor carries the guard's output into `insertFindings` rather
   * than the model's raw findings — a plausible bug that leaves both unit
   * suites green and silently persists the model's `out_of_scope` on a CRITICAL.
   */
  it('persists each finding’s scope, with CRITICAL forced in_scope whatever the model said', async () => {
    const app = await appWith(SCOPED_REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Scoped', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const scopeByTitle = Object.fromEntries(
      reviews[0].findings.map((f: { title: string; scope: string | null }) => [f.title, f.scope]),
    );
    expect(scopeByTitle).toEqual({
      // The floor owns this one: the model labelled it out of scope and lost.
      'Hardcoded Stripe secret key': 'in_scope',
      // And a real out-of-scope label is not quietly normalised away.
      'Drive-by rename unrelated to rate limiting': 'out_of_scope',
    });

    await app.close();
  });

  /**
   * R18 — the run's TWO model calls are both visible in one trace, in order,
   * and the intent reached the prompt.
   *
   * `tool_calls[0]` is the contract the Live Log and the trace viewer read: the
   * derivation leads, the per-file review calls follow.
   */
  it('leads the trace with derive_intent and injects the intent into the prompt', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Intentful', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    const runId = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.tool_calls[0].tool).toBe('derive_intent');
    expect(trace.tool_calls.length).toBeGreaterThan(1);
    // Everything after it is the review itself — the derivation is not repeated
    // per file and does not trail the review calls.
    expect(trace.tool_calls.slice(1).map((c: { tool: string }) => c.tool)).toEqual(
      trace.tool_calls.slice(1).map(() => 'review_file'),
    );

    expect(trace.prompt_assembly.intent).not.toBeNull();
    expect(trace.prompt_assembly.intent).toContain(INTENT_FIXTURE.intent);
    const user = trace.prompt_assembly.user as string;
    expect(user).toContain('## Stated intent and scope');
    expect(user.indexOf('## Stated intent and scope')).toBeLessThan(user.indexOf('## Diff to review'));

    await app.close();
  });

  /**
   * The other half, and the one the feature's own rule turns on: a review whose
   * intent derivation FAILS still completes. A missing intent is a worse review,
   * never a broken one — so the run reaches `done`, the prompt omits the slot
   * entirely, and the failure is recorded on the `pr_intent` row instead.
   */
  it('completes a run whose intent derivation failed, with no intent slot in the prompt', async () => {
    // A fixture that cannot satisfy `IntentClassification`, so the classifier
    // call throws exactly where a real malformed answer would.
    const { app } = await appWithMocks(REVIEW_FIXTURE, 'openai', { intent: { nonsense: true } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'NoIntent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    const runId = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.intent).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Stated intent and scope');
    expect(trace.tool_calls[0].tool).toBe('review_file');

    // The failure is recorded where the card reads it, not swallowed.
    const [row] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBeTruthy();

    // And nothing was labelled: the scope guard runs only with an intent.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews[0].findings.every((f: { scope: string | null }) => f.scope === null)).toBe(true);

    await app.close();
  });

  /**
   * R2, the acceptance item — «у його запиті немає повних тіл змін».
   *
   * The classifier gets paths, counts and `@@` headers; it never gets a diff
   * body. Asserted over the messages `MockLLMProvider` recorded, because that is
   * the only place the REQUEST is visible — the audit trail on `pr_intent` says
   * what we meant to send, not what we sent.
   *
   * The system message is excluded on purpose: it is our own markdown and its
   * bullets legitimately start with `-`. The user message is the one carrying
   * repository-derived material, and it is the one under the rule.
   */
  it('sends the classifier hunk headers and no diff body line', async () => {
    const { app, intentLlm } = await appWithMocks(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Auditor', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const call = intentLlm.calls.find(
      (c) =>
        c.method === 'completeStructured' &&
        (c.req as StructuredRequest<unknown>).schemaName === INTENT_SCHEMA_NAME,
    );
    expect(call).toBeDefined();
    const messages = (call!.req as StructuredRequest<unknown>).messages as ChatMessage[];
    const userText = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    // It DID get the headers — otherwise "no diff body" would pass on an empty
    // prompt, which is the way this assertion fails open.
    expect(userText).toContain('@@ -10,3 +10,4 @@');
    expect(userText).toContain('src/config.ts');

    // …and nothing else from the patch. `+++`/`---` are file markers, not content.
    const bodyLines = userText
      .split('\n')
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
    expect(bodyLines).toEqual([]);
    // The line the diff actually adds, named explicitly.
    expect(userText).not.toContain('sk_live_xxx');

    await app.close();
  });
});
