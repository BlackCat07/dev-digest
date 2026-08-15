/**
 * server.ts — `createServer(deps)`: an `McpServer` with the five tools registered
 * from `TOOL_DEFS`, and nothing else.
 *
 * It touches no stream, no `process` and no transport. That is what makes it
 * testable over `InMemoryTransport.createLinkedPair()` — a real client can ask a
 * real server for its `tools/list` with no sockets and no stdio involved — and it
 * is why the composition root is a separate file.
 *
 * ## The shapes below were read off the installed SDK, not remembered
 *
 * Verified against `@modelcontextprotocol/sdk@1.30.0`
 * (`dist/esm/server/mcp.d.ts`):
 *
 *   constructor(serverInfo: Implementation, options?: ServerOptions)
 *     -> `instructions` lives in the SECOND argument, not the first.
 *   registerTool(name, {title?, description?, inputSchema?, outputSchema?,
 *                       annotations?, _meta?}, cb)
 *     -> `inputSchema` is a RAW SHAPE (`ZodRawShapeCompat = Record<string,
 *        AnySchema>`), which the SDK wraps in `z.object` itself.
 *
 * ## One loop, not five calls
 *
 * Every tool is registered by the same three lines, so a new tool is one entry in
 * `TOOL_DEFS` and cannot arrive with a different result convention by accident.
 *
 * ## `structuredContent` is set exactly when a tool declares an `outputSchema`
 *
 * The SDK validates structured output only when the tool has an `outputSchema`,
 * and it FAILS the call when a tool that declares one returns no
 * `structuredContent`. Tying the two to the same field of the definition is what
 * keeps that from being a rule someone has to remember.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { INSTRUCTIONS } from './instructions.js';
import { TOOL_DEFS, type ToolDefinition } from './tools/defs.js';
import type { ToolDeps } from './tools/schemas.js';

/**
 * The one method this file needs from `McpServer`, declared with `unknown` where
 * the SDK declares a zod generic.
 *
 * ## Why this exists, because it looks like indirection for its own sake
 *
 * Calling `server.registerTool(...)` directly with a real zod raw shape fails to
 * COMPILE here: `TS2589: Type instantiation is excessively deep and possibly
 * infinite`. The cause is upstream of this file and worth writing down, because
 * nothing about the error names it.
 *
 * `tsconfig.json` pins `"zod": ["./node_modules/zod/index.d.cts"]`-shaped
 * resolution through its `paths` block (a deliberate T1 decision: one zod
 * instance, no `instanceof` failures across duplicates). The SDK's `zod-compat`
 * reads its types from the `zod/v3` SUBPATH instead. Under that pin the two
 * resolve to two different declaration files with identical contents, so
 * `ZodString` from `zod` is not the same TYPE as `ZodTypeAny` from `zod/v3` — it
 * is only structurally equal, and structurally comparing zod's recursive class
 * hierarchy exhausts TypeScript's instantiation depth. Reproduced down to three
 * lines: `import type * as z3 from 'zod/v3'; const a: z3.ZodTypeAny = z.string()`
 * errors with the pin and compiles without it.
 *
 * Two non-fixes, both tried: importing our schemas from `zod/v3` instead makes the
 * types line up and creates a SECOND zod instance at runtime (verified:
 * `zodRoot.ZodString !== zodV3.ZodString`, and `instanceof` fails across them),
 * which is the exact hazard the pin exists to prevent. Supplying the type
 * arguments explicitly does not help — the constraint is checked either way.
 *
 * So the handover to the SDK is typed `unknown`, and the shapes are still fully
 * typed on our side of it (`ToolDefinition.inputSchema` is `z.ZodRawShape`).
 * Nothing changes at runtime: the SDK reads a shape structurally, and it is the
 * same object either way. The assignment below is a real assignability check, not
 * a cast — if `McpServer.registerTool` ever stops accepting these arguments, this
 * line fails to compile.
 */
interface ToolRegistrar {
  registerTool(
    name: string,
    config: {
      readonly description?: string;
      readonly inputSchema?: unknown;
      readonly outputSchema?: unknown;
      readonly annotations?: ToolAnnotations;
    },
    cb: (args: unknown, extra: unknown) => Promise<CallToolResult>,
  ): unknown;
}

/** Server identity, as it appears in the MCP handshake. */
export const SERVER_NAME = 'devdigest';

/** Mirrors `package.json`. Hard-coded rather than imported: reading the manifest
 * at runtime would make this module depend on the file layout of an install. */
export const SERVER_VERSION = '0.0.0';

/**
 * The message for a handler that threw.
 *
 * A handler is written not to — `ApiClient` returns failures rather than throwing,
 * and every tool returns an instruction on every expected condition. So reaching
 * this is a bug in this package, and the text says so instead of asking the model
 * to fix its arguments.
 */
function unexpectedFailureMessage(tool: string, detail: string): string {
  return (
    `${tool} failed unexpectedly inside this MCP server (${detail}). That is a bug in the ` +
    'devdigest-mcp package rather than a problem with your arguments, so rephrasing them ' +
    'will not help. Retry the call once, and report this line if it happens again.'
  );
}

/**
 * Run one tool and turn its outcome into an MCP result.
 *
 * A failure becomes `isError: true` carrying the instruction as its only content:
 * the model has to see that the call did not produce data, and the sentence it
 * reads has to be the next action rather than a code.
 */
async function runTool(
  def: ToolDefinition,
  rawArgs: unknown,
  deps: ToolDeps,
): Promise<CallToolResult> {
  const startedAt = Date.now();
  try {
    const outcome = await def.handler(rawArgs, deps);
    deps.logger.debug('tool call finished', {
      tool: def.name,
      ok: outcome.ok,
      duration_ms: Date.now() - startedAt,
    });

    if (!outcome.ok) {
      return { content: [{ type: 'text', text: outcome.instruction }], isError: true };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.payload, null, 2) }],
      ...(def.outputSchema === undefined ? {} : { structuredContent: outcome.payload }),
    };
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    deps.logger.error('tool call threw', {
      tool: def.name,
      duration_ms: Date.now() - startedAt,
      detail,
    });
    return {
      content: [{ type: 'text', text: unexpectedFailureMessage(def.name, detail) }],
      isError: true,
    };
  }
}

/**
 * Build the server. Pure with respect to the process: nothing is connected, no
 * signal handler is installed, no environment is read.
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  // Checked, not cast: `McpServer` has to satisfy `ToolRegistrar` for this to
  // compile. See that interface for why the SDK's own generic cannot be used here.
  const registrar: ToolRegistrar = server;

  for (const def of TOOL_DEFS) {
    registrar.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        ...(def.outputSchema === undefined ? {} : { outputSchema: def.outputSchema }),
        annotations: def.annotations,
      },
      (rawArgs) => runTool(def, rawArgs, deps),
    );
  }

  return server;
}
