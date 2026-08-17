/**
 * index.ts — the composition root, and the ONLY file that touches `process` or a
 * transport. The order of what follows is the substance of the file, not its
 * layout.
 *
 * ## Why the imports below are dynamic
 *
 * ESM evaluates **every** static import before the importing module's body runs.
 * So `redirectConsoleToStderr()` written as "the first statement" would still run
 * after the SDK and zod had been evaluated — and a dependency that calls
 * `console.log` at import time would already have written to stdout, which on this
 * server is the JSON-RPC channel. One stray byte there corrupts the frame and the
 * client drops the connection with no message pointing back here.
 *
 * `src/log.ts` is therefore the one static import, the redirect runs, and
 * everything else is pulled in with `await import(...)` afterwards. That is the
 * only ordering ESM allows, and it is exactly what `log.ts`'s own header asks for.
 *
 * ## The rest of the order
 *
 *   redirectConsoleToStderr()   stdout is protected before anything can write
 *   loadConfig()                the only read of process.env; exits non-zero on a bad one
 *   ApiClient                   HTTP seam, no request made yet
 *   Resolver                    caches over that client
 *   createServer(deps)          tools registered, still not connected
 *   server.connect(stdio)       stdout becomes the transport HERE and not before
 *   one line to stderr          the readiness signal a human looks for
 *   SIGINT / SIGTERM            close, then exit 0
 *   unhandledRejection          one line to stderr, then exit 1
 *
 * The last one is not defensive boilerplate: a discarded rejected promise has
 * taken the DevDigest API process down twice in this repository
 * (`server/INSIGHTS.md`, 2026-08-06 and 2026-08-07). Node's default for an
 * unhandled rejection is to kill the process, and without this handler it would
 * die here with nothing written anywhere — the failure mode is a client reporting
 * that the MCP server "disconnected".
 */
import { logger, redirectConsoleToStderr } from './log.js';

// Before every other module of this package is even evaluated. See the header.
redirectConsoleToStderr();

const { loadConfig } = await import('./config.js');
const { ApiClient } = await import('./api/client.js');
const { Resolver } = await import('./resolve.js');
const { createServer, SERVER_VERSION } = await import('./server.js');
const { TOOL_COUNT } = await import('./tools/defs.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

const config = loadConfig();
const client = new ApiClient({ baseUrl: config.apiUrl, logger });
const resolver = new Resolver({ client, logger });

const server = createServer({
  client,
  resolver,
  config,
  logger,
  // The per-process index of runs this server started, so `devdigest_get_findings`
  // can be handed a bare `run_id`. Created here because it is process state, and
  // process state belongs to the composition root.
  runOrigins: new Map(),
});

await server.connect(new StdioServerTransport());

logger.info('devdigest-mcp ready on stdio', {
  version: SERVER_VERSION,
  api_url: config.apiUrl,
  tools: TOOL_COUNT,
  log_level: config.logLevel,
});

/**
 * Close the transport, then leave with 0. A shutdown asked for by a signal is not
 * a failure, and a non-zero exit here makes a client report a crash.
 *
 * `close()` is raced against nothing: if it throws or hangs the process still
 * exits, because the alternative is a server that ignores Ctrl-C.
 */
function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  void server.close().then(
    () => process.exit(0),
    (thrown: unknown) => {
      logger.warn('transport did not close cleanly', {
        detail: thrown instanceof Error ? thrown.message : String(thrown),
      });
      process.exit(0);
    },
  );
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled promise rejection - exiting', {
    detail: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});
