/* Unit-private pure helpers for the agent editor's Evals tab.

   Everything here is a function of its arguments — no React, no fetch, no i18n
   (the runtime imports are `ApiError`, for an `instanceof` check, and the
   vendored `SEV` / `CAT` lookup tables, which are plain objects).
   It exists so the component reads as a composition of parts rather than as
   arithmetic interleaved with markup, and so the two decisions that are easy to
   get quietly wrong (WHICH batch a change is measured against, and WHICH of the
   three case-count denominators a figure comes from) are each stated once.

   None of it is promoted: a second consumer would move it to `src/lib/eval.ts`,
   where the delta formatter and the metric order already live. There is no
   second consumer today. */
import { CAT, SEV, type Category, type Severity } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { EVAL_METRIC_KEYS, type EvalMetricKey } from "@/lib/eval";
import type {
  EvalAgentCase,
  EvalBatchCaseResult,
  EvalBatchTrendPoint,
  EvalDashboardRow,
  EvalNotRunReason,
} from "@devdigest/shared";
import type { RunEvent } from "@devdigest/shared";
import {
  BATCH_REFUSAL_FALLBACK_KEY,
  BATCH_REFUSAL_MESSAGE_KEY,
  type ChangeTone,
} from "./constants";

// ===========================================================================
// The metric tiles
// ===========================================================================

/**
 * The batch a change is measured against: the one immediately before the row's
 * most recent completed batch, in the retained trend.
 *
 * Located by BATCH ID rather than taken as `trend[trend.length - 2]`, so the
 * pair being differenced is always the last batch and its own predecessor even
 * if the trend ever carries a point the dashboard's `last_batch` is not. When
 * the last batch cannot be located in the trend, or is the first point in it,
 * there is nothing to compare against and the answer is null — a tile then
 * renders no change at all, rather than a change against an unrelated run.
 */
export function previousTrendPoint(
  row: EvalDashboardRow | null | undefined,
): EvalBatchTrendPoint | null {
  const lastId = row?.last_batch?.batch_id;
  if (!row || !lastId) return null;
  const idx = row.trend.findIndex((p) => p.batch_id === lastId);
  if (idx <= 0) return null;
  return row.trend[idx - 1] ?? null;
}

/**
 * A signed change, or null when either side was never measured.
 *
 * Null in either argument propagates: "recall was not measured last time" is not
 * a change of zero, and `0` would claim the metric held still. This is the same
 * rule the server applies to `EvalComparison.change`, restated here because the
 * tiles compute their own pair from the trend rather than calling the compare
 * endpoint.
 */
export function metricChange(
  later: number | null | undefined,
  earlier: number | null | undefined,
): number | null {
  if (later == null || earlier == null) return null;
  return later - earlier;
}

/** One metric tile's figures. Formatting is the component's job, not this one's. */
export interface MetricTileFigures {
  key: EvalMetricKey;
  /** The 0–1 metric of the most recent completed batch, or null if unmeasured. */
  value: number | null;
  /** Signed change in the metric against the previous batch, or null. */
  change: number | null;
}

/**
 * The three metric tiles, in the one display order every eval surface uses.
 *
 * The value comes from `last_batch` — the most recent COMPLETED batch — and not
 * from the trend's last point, because `last_batch` is what the pass ratio below
 * also reads and a tile row that mixed sources could show a percentage from one
 * batch beside a ratio from another.
 *
 * No series is built: these tiles draw no sparkline. A trend needs an axis to be
 * read against, which this compact row has no room for, so it lives on the
 * agent's own eval page as a real chart instead. `previousTrendPoint` is still
 * needed — the CHANGE is one point of history, which a number can carry.
 */
export function metricTiles(row: EvalDashboardRow | null | undefined): MetricTileFigures[] {
  const previous = previousTrendPoint(row);
  return EVAL_METRIC_KEYS.map((key) => {
    const value = row?.last_batch?.[key] ?? null;
    return {
      key,
      value,
      change: metricChange(value, previous?.[key] ?? null),
    };
  });
}

// ===========================================================================
// One case's row
// ===========================================================================

/**
 * A case's last outcome, as the row renders it.
 *
 * A discriminated union and not the contract's `EvalCaseOutcome`, because the
 * row has a fourth state the outcome enum cannot express: a case that has never
 * executed at all. `never run` and `not run` are different sentences — one has
 * no history, the other has a history of not being measured — and the row must
 * not collapse them.
 */
export type EvalRowStatus =
  | { kind: "never" }
  | { kind: "passed" }
  | { kind: "failed" }
  | { kind: "not_run"; reason: EvalNotRunReason | null };

/** Resolve one case's row status, exhaustively over `EvalCaseOutcome`. */
export function rowStatus(evalCase: EvalAgentCase): EvalRowStatus {
  const last = evalCase.last_execution;
  if (!last) return { kind: "never" };
  switch (last.outcome) {
    case "passed":
      return { kind: "passed" };
    case "failed":
      return { kind: "failed" };
    case "not_run":
      return { kind: "not_run", reason: last.not_run_reason };
    default: {
      // A fifth outcome on the contract lands here as a compile error rather
      // than as a row that silently renders nothing.
      const exhaustive: never = last.outcome;
      return exhaustive;
    }
  }
}

// ===========================================================================
// The batch's per-case results
// ===========================================================================

/**
 * Per-case results of a batch, keyed by case id.
 *
 * The case list itself carries only the outcome and the two counts; the DURATION
 * and the COST of an execution live on the batch's own per-case rows, which is
 * the only place the case editor's last-run strip can read them from.
 */
export function resultsByCaseId(
  results: readonly EvalBatchCaseResult[] | undefined,
): Map<string, EvalBatchCaseResult> {
  return new Map((results ?? []).map((r) => [r.case_id, r]));
}

// ===========================================================================
// Live progress
// ===========================================================================

/**
 * How many cases of a running batch have reached an outcome.
 *
 * Counted from the `result` frames alone. The stream also carries `info`
 * heartbeats — one every 15 s while nothing has resolved — so counting every
 * frame would advance a progress bar that has measured nothing, which is the
 * whole failure mode a heartbeat exists to avoid looking like.
 */
export function completedCaseCount(events: readonly RunEvent[]): number {
  return events.filter((e) => e.kind === "result").length;
}

/** Progress as a whole percentage, and 0 rather than NaN when nothing is covered. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/**
 * Which way a change points, read off the ALREADY FORMATTED string.
 *
 * Deliberately not re-derived from the number: `formatMetricChange` renders a
 * movement below one tenth of a point as an unsigned `"0pt"`, and a tone
 * computed from the raw sign would then colour a tile green while its text says
 * nothing moved. Reading the sign the user can actually see keeps the two in
 * agreement by construction, and keeps that threshold defined in exactly one
 * place — `src/lib/eval.ts`, the module that owns the delta convention.
 */
export function changeTone(formatted: string | null): ChangeTone {
  if (formatted === null) return "none";
  if (formatted.startsWith("+")) return "up";
  if (formatted.startsWith("-")) return "down";
  return "flat";
}

// ===========================================================================
// Refusals
// ===========================================================================

/**
 * A failed batch start → the catalogue key that names WHY, or null if it did not
 * fail.
 *
 * The message key and never a sentence: the wording is the `prReview`
 * catalogue's, which is where the finding card reads the same nine refusals
 * from. An error that is not an `ApiError`, or one carrying a code this build has
 * never heard of, still says something — a refusal rendered as nothing at all is
 * the failure mode this fallback exists for, because every other signal a UI
 * trusts will say the run started.
 */
export function batchRefusalKey(error: unknown): string | null {
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : undefined;
  return (code ? BATCH_REFUSAL_MESSAGE_KEY[code] : undefined) ?? BATCH_REFUSAL_FALLBACK_KEY;
}

// ===========================================================================
// The source finding's severity and category
// ===========================================================================

/**
 * Narrow a stored severity to one the vendored badge can render, or null.
 *
 * The guard is not defensive padding, it is required. `eval_cases.source_severity`
 * is a plain `text` column mirroring `findings.severity`, so its value is a
 * string as far as any type here knows — and `SeverityBadge` looks the value up
 * in `SEV` and immediately reads `.icon` off the result, so an unrecognised
 * string is a THROWN error inside a list row, not a missing chip. `CategoryTag`
 * is kinder (it returns null on a miss) and is guarded the same way anyway, so
 * one rule covers both and neither depends on the other's manners.
 *
 * The membership test is against the vendored tables themselves rather than a
 * local list of names: a fourth severity added there must not need a second edit
 * here to become renderable.
 */
export function severityChip(value: string | null | undefined): Severity | null {
  return value != null && value in SEV ? (value as Severity) : null;
}

/** The same guard for the category half. See {@link severityChip}. */
export function categoryChip(value: string | null | undefined): Category | null {
  return value != null && value in CAT ? (value as Category) : null;
}
