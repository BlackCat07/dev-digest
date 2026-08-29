/* Unit-private pure helpers for the eval case editor.

   One function is left here: `resolveLastRun`, which is about THIS unit's two
   sources of a last execution. The validity gate and the two display formatters
   moved to `src/lib/eval.ts` when a second editor — the draft modal opened from
   a finding — needed exactly the same four, and two copies of a JSON gate is how
   two screens come to disagree about what `valid JSON` means. */
import type {
  EvalAgentCase,
  EvalBatchCaseResult,
  EvalCaseOutcome,
  EvalNotRunReason,
} from "@devdigest/shared";

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
