/**
 * log.ts — the only file in this package that writes to a stream, and the only
 * stream it writes to is **stderr**.
 *
 * Why that is a hard rule and not a preference: this server speaks MCP over
 * stdio, so `process.stdout` carries JSON-RPC frames. One stray byte there and
 * the frame is corrupt; the client's reaction is to drop the connection, with
 * no message that points back here. Three mechanisms keep stdout clean, and
 * each covers what the previous one cannot:
 *
 *  1. `eslint.config.js` makes `console.*` an error and `process.stdout`
 *     unreachable outside this file and `index.ts`. Sees only our own source.
 *  2. A test walks every file under `src/` and asserts the same thing, so a new
 *     file is covered whether or not lint ran over it.
 *  3. `redirectConsoleToStderr()` below, which is the only one that reaches a
 *     **dependency** logging from inside itself.
 *
 * Level: this file does NOT read `process.env`. `config.ts` is the single
 * reader of the environment (it validates `DEVDIGEST_MCP_LOG_LEVEL` against
 * `LOG_LEVELS` and calls `setLogLevel`), which keeps configuration in one place
 * and keeps this module trivially testable. Until it does, the level is
 * `DEFAULT_LOG_LEVEL`.
 */
import { Console } from 'node:console';
import { format } from 'node:util';

/** The accepted `DEVDIGEST_MCP_LOG_LEVEL` values, most severe first. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Structured fields accompanying a line. Never a request or response body. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
}

const SEVERITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = DEFAULT_LOG_LEVEL;

/** Called once by `config.ts` after the environment has been validated. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

function serialiseFields(fields: LogFields): string {
  try {
    return JSON.stringify(fields);
  } catch {
    // Circular reference or a BigInt. A log line must never be the thing that
    // takes the process down.
    return format(fields);
  }
}

function writeStderr(text: string): void {
  try {
    process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  } catch {
    // stderr closed or EPIPE. Nothing left to report it to.
  }
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (SEVERITY[level] > SEVERITY[currentLevel]) return;
  const head = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} devdigest-mcp`;
  const tail = fields === undefined ? '' : ` ${serialiseFields(fields)}`;
  writeStderr(`${head} ${message}${tail}`);
}

export const logger: Logger = {
  error: (message, fields) => emit('error', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  info: (message, fields) => emit('info', message, fields),
  debug: (message, fields) => emit('debug', message, fields),
};

let redirected = false;

/**
 * Repoint every `console.*` method at stderr, by replacing the global console
 * with one constructed over `process.stderr` for BOTH of its streams.
 *
 * This is the layer eslint cannot provide: a dependency that calls
 * `console.log` resolves `console` from the global scope at call time, so after
 * this runs its output lands on stderr like ours. It covers the whole surface
 * (`log`, `info`, `dir`, `table`, `group`, `count`, …) rather than the handful
 * of methods a per-method patch would remember.
 *
 * Call it as the first statement of the composition root, and import this
 * module before anything else there: ESM evaluates every import before the
 * importer's body, so a dependency that logs at **import** time still slips
 * through unless it is imported after this module.
 *
 * Idempotent — returns `true` the first time and `false` afterwards.
 */
export function redirectConsoleToStderr(): boolean {
  if (redirected) return false;
  globalThis.console = new Console({
    stdout: process.stderr,
    stderr: process.stderr,
    colorMode: false,
  });
  redirected = true;
  return true;
}
