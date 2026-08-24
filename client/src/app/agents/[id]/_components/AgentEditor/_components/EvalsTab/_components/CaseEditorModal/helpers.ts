/* Unit-private pure helpers for the eval case editor.

   No React, no fetch, no i18n — the validity gate and the two display
   formatters, each a function of its arguments. */
import type {
  EvalAgentCase,
  EvalBatchCaseResult,
  EvalCaseOutcome,
  EvalNotRunReason,
} from "@devdigest/shared";

/**
 * The stored expected output as editable text.
 *
 * Two-space JSON rather than one line, because the thing a reader is being asked
 * to check is its SHAPE. `undefined` — a case whose `expected_output` jsonb is
 * absent — becomes empty text, which the gate below then reports as invalid: a
 * case with nothing to assert is exactly a case that must not be saved as is,
 * and an empty box saying `valid JSON` would claim otherwise.
 *
 * The `try` is not defensive padding: the value arrives typed as `unknown`, and
 * `JSON.stringify` throws on a BigInt and returns `undefined` for a function or
 * a bare `undefined`. Both are unreachable through an HTTP JSON response, and
 * neither may take the editor down if the shape ever widens.
 */
export function stringifyExpected(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

/** The JSON-validity gate's answer: the parsed value, or the fact that there is none. */
export type ExpectedOutputParse =
  | { valid: true; value: unknown }
  | { valid: false; value: null };

/**
 * Parse the expected-output text.
 *
 * `unknown` and never `any`: the contract's `expected_output` is `unknown` and
 * this value's only destination is that field, so there is no shape to check it
 * against and nothing that may be assumed about it. What IS checked is that it
 * is JSON at all — which is the whole of AC-66's gate, and the reason `Save` and
 * `Run case` read their disabled state from `valid` rather than from a
 * try/catch at submit time, where the user would have already committed.
 *
 * Empty (or whitespace-only) text is invalid, not `null`: an empty box is an
 * unfinished edit, and treating it as the JSON value `null` would silently
 * replace a case's assertion with nothing.
 */
export function parseExpected(text: string): ExpectedOutputParse {
  if (text.trim() === "") return { valid: false, value: null };
  try {
    const value: unknown = JSON.parse(text);
    return { valid: true, value };
  } catch {
    return { valid: false, value: null };
  }
}

/**
 * A case execution's duration: `1840` → `"1.8s"`.
 *
 * Seconds with one decimal, matching how the dashboard's own result summary
 * spells a duration. `null` → `"—"`, never `"0.0s"`: a `not_run` case has no
 * duration, and zero would claim it finished instantly.
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One execution's outcome → its catalogue key, exhaustively.
 *
 * `not_run` gets its own sentence rather than being folded into "failed": the
 * case was never measured, and the reason is named beside it.
 */
export function lastRunLabelKey(outcome: EvalCaseOutcome): string {
  switch (outcome) {
    case "passed":
      return "caseEditor.lastRunPassed";
    case "failed":
      return "caseEditor.lastRunFailed";
    case "not_run":
      return "caseEditor.lastRunNotRun";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** The most recent execution of this case, as the last-run strip states it. */
export interface CaseLastRun {
  outcome: EvalCaseOutcome;
  reason: EvalNotRunReason | null;
  expected: number | null;
  actual: number | null;
  /** Null when the figure is not on hand — see `resolveLastRun`. */
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * Resolve what the last-run strip states, preferring the batch's own row.
 *
 * Two sources, and they carry different amounts. `EvalAgentCase.last_execution`
 * is always there once a case has run, and holds the outcome and the two counts
 * — but no duration and no cost. The batch's `EvalBatchCaseResult` holds all
 * four, and is on hand whenever this case was covered by the agent's most recent
 * completed batch. So the batch row wins when there is one, and the case's own
 * block is the fallback: a case whose last execution belongs to an older batch
 * still states its outcome and counts, with the duration and cost rendering as
 * `—` rather than as a zero that would claim the run was instant and free.
 *
 * Written as a function rather than a nested ternary in the markup because the
 * precedence is the interesting part and it is worth stating once.
 */
export function resolveLastRun(
  evalCase: EvalAgentCase,
  batchResult: EvalBatchCaseResult | null | undefined,
): CaseLastRun | null {
  if (batchResult) {
    return {
      outcome: batchResult.outcome,
      reason: batchResult.not_run_reason,
      expected: batchResult.expected_count,
      actual: batchResult.actual_count,
      durationMs: batchResult.duration_ms,
      costUsd: batchResult.cost_usd,
    };
  }
  const last = evalCase.last_execution;
  if (!last) return null;
  return {
    outcome: last.outcome,
    reason: last.not_run_reason,
    expected: last.expected_count,
    actual: last.actual_count,
    durationMs: null,
    costUsd: null,
  };
}
