/**
 * run-agent.test.ts — the wait loop of `devdigest_run_agent_on_pr`, hermetic and
 * with no real waiting.
 *
 * ## Why `node:timers/promises` is mocked here
 *
 * `src/tools/run-agent-on-pr.ts` awaits `setTimeout` from `node:timers/promises`,
 * which is the right thing for the source: it is the promise API, it needs no
 * callback wrapper, and it cannot leak a dangling timer.
 *
 * Vitest's fake timers do **not** drive it, though. Measured on vitest 2.1.9:
 * `await vi.advanceTimersByTimeAsync(1600)` never resolves a pending
 * `await delay(1500)` from that module, because `@sinonjs/fake-timers` replaces
 * the GLOBAL `setTimeout` while `node:timers/promises` reaches Node's timer
 * internals directly. So the module is replaced here with a one-line adapter over
 * `globalThis.setTimeout`, which the fake clock does control. Same semantics, and
 * the source keeps the API it should have.
 *
 * ## What the loop has to get right, and why each one is asserted
 *
 *  - The POST body is ALWAYS `{agentId}` - an empty body is a 400.
 *  - `null` and any unrecognised status are NOT terminal. `RunSummary.status` is
 *    `z.string().nullable()`, so "not one of the three I know" must mean "keep
 *    waiting", never "finished".
 *  - Our run missing from three consecutive polls stops the loop.
 *    `listRunsForPull` answers `[]` for a pull request that does not exist, with
 *    no error, so a loop keyed on "no runs yet" would spin forever.
 *  - Exactly ONE `GET /pulls/:id/reviews`, and only after a `done` status.
 *  - The 120 s budget returns `{status:'running', run_id, next_step}` as a
 *    SUCCESS. That is the normal path for a large diff, not an edge case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, ms);
    }),
}));

const { ApiClient } = await import('../src/api/client.js');
const { Resolver } = await import('../src/resolve.js');
const { getFindings } = await import('../src/tools/get-findings.js');
const { MAX_CONSECUTIVE_ABSENCES, MAX_RUN_ERROR_CHARS, runAgentOnPr } = await import(
  '../src/tools/run-agent-on-pr.js'
);
const { DEFAULT_POLL_INTERVAL_MS, DEFAULT_RUN_TIMEOUT_MS } = await import('../src/config.js');

type FetchLike = import('../src/api/client.js').FetchLike;
type ToolDeps = import('../src/tools/schemas.js').ToolDeps;
type Logger = import('../src/log.js').Logger;
type LogFields = import('../src/log.js').LogFields;

const IMPERATIVE =
  /(Start|Wait|Retry|retry|Check|check|Call|call|Open|open|Use|use|Enable|enable|Pick|pick|report|set) /;

const BASE_URL = 'http://localhost:3001';
const AGENT_ID = 'agent-1';
const RUN_ID = 'run-1';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const REPO: Repo = {
  id: 'repo-1',
  workspace_id: 'ws-1',
  owner: 'acme',
  name: 'payments-api',
  full_name: 'acme/payments-api',
  default_branch: 'main',
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const PULL: PrMeta = {
  id: 'pr-1',
  number: 482,
  title: 'Add rate limiting',
  author: 'octocat',
  branch: 'feature/rate-limit',
  base: 'main',
  head_sha: 'sha-482',
  additions: 120,
  deletions: 8,
  files_count: 4,
  status: 'needs_review',
};

function agentRow(enabled: boolean): Agent {
  return {
    id: AGENT_ID,
    name: 'Security Reviewer',
    description: 'Reviews for security problems',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    system_prompt: 'You are a reviewer.',
    enabled,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
  };
}

function runRow(input: {
  readonly status: string | null;
  readonly error?: string | null;
  readonly runId?: string;
}): RunSummary {
  return {
    run_id: input.runId ?? RUN_ID,
    agent_id: AGENT_ID,
    agent_name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    status: input.status,
    error: input.error ?? null,
    duration_ms: 18_422,
    tokens_in: 4_100,
    tokens_out: 900,
    cost_usd: 0.0031,
    findings_count: 2,
    grounding: 'ok',
    ran_at: '2026-08-13T10:00:00.000Z',
    score: 42,
    blockers: 1,
  };
}

const FINDING: FindingRecord = {
  id: 'f-1',
  review_id: 'review-1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'SQL injection in the users route',
  file: 'src/api/users.ts',
  start_line: 13,
  end_line: 13,
  rationale: 'The identifier is interpolated into the query.',
  suggestion: 'Bind the parameter.',
  confidence: 0.95,
  accepted_at: null,
  dismissed_at: null,
};

const REVIEW: ReviewRecord = {
  id: 'review-1',
  pr_id: 'pr-1',
  agent_id: AGENT_ID,
  run_id: RUN_ID,
  agent_name: 'Security Reviewer',
  kind: 'review',
  verdict: 'request_changes',
  summary: 'One blocking problem.',
  score: 42,
  model: 'gpt-4.1-mini',
  grounding: 'ok',
  created_at: '2026-08-13T10:00:00.000Z',
  findings: [FINDING],
};

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

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId?: string,
): Response {
  const error =
    requestId === undefined ? { code, message } : { code, message, details: { requestId } };
  return json({ error }, { status });
}

function silentLogger(): Logger {
  const drop = (_message: string, _fields?: LogFields): void => undefined;
  return { error: drop, warn: drop, info: drop, debug: drop };
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
}

interface Scenario {
  /** One entry per poll of `GET /pulls/:id/runs`, in order. The last repeats. */
  readonly polls: readonly (readonly RunSummary[])[];
  readonly reviews?: readonly ReviewRecord[];
  readonly agentEnabled?: boolean;
  /** Response for `POST /pulls/:id/review`; the default creates one run. */
  readonly startReview?: () => Response;
  /** When set, `GET /pulls/:id/runs` answers this instead of a poll entry. */
  readonly runsFail?: () => Response;
  /** Overrides `GET /repos` — for the `pr_id` path, which needs it to name the repo. */
  readonly repos?: () => Response;
  /** Overrides `GET /repos/:id/pulls`, the list the `pr_id` search walks. */
  readonly pulls?: () => Response;
}

interface Harness {
  readonly deps: ToolDeps;
  readonly calls: Call[];
  /** Paths of the calls, for a readable sequence assertion. */
  paths(): string[];
  countOf(path: string): number;
}

function harness(scenario: Scenario): Harness {
  const calls: Call[] = [];
  const logger = silentLogger();
  let pollIndex = 0;

  const fetchImpl: FetchLike = (url, init) => {
    const path = new URL(url).pathname;
    const body = typeof init.body === 'string' ? init.body : null;
    calls.push({ method: init.method ?? 'GET', path, body });

    if (path === '/repos') {
      return Promise.resolve(scenario.repos === undefined ? json([REPO]) : scenario.repos());
    }
    // PR detail. The `pr_id` path reaches this to validate the uuid and read the
    // number; it is also what backfills `pr_files` server-side.
    if (path === '/pulls/pr-1') {
      return Promise.resolve(json({ ...PULL, body: null, files: [], commits: [] }));
    }
    if (/^\/repos\/[^/]+\/pulls$/.test(path)) {
      if (scenario.pulls !== undefined) return Promise.resolve(scenario.pulls());
      return Promise.resolve(path === '/repos/repo-1/pulls' ? json([PULL]) : json([]));
    }
    if (path === '/agents') {
      return Promise.resolve(json([agentRow(scenario.agentEnabled ?? true)]));
    }
    if (path === '/pulls/pr-1/review') {
      if (scenario.startReview !== undefined) return Promise.resolve(scenario.startReview());
      return Promise.resolve(
        json({
          pr_id: 'pr-1',
          runs: [{ run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Security Reviewer' }],
          // Always empty: the run is fire-and-forget, whatever the contract's
          // doc-comment claims about a synchronous run.
          reviews: [],
        }),
      );
    }
    if (path === '/pulls/pr-1/runs') {
      if (scenario.runsFail !== undefined) return Promise.resolve(scenario.runsFail());
      const index = Math.min(pollIndex, scenario.polls.length - 1);
      pollIndex += 1;
      return Promise.resolve(json(scenario.polls[index] ?? []));
    }
    if (path === '/pulls/pr-1/reviews') return Promise.resolve(json(scenario.reviews ?? []));

    return Promise.resolve(errorResponse(404, 'not_found', `no fake route for ${path}`));
  };

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, logger });
  const deps: ToolDeps = {
    client,
    resolver: new Resolver({ client, logger }),
    config: {
      apiUrl: BASE_URL,
      runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      logLevel: 'error',
    },
    logger,
    runOrigins: new Map(),
  };

  return {
    deps,
    calls,
    paths: () => calls.map((call) => call.path),
    countOf: (path) => calls.filter((call) => call.path === path).length,
  };
}

const ARGS = { repo: 'acme/payments-api', pr: 482, agent_id: AGENT_ID };

/**
 * Drive the fake clock until the tool's promise settles.
 *
 * The loop is bounded so a bug in the source fails the test instead of hanging
 * it: 400 virtual seconds is more than three times the 120 s budget.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  for (let step = 0; step < 400 && !settled; step += 1) {
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return promise;
}

function payloadOf(outcome: { readonly ok: boolean }): Record<string, unknown> {
  expect(outcome.ok).toBe(true);
  if (!('payload' in outcome)) throw new Error('outcome carries no payload');
  return outcome.payload as Record<string, unknown>;
}

function instructionOf(outcome: { readonly ok: boolean }): string {
  expect(outcome.ok).toBe(false);
  if (!('instruction' in outcome)) throw new Error('outcome carries no instruction');
  return String(outcome.instruction);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --------------------------------------------------------------------------

describe('devdigest_run_agent_on_pr — completed', () => {
  it('creates one run, waits for it and returns the verdict with its findings', async () => {
    const test = harness({
      polls: [[runRow({ status: 'running' })], [runRow({ status: 'done' })]],
      reviews: [REVIEW],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('completed');
    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.pr).toBe(482);
    expect(payload.agent).toBe('Security Reviewer');
    expect(payload.verdict).toBe('request_changes');
    expect(payload.score).toBe(42);
    expect(payload.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(payload.run).toEqual({ run_id: RUN_ID, duration_ms: 18_422, cost_usd: 0.0031 });
    expect(payload.summary).toBe('One blocking problem.');

    const findings = payload.findings as Record<string, unknown>[];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('src/api/users.ts:13');
    expect(Object.keys(findings[0] ?? {})).toEqual(['severity', 'title', 'file', 'rationale']);

    // A disabled-agent note is absent when the agent is enabled.
    expect(Object.keys(payload)).not.toContain('note');

    // The whole sequence: resolve, POST, read agents for the note, poll twice,
    // then ONE read of the reviews.
    expect(test.paths()).toEqual([
      '/repos',
      '/repos/repo-1/pulls',
      '/pulls/pr-1/review',
      '/agents',
      '/pulls/pr-1/runs',
      '/pulls/pr-1/runs',
      '/pulls/pr-1/reviews',
    ]);
    expect(test.countOf('/pulls/pr-1/reviews')).toBe(1);
  });

  it('always posts {agentId}, never an empty body', async () => {
    const test = harness({ polls: [[runRow({ status: 'done' })]], reviews: [REVIEW] });

    await settle(runAgentOnPr(ARGS, test.deps));

    const post = test.calls.find((call) => call.path === '/pulls/pr-1/review');
    expect(post?.method).toBe('POST');
    // An empty body makes the server's `resolveTargets` throw
    // `invalid_run_request` (400), and a body-less POST declaring JSON is a 400
    // from Fastify itself.
    expect(post?.body).toBe(JSON.stringify({ agentId: AGENT_ID }));
  });

  it('registers the run so devdigest_get_findings can be handed the bare run id', async () => {
    const test = harness({ polls: [[runRow({ status: 'done' })]], reviews: [REVIEW] });

    await settle(runAgentOnPr(ARGS, test.deps));

    // The pair closes: this server can look up the run id it just handed out,
    // which is what the `running` path depends on.
    expect(test.deps.runOrigins.get(RUN_ID)).toEqual({
      prId: 'pr-1',
      repo: 'acme/payments-api',
      pr: 482,
      agentName: 'Security Reviewer',
    });

    const followUp = payloadOf(await getFindings({ run_id: RUN_ID }, test.deps));
    expect(followUp.reviewed).toBe(true);
    expect(followUp.run_id).toBe(RUN_ID);
  });

  it('notes that a DISABLED agent named by id really ran', async () => {
    const test = harness({
      polls: [[runRow({ status: 'done' })]],
      reviews: [REVIEW],
      agentEnabled: false,
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('completed');
    // `resolveTargets` reaches an explicit agent id through `getById`, which does
    // NOT filter on `enabled` - so the results are real and the surprise has to be
    // named rather than hidden.
    expect(String(payload.note)).toContain('disabled');
    expect(String(payload.note)).toContain('Security Reviewer');
    expect(String(payload.note)).toMatch(IMPERATIVE);
  });

  it('reports a done run whose review row is missing, instead of claiming a clean review', async () => {
    const test = harness({ polls: [[runRow({ status: 'done' })]], reviews: [] });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('completed');
    expect(payload.verdict).toBeNull();
    expect(payload.findings).toEqual([]);
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
    expect(String(payload.next_step)).toContain(RUN_ID);
  });
});

describe('devdigest_run_agent_on_pr — the pr_id path', () => {
  it('runs a review addressed by the pull request uuid alone', async () => {
    const test = harness({
      polls: [[runRow({ status: 'done' })]],
      reviews: [REVIEW],
    });

    const payload = payloadOf(
      await settle(runAgentOnPr({ pr_id: 'pr-1', agent_id: AGENT_ID }, test.deps)),
    );

    expect(payload.status).toBe('completed');
    // The repository is named from the single-repository shortcut, so every sentence
    // this run can produce still has a name to use.
    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.pr).toBe(482);
  });

  it('refuses rather than reporting a run against an unnamed repository', async () => {
    // Two repositories and neither lists this pull, so nothing can name it. Unlike
    // the read tools, this one cannot omit the name: it stores it in `runOrigins` and
    // builds ten messages from it. Refusing with the recommended form is cheaper for
    // the caller than a run reported against "unknown".
    const test = harness({
      polls: [[runRow({ status: 'done' })]],
      repos: () =>
        json([REPO, { ...REPO, id: 'repo-2', name: 'other', full_name: 'acme/other' }]),
      // No repository lists it, so neither the cache, the single-repo shortcut nor the
      // bounded search can name it.
      pulls: () => json([]),
    });

    const instruction = instructionOf(
      await settle(runAgentOnPr({ pr_id: 'pr-1', agent_id: AGENT_ID }, test.deps)),
    );

    expect(instruction).toContain('could not tell which repository');
    expect(instruction).toContain('repo');
    expect(instruction).toMatch(IMPERATIVE);
    // Nothing was started, so no model call was spent.
    expect(test.countOf('/pulls/pr-1/review')).toBe(0);
  });

  it('names both address forms when the pull request is not identified at all', async () => {
    const test = harness({ polls: [[runRow({ status: 'done' })]] });
    const instruction = instructionOf(
      await settle(runAgentOnPr({ agent_id: AGENT_ID }, test.deps)),
    );
    expect(instruction).toContain('pr_id');
    expect(instruction).toContain('repo');
    expect(instruction).toMatch(IMPERATIVE);
    expect(test.paths()).toEqual([]);
  });
});

describe('devdigest_run_agent_on_pr — not terminal yet', () => {
  it('treats null and an unrecognised status as still running', async () => {
    const test = harness({
      polls: [
        // `RunSummary.status` is `z.string().nullable()`: neither of these two may
        // end the wait, or a running review is reported as complete.
        [runRow({ status: null })],
        [runRow({ status: 'queued' })],
        [runRow({ status: 'reaping' })],
        [runRow({ status: 'done' })],
      ],
      reviews: [REVIEW],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('completed');
    expect(test.countOf('/pulls/pr-1/runs')).toBe(4);
  });

  it('ignores other agents’ runs on the same pull request', async () => {
    const test = harness({
      polls: [
        [runRow({ status: 'done', runId: 'someone-elses-run' })],
        [runRow({ status: 'done', runId: 'someone-elses-run' }), runRow({ status: 'done' })],
      ],
      reviews: [REVIEW],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    // The first poll carries a terminal run that is NOT ours. Keying on the run id
    // from the POST is what keeps that from ending the wait.
    expect(payload.status).toBe('completed');
    expect(test.countOf('/pulls/pr-1/runs')).toBe(2);
  });
});

describe('devdigest_run_agent_on_pr — failed', () => {
  it('reports the error and the next step, and reads no reviews', async () => {
    const test = harness({
      polls: [[runRow({ status: 'failed', error: 'OpenAI rejected the API key' })]],
      reviews: [REVIEW],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('failed');
    expect(payload.error).toBe('OpenAI rejected the API key');
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
    expect(String(payload.next_step)).toContain('Settings');
    // A failed run wrote no review, so asking for one would be a request that can
    // only answer "nothing".
    expect(test.countOf('/pulls/pr-1/reviews')).toBe(0);
  });

  it('caps a very long error', async () => {
    const test = harness({
      polls: [[runRow({ status: 'failed', error: 'x'.repeat(2_000) })]],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(String(payload.error)).toHaveLength(MAX_RUN_ERROR_CHARS);
  });

  it('says something useful when a failed run recorded no message at all', async () => {
    const test = harness({ polls: [[runRow({ status: 'failed', error: null })]] });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(String(payload.error)).toContain('no error message');
  });

  it('distinguishes a cancelled run from a failed one', async () => {
    const test = harness({ polls: [[runRow({ status: 'cancelled' })]] });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('failed');
    expect(String(payload.next_step)).toContain('cancelled');
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
  });
});

describe('devdigest_run_agent_on_pr — running at the budget', () => {
  it('returns status running as a SUCCESS, naming get_findings and the run id', async () => {
    const test = harness({ polls: [[runRow({ status: 'running' })]] });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    // The normal path for a large diff, not an error: one review can legitimately
    // outlast 120s (three provider attempts of up to 90s each).
    expect(payload.status).toBe('running');
    expect(Object.keys(payload)).toEqual(['status', 'run_id', 'next_step']);
    expect(payload.run_id).toBe(RUN_ID);
    expect(String(payload.next_step)).toContain('devdigest_get_findings');
    expect(String(payload.next_step)).toContain(RUN_ID);
    // It also names the repo + pr fallback, for a session that has ended by then.
    expect(String(payload.next_step)).toContain('acme/payments-api');
    expect(String(payload.next_step)).toMatch(IMPERATIVE);

    // Bounded by the budget, and the interval it says it uses: 1.5s then every 2s.
    const polls = test.countOf('/pulls/pr-1/runs');
    const expected = Math.floor((DEFAULT_RUN_TIMEOUT_MS - 1_500) / DEFAULT_POLL_INTERVAL_MS) + 1;
    expect(polls).toBeGreaterThanOrEqual(expected - 2);
    expect(polls).toBeLessThanOrEqual(expected + 1);
    expect(test.countOf('/pulls/pr-1/reviews')).toBe(0);

    // The run is still resolvable afterwards - that is what makes the timeout path
    // cheap rather than lossy.
    expect(test.deps.runOrigins.has(RUN_ID)).toBe(true);
  });

  it('honours a shorter configured budget', async () => {
    const test = harness({ polls: [[runRow({ status: 'running' })]] });
    const deps: ToolDeps = {
      ...test.deps,
      config: { ...test.deps.config, runTimeoutMs: 30_000, pollIntervalMs: 5_000 },
    };

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, deps)));

    expect(payload.status).toBe('running');
    expect(test.countOf('/pulls/pr-1/runs')).toBeLessThanOrEqual(8);
  });
});

describe('devdigest_run_agent_on_pr — the run disappears', () => {
  it('stops after three consecutive absences instead of spinning', async () => {
    // `listRunsForPull` does not verify the pull request exists and answers `[]`
    // without erroring, so this is the shape a loop keyed on "no runs yet" would
    // spin on forever.
    const test = harness({ polls: [[]] });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(payload.status).toBe('failed');
    expect(test.countOf('/pulls/pr-1/runs')).toBe(MAX_CONSECUTIVE_ABSENCES);
    expect(String(payload.error)).toContain(RUN_ID);
    expect(String(payload.error)).toContain(String(MAX_CONSECUTIVE_ABSENCES));
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
    expect(String(payload.next_step)).toContain('devdigest_get_findings');
  });

  it('does not stop on a single absence mid-write', async () => {
    const test = harness({
      polls: [[], [runRow({ status: 'running' })], [], [runRow({ status: 'done' })]],
      reviews: [REVIEW],
    });

    const payload = payloadOf(await settle(runAgentOnPr(ARGS, test.deps)));

    // The counter RESETS on a poll that sees the run, so two isolated absences are
    // not three consecutive ones.
    expect(payload.status).toBe('completed');
    expect(test.countOf('/pulls/pr-1/runs')).toBe(4);
  });
});

describe('devdigest_run_agent_on_pr — failures before the loop', () => {
  it('sends an unknown agent id to devdigest_list_agents, naming the ids that exist', async () => {
    const test = harness({
      polls: [[]],
      startReview: () => errorResponse(404, 'not_found', 'Agent not found'),
    });

    const instruction = instructionOf(await settle(runAgentOnPr({ ...ARGS, agent_id: 'nope' }, test.deps)));

    expect(instruction).toContain('nope');
    expect(instruction).toContain('devdigest_list_agents');
    expect(instruction).toContain('Security Reviewer (id agent-1)');
    expect(instruction).toMatch(IMPERATIVE);
    expect(test.countOf('/pulls/pr-1/runs')).toBe(0);
  });

  it('reports a rate limit as an instruction rather than starting a second run', async () => {
    const test = harness({
      polls: [[]],
      startReview: () => errorResponse(429, 'internal_error', 'Rate limit exceeded'),
    });

    const instruction = instructionOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(instruction).toContain('120 requests per minute');
    expect(instruction).toContain('do not start a second review');
    expect(instruction).toMatch(IMPERATIVE);
  });

  it('stops on a mistyped pull request before posting anything', async () => {
    const test = harness({ polls: [[]] });

    const instruction = instructionOf(
      await settle(runAgentOnPr({ ...ARGS, pr: 9_999 }, test.deps)),
    );

    expect(instruction).toContain('#482');
    expect(instruction).toMatch(IMPERATIVE);
    expect(test.countOf('/pulls/pr-1/review')).toBe(0);
  });

  it('reports a POST that created no run', async () => {
    const test = harness({
      polls: [[]],
      startReview: () => json({ pr_id: 'pr-1', runs: [], reviews: [] }),
    });

    const instruction = instructionOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(instruction).toContain('devdigest_list_agents');
    expect(instruction).toMatch(IMPERATIVE);
    expect(test.countOf('/pulls/pr-1/runs')).toBe(0);
  });

  it('reports an API failure raised mid-wait, and stops polling', async () => {
    // The run was created, then the runs list started failing. That is an
    // instruction, not one of the three run statuses: this server does not know
    // what happened to the review, and must not guess.
    const test = harness({
      polls: [[runRow({ status: 'running' })]],
      runsFail: () => errorResponse(500, 'internal_error', 'Internal error', 'req-77'),
    });

    const instruction = instructionOf(await settle(runAgentOnPr(ARGS, test.deps)));

    expect(instruction).toMatch(IMPERATIVE);
    expect(instruction).toContain('requestId req-77');
    expect(test.countOf('/pulls/pr-1/runs')).toBe(1);
  });
});
