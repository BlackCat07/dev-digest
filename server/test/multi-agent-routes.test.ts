import { describe, it, expect } from 'vitest';
import type { AuthProvider, LLMProvider } from '@devdigest/shared';
import { MultiAgentRun } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MultiAgentService } from '../src/modules/multi-agent/service.js';
import type {
  MultiAgentStore,
  StoredMultiAgentColumn,
  StoredMultiAgentRun,
} from '../src/modules/multi-agent/types.js';

/**
 * The multi-agent module's transport: that it is REGISTERED, what a schema
 * rejects before the handler runs, which envelope a pull request with no
 * multi-run answers with, and — the one this file exists for — that reading a
 * multi-run makes no model call (AC-23).
 *
 * Hermetic, per `DDG-TEST-001`. The REAL `MultiAgentService` arrives through
 * `ContainerOverrides.multiAgent` over a fake store, so the route, the error
 * handler and the assembly all run while nothing touches Postgres, and the
 * workspace comes from a fake `AuthProvider` so `getContext` resolves without
 * one either.
 *
 * **The provider fake throws from every method, and that is the AC-23 test.**
 * "No model call happened" asserted against a payload is not evidence — a
 * payload that looks right is exactly what a wrong implementation that DID call
 * a model would also produce. A provider that throws turns it into a failing
 * test that names the offending call, and two successive reads of a completed
 * multi-run are what prove a second read does not "refresh" anything either.
 *
 * **The 404's BODY is the registration proof.** An unregistered module and a
 * registered one both answer 404 for a pull request that has no multi-run; only
 * the registered one answers with the service's own
 * `{"error":{"code":"not_found",…}}` envelope and its own message
 * (`server/INSIGHTS.md`, 2026-08-20). Asserting the status alone would pass with
 * this module missing from `modules/index.ts` entirely.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const PR = '22222222-2222-4222-8222-222222222222';
const MULTI_RUN = '33333333-3333-4333-8333-333333333333';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' });

const auth: AuthProvider = {
  currentUser: async () => ({ id: 'user-1', email: 'dev@local', name: 'Dev' }),
  currentWorkspace: async () => ({ id: WS, name: 'Local' }),
};

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

function store(over: Partial<MultiAgentStore>): MultiAgentStore {
  return {
    createIfIdle: unreachable('createIfIdle'),
    latestForPull: unreachable('latestForPull'),
    discard: unreachable('discard'),
    runsOf: unreachable('runsOf'),
    findingsOf: unreachable('findingsOf'),
    readNotes: unreachable('readNotes'),
    saveNotes: unreachable('saveNotes'),
    ...over,
  };
}

/**
 * An `LLMProvider` that cannot be used, only detected.
 *
 * Every method throws rather than recording, so a model call does not merely
 * fail an assertion at the end of the test — it fails the request, with this
 * message, at the line that made it.
 */
function forbiddenProvider(id: 'openai' | 'anthropic' | 'openrouter'): LLMProvider {
  const boom = (method: string) => (): never => {
    throw new Error(`the read made a model call: ${id}.${method}`);
  };
  return {
    id,
    listModels: boom('listModels'),
    complete: boom('complete'),
    completeStructured: boom('completeStructured'),
    embed: boom('embed'),
  };
}

const noModelCalls = {
  openai: forbiddenProvider('openai'),
  anthropic: forbiddenProvider('anthropic'),
  openrouter: forbiddenProvider('openrouter'),
};

const app = (over: Partial<MultiAgentStore>) =>
  buildApp({
    config,
    overrides: {
      auth,
      llm: noModelCalls,
      multiAgent: new MultiAgentService({ store: store(over) }),
    },
  });

const parent: StoredMultiAgentRun = {
  id: MULTI_RUN,
  prId: PR,
  prNumber: 42,
  ranAt: new Date('2026-08-25T10:00:00.000Z'),
};

const column: StoredMultiAgentColumn = {
  runId: 'run-a',
  agentId: 'agent-a',
  agentName: 'Security Reviewer',
  provider: 'openrouter',
  model: 'gpt-4.1',
  status: 'done',
  error: null,
  durationMs: 8200,
  costUsd: 0.06,
  reviewId: 'review-a',
  score: 75,
  summary: 'One problem.',
  verdict: 'REQUEST_CHANGES',
};

describe('multi-agent routes', () => {
  it('422s a non-uuid pull-request id before the service is reached', async () => {
    // Every store method throws, so a 422 here is evidence the schema ran first:
    // `IdParams` validation happens before `getContext` and before any handler
    // body (`DDG-SEC-003` — the one user-controlled value reaching a query is
    // checked at the edge).
    const a = await app({});
    const res = await a.inject({ method: 'GET', url: '/pulls/not-a-uuid/multi-agent' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await a.close();
  });

  it('answers a pull request with no multi-run with the SERVICE envelope', async () => {
    // AC-17, and the registration check (`DDG-WIRE-001`). Fastify's own
    // route-not-found body here would mean this module never reached
    // `modules/index.ts`.
    const a = await app({ latestForPull: async () => undefined });
    const res = await a.inject({ method: 'GET', url: `/pulls/${PR}/multi-agent` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.message).toBe('No multi-agent run for this pull request');
    await a.close();
  });

  it('scopes the read to the caller’s workspace, from getContext and never from the request', async () => {
    const seen: string[] = [];
    const a = await app({
      latestForPull: async (workspaceId, prId) => {
        seen.push(workspaceId, prId);
        return undefined;
      },
    });
    await a.inject({ method: 'GET', url: `/pulls/${PR}/multi-agent` });
    expect(seen).toEqual([WS, PR]);
    await a.close();
  });

  it('serves a completed multi-run twice, and makes no model call on either read', async () => {
    // AC-23. Two reads, because "the first read is cheap and the second one
    // synthesises" is the exact mistake this criterion exists to forbid; with
    // every provider method throwing, a second read that reached for one would
    // 500 here rather than pass quietly.
    let reads = 0;
    const a = await app({
      latestForPull: async () => {
        reads += 1;
        return parent;
      },
      runsOf: async () => [column],
      findingsOf: async () => [],
      readNotes: async () => null,
    });

    for (const _ of [1, 2]) {
      const res = await a.inject({ method: 'GET', url: `/pulls/${PR}/multi-agent` });
      expect(res.statusCode).toBe(200);
      const parsed = MultiAgentRun.safeParse(res.json());
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data?.id).toBe(MULTI_RUN);
      expect(parsed.data?.agent_count).toBe(1);
      expect(parsed.data?.columns[0]?.score).toBe(75);
      expect(parsed.data?.total_duration_ms).toBe(8200);
    }
    expect(reads).toBe(2);
    await a.close();
  });
});
