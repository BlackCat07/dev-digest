/**
 * tools/defs.ts — the five tools as DATA: one array, read by `server.ts` to
 * register them and by `test/budget.test.ts` to measure them.
 *
 * ## Why an array and not five `registerTool` calls
 *
 * Five calls would put the tool surface in an imperative function, where "exactly
 * five tools", "`readOnlyHint` is true on four of them", "`list_agents` is the
 * only one with an `outputSchema`" and "every description fits the client's
 * truncation limit" are all unassertable — a test would have to boot a server and
 * infer the answers. As data, each of those is one expression over `TOOL_DEFS`,
 * and R11's token budget is a measurement rather than a promise.
 *
 * ## The descriptions are the deliverable
 *
 * They are reproduced here verbatim from the plan's tool contracts, in ASCII: an
 * em dash costs 3 bytes against a hyphen's 1, and these strings are measured in
 * bytes against a client-side truncation limit. Do not "improve" the wording
 * without re-measuring — a description is the only thing a model reads before
 * deciding whether a tool answers its question.
 *
 * ## The annotations, and why they differ
 *
 * `run_agent_on_pr` is the only tool with `readOnlyHint: false` and
 * `openWorldHint: true`, and the only one that is not idempotent: it calls an LLM,
 * so two calls are two runs and two bills. `destructiveHint: false` because it
 * only ever ADDS a run and a review; it removes nothing. The other four read, and
 * reading the same arguments twice gives the same answer.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { ToolHandler } from './schemas.js';
import { LIST_AGENTS_OUTPUT_SHAPE, listAgents } from './list-agents.js';
import { RUN_AGENT_INPUT_SHAPE, runAgentOnPr } from './run-agent-on-pr.js';
import { GET_FINDINGS_INPUT_SHAPE, getFindings } from './get-findings.js';
import { GET_CONVENTIONS_INPUT_SHAPE, getConventions } from './get-conventions.js';
import { GET_BLAST_RADIUS_INPUT_SHAPE, getBlastRadius } from './get-blast-radius.js';

/**
 * One tool's whole surface.
 *
 * `inputSchema` and `outputSchema` are RAW SHAPES (`{ repo: RepoArg, pr: PrArg }`),
 * not `z.object(...)`: that is what `McpServer.registerTool` takes, and it is what
 * lets a test walk the fields of a tool without unwrapping a schema.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Flat: primitives only, `MAX_TOOL_INPUT_FIELDS` at most, each `.describe()`d. */
  readonly inputSchema: z.ZodRawShape;
  /** Present on `devdigest_list_agents` only — see that file for why. */
  readonly outputSchema?: z.ZodRawShape;
  readonly annotations: ToolAnnotations;
  readonly handler: ToolHandler;
}

/** Shared by the four read-only tools. */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOL_DEFS: readonly ToolDefinition[] = [
  {
    name: 'devdigest_list_agents',
    description:
      'List the reviewer agents configured in DevDigest (id, name, model, enabled). Call ' +
      'this first to get a valid agent id for devdigest_run_agent_on_pr - do not guess or ' +
      'invent agent ids.',
    // Zero arguments. An empty shape rather than an absent one, so every handler
    // is called with the same `(args, extra)` signature.
    inputSchema: {},
    outputSchema: LIST_AGENTS_OUTPUT_SHAPE,
    annotations: READ_ONLY,
    handler: listAgents,
  },
  {
    name: 'devdigest_run_agent_on_pr',
    description:
      'Run one reviewer agent on a pull request and return the result. This is a single ' +
      'call that triggers the review, waits for it to finish, and returns the verdict and ' +
      'findings - you do not need to poll. Requires a valid agent id from ' +
      'devdigest_list_agents - do not guess it. If the review takes longer than ~2 min it ' +
      "returns {status:'running', run_id}; call devdigest_get_findings with that run_id " +
      'later.',
    inputSchema: RUN_AGENT_INPUT_SHAPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: runAgentOnPr,
  },
  {
    name: 'devdigest_get_findings',
    description:
      'Get the verdict and findings of an already-completed review run. Provide either ' +
      'run_id, or repo + pr. Defaults to a concise summary (top findings + counts by ' +
      "severity); pass response_format:'detailed' for full fields, and use offset/limit to " +
      'page through large result sets.',
    inputSchema: GET_FINDINGS_INPUT_SHAPE,
    annotations: READ_ONLY,
    handler: getFindings,
  },
  {
    name: 'devdigest_get_conventions',
    description:
      'Get the coding conventions extracted for a repository (rule, file, confidence, ' +
      "accepted). Use this to justify or check a finding against the repository's house " +
      'rules, and read them before you propose code for that repository.',
    inputSchema: GET_CONVENTIONS_INPUT_SHAPE,
    annotations: READ_ONLY,
    handler: getConventions,
  },
  {
    name: 'devdigest_get_blast_radius',
    description:
      'What else could this PR touch? Returns the symbols it changes, who calls them ' +
      '(file:line, ranked by importance), and the HTTP endpoints and cron jobs reachable ' +
      'from there. Read from the codebase index - free, instant, and no model call. Call ' +
      'it before judging whether a change is safe. If status is not "ok" the map is ' +
      'incomplete: never read an empty result as evidence that a change has no callers.',
    inputSchema: GET_BLAST_RADIUS_INPUT_SHAPE,
    annotations: READ_ONLY,
    handler: getBlastRadius,
  },
];

/** How many tools this server exposes. Asserted, not assumed. */
export const TOOL_COUNT = TOOL_DEFS.length;
