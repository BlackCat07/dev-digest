/**
 * resolve.test.ts — hermetic. Every test drives a fake `fetchImpl`, so no socket
 * is opened and no DevDigest API has to be running.
 *
 * The assertions that matter here are about **how many requests** a resolution
 * costs, not only about its answer. That is the whole point of `resolve.ts`:
 * `GET /repos/:id/pulls` drives a live GitHub sync plus up to ten detail
 * backfills per call and shares the API's 120 req/min budget with the studio, so
 * "did this resolve?" and "how many times did it ask?" are equally load-bearing.
 * Hence `paths` is asserted with `toEqual` — an exact sequence, not a count with
 * room to grow.
 *
 * Three request-count facts are pinned:
 *
 *  1. Two different repositories resolve with a single `GET /repos`.
 *  2. A miss costs exactly two requests and then reports.
 *  3. A pull request that appeared after the cache was filled resolves on that
 *     one refetch, and is cached afterwards.
 */
import { describe, expect, it } from 'vitest';
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { MAX_LISTED_ALTERNATIVES, Resolver } from '../src/resolve.js';
import type { LogFields, Logger } from '../src/log.js';

/**
 * The house pattern from `test/errors.test.ts`: a failure message must contain a
 * verb telling the caller what to DO. Every message this file can produce is run
 * through it in the last test.
 */
const IMPERATIVE = /(Start|Wait|Retry|retry|Check|check|report|set) /;

const BASE_URL = 'http://localhost:3001';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function repoRow(owner: string, name: string): Repo {
  return {
    id: `repo-${owner}-${name}`,
    workspace_id: 'ws-1',
    owner,
    name,
    full_name: `${owner}/${name}`,
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

/** Two owners share `payments-api`, which is exactly what a bare name cannot decide. */
const REPOS: Repo[] = [
  repoRow('acme', 'payments-api'),
  repoRow('globex', 'payments-api'),
  repoRow('initech', 'billing'),
];

const ACME_PULLS_PATH = '/repos/repo-acme-payments-api/pulls';

function pullRow(number: number, id: string | null): PrMeta {
  const row: PrMeta = {
    number,
    title: `Change ${number}`,
    author: 'octocat',
    branch: `feature/${number}`,
    base: 'main',
    head_sha: `sha-${number}`,
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: 'needs_review',
  };
  return id === null ? row : { ...row, id };
}

/**
 * #9 carries no id — `PrMeta.id` is nullish in the contract, so a row that
 * cannot be addressed has to be skipped rather than half-resolved.
 */
const ACME_PULLS: PrMeta[] = [
  pullRow(4, 'pr-4'),
  pullRow(482, 'pr-482'),
  pullRow(7, 'pr-7'),
  pullRow(9, null),
];

function agentRow(id: string, name: string): Agent {
  return {
    id,
    name,
    description: 'Reviews pull requests',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    system_prompt: 'You are a reviewer.',
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
  };
}

const AGENTS: Agent[] = [agentRow('agent-1', 'Security Reviewer'), agentRow('agent-2', 'Style')];

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

/** A `Logger` that records instead of writing, so nothing reaches a stream. */
function silentLogger(): Logger {
  const drop = (_message: string, _fields?: LogFields): void => undefined;
  return { error: drop, warn: drop, info: drop, debug: drop };
}

interface FakeApi {
  readonly repos?: () => Response;
  readonly pulls?: (repoId: string) => Response;
  readonly agents?: () => Response;
}

/**
 * A `Resolver` over a fake API, plus the exact sequence of paths it requested.
 */
function harness(api: FakeApi): { resolver: Resolver; paths: string[] } {
  const paths: string[] = [];
  const logger = silentLogger();

  const fetchImpl: FetchLike = (url) => {
    const path = new URL(url).pathname;
    paths.push(path);

    const pulls = /^\/repos\/([^/]+)\/pulls$/.exec(path);
    if (path === '/repos' && api.repos !== undefined) return Promise.resolve(api.repos());
    if (pulls !== null && api.pulls !== undefined) {
      return Promise.resolve(api.pulls(decodeURIComponent(pulls[1] ?? '')));
    }
    if (path === '/agents' && api.agents !== undefined) return Promise.resolve(api.agents());

    return Promise.resolve(errorResponse(404, 'not_found', `no fake route for ${path}`));
  };

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, logger });
  return { resolver: new Resolver({ client, logger }), paths };
}

/** The full happy-path API: three repos, four pull requests, two agents. */
function fullApi(): FakeApi {
  return {
    repos: () => json(REPOS),
    pulls: (repoId) => json(repoId === 'repo-acme-payments-api' ? ACME_PULLS : []),
    agents: () => json(AGENTS),
  };
}

// --------------------------------------------------------------------------

describe('Resolver.resolveRepo', () => {
  it('resolves owner/name, a bare unique name and a mistyped case from ONE GET /repos', async () => {
    const { resolver, paths } = harness(fullApi());

    const byFullName = await resolver.resolveRepo('acme/payments-api');
    const byBareName = await resolver.resolveRepo('billing');
    const byWrongCase = await resolver.resolveRepo('ACME/Payments-API');

    expect(byFullName.ok).toBe(true);
    expect(byFullName.ok && byFullName.data).toMatchObject({
      id: 'repo-acme-payments-api',
      owner: 'acme',
      name: 'payments-api',
      fullName: 'acme/payments-api',
    });

    expect(byBareName.ok && byBareName.data.fullName).toBe('initech/billing');
    // The resolved name is DevDigest's spelling, not the caller's.
    expect(byWrongCase.ok && byWrongCase.data.fullName).toBe('acme/payments-api');

    // Three resolutions, one request: this is the cache paying for itself.
    expect(paths).toEqual(['/repos']);
  });

  it('reports both candidates for an ambiguous bare name, and does NOT refetch', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolveRepo('payments-api');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(result.message).toContain('acme/payments-api and globex/payments-api');
    expect(result.message).toContain('Pass the full owner/name');
    expect(result.message).toMatch(IMPERATIVE);

    // `repos_ws_fullname_uq` only makes owner/name unique, so a bare name really
    // can hit twice - and a second copy of the same list cannot decide it, which
    // is why this is the one miss that costs no extra request.
    expect(paths).toEqual(['/repos']);
  });

  it('costs exactly two requests on a miss, then reports every alternative', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolveRepo('acme/nope');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(result.message).toContain('acme/payments-api');
    expect(result.message).toContain('globex/payments-api');
    expect(result.message).toContain('initech/billing');
    expect(result.message).toMatch(IMPERATIVE);

    // Exactly one refetch on the miss - never a poll loop.
    expect(paths).toEqual(['/repos', '/repos']);
  });

  it('caps the alternatives it lists and says how many it withheld', async () => {
    const many = Array.from({ length: MAX_LISTED_ALTERNATIVES + 5 }, (_unused, index) =>
      repoRow('demo', `api-${String(index).padStart(2, '0')}`),
    );
    const { resolver } = harness({ repos: () => json(many) });

    const result = await resolver.resolveRepo('demo/absent');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('demo/api-00');
    expect(result.message).toContain(`demo/api-${String(MAX_LISTED_ALTERNATIVES - 1)}`);
    expect(result.message).not.toContain('demo/api-24');
    expect(result.message).toContain('(+5 more)');
  });

  it('resolves a repository imported after the cache was filled, on that one refetch', async () => {
    let imported = false;
    const { resolver, paths } = harness({
      repos: () => json(imported ? [...REPOS, repoRow('late', 'arrival')] : REPOS),
    });

    await resolver.resolveRepo('acme/payments-api');
    expect(paths).toEqual(['/repos']);

    imported = true;
    const late = await resolver.resolveRepo('late/arrival');

    // The warm cache missed, one refetch found it: no process restart needed.
    expect(late.ok && late.data.id).toBe('repo-late-arrival');
    expect(paths).toEqual(['/repos', '/repos']);

    // And the refetched list replaced the cache, so the next call is free.
    await resolver.resolveRepo('late/arrival');
    expect(paths).toEqual(['/repos', '/repos']);
  });

  it('gives an empty GET /repos its own text, naming the memoised workspace', async () => {
    const { resolver, paths } = harness({ repos: () => json([]) });

    const result = await resolver.resolveRepo('acme/payments-api');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The common cause is not "no repositories" - it is a workspace the API
    // memoised at startup (server/INSIGHTS.md, 2026-08-06), and no retry from
    // here fixes that. The message has to say so.
    expect(result.message).toContain('memoised');
    expect(result.message).toContain('restart');
    expect(result.message).toContain('./scripts/dev.sh');
    expect(result.message).toMatch(IMPERATIVE);
    expect(paths).toEqual(['/repos', '/repos']);
  });

  it('asks nothing at all when no repository was given', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolveRepo('   ');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('passes an API failure through as an ApiFailure, and never caches it', async () => {
    const { resolver, paths } = harness({
      repos: () => errorResponse(500, 'internal_error', 'Internal error'),
    });

    const first = await resolver.resolveRepo('acme/payments-api');
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.reason).toBe('api');
    expect(first.reason === 'api' && first.failure.kind).toBe('server');
    expect(first.message).toMatch(IMPERATIVE);

    // Positive-only caching: a failed list is not remembered as "no repos".
    await resolver.resolveRepo('acme/payments-api');
    expect(paths).toEqual(['/repos', '/repos']);
  });
});

describe('Resolver.resolvePull', () => {
  it('resolves two pull requests of one repository with ONE expensive pulls call', async () => {
    const { resolver, paths } = harness(fullApi());

    const first = await resolver.resolvePull('acme/payments-api', 482);
    const second = await resolver.resolvePull('acme/payments-api', 7);

    expect(first.ok && first.data.id).toBe('pr-482');
    expect(first.ok && first.data.number).toBe(482);
    expect(first.ok && first.data.repo.fullName).toBe('acme/payments-api');
    // The row travels with the resolution, so a tool needs no second read.
    expect(first.ok && first.data.meta.head_sha).toBe('sha-482');
    expect(second.ok && second.data.id).toBe('pr-7');

    expect(paths).toEqual(['/repos', ACME_PULLS_PATH]);
  });

  it('costs exactly two pulls calls on a miss, then lists the numbers it knows', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolvePull('acme/payments-api', 1234);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    // Newest first, and #9 is absent because it has no id to resolve to.
    expect(result.message).toContain('#482, #7, #4');
    expect(result.message).not.toContain('#9');
    expect(result.message).toContain('NUMBER');
    expect(result.message).toMatch(IMPERATIVE);

    expect(paths).toEqual(['/repos', ACME_PULLS_PATH, ACME_PULLS_PATH]);
  });

  it('gives the row with no id its own message instead of "no such pull request"', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolvePull('acme/payments-api', 9);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The number is right; what is missing is the internal id. Telling the
    // caller to check the number would send them after a correct value.
    expect(result.message).toContain('#9');
    expect(result.message).toContain('no internal id');
    expect(result.message).toMatch(IMPERATIVE);
    expect(paths).toEqual(['/repos', ACME_PULLS_PATH, ACME_PULLS_PATH]);
  });

  it('gives a repository with no pull requests at all its own text', async () => {
    const { resolver } = harness(fullApi());

    const result = await resolver.resolvePull('initech/billing', 3);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('initech/billing');
    expect(result.message).toContain('GitHub token');
    expect(result.message).toMatch(IMPERATIVE);
  });

  it('passes a 404 from the expensive pulls list through as not_found', async () => {
    // The seeded acme/payments-api does not exist on GitHub, so its sync can
    // fail outright rather than answering an empty list.
    const { resolver, paths } = harness({
      repos: () => json(REPOS),
      pulls: () => errorResponse(404, 'not_found', 'Repo not found'),
    });

    const result = await resolver.resolvePull('acme/payments-api', 482);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('api');
    expect(result.reason === 'api' && result.failure.kind).toBe('not_found');
    expect(result.message).toMatch(IMPERATIVE);
    // One attempt, not two: an API failure is not a cache miss.
    expect(paths).toEqual(['/repos', ACME_PULLS_PATH]);
  });

  it('reports the repository problem when the repository is what is wrong', async () => {
    const { resolver, paths } = harness(fullApi());

    const result = await resolver.resolvePull('payments-api', 482);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Pass the full owner/name');
    // Never touches the expensive list when the repository did not resolve.
    expect(paths).toEqual(['/repos']);
  });
});

describe('Resolver agents', () => {
  it('memoises GET /agents and names the real agents for an unknown id', async () => {
    const { resolver, paths } = harness(fullApi());

    const first = await resolver.agents();
    const second = await resolver.agents();

    expect(first.ok && first.data).toHaveLength(2);
    expect(second.ok && second.data[0]?.name).toBe('Security Reviewer');
    expect(paths).toEqual(['/agents']);

    const message = await resolver.unknownAgentMessage('made-up-id');

    expect(message).toContain('made-up-id');
    expect(message).toContain('Security Reviewer (id agent-1)');
    // Agents are addressed by id, never by name: `agents.name` has no unique
    // constraint, so a name can legally address two agents.
    expect(message).toContain('devdigest_list_agents');
    expect(message).toMatch(IMPERATIVE);
    // Served from the cache filled above.
    expect(paths).toEqual(['/agents']);
  });

  it('still names the next call when the agent list itself cannot be read', async () => {
    const { resolver } = harness({
      agents: () => errorResponse(500, 'internal_error', 'Internal error'),
    });

    const message = await resolver.unknownAgentMessage('made-up-id');

    expect(message).toContain('devdigest_list_agents');
    expect(message).toContain('could not list');
    expect(message).toMatch(IMPERATIVE);
  });
});

describe('every unresolved message', () => {
  /**
   * One table over every message this file can produce, so a new one cannot be
   * added without an imperative verb. Same shape as the `API_FAILURE_KINDS` loop
   * in `test/errors.test.ts`.
   */
  const SCENARIOS: readonly { readonly name: string; readonly run: () => Promise<string> }[] = [
    {
      name: 'blank repo',
      run: async () => messageOf(await harness(fullApi()).resolver.resolveRepo('')),
    },
    {
      name: 'no repositories imported',
      run: async () =>
        messageOf(await harness({ repos: () => json([]) }).resolver.resolveRepo('acme/api')),
    },
    {
      name: 'unknown repository',
      run: async () => messageOf(await harness(fullApi()).resolver.resolveRepo('acme/nope')),
    },
    {
      name: 'ambiguous bare name',
      run: async () => messageOf(await harness(fullApi()).resolver.resolveRepo('payments-api')),
    },
    {
      name: 'owner/name ambiguous only by case',
      run: async () =>
        messageOf(
          await harness({
            repos: () => json([repoRow('acme', 'api'), repoRow('ACME', 'api')]),
          }).resolver.resolveRepo('acme/API'),
        ),
    },
    {
      name: 'unknown pull request',
      run: async () =>
        messageOf(await harness(fullApi()).resolver.resolvePull('acme/payments-api', 1234)),
    },
    {
      name: 'repository with no pull requests',
      run: async () => messageOf(await harness(fullApi()).resolver.resolvePull('initech/billing', 3)),
    },
    {
      name: 'pull request row with no id',
      run: async () =>
        messageOf(await harness(fullApi()).resolver.resolvePull('acme/payments-api', 9)),
    },
    {
      name: 'unknown agent id',
      run: () => harness(fullApi()).resolver.unknownAgentMessage('made-up-id'),
    },
    {
      name: 'unknown agent id, agents unreadable',
      run: () =>
        harness({
          agents: () => errorResponse(503, 'internal_error', 'Internal error'),
        }).resolver.unknownAgentMessage('made-up-id'),
    },
  ];

  it('reads as an instruction and is a sentence, not a code dump', async () => {
    for (const scenario of SCENARIOS) {
      const message = await scenario.run();

      expect(message, `${scenario.name} has no instruction`).toMatch(IMPERATIVE);
      expect(message.length, `${scenario.name} too short`).toBeGreaterThan(80);
      expect(message.length, `${scenario.name} too long`).toBeLessThan(900);
      expect(message).not.toMatch(/^[A-Z_]+$/);
      // No internal id is ever quoted at the model: it addresses by name and
      // number, and a uuid in the text invites it to reuse one.
      expect(message, `${scenario.name} leaks an internal id`).not.toContain('repo-acme');
    }
  });
});

/** The message of a resolution that must have failed. */
function messageOf(result: { readonly ok: boolean; readonly message?: string }): string {
  expect(result.ok).toBe(false);
  return result.message ?? '';
}
