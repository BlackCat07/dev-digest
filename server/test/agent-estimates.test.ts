import { describe, it, expect } from 'vitest';
import type { AuthProvider } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import type { AgentRunSampleRow } from '../src/modules/agents/repository.js';
import {
  AGENT_ESTIMATE_SAMPLE_SIZE,
  agentRunEstimates,
  runEstimatesFrom,
  type AgentEstimateStore,
} from '../src/modules/agents/service.js';

/**
 * L07 — per-agent run estimates (`GET /agents/estimates`).
 *
 * The subject is a set of null-versus-zero rules, so almost everything here runs
 * against the pure reduction and the narrow `AgentEstimateStore` port rather
 * than against SQL: `null` means "nothing was measured" and `0` means "measured,
 * and it was zero", the screen renders them differently, and no typechecker can
 * tell the two apart.
 *
 * Hermetic, and it has to be — `DDG-TEST-001` reserves `*.it.test.ts` for
 * DB-backed files and nothing below needs storage. The route case builds the
 * real app over a stub `Db` whose three call shapes are the only ones this
 * feature reaches, so the assertion is about ROUTING, not about the query.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const A1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const A2 = 'aaaaaaaa-2222-4222-8222-222222222222';
const A3 = 'aaaaaaaa-3333-4333-8333-333333333333';

const sample = (
  agentId: string,
  durationMs: number | null,
  costUsd: number | null,
): AgentRunSampleRow => ({ agentId, durationMs, costUsd });

/** A store whose unnamed method throws with its own name, so a stray call fails loudly. */
function store(over: Partial<AgentEstimateStore>): AgentEstimateStore {
  return {
    listAgentIds: () => {
      throw new Error('listAgentIds must not be reached in this case');
    },
    recentDoneRunSamples: () => {
      throw new Error('recentDoneRunSamples must not be reached in this case');
    },
    ...over,
  };
}

describe('runEstimatesFrom — the null-versus-zero rules', () => {
  it('returns one row per workspace agent, sample-driven figures and all', () => {
    // AC-41. Five agents in the workspace yield five rows even though only one
    // of them has ever run: the AGENT LIST drives the row set, never the sample.
    const agentIds = [A1, A2, A3, 'aaaaaaaa-4444-4444-8444-444444444444', 'aaaaaaaa-5555-4555-8555-555555555555'];
    const rows = runEstimatesFrom(agentIds, [sample(A1, 1000, 0.02)]);

    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.agent_id)).toEqual(agentIds);
  });

  it('reports null means and sample_size 0 for an agent that has never run — never 0 ms and never $0.00', () => {
    // AC-43, and the whole reason this task exists. A freshly created agent has
    // no measurement; reporting `0` would claim it is instant and free.
    const [fresh] = runEstimatesFrom([A1], []);

    expect(fresh).toEqual({
      agent_id: A1,
      mean_duration_ms: null,
      mean_cost_usd: null,
      sample_size: 0,
    });
  });

  it('averages the ten most recent sampled runs and discards everything past them', () => {
    // AC-42. The repository bounds the transfer, but the cut is re-applied here
    // as the rule of record: rows arrive newest-first per agent, so an eleventh
    // and twelfth row are the two OLDEST and must move nothing.
    //
    // Ten runs of 1000 ms, then two of 999_000 ms. A mean that let the tail in
    // would be far above 1000.
    const samples = [
      ...Array.from({ length: AGENT_ESTIMATE_SAMPLE_SIZE }, () => sample(A1, 1000, 0.01)),
      sample(A1, 999_000, 9.99),
      sample(A1, 999_000, 9.99),
    ];
    const [row] = runEstimatesFrom([A1], samples);

    expect(row!.sample_size).toBe(AGENT_ESTIMATE_SAMPLE_SIZE);
    expect(row!.mean_duration_ms).toBe(1000);
    expect(row!.mean_cost_usd).toBeCloseTo(0.01, 10);
  });

  it('reports a duration mean with a null cost mean when no sampled run recorded a cost', () => {
    // AC-44. Ten `done` runs of an unpriced model: the duration is known, the
    // cost is not, and the cost is NOT therefore zero.
    const samples = Array.from({ length: AGENT_ESTIMATE_SAMPLE_SIZE }, (_, i) =>
      sample(A1, 1000 + i * 100, null),
    );
    const [row] = runEstimatesFrom([A1], samples);

    expect(row!.mean_duration_ms).toBe(1450);
    expect(row!.mean_cost_usd).toBeNull();
    expect(row!.sample_size).toBe(AGENT_ESTIMATE_SAMPLE_SIZE);
  });

  it('distinguishes a genuinely free model from a missing cost, and averages only the priced runs', () => {
    // `agent_runs.cost_usd`: null = no cost data at all, 0 = a free model.
    // A2 ran twice for free — that is a measurement and it averages to 0.
    // A1 ran three times and only two of them priced themselves; the mean is
    // over those two (0.04), not over three with a zero filled in (0.0266…).
    const rows = runEstimatesFrom(
      [A1, A2],
      [
        sample(A1, 1000, 0.02),
        sample(A1, 1000, null),
        sample(A1, 1000, 0.06),
        sample(A2, 500, 0),
        sample(A2, 500, 0),
      ],
    );

    expect(rows[0]!.mean_cost_usd).toBeCloseTo(0.04, 10);
    expect(rows[0]!.sample_size).toBe(3);
    expect(rows[1]!.mean_cost_usd).toBe(0);
    expect(rows[1]!.sample_size).toBe(2);
  });

  it('averages only the runs that recorded a duration, and reports null when none did', () => {
    // `duration_ms` is nullable too. A missing measurement must not be averaged
    // in as a zero, which would drag the mean toward "instant".
    const rows = runEstimatesFrom(
      [A1, A2],
      [sample(A1, null, 0.01), sample(A1, 2000, 0.01), sample(A2, null, 0.01)],
    );

    expect(rows[0]!.mean_duration_ms).toBe(2000);
    expect(rows[1]!.mean_duration_ms).toBeNull();
    // The absent duration still counts as a sampled run.
    expect(rows[0]!.sample_size).toBe(2);
    expect(rows[1]!.sample_size).toBe(1);
  });

  it('drops a sample naming an agent that is not in the workspace list', () => {
    // `agent_runs.agent_id` is ON DELETE SET NULL and the query filters those
    // rows out, but a sample for an agent of another workspace must never leak
    // into a row here either — and it must not invent a row of its own.
    const rows = runEstimatesFrom([A1], [sample(A1, 1000, 0.01), sample(A2, 5000, 5)]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.mean_duration_ms).toBe(1000);
  });

  it('rounds the duration mean to whole milliseconds and leaves the cost mean exact', () => {
    const [row] = runEstimatesFrom([A1], [sample(A1, 1000, 0.001), sample(A1, 1001, 0.002)]);

    expect(row!.mean_duration_ms).toBe(1001); // 1000.5 → 1001, not 1000.5
    expect(row!.mean_cost_usd).toBeCloseTo(0.0015, 10);
  });
});

describe('agentRunEstimates — over the store port', () => {
  it('reads the workspace agents and samples ten runs each, in agent order', async () => {
    const seen: { workspaceId: string; perAgent: number }[] = [];
    const rows = await agentRunEstimates(
      store({
        listAgentIds: async (workspaceId) => {
          expect(workspaceId).toBe(WS);
          return [A1, A2];
        },
        recentDoneRunSamples: async (workspaceId, perAgent) => {
          seen.push({ workspaceId, perAgent });
          return [sample(A2, 4000, 0.08), sample(A1, 2000, null)];
        },
      }),
      WS,
    );

    // The sample is scoped by workspace and by nothing else, and asks for
    // exactly the constant the reduction cuts on.
    expect(seen).toEqual([{ workspaceId: WS, perAgent: AGENT_ESTIMATE_SAMPLE_SIZE }]);
    // Row order follows the agent list, not the order the samples arrived in.
    expect(rows.map((r) => r.agent_id)).toEqual([A1, A2]);
    expect(rows[0]!.mean_cost_usd).toBeNull();
    expect(rows[1]!.mean_cost_usd).toBeCloseTo(0.08, 10);
  });

  it('answers an agent-less workspace with an empty list and never samples', async () => {
    // `recentDoneRunSamples` throws if reached, so this is evidence the read
    // short-circuits rather than an assertion about the empty array.
    const rows = await agentRunEstimates(store({ listAgentIds: async () => [] }), WS);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });

const auth: AuthProvider = {
  currentUser: async () => ({ id: 'user-1', email: 'dev@local', name: 'Dev' }),
  currentWorkspace: async () => ({ id: WS, name: 'Local' }),
};

/**
 * The three call shapes this feature reaches on `Db`, and nothing else:
 * the boot reaper's `update(...).set(...).where(...).returning(...)`,
 * `listAgentIds`' `select(...).from(...).where(...).orderBy(...)`, and
 * `recentDoneRunSamples`' `execute(...)`.
 *
 * A stub rather than a mock database: this case is about which handler
 * `/agents/estimates` lands in, and a real Postgres would say nothing extra
 * about that while making the file DB-backed (`DDG-TEST-001`).
 */
function stubDb(agentIds: { id: string }[], samples: Record<string, unknown>[]): Db {
  return {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => agentIds }) }) }),
    execute: async () => samples,
  } as unknown as Db;
}

describe('GET /agents/estimates', () => {
  it('answers 200 and not 422 — the static segment wins over /agents/:id', async () => {
    // `/agents/:id` validates a uuid through `IdParams`, so a router that
    // preferred the parametric route would answer 422 for the literal
    // "estimates". Fastify prefers the static segment; this is the assertion
    // that keeps that true rather than assumed.
    const app = await buildApp({
      config,
      db: stubDb([{ id: A1 }], [{ agent_id: A1, duration_ms: 8200, cost_usd: 0.06 }]),
      overrides: { auth },
    });

    const res = await app.inject({ method: 'GET', url: '/agents/estimates' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { agent_id: A1, mean_duration_ms: 8200, mean_cost_usd: 0.06, sample_size: 1 },
    ]);
    await app.close();
  });

  it('still 422s a non-uuid id on /agents/:id, so the two routes stay distinct', async () => {
    // The other half of the same question: adding a static sibling must not
    // have loosened the parametric route into matching anything.
    const app = await buildApp({ config, db: stubDb([], []), overrides: { auth } });

    const res = await app.inject({ method: 'GET', url: '/agents/not-a-uuid' });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
