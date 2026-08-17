/**
 * errors.test.ts — hermetic. The injected `fetchImpl` is the only seam this
 * suite needs, so nothing here opens a socket.
 *
 * Two halves:
 *
 *  1. The table-driven proof of R7 ("every failure returns an instruction, not a
 *     code"). `SAMPLES` is typed `Record<ApiFailureKind, ApiFailure>`, so an
 *     eighth variant added to the union fails `tsc -p tsconfig.eslint.json`
 *     until it has a fixture, and the loop over `API_FAILURE_KINDS` then fails
 *     until that fixture's message carries an imperative verb.
 *  2. `ApiClient` driven through a fake `fetchImpl`: the classification a status
 *     code decides, the URL a segment list produces, the header a body implies,
 *     and the promise that no expected condition throws.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  API_FAILURE_KINDS,
  httpFailure,
  instructionFor,
  malformedFailure,
  type ApiFailure,
  type ApiFailureKind,
} from '../src/errors.js';
import { ApiClient, REQUEST_TIMEOUT_MS, type FetchLike } from '../src/api/client.js';
import type { LogFields, Logger } from '../src/log.js';

/**
 * The assertion the plan turns the fourth principle ("an error leads onward")
 * into: an instruction contains a verb telling the caller what to DO.
 */
const IMPERATIVE = /(Start|Wait|Retry|retry|Check|check|report|set) /;

const CALL = { method: 'GET', path: '/agents' } as const;

/**
 * One fixture per variant. Exhaustive by TYPE, not by discipline — the `Record`
 * key is the union of kinds.
 */
const SAMPLES: Record<ApiFailureKind, ApiFailure> = {
  unreachable: {
    kind: 'unreachable',
    ...CALL,
    baseUrl: 'http://localhost:3001',
    cause: 'fetch failed: connect ECONNREFUSED 127.0.0.1:3001 (ECONNREFUSED)',
  },
  timeout: { kind: 'timeout', ...CALL, timeoutMs: 20_000 },
  not_found: { kind: 'not_found', ...CALL, message: 'Agent not found' },
  rate_limited: { kind: 'rate_limited', ...CALL, retryAfterSeconds: 42 },
  validation: {
    kind: 'validation',
    ...CALL,
    status: 422,
    message: 'Request validation failed',
    detail: '[{"path":["agentId"],"message":"Required"}]',
  },
  server: { kind: 'server', ...CALL, status: 500, requestId: 'req-17' },
  malformed: { kind: 'malformed', ...CALL, issues: ['0.status: Required'] },
};

describe('instructionFor', () => {
  it('gives every failure variant an instruction with an imperative verb', () => {
    expect(API_FAILURE_KINDS).toHaveLength(7);

    for (const kind of API_FAILURE_KINDS) {
      const message = instructionFor(SAMPLES[kind]);

      expect(message, `${kind} has no instruction`).toMatch(IMPERATIVE);
      // Long enough to be a sentence, short enough not to be a wall of text the
      // model will skim past.
      expect(message.length, `${kind} instruction too short`).toBeGreaterThan(80);
      expect(message.length, `${kind} instruction too long`).toBeLessThan(600);
      // It must not read like a code dump.
      expect(message).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('names the concrete next step for each variant', () => {
    // Each of these strings is the reason the variant exists at all.
    expect(instructionFor(SAMPLES.unreachable)).toContain('./scripts/dev.sh');
    expect(instructionFor(SAMPLES.unreachable)).toContain('DEVDIGEST_API_URL');

    expect(instructionFor(SAMPLES.rate_limited)).toContain('120 requests per minute');
    expect(instructionFor(SAMPLES.rate_limited)).toContain('studio');
    expect(instructionFor(SAMPLES.rate_limited)).toContain('42s');

    expect(instructionFor(SAMPLES.server)).toContain('requestId req-17');
    expect(instructionFor(SAMPLES.server)).toContain("API's own log");

    // The point of the validation text: do not send the model back to rewrite
    // arguments that were never the problem.
    expect(instructionFor(SAMPLES.validation)).toContain('bug in the request this MCP server');
    expect(instructionFor(SAMPLES.validation)).toContain('not in the arguments you passed');

    expect(instructionFor(SAMPLES.malformed)).toContain('0.status: Required');

    expect(instructionFor(SAMPLES.timeout)).toContain('cloning or indexing');
    expect(instructionFor(SAMPLES.timeout)).toContain('20s');

    expect(instructionFor(SAMPLES.not_found)).toContain('devdigest_list_agents');
  });

  it('still reads as an instruction when the optional facts are absent', () => {
    const noRetryAfter = instructionFor({ kind: 'rate_limited', ...CALL, retryAfterSeconds: null });
    expect(noRetryAfter).toMatch(IMPERATIVE);
    expect(noRetryAfter).toContain('about a minute');

    const noRequestId = instructionFor({ kind: 'server', ...CALL, status: 502, requestId: null });
    expect(noRequestId).toMatch(IMPERATIVE);
    // No id to quote, so the clause that would quote one is gone - it never
    // renders `requestId null` or `requestId undefined`.
    expect(noRequestId).not.toContain('on the line with requestId');
    expect(noRequestId).not.toMatch(/requestId (null|undefined)/);
  });
});

describe('httpFailure', () => {
  it('classifies 429 by STATUS, not by error.code', () => {
    // @fastify/rate-limit's error is neither an AppError nor a ZodError, so
    // server/src/app.ts's last branch rewrites it to `internal_error`. Reading
    // the code here would file every rate limit under `server`.
    const failure = httpFailure({
      call: CALL,
      status: 429,
      body: { error: { code: 'internal_error', message: 'Rate limit exceeded, retry in 1 minute' } },
      retryAfterSeconds: 60,
    });

    expect(failure.kind).toBe('rate_limited');
    expect(instructionFor(failure)).toContain('120 requests per minute');
  });

  it('maps 404 to not_found, other 4xx to validation, 5xx to server', () => {
    const notFound = httpFailure({
      call: CALL,
      status: 404,
      body: { error: { code: 'not_found', message: 'Repo not found' } },
      retryAfterSeconds: null,
    });
    expect(notFound).toMatchObject({ kind: 'not_found', message: 'Repo not found' });

    const badRequest = httpFailure({
      call: CALL,
      status: 400,
      body: { error: { code: 'invalid_run_request', message: 'agentId or all is required' } },
      retryAfterSeconds: null,
    });
    expect(badRequest).toMatchObject({ kind: 'validation', status: 400 });

    const serverSide = httpFailure({
      call: CALL,
      status: 500,
      body: {
        error: { code: 'internal_error', message: 'Internal error', details: { requestId: 'req-9' } },
      },
      retryAfterSeconds: null,
    });
    expect(serverSide).toMatchObject({ kind: 'server', status: 500, requestId: 'req-9' });
  });

  it('survives a body that is not the API error envelope', () => {
    const failure = httpFailure({
      call: CALL,
      status: 503,
      body: '<html>502 Bad Gateway</html>',
      retryAfterSeconds: null,
    });
    expect(failure).toMatchObject({ kind: 'server', requestId: null });
    expect(instructionFor(failure)).toMatch(IMPERATIVE);
  });
});

describe('malformedFailure', () => {
  it('names the offending field path and summarises the rest', () => {
    const schema = z.array(z.object({ run_id: z.string(), status: z.string() }));
    const parsed = schema.safeParse([{ run_id: 1 }, {}, {}, {}]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const failure = malformedFailure({ method: 'GET', path: '/pulls/x/runs' }, parsed.error);

    expect(failure.issues[0]).toContain('0.run_id');
    expect(failure.issues).toHaveLength(4); // 3 quoted + the "(+N more)" line
    expect(failure.issues.at(-1)).toMatch(/^\(\+\d+ more field/);
  });
});

// --------------------------------------------------------------------------
// ApiClient over a fake fetch. No socket is opened anywhere below.
// --------------------------------------------------------------------------

/** Every call the fake fetch saw, so the URL and headers can be asserted. */
interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(respond: (call: RecordedCall) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** A `Logger` that records instead of writing, so nothing reaches a stream. */
function recordingLogger(): { logger: Logger; lines: { message: string; fields?: LogFields }[] } {
  const lines: { message: string; fields?: LogFields }[] = [];
  const record = (message: string, fields?: LogFields) => {
    lines.push(fields === undefined ? { message } : { message, fields });
  };
  return {
    logger: { error: record, warn: record, info: record, debug: record },
    lines,
  };
}

const AGENT = {
  id: 'agent-1',
  name: 'Security Reviewer',
  description: 'Looks for injection and auth mistakes',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  system_prompt: 'You are a reviewer.',
  enabled: true,
  version: 3,
};

function clientFor(
  respond: (call: RecordedCall) => Response | Promise<Response>,
  logger?: Logger,
): { client: ApiClient; calls: RecordedCall[] } {
  const { fetchImpl, calls } = fakeFetch(respond);
  const client = new ApiClient({
    baseUrl: 'http://localhost:3001',
    fetchImpl,
    ...(logger === undefined ? {} : { logger }),
  });
  return { client, calls };
}

describe('ApiClient', () => {
  it('parses a good response with the shared contract schema', async () => {
    const { client, calls } = clientFor(() => json([AGENT]));

    const result = await client.listAgents();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.name).toBe('Security Reviewer');
    // Contract defaults are applied by the parse, so callers never see undefined.
    expect(result.data[0]?.strategy).toBe('single-pass');
    expect(result.data[0]?.ci_fail_on).toBe('critical');
    expect(calls[0]?.url).toBe('http://localhost:3001/agents');
  });

  it('percent-encodes every path segment, so a segment cannot escape its slot', async () => {
    const { client, calls } = clientFor(() => json([]));

    // A path traversal and a slash-carrying id: both must stay ONE component.
    await client.listPulls('../../health');
    await client.listReviews('a/b?x=1');

    expect(calls[0]?.url).toBe('http://localhost:3001/repos/..%2F..%2Fhealth/pulls');
    expect(calls[1]?.url).toBe('http://localhost:3001/pulls/a%2Fb%3Fx%3D1/reviews');
    for (const call of calls) {
      expect(call.url.startsWith('http://localhost:3001/')).toBe(true);
      expect(call.url).not.toMatch(/\.\.\//);
    }
  });

  it('sends content-type only when there is a body', async () => {
    const { client, calls } = clientFor((call) =>
      json(
        call.init.method === 'POST'
          ? { pr_id: 'pr-1', runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Sec' }], reviews: [] }
          : [],
      ),
    );

    await client.listRuns('pr-1');
    await client.startReview('pr-1', 'agent-1');

    const headersOf = (init: RequestInit) => new Headers(init.headers);
    expect(headersOf(calls[0]!.init).get('content-type')).toBeNull();
    expect(calls[0]?.init.body).toBeUndefined();

    expect(headersOf(calls[1]!.init).get('content-type')).toBe('application/json');
    // Always `{ agentId }`: an empty body makes resolveTargets throw a 400.
    expect(calls[1]?.init.body).toBe('{"agentId":"agent-1"}');
    expect(calls[1]?.init.method).toBe('POST');
  });

  it('bounds every request with its own deadline', async () => {
    const { client, calls } = clientFor(() => json([]));
    await client.listAgents();

    const signal = calls[0]?.init.signal;
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(120_000);
  });

  it('returns a rate_limited failure on 429 even though the code says internal_error', async () => {
    const { client } = clientFor(() =>
      json(
        { error: { code: 'internal_error', message: 'Rate limit exceeded' } },
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
      ),
    );

    const result = await client.listRepos();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 30 });
    expect(instructionFor(result.failure)).toMatch(IMPERATIVE);
  });

  it('returns a malformed failure naming the field when the contract drifts', async () => {
    // `status` missing from a run row — the exact shape of contract drift.
    const { client } = clientFor(() => json([{ run_id: 'run-1' }]));

    const result = await client.listRuns('pr-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('malformed');
    expect(instructionFor(result.failure)).toContain('0.agent_id');
  });

  it('returns an unreachable failure when the API is not listening', async () => {
    const refused = new TypeError('fetch failed');
    refused.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
      code: 'ECONNREFUSED',
    });
    const { client } = clientFor(() => Promise.reject(refused));

    const result = await client.listRepos();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'unreachable', baseUrl: 'http://localhost:3001' });
    const instruction = instructionFor(result.failure);
    expect(instruction).toContain('ECONNREFUSED');
    expect(instruction).toContain('./scripts/dev.sh');
  });

  it('returns a timeout failure when its own deadline aborts the request', async () => {
    const { client } = clientFor(() =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );

    const result = await client.listReviews('pr-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'timeout', timeoutMs: REQUEST_TIMEOUT_MS });
  });

  it('never throws on an expected condition, including a non-JSON body', async () => {
    const cases: (() => Promise<unknown>)[] = [];

    const notJson = clientFor(() => new Response('<html>nope</html>', { status: 200 }));
    cases.push(() => notJson.client.listAgents());

    const gateway = clientFor(() => new Response('bad gateway', { status: 502 }));
    cases.push(() => gateway.client.listAgents());

    const nothing = clientFor(() => new Response(null, { status: 204 }));
    cases.push(() => nothing.client.listAgents());

    for (const run of cases) {
      await expect(run()).resolves.toMatchObject({ ok: false });
    }
  });

  it('logs method, path, status and duration - and never a body', async () => {
    const { logger, lines } = recordingLogger();
    const secret = 'PR body text that must not be logged';
    const { client } = clientFor(
      () => json([{ ...AGENT, description: secret }]),
      logger,
    );

    await client.listAgents();

    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({ method: 'GET', path: '/agents', status: 200 });
    expect(typeof lines[0]?.fields?.duration_ms).toBe('number');
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it('logs a failure once, with its kind and no body', async () => {
    const { logger, lines } = recordingLogger();
    const { client } = clientFor(
      () =>
        json(
          { error: { code: 'not_found', message: 'Pull request not found' } },
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
      logger,
    );

    await client.listRuns('pr-missing');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({
      method: 'GET',
      path: '/pulls/pr-missing/runs',
      status: 404,
      kind: 'not_found',
    });
    expect(JSON.stringify(lines)).not.toContain('Pull request not found');
  });

  it('defaults fetchImpl to the global fetch without calling it', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    new ApiClient({ baseUrl: 'http://localhost:3001/' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
