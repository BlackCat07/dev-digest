/**
 * All tunables in one place. No logic here — just the knobs the rest of the package reads.
 * Nothing in this module imports from another src module (it is the bottom of the dependency
 * graph): config knows nothing of runtime, scoring, or the SDK.
 */

// --- Models -----------------------------------------------------------------
// Cheap model under test by default; the judge is a stronger family to soften self-preference.
export const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-5";
export const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? "8");

// --- Configuration tag ------------------------------------------------------
// "candidate" = artifact injected (normal). "baseline" = no artifact (benchmark lift baseline).
export const EVAL_CONFIG = process.env.EVAL_CONFIG ?? "candidate";
export const IS_BASELINE = EVAL_CONFIG === "baseline";

// --- Scoring / statistics thresholds ---------------------------------------
export const DEFAULT_THRESHOLD = 0.6; // judge score gate for a quality case
export const FLAKY_LOW = 0.2; // pass rate strictly inside (20%, 80%) is "flaky"
export const FLAKY_HIGH = 0.8;
export const COST_REGRESSION_RATIO = 1.25; // candidate mean tokens > 125% of baseline

// --- Tool lists -------------------------------------------------------------
// Subagent-spawning tool name varies by harness; count both.
export const SPAWN_TOOLS = new Set(["Task", "Agent"]);

/**
 * The tools a workflow session is auto-approved to use.
 *
 * READ THE NEXT PARAGRAPH BEFORE TRUSTING THIS NAME. `allowedTools` is an AUTO-APPROVE list, not a
 * restriction — the SDK's own docs say so ("List of tool names that are auto-allowed without
 * prompting… To restrict which tools are available, use the `tools` option instead"). Combined with
 * `permissionMode: "bypassPermissions"` it means every other tool is still available AND runs
 * without asking. This file used to claim the list kept a session "read-only". It did not: on
 * 2026-08-23 two eval sessions mutated the live repo — one appended two fabricated pgvector entries
 * to `server/INSIGHTS.md` via `Edit`, another wrote a 274-line `server/docs/pgvector-dimensions.md`
 * via `Write`. Both had to be reverted by hand.
 *
 * What actually holds the line is MUTATING_TOOLS below, passed as `disallowedTools` (which "removes
 * the tools from the model's context and cannot be used, even if they would otherwise be allowed").
 */
export const WORKFLOW_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Task", "Agent", "Skill"];

/**
 * Removed from EVERY eval session's context, content tiers included. An eval measures what a model
 * WOULD do; it must never be able to do it to the repo it is measured in. Note the content tiers
 * were exposed too: they pass `allowedTools: []` plus a "you have no tools" line in the prompt —
 * prose, not a constraint.
 */
export const MUTATING_TOOLS = [
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Bash",
  "BashOutput",
  "KillShell",
  "KillBash",
];

// --- Output verbosity -------------------------------------------------------
// Set EVAL_QUIET to suppress per-run trace/verdict spam during multi-run aggregation.
export const QUIET = Boolean(process.env.EVAL_QUIET);
