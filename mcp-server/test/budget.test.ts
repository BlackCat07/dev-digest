/**
 * budget.test.ts — R11: the token budget is MEASURED, over the real MCP surface.
 *
 * ## Why this boots a server instead of reading `TOOL_DEFS`
 *
 * `test/tools.test.ts` already asserts the shape of `TOOL_DEFS`. That array is
 * what we wrote; it is not what a client pays for. Between the two sits the SDK:
 * it wraps each raw shape into draft-07 JSON Schema, adds `annotations`, adds an
 * `execution` field of its own, and decides what actually travels in a
 * `tools/list` response. So every number below is taken from a real `Client`
 * talking to the server `createServer()` builds, over
 * `InMemoryTransport.createLinkedPair()` — no socket, no stdio, no API.
 *
 * ## The numbers are the deliverable, so they are printed
 *
 * Every assertion writes its measured value to **stderr** before asserting, so a
 * green run still reports the budget and a red one reports the number that broke
 * it. stderr and not stdout, and not `console.*`: `console` is an eslint error
 * package-wide (a stray byte on stdout corrupts a JSON-RPC frame), and
 * `process.stdout` is unreachable outside `src/log.ts` / `src/index.ts`.
 * `process.stderr` carries no such restriction, which is the whole point of the
 * split.
 *
 * ## Two ceilings from the plan, one ratchet from today's measurement
 *
 * `MAX_INSTRUCTIONS_BYTES` and `MAX_DESCRIPTION_BYTES` (2048 each) are Claude
 * Code's truncation limits — external facts, asserted as given. Both hold with
 * room to spare.
 *
 * The whole-response figure is different in kind. The plan estimated ~2905 B for
 * the metadata before any of it existed; the real `tools/list` measures roughly
 * twice that, and the excess is ENVELOPE rather than prose — JSON Schema
 * scaffolding (`type`, `required`, `additionalProperties`, `$schema`), the
 * annotation objects, and the SDK's own `execution` key. The plan's instruction
 * for that case is followed literally: report the number, do not raise a limit to
 * accommodate it, and do not shorten a description to chase an estimate — the
 * descriptions are verbatim deliverables and both hard ceilings pass. So
 * `TOOLS_LIST_RATCHET_BYTES` below records what this tree measures TODAY as a
 * regression guard. It is a ratchet, not a target from the plan: if it fires,
 * something grew, and the honest response is to find out what and report the new
 * number — not to nudge the constant up.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';
import {
  INSTRUCTIONS,
  MAX_DESCRIPTION_BYTES,
  MAX_INSTRUCTIONS_BYTES,
  MAX_TOOL_INPUT_FIELDS,
} from '../src/instructions.js';
import type { LogFields, Logger } from '../src/log.js';
import { Resolver } from '../src/resolve.js';
import { createServer } from '../src/server.js';
import { TOOL_COUNT, TOOL_DEFS } from '../src/tools/defs.js';
import type { ToolDeps } from '../src/tools/schemas.js';

/**
 * What `tools/list` weighs on this tree, plus a little headroom. A record of a
 * measurement, not a budget from the plan — see the header.
 *
 * **Raised 6400 → 7000 on 2026-08-14, and the reason is on the record here rather
 * than in a commit message.** L04 added four optional uuid arguments — `pr_id` on
 * `run_agent_on_pr`, `get_findings` and `get_blast_radius`, and `repo_id` on
 * `get_conventions` — so that a caller holding an id from a DevDigest studio URL is
 * not turned away. Measured: 5776 → 6879 B. The two new `.describe()` texts were
 * then shortened, which recovered 136 B (→ 6743); the rest is per-field JSON Schema
 * scaffolding (`type`, `description`, the `required` bookkeeping) and cannot be
 * written away without dropping the fields.
 *
 * So this is a real increase bought by a real capability, not drift — which is the
 * distinction `INSIGHTS.md` (2026-08-13) asks for when this ratchet fires. If it
 * fires again, measure first and report the number; only raise it with the same kind
 * of note, and never to accommodate a description that simply grew.
 */
const TOOLS_LIST_RATCHET_BYTES = 7000;

/** Tools this server exposes. Duplicated from the plan on purpose: a test that
 * reads the count off the code under test cannot notice a sixth tool. */
const EXPECTED_TOOL_COUNT = 5;

/** The one tool whose output a model walks programmatically, to read an `id`. */
const TOOL_WITH_OUTPUT_SCHEMA = 'devdigest_list_agents';

// --------------------------------------------------------------------------
// Measuring
// --------------------------------------------------------------------------

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * The single stream writer in this file. One aligned line per measurement, so a
 * run of this suite reads as the budget table the plan asks for.
 */
function line(label: string, value: string, limit?: number, measured?: number): void {
  const share =
    limit === undefined || measured === undefined
      ? ''
      : `  (${Math.round((measured / limit) * 100)}% of ${limit})`;
  process.stderr.write(`budget  ${label.padEnd(44)}${value.padStart(8)}${share}\n`);
}

/** A size. The unit is stated because the ceilings are in bytes, not characters. */
function reportBytes(label: string, measured: number, limit?: number): void {
  line(label, `${measured} B`, limit, measured);
}

/** A cardinality — tools, fields. Deliberately not suffixed with a unit. */
function reportCount(label: string, measured: number, limit?: number): void {
  line(label, String(measured), limit, measured);
}

type ListedTools = Awaited<ReturnType<Client['listTools']>>;
type ListedTool = ListedTools['tools'][number];

interface Surface {
  /** Exactly what the client received, tool by tool. */
  readonly tools: readonly ListedTool[];
  /** `instructions` as it arrived in the initialize result, not as we wrote it. */
  readonly instructions: string;
  /** `JSON.stringify` of the whole `tools/list` result — the thing being weighed. */
  readonly json: string;
}

function silentLogger(): Logger {
  const drop = (_message: string, _fields?: LogFields): void => undefined;
  return { error: drop, warn: drop, info: drop, debug: drop };
}

/**
 * Tool dependencies whose HTTP seam is a landmine: listing tools must not touch
 * the API, so a request here fails the run rather than passing silently.
 */
function deps(): ToolDeps {
  const logger = silentLogger();
  const fetchImpl: FetchLike = (url) =>
    Promise.reject(new Error(`budget.test.ts made an HTTP request to ${url}`));
  const client = new ApiClient({ baseUrl: 'http://localhost:3001', fetchImpl, logger });

  return {
    client,
    resolver: new Resolver({ client, logger }),
    config: {
      apiUrl: 'http://localhost:3001',
      runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      logLevel: 'error',
    },
    logger,
    runOrigins: new Map(),
  };
}

let cached: Surface | undefined;

/**
 * Boot a real server, ask it for its tools once, and keep the answer. Measured
 * once rather than per test: the response is static metadata, and re-listing it
 * five times would measure the same bytes five times.
 */
async function surface(): Promise<Surface> {
  if (cached !== undefined) return cached;

  const server = createServer(deps());
  const client = new Client({ name: 'budget-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  cached = {
    tools: listed.tools,
    instructions: client.getInstructions() ?? '',
    json: JSON.stringify(listed),
  };

  await client.close();
  await server.close();
  return cached;
}

/**
 * A tool's input fields, read off the JSON Schema the client received rather
 * than off the zod shape we handed the SDK.
 */
function fieldsOf(tool: ListedTool): [string, object][] {
  const properties = tool.inputSchema.properties;
  return properties === undefined ? [] : Object.entries(properties);
}

/** The `.describe()` text as it survived the trip to JSON Schema. */
function describeOf(field: object): string {
  return 'description' in field && typeof field.description === 'string' ? field.description : '';
}

// --------------------------------------------------------------------------
// The surface itself
// --------------------------------------------------------------------------

describe('tools/list, measured over a real client', () => {
  it('advertises exactly five tools', async () => {
    const { tools } = await surface();

    reportCount('tools advertised', tools.length);
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
    // The array `server.ts` iterates and the wire agree: a tool registered twice,
    // or one dropped by the SDK, shows up as a mismatch rather than as a smaller
    // byte count that reads like an improvement.
    expect(TOOL_COUNT).toBe(EXPECTED_TOOL_COUNT);
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      TOOL_DEFS.map((def) => def.name).sort(),
    );
  });

  it('keeps instructions inside Claude Code truncation limit', async () => {
    const { instructions, tools } = await surface();

    // Measured on what the client received, so a `instructions` the SDK failed to
    // forward reads as 0 B rather than as a pass.
    const measured = bytes(instructions);
    reportBytes('instructions', measured, MAX_INSTRUCTIONS_BYTES);
    expect(instructions).toBe(INSTRUCTIONS);
    expect(measured).toBeLessThan(MAX_INSTRUCTIONS_BYTES);

    // The floor a fresh conversation pays with tool search on: the names and this
    // string, and nothing else. Reported because it is the number the plan's
    // budget table is really about.
    const names = tools.map((tool) => tool.name);
    const nameBytes = names.reduce((total, name) => total + bytes(name), 0);
    reportBytes('tool names (sum)', nameBytes);
    reportBytes('names + instructions (session floor)', nameBytes + measured);
  });

  it('keeps every tool description inside the same limit', async () => {
    const { tools } = await surface();

    for (const tool of tools) {
      const measured = bytes(tool.description ?? '');
      reportBytes(`description  ${tool.name}`, measured, MAX_DESCRIPTION_BYTES);
      // An empty description would also be "under the limit", and a tool a model
      // cannot read is worse than a long one.
      expect(measured, `${tool.name} has no description`).toBeGreaterThan(0);
      expect(measured, `${tool.name} description is truncated by the client`).toBeLessThan(
        MAX_DESCRIPTION_BYTES,
      );
    }
  });

  it('describes every input field, and keeps every schema flat and small', async () => {
    const { tools } = await surface();

    // Tie the wire back to the source shapes first. Without this, a `properties`
    // block the SDK dropped would make the per-field loop below vacuous: zero
    // fields trivially satisfy "every field is described".
    const wireFields = tools.reduce((total, tool) => total + fieldsOf(tool).length, 0);
    const sourceFields = TOOL_DEFS.reduce(
      (total, def) => total + Object.keys(def.inputSchema).length,
      0,
    );
    reportCount('input fields on the wire', wireFields);
    expect(wireFields).toBe(sourceFields);

    for (const tool of tools) {
      const fields = fieldsOf(tool);
      reportCount(`fields       ${tool.name}`, fields.length, MAX_TOOL_INPUT_FIELDS);
      expect(fields.length, `${tool.name} takes too many arguments`).toBeLessThanOrEqual(
        MAX_TOOL_INPUT_FIELDS,
      );

      for (const [name, field] of fields) {
        const measured = bytes(describeOf(field));
        reportBytes(`describe     ${tool.name}.${name}`, measured);
        // `.describe()` is the only channel a field's meaning travels on: the JSON
        // Schema carries the description and nothing else that explains it.
        expect(measured, `${tool.name}.${name} has no .describe()`).toBeGreaterThan(0);
      }
    }
  });

  it('gives an outputSchema to devdigest_list_agents and to nothing else', async () => {
    const { tools } = await surface();

    const withOutput = tools.filter((tool) => tool.outputSchema !== undefined);
    reportCount('tools carrying an outputSchema', withOutput.length);
    expect(withOutput.map((tool) => tool.name)).toEqual([TOOL_WITH_OUTPUT_SCHEMA]);
    // Not a formality: the SDK validates structured output only when a tool
    // declares an `outputSchema`, and FAILS a call from a tool that declares one
    // and returns none. A second one appearing here means a second tool now has
    // to return `structuredContent`.
    expect(withOutput).toHaveLength(1);
  });

  it('weighs the whole tools/list response, and says where the bytes are', async () => {
    const { tools, json } = await surface();

    const total = bytes(json);
    const nameBytes = tools.reduce((sum, tool) => sum + bytes(tool.name), 0);
    const descriptionBytes = tools.reduce((sum, tool) => sum + bytes(tool.description ?? ''), 0);
    const describeBytes = tools.reduce(
      (sum, tool) =>
        sum + fieldsOf(tool).reduce((inner, [, field]) => inner + bytes(describeOf(field)), 0),
      0,
    );

    reportBytes('tools/list JSON (whole response)', total, TOOLS_LIST_RATCHET_BYTES);
    reportBytes('  of which: tool names', nameBytes);
    reportBytes('  of which: tool descriptions', descriptionBytes);
    reportBytes('  of which: field .describe() text', describeBytes);
    // Everything that is neither a name nor prose: draft-07 JSON Schema keys,
    // `annotations`, and the `execution` field the SDK adds itself. This is the
    // line that answers "why is the response twice the pre-measurement estimate",
    // and it is why shortening a description would not help.
    reportBytes('  of which: envelope', total - nameBytes - descriptionBytes - describeBytes);

    expect(total).toBeLessThanOrEqual(TOOLS_LIST_RATCHET_BYTES);
  });
});
