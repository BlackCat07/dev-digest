import { describe, it, expect } from 'vitest';
import type { AuthProvider, CiExport, CiInstallation, CiRun } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Cis } from '../src/modules/ci/types.js';

/**
 * The CI module's transport: what a schema rejects before the handler runs, which
 * envelope an out-of-workspace id answers with, and that the nine fields AC-28
 * names survive serialization.
 *
 * Hermetic, and it has to be — `DDG-TEST-001` reserves `*.it.test.ts` for the one
 * DB-backed file and nothing here is about storage. The service arrives through
 * `ContainerOverrides.ci` as a fake with no database, no GitHub token and nothing
 * committed anywhere, and the workspace comes from a fake `AuthProvider` so
 * `getContext` resolves without Postgres.
 *
 * **Every fake method not named by a case throws with its own name.** That is what
 * turns "the schema rejected this before the handler ran" from an assertion about
 * a status code — which a handler could equally have produced — into a failing
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

function cis(over: Partial<Cis>): Cis {
  return {
    preview: unreachable('preview'),
    exportToCi: unreachable('exportToCi'),
    listInstallations: unreachable('listInstallations'),
    listRuns: unreachable('listRuns'),
    refresh: unreachable('refresh'),
    ...over,
  };
}

const app = (service: Partial<Cis>) =>
  buildApp({ config, overrides: { auth, ci: cis(service) } });

/** A run with every one of AC-28's nine fields populated. */
const aRun = (over: Partial<CiRun> = {}): CiRun => ({
  id: 'run-1',
  ci_installation_id: 'installation-1',
  pr_number: 482,
  ran_at: '2026-08-20T10:00:00.000Z',
  status: 'succeeded',
  findings_count: 3,
  cost_usd: 0.0142,
  github_url: 'https://github.com/acme/payments-api/actions/runs/90001',
  source: 'gha',
  agent: 'Security Reviewer',
  duration_s: 42,
  repo: 'acme/payments-api',
  head_sha: 'a1b2c3d4e5f6',
  blockers: 1,
  reason: null,
  ...over,
});

const anInstallation: CiInstallation = {
  id: 'installation-1',
  agent_id: AGENT,
  repo: 'acme/payments-api',
  target_type: 'gha',
  installed_at: '2026-08-01T00:00:00.000Z',
  last_run_status: 'succeeded',
  last_run_at: '2026-08-20T10:00:00.000Z',
};

const anExport: CiExport = {
  installation: anInstallation,
  files: [{ path: '.devdigest/runner.mjs', contents: 'console.log(1)', editable: false }],
  pr_url: 'https://github.com/acme/payments-api/pull/7',
};

const body = (over: Record<string, unknown> = {}) => ({
  repo: 'acme/payments-api',
  ...over,
});

describe('CI routes', () => {
  it('422s a non-uuid agent id before the service is reached', async () => {
    const a = await app({});
    const res = await a.inject({
      method: 'POST',
      url: '/agents/not-a-uuid/export-ci/preview',
      payload: body(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await a.close();
  });

  it('422s a repository that is not owner/name, before the service is reached', async () => {
    // Every service method throws, so a 422 here is evidence the SCHEMA ran
    // first: validation happens before `getContext`, before the workspace lookup
    // and before anything reaches GitHub.
    const a = await app({});
    for (const repo of ['acme', 'acme/payments/api', '../../etc/passwd', '']) {
      const res = await a.inject({
        method: 'POST',
        url: `/agents/${AGENT}/export-ci`,
        payload: body({ repo }),
      });
      expect(res.statusCode, `repo=${repo}`).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    await a.close();
  });

  it('applies the contract defaults to a body carrying only a repository', async () => {
    // `CiExportBody` is `CiExportInput` with `repo` narrowed, so the Configure
    // step's specified defaults come from the contract rather than from a copy
    // that is free to drift from what the client sends.
    let seen: unknown;
    const a = await app({
      preview: async (_ws, _id, input) => {
        seen = input;
        return { files: [] };
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: `/agents/${AGENT}/export-ci/preview`,
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual({
      repo: 'acme/payments-api',
      target: 'gha',
      action: 'open_pr',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize', 'reopened'],
      base: 'main',
    });
    await a.close();
  });

  it('accepts the FULL six-field body the client sends, on both POST paths', async () => {
    // The client posts every `CiExportInput` field to both endpoints and varies
    // only `action` — `"files"` for the preview, `"open_pr"` for the install. A
    // test that posts a minimal `{ repo }` passes whether or not the schema would
    // accept what the client really sends, so this one sends the real body and
    // asserts the handler saw it unchanged.
    const seen: unknown[] = [];
    const a = await app({
      preview: async (_ws, _id, input) => {
        seen.push(input);
        return { files: [] };
      },
      exportToCi: async (_ws, _id, input) => {
        seen.push(input);
        return anExport;
      },
    });

    const full = (action: 'files' | 'open_pr') => ({
      repo: 'acme/payments-api',
      target: 'gha',
      action,
      post_as: 'none',
      triggers: ['opened'],
      base: 'develop',
    });

    const preview = await a.inject({
      method: 'POST',
      url: `/agents/${AGENT}/export-ci/preview`,
      payload: full('files'),
    });
    expect(preview.statusCode).toBe(200);

    const install = await a.inject({
      method: 'POST',
      url: `/agents/${AGENT}/export-ci`,
      payload: full('open_pr'),
    });
    expect(install.statusCode).toBe(200);

    expect(seen).toEqual([full('files'), full('open_pr')]);
    await a.close();
  });

  it('answers an out-of-workspace agent id with the SERVICE envelope, not route-not-found', async () => {
    // The one extra request that turns "the route answered" into "the handler ran
    // and the workspace resolution executed". An UNREGISTERED module and a
    // registered one both answer 404 for an id that is not there — only the
    // registered one carries `code: "not_found"` and a message, rather than
    // Fastify's `{"message":"Route POST:/… not found"}`.
    const a = await app({
      exportToCi: async () => {
        throw new NotFoundError(`Agent ${AGENT} not found`);
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: `/agents/${AGENT}/export-ci`,
      payload: body(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: 'not_found', message: `Agent ${AGENT} not found` },
    });
    await a.close();
  });

  it('answers Fastify’s own 404 for a path this module does NOT declare', async () => {
    // The control for the assertion above: this is what an unregistered module
    // would answer for every path, so seeing the two shapes differ is what makes
    // the envelope evidence of registration.
    const a = await app({});
    const res = await a.inject({ method: 'GET', url: '/ci-runs-that-do-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error?.code).toBeUndefined();
    await a.close();
  });

  it('returns the export, PR link included', async () => {
    const a = await app({ exportToCi: async () => anExport });
    const res = await a.inject({
      method: 'POST',
      url: `/agents/${AGENT}/export-ci`,
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr_url).toBe('https://github.com/acme/payments-api/pull/7');
    await a.close();
  });

  it('returns an agent’s installations, including one that has never run', async () => {
    const a = await app({
      listInstallations: async () => [
        anInstallation,
        { ...anInstallation, id: 'installation-2', last_run_status: null, last_run_at: null },
      ],
    });
    const res = await a.inject({ method: 'GET', url: `/agents/${AGENT}/ci-installations` });
    expect(res.statusCode).toBe(200);
    const rows: CiInstallation[] = res.json();
    expect(rows).toHaveLength(2);
    // `null` and not absent: the CI tab renders "never run" from a value, and an
    // omitted key would arrive as `undefined` and be indistinguishable from a
    // field the server forgot.
    expect(rows[1]).toHaveProperty('last_run_status', null);
    expect(rows[1]).toHaveProperty('last_run_at', null);
    await a.close();
  });

  it('serves every one of AC-28’s nine fields, none of them undefined', async () => {
    const a = await app({ listRuns: async () => [aRun()] });
    const res = await a.inject({ method: 'GET', url: '/ci-runs' });
    expect(res.statusCode).toBe(200);

    const [row]: CiRun[] = res.json();
    for (const field of [
      'repo',
      'pr_number',
      'agent',
      'status',
      'findings_count',
      'blockers',
      'cost_usd',
      'duration_s',
      'github_url',
    ] as const) {
      expect(row?.[field], `${field} is missing`).not.toBeUndefined();
      expect(row?.[field], `${field} is null on a fully read run`).not.toBeNull();
    }
    await a.close();
  });

  it('defaults the page size and rejects one past the ceiling', async () => {
    let seen = -1;
    const a = await app({
      listRuns: async (_ws, limit) => {
        seen = limit;
        return [];
      },
    });
    expect((await a.inject({ method: 'GET', url: '/ci-runs' })).statusCode).toBe(200);
    expect(seen).toBe(50);

    expect(
      (await a.inject({ method: 'GET', url: '/ci-runs?limit=5000' })).statusCode,
    ).toBe(422);
    await a.close();
  });

  it('refreshes on a POST carrying no body at all', async () => {
    // `apiFetch` sets `content-type: application/json` only when a body is
    // actually sent, so the request that really arrives has none. A body schema
    // on this route would make it the only one this endpoint rejects.
    const a = await app({ refresh: async () => [aRun()] });
    const res = await a.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await a.close();
  });
});
