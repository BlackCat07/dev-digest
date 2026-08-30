import type { AgentColumn } from "@devdigest/shared";

/**
 * The token each run status is drawn in.
 *
 * Keyed by `AgentColumn["status"]` rather than by `string`, so the day the
 * contract gains a fifth status this map stops compiling instead of quietly
 * dropping the new one into the fallback colour. The four keys and the four
 * `runs.results.status.*` message keys have to agree, and nothing type-checks
 * that half — it is the reason both live one file apart rather than one in a
 * global constants bucket.
 *
 * `cancelled` is deliberately muted rather than red: a cancelled run is a
 * decision someone made, not a failure, and colouring the two alike is the
 * untruth AC-19 exists to prevent.
 */
export const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  running: "var(--accent)",
  done: "var(--ok)",
  failed: "var(--crit)",
  cancelled: "var(--text-muted)",
};
