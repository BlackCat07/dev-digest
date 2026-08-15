/**
 * instructions.ts — the server-level `instructions` string, and the token budget
 * it has to fit inside.
 *
 * ## Why this text is a deliverable and not a comment
 *
 * With tool search enabled, a fresh conversation pays for the tool NAMES and
 * this string, and nothing else — the descriptions and schemas arrive only once
 * a tool is actually reached for. So this is the one piece of prose every session
 * is billed for, and it is written to earn that: addressing rules the model
 * cannot derive, then which tool answers which question, then the operational
 * facts that turn a failure into a retry instead of a dead end.
 *
 * ## The block order is load-bearing
 *
 * A client that has to truncate truncates from the END. So the order is
 * addressing -> which tool -> operational, worst-to-lose last:
 *
 *  1. **Addressing.** Without it the model invents uuids, and every tool call
 *     fails on an id that never existed.
 *  2. **Which tool.** Wrong tool = a wasted model call (`run_agent_on_pr` is the
 *     only one that spends money) or a wrong conclusion (`get_blast_radius`).
 *  3. **Operational.** Recoverable by other means: every failure message from
 *     `errors.ts` repeats the "start the API" instruction anyway.
 *
 * ## ASCII only, deliberately
 *
 * Every dash here is an ASCII hyphen. An em dash is 3 bytes in UTF-8 against a
 * hyphen's 1, and this string is measured in BYTES against a 2048-byte ceiling
 * (`MAX_INSTRUCTIONS_BYTES`) — so a stylistic dash is a real, if small, tax on
 * every conversation. `test/budget.test.ts` measures the actual number.
 */

/**
 * Claude Code truncates a server's `instructions` past this many bytes, and it
 * truncates from the end. Not a style ceiling — the tail of a longer string is
 * silently absent from the model's context.
 */
export const MAX_INSTRUCTIONS_BYTES = 2048;

/** Same ceiling, per tool description. */
export const MAX_DESCRIPTION_BYTES = 2048;

/**
 * Arguments one tool may take. A flat, small schema is what keeps a tool call a
 * single decision; past this many fields a tool is doing two jobs.
 */
export const MAX_TOOL_INPUT_FIELDS = 8;

/**
 * The `instructions` handed to `McpServer` (second constructor argument).
 *
 * Kept as one template literal rather than assembled from parts: the byte count
 * is the point, and a builder makes it impossible to read the shipped text off
 * the source.
 */
export const INSTRUCTIONS = `DevDigest reviews pull requests locally with configurable AI reviewer agents.

Addressing: \`repo\` is "owner/name" (e.g. "acme/payments-api"), or just the name if
unambiguous. \`pr\` is the GitHub pull request NUMBER (e.g. 482), never an internal id.
\`agent_id\` is an agent id from devdigest_list_agents - list them, never guess one.
Holding a uuid from a DevDigest studio URL instead? Pass it as \`pr_id\` (or \`repo_id\` on
get_conventions) and omit repo/pr.

Which tool:
- devdigest_run_agent_on_pr - review a PR now. One call: triggers the review, waits, returns
  verdict and findings. The only tool that writes and the only one that spends a model call.
  On {status:'running'} nothing was lost - call devdigest_get_findings with that run_id a
  minute later.
- devdigest_get_findings - read an already-completed review. Free and instant; try it before
  running a new one.
- devdigest_list_agents - the agent ids run_agent_on_pr requires.
- devdigest_get_conventions - a repository's house rules, for justifying a finding or before
  proposing code.
- devdigest_get_blast_radius - what else a PR could touch: changed symbols, their callers at
  file:line, and the endpoints/crons reachable from them. Free, no model call. If its status is
  not 'ok' the map is incomplete - never read an empty map as "no impact".

Needs the DevDigest API running locally (default http://localhost:3001, override with
DEVDIGEST_API_URL). If a tool says it cannot reach the API, run ./scripts/dev.sh in the
DevDigest repository and retry rather than giving up.

Responses default to a concise projection; pass response_format:'detailed' for full fields.
Errors name the next step - follow it.`;
