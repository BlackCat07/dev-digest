import { describe, it, expect } from 'vitest';
import type { AuthProvider } from '@devdigest/shared';
import type { EvalAgentCase, EvalBatch, EvalPeriod } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { NotFoundError } from '../src/platform/errors.js';
import { EvalRefusal } from '../src/modules/eval/service.js';
import type { Evals } from '../src/modules/eval/types.js';
import { runBus } from '../src/platform/sse.js';

/**
 * The eval module's transport: what a schema rejects before the handler runs,
 * which envelope an out-of-workspace id answers with, that a named refusal
 * reaches the client with its own code, and that the progress stream replays and
 * then closes for a batch that already finished.
 *
 * Hermetic, and it has to be — `DDG-TEST-001` reserves `*.it.test.ts` for the one
 * DB-backed file, and nothing below is about storage. The service arrives through
 * `ContainerOverrides.eval` as a fake with no database, no provider and no batch
 * actually running, and the workspace comes from a fake `AuthProvider` so
 * `getContext` resolves without Postgres.
 *
 * **Every fake method not named by a case throws with its own name.** That is
 * what turns "the schema rejected this before the handler ran" from an assertion
 * about a status code — which a handler could also have produced — into a failing
 * test that NAMES the service call that should never have happened.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

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

function evals(over: Partial<Evals>): Evals {
  return {
    createCaseFromFinding: unreachable('createCaseFromFinding'),
    listCases: unreachable('listCases'),
    saveCase: unreachable('saveCase'),
    deleteCase: unreachable('deleteCase'),
    startBatch: unreachable('startBatch'),
    getBatch: unreachable('getBatch'),
    listBatches: unreachable('listBatches'),
    agentDashboard: unreachable('agentDashboard'),
    workspaceDashboard: unreachable('workspaceDashboard'),
    compare: unreachable('compare'),
    runAllAgents: unreachable('runAllAgents'),
    ...over,
  };
}

const app = (service: Partial<Evals>) =>
  buildApp({ config, overrides: { auth, eval: evals(service) } });

/** A case shaped enough to be serialized back; no route asserts on its fields. */
const aCase = (id: string): EvalAgentCase => ({
  id,
  owner_kind: 'agent',
  owner_id: AGENT,
  name: 'accepted finding',
  input_diff: '',
  input_files: null,
  input_meta: null,
  expected_output: null,
  notes: null,
  expectation: 'must_find',
  expected_anchors: [],
  source_finding_id: null,
  edited: false,
  last_execution: null,
});

const aBatch = (id: string): EvalBatch => ({
  id,
  workspace_id: WS,
  agent_id: AGENT,
  agent_name: 'General Reviewer',
  agent_version: 7,
  system_prompt_snapshot: 'be careful',
  model_snapshot: 'gpt-4.1',
  status: 'running',
  label: null,
  started_at: '2026-08-01T00:00:00.000Z',
  finished_at: null,
  cases_covered: null,
  cases_passed: null,
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  error: null,
});

describe('eval routes', () => {
  it('422s a non-uuid agent id before the service is reached', async () => {
    // Every service method throws, so a 422 here is evidence the schema ran
    // first — `IdParams`-style validation happens before `getContext` and before
    // any handler body.
    const a = await app({});
    const res = await a.inject({ method: 'GET', url: '/eval/agents/not-a-uuid/cases' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await a.close();
  });

  it('answers an out-of-workspace agent id with the SERVICE envelope, not route-not-found', async () => {
    // AC-18. An unregistered module and a registered one both 404 for an id that
    // is not there; only the registered one carries `code: "not_found"` and a
    // message of its own, which is what this asserts.
    const a = await app({
      listCases: async () => {
        throw new NotFoundError('Agent not found');
      },
    });
    const res = await a.inject({ method: 'GET', url: `/eval/agents/${AGENT}/cases` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.message).toBe('Agent not found');
    await a.close();
  });

  it('creates a case from a finding id alone and rejects a body carrying an expectation', async () => {
    const seen: string[] = [];
    const a = await app({
      createCaseFromFinding: async (workspaceId, findingId) => {
        expect(workspaceId).toBe(WS);
        seen.push(findingId);
        return aCase('case-1');
      },
    });

    const ok = await a.inject({
      method: 'POST',
      url: '/eval/cases',
      payload: { finding_id: '33333333-3333-4333-8333-333333333333' },
    });
    expect(ok.statusCode).toBe(201);
    expect(seen).toEqual(['33333333-3333-4333-8333-333333333333']);

    // AC-52: what the case asserts is derived from the finding's decision, so an
    // expectation in the body is refused rather than quietly ignored.
    const withExpectation = await a.inject({
      method: 'POST',
      url: '/eval/cases',
      payload: {
        finding_id: '33333333-3333-4333-8333-333333333333',
        expectation: 'must_not_flag',
      },
    });
    expect(withExpectation.statusCode).toBe(422);
    expect(seen).toHaveLength(1);
    await a.close();
  });

  it('passes a named refusal through with its own code and status', async () => {
    // The client keys one message per `EvalRefusalReason` off `error.code`. A
    // try/catch in the route that rewrapped this as `validation_error` would
    // answer the right status with a code nothing renders.
    const a = await app({
      createCaseFromFinding: async () => {
        throw new EvalRefusal('duplicate_source_finding', 'This finding is already a case', 409, {
          case_id: 'case-9',
          case_name: 'accepted finding',
        });
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/eval/cases',
      payload: { finding_id: '33333333-3333-4333-8333-333333333333' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('duplicate_source_finding');
    expect(res.json().error.details).toMatchObject({ case_id: 'case-9' });
    await a.close();
  });

  it('defaults the period to 30d, forwards a named one, and rejects an unknown one', async () => {
    const periods: EvalPeriod[] = [];
    const a = await app({
      workspaceDashboard: async (workspaceId, period) => {
        expect(workspaceId).toBe(WS);
        periods.push(period);
        return { period, rows: [], recent_batches: [] };
      },
    });

    expect((await a.inject({ method: 'GET', url: '/eval/dashboard' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/eval/dashboard?period=90d' })).statusCode).toBe(
      200,
    );
    const bad = await a.inject({ method: 'GET', url: '/eval/dashboard?period=last-tuesday' });
    expect(bad.statusCode).toBe(422);

    expect(periods).toEqual(['30d', '90d']);
    await a.close();
  });

  it('acknowledges a batch as running, with or without a body', async () => {
    const calls: unknown[] = [];
    const a = await app({
      startBatch: async (workspaceId, agentId, options) => {
        calls.push({ workspaceId, agentId, options });
        return aBatch('batch-1');
      },
    });

    const empty = await a.inject({ method: 'POST', url: `/eval/agents/${AGENT}/batches` });
    expect(empty.statusCode).toBe(202);
    expect(empty.json().status).toBe('running');

    const one = await a.inject({
      method: 'POST',
      url: `/eval/agents/${AGENT}/batches`,
      payload: { case_id: '44444444-4444-4444-8444-444444444444' },
    });
    expect(one.statusCode).toBe(202);

    expect(calls).toEqual([
      { workspaceId: WS, agentId: AGENT, options: {} },
      {
        workspaceId: WS,
        agentId: AGENT,
        options: { caseId: '44444444-4444-4444-8444-444444444444' },
      },
    ]);
    await a.close();
  });

  it('replays a completed batch’s buffered events and then closes the stream', async () => {
    // AC-24. `RunBus.subscribe` replays its buffer to a late subscriber and
    // `onDone` fires immediately for a stream already marked complete — so the
    // request below must RETURN rather than hang, which is the half of this that
    // a payload assertion alone would not catch.
    const batchId = '55555555-5555-4555-8555-555555555555';
    runBus.publish(batchId, 'info', 'case 1 passed');
    runBus.publish(batchId, 'info', 'case 2 failed');
    runBus.complete(batchId);

    const a = await app({
      getBatch: async (workspaceId, id) => {
        expect(workspaceId).toBe(WS);
        expect(id).toBe(batchId);
        return { batch: aBatch(batchId), cases: [] };
      },
    });
    const res = await a.inject({ method: 'GET', url: `/eval/batches/${batchId}/events` });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('case 1 passed');
    expect(res.payload).toContain('case 2 failed');
    await a.close();
  });

  it('authorizes the stream through the service before subscribing', async () => {
    const a = await app({
      getBatch: async () => {
        throw new NotFoundError('Eval batch not found');
      },
    });
    const res = await a.inject({
      method: 'GET',
      url: '/eval/batches/66666666-6666-4666-8666-666666666666/events',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await a.close();
  });
});
