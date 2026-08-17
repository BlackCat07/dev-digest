/**
 * config.ts — the ONLY reader of `process.env` in this package.
 *
 * Everything else takes what it needs as a parameter, which is what makes the
 * rest of the tree testable without touching the environment. The invariant is
 * mechanically checkable and is part of T5's done-condition:
 *
 *     rg -n "process\.env" mcp-server/src/     # must match this file only
 *
 * Four knobs, one `safeParse` at startup. A bad value is a startup failure, not
 * a runtime surprise: `loadConfig()` writes one line per problem to **stderr**
 * (through `logger`, the single stream writer) and exits non-zero. There is no
 * "fall back to the default and carry on" path — an operator who set
 * `DEVDIGEST_API_URL` to something unusable wants to hear about it before a tool
 * call fails four layers down.
 *
 * The schema is keyed on the ENVIRONMENT VARIABLE NAMES rather than on the
 * config field names, so a zod issue's `path` already is the variable the
 * operator has to fix; `.transform()` then renames the whole record into the
 * shape the rest of the package consumes.
 */
import { z } from 'zod';
import { DEFAULT_LOG_LEVEL, LOG_LEVELS, logger, setLogLevel } from './log.js';

/** `process.env`, narrowed to what this module actually needs from it. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** Where the DevDigest API listens when nothing says otherwise. */
export const DEFAULT_API_URL = 'http://localhost:3001';

/**
 * How long `devdigest_run_agent_on_pr` waits before returning
 * `{status:'running', run_id}`. 120s is a deliberate "short cycle, collect
 * later" choice: a single review can legitimately run longer than this (the
 * provider client retries up to three times at 90s each — `server/INSIGHTS.md`,
 * 2026-08-06), so the timeout path is the NORMAL path and has to stay cheap.
 */
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;
export const MIN_RUN_TIMEOUT_MS = 30_000;
export const MAX_RUN_TIMEOUT_MS = 600_000;

/**
 * Poll interval for `GET /pulls/:id/runs` while waiting. The API's global rate
 * limit is 120 req/min and it is SHARED with the studio in the browser, so 2s
 * (30 req/min) leaves room for a human clicking around at the same time.
 */
export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const MIN_POLL_INTERVAL_MS = 1_000;
export const MAX_POLL_INTERVAL_MS = 15_000;

/** Exit code used when the environment cannot produce a usable config. */
export const EXIT_INVALID_CONFIG = 1;

/**
 * An absolute `http:`/`https:` URL with every trailing slash removed, so callers
 * can always build a path as `${apiUrl}/${segments.join('/')}` without checking
 * for a double slash first.
 *
 * The scheme allowlist is not theatre: the value is turned into a `fetch()`
 * target, and `file:`/`data:` targets are the two that would read something
 * other than the API. It is server-controlled (an env var, never a tool
 * argument), so this is defence in depth rather than the primary control.
 */
const ApiUrlSchema = z
  .string()
  .default(DEFAULT_API_URL)
  .transform((raw) => raw.trim().replace(/\/+$/, ''))
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be an absolute URL, e.g. ${DEFAULT_API_URL} (could not parse "${value}")`,
      });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // Reached by a genuinely wrong scheme (`file:`) AND by a bare host:port
      // like `localhost:3001`, which `new URL` happily reads as the scheme
      // "localhost:" - hence the worked example rather than just the rule.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be an absolute http(s) URL, e.g. ${DEFAULT_API_URL} (read "${value}" as scheme "${parsed.protocol}")`,
      });
    }
    // No host check: for a special scheme the WHATWG parser rejects an empty
    // authority outright, so `new URL` above has already thrown by then.
  });

/**
 * A millisecond count that is CLAMPED into range rather than rejected: an
 * operator who asks for a 5s run budget gets 30s, not a server that refuses to
 * start. Only a value that is not a whole number at all is a hard failure.
 */
function clampedMs(fallback: number, min: number, max: number) {
  return z.coerce
    .number({
      invalid_type_error: `must be a number of milliseconds, e.g. ${fallback}`,
    })
    .int(`must be a whole number of milliseconds (clamped into [${min}, ${max}])`)
    .default(fallback)
    .transform((ms) => Math.min(max, Math.max(min, ms)));
}

const EnvSchema = z
  .object({
    DEVDIGEST_API_URL: ApiUrlSchema,
    DEVDIGEST_MCP_RUN_TIMEOUT_MS: clampedMs(
      DEFAULT_RUN_TIMEOUT_MS,
      MIN_RUN_TIMEOUT_MS,
      MAX_RUN_TIMEOUT_MS,
    ),
    DEVDIGEST_MCP_POLL_INTERVAL_MS: clampedMs(
      DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS,
    ),
    // Validated against `LOG_LEVELS` from log.ts, which is the list `logger`
    // itself switches on — one source of truth for the accepted values.
    DEVDIGEST_MCP_LOG_LEVEL: z.enum(LOG_LEVELS).default(DEFAULT_LOG_LEVEL),
  })
  .transform((env) => ({
    /** Base URL of the DevDigest API. No trailing slash. */
    apiUrl: env.DEVDIGEST_API_URL,
    /** Wall-clock budget for one blocking `run_agent_on_pr` call. */
    runTimeoutMs: env.DEVDIGEST_MCP_RUN_TIMEOUT_MS,
    /** Delay between two `GET /pulls/:id/runs` polls inside that budget. */
    pollIntervalMs: env.DEVDIGEST_MCP_POLL_INTERVAL_MS,
    /** Threshold for `logger`; every line still goes to stderr only. */
    logLevel: env.DEVDIGEST_MCP_LOG_LEVEL,
  }));

export type McpConfig = z.infer<typeof EnvSchema>;

export type ConfigResult =
  | { readonly ok: true; readonly config: McpConfig }
  /** One human-readable line per problem, each naming its environment variable. */
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * An empty or whitespace-only variable means "not set" — a `.env` line left as
 * `DEVDIGEST_API_URL=` should get the default, not fail. `z.coerce.number()`
 * would otherwise read `''` as `0` and silently clamp it to the minimum.
 */
function pick(env: EnvRecord, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The pure half: environment in, config or problems out. No stream writes, no
 * `process.exit`, no level mutation — so it can be exercised directly.
 */
export function parseConfig(env: EnvRecord): ConfigResult {
  const parsed = EnvSchema.safeParse({
    DEVDIGEST_API_URL: pick(env, 'DEVDIGEST_API_URL'),
    DEVDIGEST_MCP_RUN_TIMEOUT_MS: pick(env, 'DEVDIGEST_MCP_RUN_TIMEOUT_MS'),
    DEVDIGEST_MCP_POLL_INTERVAL_MS: pick(env, 'DEVDIGEST_MCP_POLL_INTERVAL_MS'),
    DEVDIGEST_MCP_LOG_LEVEL: pick(env, 'DEVDIGEST_MCP_LOG_LEVEL'),
  });

  if (parsed.success) return { ok: true, config: parsed.data };

  // Report EVERY issue, not just the first: an operator fixing one variable per
  // restart is the worst version of this loop. `issue.path` is the variable name
  // because the schema is keyed on the variable names.
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(environment)';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, problems };
}

/**
 * The effectful half, called once from the composition root: parse
 * `process.env`, apply the log level, or report and exit non-zero.
 */
export function loadConfig(env: EnvRecord = process.env): McpConfig {
  const result = parseConfig(env);

  if (!result.ok) {
    logger.error('devdigest-mcp cannot start: the environment is invalid.');
    for (const problem of result.problems) logger.error(problem);
    process.exit(EXIT_INVALID_CONFIG);
  }

  setLogLevel(result.config.logLevel);
  logger.debug('configuration loaded', {
    api_url: result.config.apiUrl,
    run_timeout_ms: result.config.runTimeoutMs,
    poll_interval_ms: result.config.pollIntervalMs,
    log_level: result.config.logLevel,
  });
  return result.config;
}
