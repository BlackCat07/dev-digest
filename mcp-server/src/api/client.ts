/**
 * api/client.ts — the only file in this package that speaks HTTP.
 *
 * Four properties, each load-bearing rather than stylistic:
 *
 *  1. **The path is built from SEGMENTS**, each one `encodeURIComponent`-ed by
 *     `request()`. That single mechanism is what makes "no string from the model
 *     ever reaches a URL path" mechanically true instead of a promise: a segment
 *     of `../../health` or `a/b` becomes one encoded component and cannot climb
 *     out of the route it was meant for. No caller assembles a path itself.
 *  2. **`content-type` is set only when there is a body.** Fastify rejects an
 *     empty body carrying a JSON content-type ("Body cannot be empty when
 *     content-type is application/json"), which a body-less POST would do. The
 *     client half of this repo carries the same conditional and a note not to
 *     "simplify" it (`client/CLAUDE.md`, `apiFetch`).
 *  3. **Every response is PARSED with a contract schema from
 *     `@devdigest/shared`** — no `as`, anywhere. The HTTP response is untrusted
 *     input even though we run next to the server that produced it, and a
 *     contract change becomes a `malformed` failure naming the field rather than
 *     an `undefined` three layers up.
 *  4. **It never throws on an expected condition** and never logs a body. PR
 *     titles, descriptions and whole diffs travel through this process; the log
 *     line carries method, path, status and duration, and nothing else.
 *
 * The `fetchImpl` seam is deliberately LOCAL to this package (not a port in
 * `@devdigest/shared`): the contract is a frozen cross-package do-not-touch
 * zone, and widening it for one consumer's test seam would be the wrong trade.
 * Injection here is enough — every test drives a fake `fetchImpl` and makes no
 * network call.
 */
import { z } from 'zod';
import {
  Agent,
  ConventionsPayload,
  PrBlastRadius,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import { logger as defaultLogger, type Logger } from '../log.js';
import {
  httpFailure,
  malformedFailure,
  type ApiCall,
  type ApiResult,
  type ApiFailure,
} from '../errors.js';

/**
 * The injected seam. Narrower than `typeof globalThis.fetch` on purpose: this
 * client always passes a fully-built string URL and an init object, so a test
 * double is a two-parameter function rather than a re-implementation of the
 * whole DOM signature. `globalThis.fetch` satisfies it.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Per-request deadline, well under the 120s `run_agent_on_pr` budget so that one
 * stuck request cannot eat the whole wait: the wait loop needs to keep polling,
 * and a hung `GET /pulls/:id/runs` that never resolves would starve it.
 * Deliberately not an env knob — the four knobs live in `config.ts`.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface ApiClientOptions {
  /** Absolute base URL, no trailing slash (`config.ts` guarantees both). */
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
  readonly logger?: Logger;
}

// Response schemas, built once at module load rather than per call.
const ReposResponse = z.array(Repo);
const PullsResponse = z.array(PrMeta);
const AgentsResponse = z.array(Agent);
const RunsResponse = z.array(RunSummary);
const ReviewsResponse = z.array(ReviewRecord);

/** `retry-after` is seconds here (`@fastify/rate-limit` sends a number). */
function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** An `Error` carrying a libuv errno string, e.g. `ECONNREFUSED`. */
const ErrnoLike = z.object({ code: z.string() });

/**
 * Describe what `fetch` threw, without a body and without a stack. Undici
 * reports a connection failure through `TypeError: fetch failed` and keeps the
 * useful part (`ECONNREFUSED`) in `cause`, so the cause is unwrapped one level.
 * The errno is read by parsing, not by asserting a type onto `unknown`.
 */
function describeThrown(thrown: unknown): string {
  if (!(thrown instanceof Error)) return String(thrown);
  const cause = thrown.cause;
  if (cause instanceof Error) {
    const errno = ErrnoLike.safeParse(cause);
    const suffix = errno.success ? ` (${errno.data.code})` : '';
    return `${thrown.message}: ${cause.message}${suffix}`;
  }
  return thrown.message;
}

/** Was this rejection our own deadline firing, rather than a transport error? */
function isAbort(thrown: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (!(thrown instanceof Error)) return false;
  return thrown.name === 'TimeoutError' || thrown.name === 'AbortError';
}

/**
 * HTTP client for the DevDigest API. One private `request` builds every call;
 * the public methods exist so callers name an endpoint instead of a path.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;

  constructor({ baseUrl, fetchImpl = globalThis.fetch, logger = defaultLogger }: ApiClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  /** `GET /repos` — every repository imported into the workspace. */
  listRepos(): Promise<ApiResult<Repo[]>> {
    return this.request('GET', ['repos'], ReposResponse);
  }

  /**
   * `GET /repos/:id/pulls` — EXPENSIVE: it syncs against live GitHub and
   * backfills PR detail, so callers cache it (see `resolve.ts`).
   */
  listPulls(repoId: string): Promise<ApiResult<PrMeta[]>> {
    return this.request('GET', ['repos', repoId, 'pulls'], PullsResponse);
  }

  /** `GET /agents` — the reviewer agents, with the ids a run needs. */
  listAgents(): Promise<ApiResult<Agent[]>> {
    return this.request('GET', ['agents'], AgentsResponse);
  }

  /**
   * `POST /pulls/:id/review` — FIRE AND FORGET. It creates the run rows and
   * returns immediately; `reviews` in the response is always empty, whatever
   * `ReviewRunResponse`'s doc-comment says about a synchronous run. The caller
   * polls `listRuns` and then reads `listReviews`.
   *
   * The body is always `{ agentId }`: an empty body makes the server's
   * `resolveTargets` throw `invalid_run_request` (400).
   */
  startReview(prId: string, agentId: string): Promise<ApiResult<ReviewRunResponse>> {
    return this.request('POST', ['pulls', prId, 'review'], ReviewRunResponse, { agentId });
  }

  /**
   * `GET /pulls/:id/runs` — the PR's whole run history, any status. Note it does
   * not verify the PR exists: an unknown id answers `[]`, not 404.
   */
  listRuns(prId: string): Promise<ApiResult<RunSummary[]>> {
    return this.request('GET', ['pulls', prId, 'runs'], RunsResponse);
  }

  /** `GET /pulls/:id/reviews` — persisted reviews with their findings. */
  listReviews(prId: string): Promise<ApiResult<ReviewRecord[]>> {
    return this.request('GET', ['pulls', prId, 'reviews'], ReviewsResponse);
  }

  /** `GET /repos/:id/conventions` — scan, budget and every candidate. */
  getConventions(repoId: string): Promise<ApiResult<ConventionsPayload>> {
    return this.request('GET', ['repos', repoId, 'conventions'], ConventionsPayload);
  }

  /**
   * `GET /pulls/:id/blast` — the PR's impact map, read from the codebase index.
   *
   * Cheap and side-effect-free: no model call, no write, and no analysis at request
   * time. It does, however, depend on `pr_files` already being populated, and
   * `GET /pulls/:id` is the ONLY writer of that table — so a caller that cannot
   * guarantee the PR detail has been loaded must call `getPull` first, or the map
   * comes back `degraded / no_changed_files`. `get-blast-radius.ts` does exactly that
   * and says why.
   */
  getBlast(prId: string): Promise<ApiResult<PrBlastRadius>> {
    return this.request('GET', ['pulls', prId, 'blast'], PrBlastRadius);
  }

  /**
   * `GET /pulls/:id` — PR detail. Called for its WRITE, not its body: it backfills
   * `pr_files`, which the blast map is a function of.
   */
  getPull(prId: string): Promise<ApiResult<PrDetail>> {
    return this.request('GET', ['pulls', prId], PrDetail);
  }

  /**
   * The single request path. `segments` are PATH COMPONENTS, never a joined
   * path — each is percent-encoded, so a `/` inside one stays inside it.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    segments: readonly string[],
    // The schema's INPUT type is `unknown` so that a contract carrying
    // `.default()` fields (Agent) can be passed here: its input and output types
    // differ, and a bare `z.ZodType<T>` accepts only schemas where they
    // coincide.
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const path = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
    const call: ApiCall = { method, path };
    const url = `${this.baseUrl}${path}`;
    const startedAt = Date.now();

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const init: RequestInit = {
      method,
      signal,
      // Only declare a JSON body when one is actually sent: Fastify answers 400
      // "Body cannot be empty when content-type is application/json" otherwise.
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (thrown) {
      const failure: ApiFailure = isAbort(thrown, signal)
        ? { kind: 'timeout', method, path, timeoutMs: REQUEST_TIMEOUT_MS }
        : {
            kind: 'unreachable',
            method,
            path,
            baseUrl: this.baseUrl,
            cause: describeThrown(thrown),
          };
      return this.fail(failure, startedAt, null);
    }

    // Read the body once. A non-JSON body is not an error by itself — the
    // classifier falls back on the status when the envelope does not parse.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      return this.fail(
        httpFailure({
          call,
          status: response.status,
          body: payload,
          retryAfterSeconds: retryAfterSeconds(response),
        }),
        startedAt,
        response.status,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return this.fail(malformedFailure(call, parsed.error), startedAt, response.status);
    }

    this.logger.debug('api call ok', {
      method,
      path,
      status: response.status,
      duration_ms: Date.now() - startedAt,
    });
    return { ok: true, data: parsed.data };
  }

  /**
   * One log line per failure, then the failure. Method, path, status, duration
   * and the failure KIND — never the response body, which on these endpoints is
   * PR text, review prose or a whole diff.
   */
  private fail<T>(failure: ApiFailure, startedAt: number, status: number | null): ApiResult<T> {
    this.logger.warn('api call failed', {
      method: failure.method,
      path: failure.path,
      status,
      duration_ms: Date.now() - startedAt,
      kind: failure.kind,
    });
    return { ok: false, failure };
  }
}
