/**
 * errors.ts — the failure taxonomy of this server, and the one function that
 * turns a failure into an INSTRUCTION.
 *
 * The design rule (R7): a tool never returns a code, a status or a stack to the
 * model. It returns a sentence that names the next action. A model that reads
 * `{"error":"ECONNREFUSED"}` guesses; a model that reads "Start it with
 * ./scripts/dev.sh in the DevDigest repository, then retry this tool" does the
 * right thing. That is enforced rather than remembered: `test/errors.test.ts`
 * iterates `API_FAILURE_KINDS` and requires every message to contain an
 * imperative verb.
 *
 * Nothing here throws and nothing here does I/O. `ApiClient` builds an
 * `ApiFailure` from the transport facts; tools decide what to say around it.
 */
import { z } from 'zod';
import { ApiErrorBody } from '@devdigest/shared';

/**
 * The variants, as DATA. The union below is derived from this list, so a new
 * variant cannot be added without appearing here — which is what lets the test
 * prove every variant has an instruction rather than sampling the ones someone
 * remembered to add.
 */
export const API_FAILURE_KINDS = [
  'unreachable',
  'timeout',
  'not_found',
  'rate_limited',
  'validation',
  'server',
  'malformed',
] as const;

export type ApiFailureKind = (typeof API_FAILURE_KINDS)[number];

/** Which call failed. Method and path only — never a body (see `ApiClient`). */
export interface ApiCall {
  readonly method: string;
  /** Path with the segments already percent-encoded, e.g. `/pulls/<id>/runs`. */
  readonly path: string;
}

/** The API is not answering at all: connection refused, DNS, TLS, reset. */
export interface UnreachableFailure extends ApiCall {
  readonly kind: 'unreachable';
  readonly baseUrl: string;
  /** Short description of what the fetch threw. Never a response body. */
  readonly cause: string;
}

/** The request was aborted by our own client-side deadline. */
export interface TimeoutFailure extends ApiCall {
  readonly kind: 'timeout';
  readonly timeoutMs: number;
}

/** 404 — the id we addressed does not exist (or was deleted). */
export interface NotFoundFailure extends ApiCall {
  readonly kind: 'not_found';
  readonly message: string;
}

/** 429 — classified by STATUS; see `httpFailure` for why not by `error.code`. */
export interface RateLimitedFailure extends ApiCall {
  readonly kind: 'rate_limited';
  /** From the `retry-after` header when the API sent one. */
  readonly retryAfterSeconds: number | null;
}

/** Any other 4xx — the request WE built was wrong. A bug in this package. */
export interface ValidationFailure extends ApiCall {
  readonly kind: 'validation';
  readonly status: number;
  readonly message: string;
  /** Compacted `error.details`, capped. Our requests carry ids only. */
  readonly detail: string | null;
}

/** 5xx — the API failed and deliberately withheld the real message. */
export interface ServerFailure extends ApiCall {
  readonly kind: 'server';
  readonly status: number;
  /** `error.details.requestId`, which is how the API's own log line is found. */
  readonly requestId: string | null;
}

/** A 2xx whose body did not match the contract schema. Contract drift. */
export interface MalformedFailure extends ApiCall {
  readonly kind: 'malformed';
  /** `<field path>: <message>` lines, capped by `MAX_REPORTED_ISSUES`. */
  readonly issues: readonly string[];
}

export type ApiFailure =
  | UnreachableFailure
  | TimeoutFailure
  | NotFoundFailure
  | RateLimitedFailure
  | ValidationFailure
  | ServerFailure
  | MalformedFailure;

/** Result of any `ApiClient` call. The client never throws on these. */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly failure: ApiFailure };

/** How many zod issues a `malformed` failure quotes before summarising. */
export const MAX_REPORTED_ISSUES = 3;

/** Cap on `error.details` in a `validation` failure, in characters. */
const MAX_DETAIL_CHARS = 300;

/**
 * `details` of a 5xx from this API is `{ requestId }` — see the error handler in
 * `server/src/app.ts`, which replaces every 5xx message with a fixed string and
 * attaches the Fastify request id instead. Parsed, not cast.
 */
const RequestIdDetails = z.object({ requestId: z.string() });

function compactDetail(details: unknown): string | null {
  if (details === undefined || details === null) return null;
  // `JSON.stringify` answers `undefined` for a function or a bare symbol, and
  // throws on a circular structure or a BigInt.
  let text: string | undefined;
  try {
    text = typeof details === 'string' ? details : JSON.stringify(details);
  } catch {
    return null;
  }
  if (text === undefined || text === '') return null;
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text;
}

/**
 * Classify a non-2xx response.
 *
 * **429 is decided by the HTTP STATUS, never by `error.code`.** The rate limiter
 * is `@fastify/rate-limit`, whose error is neither an `AppError` nor a
 * `ZodError`, so it falls through to the last branch of the error handler in
 * `server/src/app.ts` and arrives as `{"error":{"code":"internal_error", ...}}`
 * with status 429. Branching on the code would file every rate limit under
 * `server` and tell the model to go read a log that says nothing.
 *
 * The rest: 404 is a bad id, any other 4xx means WE built a bad request (a bug
 * in this package, not in the model's arguments), and 5xx is the API's own
 * failure.
 */
export function httpFailure(input: {
  readonly call: ApiCall;
  readonly status: number;
  /** Decoded JSON body, or `undefined` when the body was not JSON. */
  readonly body: unknown;
  readonly retryAfterSeconds: number | null;
}): ApiFailure {
  const { call, status, body, retryAfterSeconds } = input;
  const envelope = ApiErrorBody.safeParse(body);
  const error = envelope.success ? envelope.data.error : null;

  if (status === 429) {
    return { kind: 'rate_limited', method: call.method, path: call.path, retryAfterSeconds };
  }
  if (status === 404) {
    return {
      kind: 'not_found',
      method: call.method,
      path: call.path,
      message: error?.message ?? 'Not found',
    };
  }
  if (status >= 500) {
    const details = RequestIdDetails.safeParse(error?.details);
    return {
      kind: 'server',
      method: call.method,
      path: call.path,
      status,
      requestId: details.success ? details.data.requestId : null,
    };
  }
  return {
    kind: 'validation',
    method: call.method,
    path: call.path,
    status,
    message: error?.message ?? `HTTP ${status}`,
    detail: compactDetail(error?.details),
  };
}

/**
 * A 2xx body that failed its contract schema. The field PATH is the whole point
 * — "the response was malformed" sends the reader nowhere, `runs.0.status: …`
 * names the drifted field.
 */
export function malformedFailure(call: ApiCall, error: z.ZodError): MalformedFailure {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${where}: ${issue.message}`;
  });
  const hidden = error.issues.length - issues.length;
  return {
    kind: 'malformed',
    method: call.method,
    path: call.path,
    issues: hidden > 0 ? [...issues, `(+${hidden} more field(s))`] : issues,
  };
}

/**
 * The one mapper: every variant to a sentence that names the next action.
 *
 * Every message must match `/(Start|Wait|Retry|retry|Check|check|report|set) /`
 * — asserted for all of `API_FAILURE_KINDS` in `test/errors.test.ts`.
 */
export function instructionFor(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'unreachable':
      return (
        `Cannot reach the DevDigest API at ${failure.baseUrl} ` +
        `(${failure.method} ${failure.path}: ${failure.cause}). ` +
        'Start it with ./scripts/dev.sh in the DevDigest repository, then retry this tool. ' +
        'If it is running on another port, set DEVDIGEST_API_URL to that address.'
      );

    case 'timeout':
      return (
        `The DevDigest API did not answer ${failure.method} ${failure.path} within ` +
        `${Math.round(failure.timeoutMs / 1000)}s. It may be cloning or indexing the ` +
        'repository, which is slow the first time. Retry the same call in a minute; ' +
        'if it keeps timing out, check the API log for a stuck job.'
      );

    case 'not_found':
      return (
        `The DevDigest API has nothing at ${failure.method} ${failure.path} ` +
        `(404: ${failure.message}). Check the identifier you passed: repositories come ` +
        'from the ones imported into DevDigest, pull request numbers from that ' +
        'repository, and agent ids from devdigest_list_agents - list them again rather ' +
        'than guessing a different id.'
      );

    case 'rate_limited': {
      const wait =
        failure.retryAfterSeconds === null
          ? 'about a minute'
          : `${failure.retryAfterSeconds}s`;
      return (
        `The DevDigest API is rate limiting this client (429 on ${failure.method} ` +
        `${failure.path}). Its budget is 120 requests per minute and it is shared with ` +
        `the DevDigest studio open in the browser. Wait ${wait} and retry the same ` +
        'call; do not retry in a loop, and do not start a second review.'
      );
    }

    case 'validation':
      return (
        `The DevDigest API rejected ${failure.method} ${failure.path} as invalid ` +
        `(${failure.status}: ${failure.message}` +
        `${failure.detail === null ? '' : ` - ${failure.detail}`}). ` +
        'This is a bug in the request this MCP server built, not in the arguments you ' +
        'passed, so rephrasing them will not help. Please report this line against the ' +
        'devdigest-mcp package.'
      );

    case 'server':
      return (
        `The DevDigest API failed ${failure.method} ${failure.path} with ` +
        `${failure.status}. Its response carries no message on purpose - the real one ` +
        `is only in the API's own log` +
        `${failure.requestId === null ? '' : `, on the line with requestId ${failure.requestId}`}. ` +
        'Check that log (the terminal running ./scripts/dev.sh) before retrying, and ' +
        'report it with the requestId if it repeats.'
      );

    case 'malformed':
      return (
        `The DevDigest API answered ${failure.method} ${failure.path} with a body this ` +
        `MCP server cannot read: ${failure.issues.join('; ')}. That is contract drift, ` +
        'not a problem with your arguments. Check that the API and this MCP server come ' +
        'from the same checkout, and report the field path above if they do.'
      );
  }
}
