import { describe, it, expect } from 'vitest';
import type { AuthProvider } from '@devdigest/shared';
import { MultiAgentRun } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { ReviewService, MAX_MULTI_AGENT_RUN_AGENTS } from '../src/modules/reviews/service.js';
import type { MultiRunRecorder } from '../src/modules/reviews/service.js';
import type { ReviewRepository, PullRow } from '../src/modules/reviews/repository.js';
import type { Container } from '../src/platform/container.js';
import type { AgentRow } from '../src/db/rows.js';
import type * as schema from '../src/db/schema.js';
import { RunBus } from '../src/platform/sse.js';

/**
 * T10 — the create path: `agentIds` on `POST /pulls/:id/review`, and the
 * dedicated `POST /pulls/:id/multi-agent-run`.
 *
 * **Every refusal is asserted twice: the status code, AND that no run was
 * created.** A `400` that has already written four `agent_runs` rows is not a
 * refusal, it is a failure with a polite message — and the rows it leaves behind
 * are what the results screen reads back as "the pull request's most recent
 * fan-out". Hence `created` below: the fake repository records every insert, and
 * the refusal cases assert it is still empty.
 *
 * HERMETIC, per `DDG-TEST-001` — no Postgres, so no `.it.` in the filename (the
 * two CI workflows filter on exactly that substring). Two seams, used for two
 * different questions:
 *
 *  - **the SERVICE, over a fake `Container`** — for everything about what gets
 *    written: which agents resolve, how many rows appear, which multi-run they
 *    are stamped with, and what the initial payload says. This is the shape
 *    `project-context-run.test.ts` already uses on the executor.
 *  - **the ROUTE, through `buildApp`** — for the handful of rules that are
 *    genuinely about transport: which bodies the two schemas reject before a
 *    handler runs, which refusals are the SERVICE's named ones rather than the
 *    validator's anonymous `422`, and the per-route rate limit. Every route case
 *    below refuses before the first repository call, which is what lets it run
 *    against a real container with no database behind it.
 *
 * The one thing neither seam can see is `ReviewRunResponse`'s doc-comment, which
 * claims the run is synchronous and that the persisted reviews come back with
 * it. Both claims are false — `runReview` fires the executor with `void` and
 * returns immediately, so `reviews` is always `[]` — and the file is
 * do-not-touch, so the comment stays wrong. Nothing here waits for a review.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const PR = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';

/** One `agent_runs` row as the fake repository records it. */
interface CreatedRun {
  runId: string;
  agentId: string | null;
  prId: string;
  multiAgentRunId: string | null;
}

interface Harness {
  service: ReviewService;
  /** Every run the service asked for, in creation order. */
  created: CreatedRun[];
  /**
   * The parent records that still EXIST — `create` appends, and a successful
   * `discard` removes. So "no `multi_agent_runs` row survives" is one
   * assertion over this list rather than a claim about call order.
   */
  parents: string[];
  /** Every id `discard` was called with, in order. Empty on every happy path. */
  discarded: string[];
  /**
   * Make the Nth `createAgentRun` of the run throw (1-based), to fail a fan-out
   * partway through with the parent record already committed.
   */
  failCreateAgentRunAt: number | null;
  /** Make `discard` itself fail, so the cleanup cannot mask the real error. */
  discardFails: boolean;
  /** What `latestForPull` answers, and whether it still has a run in flight. */
  previous: { id: string; running: boolean } | null;
  /** Set to make the pull-request lookup miss. */
  pull: PullRow | null;
}

function agent(id: string, name: string, enabled = true): AgentRow {
  return {
    id,
    name,
    provider: 'openrouter',
    model: 'gpt-4.1',
    enabled,
  } as unknown as AgentRow;
}

/** Five agents, one of them disabled — the workspace every case runs against. */
const AGENTS = [
  agent('agent-1', 'Security Reviewer'),
  agent('agent-2', 'Performance Reviewer'),
  agent('agent-3', 'Style Reviewer'),
  agent('agent-4', 'Docs Reviewer', false),
  agent('agent-5', 'Test Reviewer'),
];

const PULL = {
  id: PR,
  repoId: 'repo-1',
  number: 482,
  base: 'main',
  headSha: 'head-sha',
} as unknown as PullRow;

/**
 * The service over fakes.
 *
 * The background execution is deliberately made to die at its first step: the
 * fake `getPrFiles` throws, so `loadDiff` fails, the executor's `failAll` marks
 * every queued run failed and returns. That path is `run-executor.ts`'s and is
 * covered by its own test; what matters here is that it cannot reach a provider,
 * cannot hang the suite, and cannot touch anything this file asserts on — the
 * rows were already created before it started, which is the whole point of
 * creating them up front.
 */
function harness(): Harness {
  const state: Harness = {
    service: null as unknown as ReviewService,
    created: [],
    parents: [],
    discarded: [],
    failCreateAgentRunAt: null,
    discardFails: false,
    previous: null,
    pull: PULL,
  };

  const repo = {
    getPull: async (_ws: string, _prId: string) => state.pull ?? undefined,
    getRepo: async () =>
      ({ id: 'repo-1', owner: 'acme', name: 'payments-api' }) as unknown as typeof schema.repos.$inferSelect,
    createAgentRun: async (values: {
      agentId: string | null;
      prId: string;
      multiAgentRunId?: string | null;
    }) => {
      if (state.failCreateAgentRunAt === state.created.length + 1) {
        throw new Error('createAgentRun failed for this agent');
      }
      const runId = `run-${state.created.length + 1}`;
      state.created.push({
        runId,
        agentId: values.agentId,
        prId: values.prId,
        multiAgentRunId: values.multiAgentRunId ?? null,
      });
      return runId;
    },
    hasRunningRunForMultiRun: async (_ws: string, id: string) =>
      state.previous !== null && state.previous.id === id && state.previous.running,
    // Kills the background execution at its first step; see the note above.
    getPrFiles: async () => {
      throw new Error('no diff in this test');
    },
    saveRunTrace: async () => undefined,
    completeAgentRun: async () => undefined,
  } as unknown as ReviewRepository;

  // A monotonic counter rather than `state.parents.length`, because a discarded
  // parent leaves that list and its id would otherwise be handed out twice.
  let parentSeq = 0;

  const recorder: MultiRunRecorder = {
    // AC-9 is decided HERE now, not by the service — the real recorder answers it
    // and the insert in one transaction, which is what stops two concurrent
    // callers both passing a guard the service used to hold open across three
    // awaits. `null` is the refusal the service turns into the 409.
    createIfIdle: async (_ws: string, _prId: string) => {
      if (state.previous?.running) return null;
      const id = `${PARENT.slice(0, -1)}${parentSeq}`;
      parentSeq += 1;
      state.parents.push(id);
      return { id, ranAt: new Date('2026-08-25T10:00:00.000Z') };
    },
    discard: async (_ws: string, id: string) => {
      state.discarded.push(id);
      // A failing delete leaves the row where it is, which is the state the
      // service has to survive without losing the original error.
      if (state.discardFails) throw new Error('discarding the parent failed too');
      const at = state.parents.indexOf(id);
      if (at !== -1) state.parents.splice(at, 1);
    },
  };

  const container = {
    db: {},
    reviewRepo: repo,
    agentsRepo: {
      getById: async (_ws: string, id: string) => AGENTS.find((a) => a.id === id),
      listEnabled: async () => AGENTS.filter((a) => a.enabled),
    },
    multiAgentRecorder: recorder,
    runBus: new RunBus(),
    intent: {
      derive: async () => {
        throw new Error('no intent in this test');
      },
    },
    git: {
      diff: async () => {
        throw new Error('no clone in this test');
      },
    },
  } as unknown as Container;

  state.service = new ReviewService(container);
  return state;
}

/** The error a refusal threw, as `{ code, statusCode }`. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string; statusCode: number }> {
  try {
    await run();
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    return { code: e.code ?? 'no-code', statusCode: e.statusCode ?? 0 };
  }
  throw new Error('expected a refusal, but the call succeeded');
}

// ===========================================================================
// The service: what a fan-out writes, and what every refusal does not
// ===========================================================================

describe('createMultiAgentRun', () => {
  it('creates exactly one run per listed agent, all stamped with one multi-run', async () => {
    const h = harness();
    const payload = await h.service.createMultiAgentRun(WS, PR, ['agent-2', 'agent-5']);

    // AC-1/AC-2: two ids, two runs, and none for any of the other three agents.
    expect(h.created).toHaveLength(2);
    expect(h.created.map((r) => r.agentId)).toEqual(['agent-2', 'agent-5']);
    expect(h.parents).toHaveLength(1);
    // Nothing failed, so the compensating delete never ran. Asserted here and
    // not only in the failure cases below: a discard on every path would leave
    // every one of those cases green.
    expect(h.discarded).toEqual([]);
    const parentId = h.parents[0]!;
    expect(h.created.every((r) => r.multiAgentRunId === parentId)).toBe(true);
    expect(h.created.every((r) => r.prId === PR)).toBe(true);

    // AC-7: the INITIAL state, and every column belongs to a run just created —
    // the hermetic form of "reading the multi-run back returns the run ids the
    // POST returned".
    const parsed = MultiAgentRun.parse(payload);
    expect(parsed.id).toBe(parentId);
    expect(parsed.pr_id).toBe(PR);
    expect(parsed.pr_number).toBe(482);
    expect(parsed.agent_count).toBe(2);
    expect(parsed.columns.map((c) => c.run_id)).toEqual(h.created.map((r) => r.runId));
    expect(parsed.columns.map((c) => c.status)).toEqual(['running', 'running']);
    expect(parsed.columns.map((c) => c.agent_name)).toEqual([
      'Performance Reviewer',
      'Test Reviewer',
    ]);
    // null, never 0: nothing has been recorded yet (AC-21, AC-22).
    expect(parsed.columns.every((c) => c.cost_usd === null && c.duration_ms === null)).toBe(true);
    expect(parsed.columns.every((c) => c.findings.length === 0)).toBe(true);
    expect(parsed.total_cost_usd).toBeNull();
    expect(parsed.total_duration_ms).toBe(0);
    expect(parsed.conflicts).toEqual([]);
  });

  it('runs a disabled agent that was named, and collapses a duplicated id to one run', async () => {
    const h = harness();
    // AC-5 — `agent-4` is disabled. Naming it explicitly is the same act as
    // `{agentId}`, which has never checked the flag either.
    // EC-1 — `agent-1` twice is one run, not two.
    const payload = await h.service.createMultiAgentRun(WS, PR, ['agent-4', 'agent-1', 'agent-1']);

    expect(h.created.map((r) => r.agentId)).toEqual(['agent-4', 'agent-1']);
    expect(payload.agent_count).toBe(2);
    expect(payload.columns).toHaveLength(2);
  });

  it('refuses the whole request when one id names no agent, creating nothing', async () => {
    const h = harness();
    // AC-4: not "run the ones that resolved" — a fan-out missing a column is
    // indistinguishable from one whose agent crashed.
    const err = await refusal(() =>
      h.service.createMultiAgentRun(WS, PR, ['agent-1', 'agent-nope']),
    );
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('not_found');
    expect(h.created).toEqual([]);
    expect(h.parents).toEqual([]);
  });

  it('refuses more than eight agents with a named 422 rather than truncating', async () => {
    const h = harness();
    const nine = Array.from({ length: 9 }, (_, i) => `agent-${i + 1}`);
    expect(nine.length).toBeGreaterThan(MAX_MULTI_AGENT_RUN_AGENTS);

    const err = await refusal(() => h.service.createMultiAgentRun(WS, PR, nine));
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('too_many_agents');
    // AC-8's real content: no truncation. Eight runs would be the "helpful" bug.
    expect(h.created).toEqual([]);
    expect(h.parents).toEqual([]);
  });

  it('refuses a second fan-out while the previous one still has a run in flight', async () => {
    const h = harness();
    const first = await h.service.createMultiAgentRun(WS, PR, ['agent-1', 'agent-2']);
    const createdByFirst = [...h.created];

    // The first multi-run is now the most recent one, and one of its runs is
    // still `running`.
    h.previous = { id: first.id, running: true };

    const err = await refusal(() => h.service.createMultiAgentRun(WS, PR, ['agent-3']));
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('multi_agent_run_in_flight');
    // AC-9: the first multi-run is untouched — no new parent, no new run, and
    // the rows it created are exactly the rows that are still there.
    expect(h.parents).toHaveLength(1);
    expect(h.created).toEqual(createdByFirst);

    // …and once it drains, the next fan-out is accepted.
    h.previous = { id: first.id, running: false };
    const second = await h.service.createMultiAgentRun(WS, PR, ['agent-3']);
    expect(second.id).not.toBe(first.id);
    expect(h.created).toHaveLength(3);
  });

  it('refuses a pull request that does not exist, creating nothing', async () => {
    const h = harness();
    h.pull = null;
    const err = await refusal(() => h.service.createMultiAgentRun(WS, PR, ['agent-1']));
    expect(err.statusCode).toBe(404);
    expect(h.created).toEqual([]);
    expect(h.parents).toEqual([]);
  });

  it('discards the parent when the fan-out fails partway, leaving no multi-run row', async () => {
    const h = harness();
    // The parent commits, the first run is created, and the second throws —
    // the one shape the ordered refusals above cannot prevent, because by then
    // every reason to refuse has already been checked.
    h.failCreateAgentRunAt = 2;

    await expect(
      h.service.createMultiAgentRun(WS, PR, ['agent-1', 'agent-2', 'agent-3']),
    ).rejects.toThrow('createAgentRun failed for this agent');

    // The point of the whole fix: nothing is left for the results screen to
    // read back as "the pull request's most recent fan-out".
    expect(h.parents).toEqual([]);
    expect(h.discarded).toHaveLength(1);

    // …and the documented residue, asserted rather than assumed. This is
    // compensation, not atomicity: the run that WAS created stays, and
    // `agent_runs.multi_agent_run_id` being `ON DELETE SET NULL` is what turns
    // it into an ordinary single-agent run instead of an orphan.
    expect(h.created.map((r) => r.agentId)).toEqual(['agent-1']);
    expect(h.discarded).toEqual([h.created[0]!.multiAgentRunId]);
  });

  it('surfaces the original error, not the cleanup, when the discard fails too', async () => {
    const h = harness();
    h.failCreateAgentRunAt = 1;
    h.discardFails = true;

    // The caller must be told what actually broke. A 500 naming the delete
    // sends whoever reads the log to the wrong table, and a rejection escaping
    // the cleanup unhandled has killed this API twice before.
    await expect(h.service.createMultiAgentRun(WS, PR, ['agent-1'])).rejects.toThrow(
      'createAgentRun failed for this agent',
    );

    expect(h.discarded).toHaveLength(1);
    expect(h.created).toEqual([]);
    // The delete failed, so the row really is still there — the service does
    // not pretend otherwise, it just does not let that failure win.
    expect(h.parents).toHaveLength(1);
  });
});

// ===========================================================================
// The service: `agentIds` on the review route, and AC-11's "exactly as today"
// ===========================================================================

describe('resolveTargets with agentIds', () => {
  it('refuses an empty list by name, creating nothing', async () => {
    const h = harness();
    // AC-3. Deliberately NOT a schema rejection: `ReviewRunRequest.agentIds`
    // carries no `.min(1)`, so this refusal reaches the caller with a name.
    const err = await refusal(() => h.service.resolveTargets(WS, { agentIds: [] }));
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('invalid_run_request');
    expect(h.created).toEqual([]);
  });

  it('refuses agentIds together with all, rather than picking one', async () => {
    const h = harness();
    // AC-6.
    const err = await refusal(() =>
      h.service.resolveTargets(WS, { agentIds: ['agent-1'], all: true }),
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('invalid_run_request');
    expect(h.created).toEqual([]);
  });

  it('resolves the listed agents in first-seen order, disabled ones included', async () => {
    const h = harness();
    const targets = await h.service.resolveTargets(WS, {
      agentIds: ['agent-4', 'agent-1', 'agent-4'],
    });
    expect(targets.map((a) => a.id)).toEqual(['agent-4', 'agent-1']);
  });
});

describe('runReview without agentIds (AC-11)', () => {
  it('{agentId} creates one unstamped run and no multi-run record', async () => {
    const h = harness();
    const targets = await h.service.resolveTargets(WS, { agentId: 'agent-3' });
    const { runs, reviews } = await h.service.runReview(WS, PR, targets);

    expect(runs.map((r) => r.agent_id)).toEqual(['agent-3']);
    // `reviews` is always empty — the executor runs in the background.
    expect(reviews).toEqual([]);
    expect(h.created.map((r) => r.multiAgentRunId)).toEqual([null]);
    expect(h.parents).toEqual([]);
  });

  it('{all:true} creates one unstamped run per ENABLED agent and no multi-run record', async () => {
    const h = harness();
    const targets = await h.service.resolveTargets(WS, { all: true });
    await h.service.runReview(WS, PR, targets);

    // `agent-4` is disabled, so `all` skips it — the one place the flag matters.
    expect(h.created.map((r) => r.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-5']);
    expect(h.created.every((r) => r.multiAgentRunId === null)).toBe(true);
    expect(h.parents).toEqual([]);
  });
});

// ===========================================================================
// The routes: which refusal comes from the schema, and which from the service
// ===========================================================================

const auth: AuthProvider = {
  currentUser: async () => ({ id: 'user-1', email: 'dev@local', name: 'Dev' }),
  currentWorkspace: async () => ({ id: WS, name: 'Local' }),
};

const testConfig = loadConfig({ ...process.env, NODE_ENV: 'test' });

/**
 * A real app over a real container with NO database.
 *
 * Every case below refuses before the first repository call — the validator, or
 * the service's own guard — so nothing here ever reaches postgres-js, which
 * connects lazily. The only fake is the `AuthProvider`, so `getContext` resolves
 * a workspace without one.
 */
const routeApp = () => buildApp({ config: testConfig, overrides: { auth } });

describe('POST /pulls/:id/review — the body schema and the named refusals', () => {
  it('422s a body whose shape is wrong, before the handler runs', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR}/review`,
      payload: { agentIds: 'agent-1' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('400s an EMPTY agentIds with the service name, not the validator 422', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR}/review`,
      payload: { agentIds: [] },
    });
    // The distinction this whole test file exists to protect: a `.min(1)` on
    // `ReviewRunRequest` would make this an anonymous 422 that never reaches the
    // handler, and AC-3 asks for a named 400.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_run_request');
    await app.close();
  });

  it('400s agentIds together with all', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR}/review`,
      payload: { agentIds: ['agent-1'], all: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_run_request');
    await app.close();
  });

  it('still accepts a request with no body at all, and refuses it by name', async () => {
    const app = await routeApp();
    // AC-11: the tolerance the manual parse had, kept by `.default({})`. The
    // body schema must not turn "no selector" into a validation error.
    const res = await app.inject({ method: 'POST', url: `/pulls/${PR}/review` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_run_request');
    await app.close();
  });

  it('422s a non-uuid pull-request id', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/pulls/not-a-uuid/review',
      payload: { all: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});

describe('POST /pulls/:id/multi-agent-run — registration, schema and the cap', () => {
  it('422s an empty agentIds from the CONTRACT schema, before the handler', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR}/multi-agent-run`,
      payload: { agentIds: [] },
    });
    // The asymmetry with `/review` above, in one assertion:
    // `MultiAgentRunRequest` DOES carry `.min(1)`.
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('422s a nine-agent list with the service name, and never reaches a query', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR}/multi-agent-run`,
      payload: { agentIds: Array.from({ length: 9 }, (_, i) => `agent-${i + 1}`) },
    });
    expect(res.statusCode).toBe(422);
    // Not `validation_error`: AC-8 asks for a NAMED reason, and the cap is a
    // service rule (`DDG-ARCH-001`), not a shape.
    expect(res.json().error.code).toBe('too_many_agents');
    await app.close();
  });

  it('422s a non-uuid pull-request id', async () => {
    const app = await routeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/pulls/not-a-uuid/multi-agent-run',
      payload: { agentIds: ['agent-1'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});

describe('POST /pulls/:id/multi-agent-run — the per-route rate limit', () => {
  it('refuses the eleventh call in a minute', async () => {
    // AC-10. `@fastify/rate-limit` is not registered at all under
    // `NODE_ENV=test` (see `app.ts`), so a per-route `config.rateLimit` is inert
    // there and asserting it needs a non-test config. Everything else stays
    // hermetic: the limiter runs in `onRequest`, ahead of validation, so ten
    // 422s and then a 429 exercise the limit without a handler, a service or a
    // query ever running.
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
    });
    const app = await buildApp({ config, overrides: { auth } });

    const call = () =>
      app.inject({
        method: 'POST',
        url: `/pulls/${PR}/multi-agent-run`,
        payload: { agentIds: [] },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await call()).statusCode);

    expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 422));
    expect(statuses[10]).toBe(429);
    await app.close();
  });
});
