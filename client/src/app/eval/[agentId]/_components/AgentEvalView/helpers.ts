/* Unit-private pure helpers for one agent's eval page.

   Every function here is a function of its arguments — no React, no fetch, no
   i18n. They exist so the component reads as a composition of parts rather than
   as arithmetic interleaved with markup, and so the three things that are easy
   to get quietly wrong are each stated once: WHICH batch a card's change is
   measured against, which trend points a chart may honestly draw, and which of
   two selected runs is the earlier one.

   `previousTrendPoint`, `metricChange` and `changeTone` are deliberate
   DUPLICATES of the agent editor's Evals tab helpers. Law 2 would promote them
   to the nearest common ancestor on this second consumer — that ancestor is
   `src/lib/eval.ts`, which this task does not own, and moving a file the other
   unit imports would break it in the same wave. The duplication is recorded
   rather than hidden; the delta FORMATTERS, which are the part that must not
   fork, are imported from `src/lib/eval.ts` by both. */
import type { EvalBatch, EvalBatchTrendPoint, EvalDashboardRow } from "@devdigest/shared";
import { EVAL_METRIC_KEYS, type EvalMetricKey } from "@/lib/eval";
import { COMPARE_SELECTION_SIZE, MIN_TREND_POINTS, type ChangeTone } from "./constants";

// ===========================================================================
// The three metric cards
// ===========================================================================

/**
 * The batch a change is measured against: the one immediately before this row's
 * most recent completed batch, in the retained trend.
 *
 * Located by BATCH ID rather than taken as `trend[trend.length - 2]`, so the
 * pair being differenced is always the last batch and its own predecessor even
 * if the trend ever carries a point `last_batch` is not. When the last batch
 * cannot be found in the trend, or is the first point in it, there is nothing to
 * compare against and the answer is null — a card then renders "not measured"
 * rather than a change against an unrelated run.
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
 * a change of zero, and 0 would claim the metric held still. The same rule the
 * server applies to `EvalComparison.change`, restated because these cards
 * compute their own pair from the trend rather than calling the compare endpoint.
 */
export function metricChange(
  later: number | null | undefined,
  earlier: number | null | undefined,
): number | null {
  if (later == null || earlier == null) return null;
  return later - earlier;
}

/** One metric card's figures. Formatting is the component's job, not this one's. */
export interface MetricCardFigures {
  key: EvalMetricKey;
  /** The 0–1 metric of the most recent completed batch, or null if unmeasured. */
  value: number | null;
  /** Signed change against the previous batch, or null. */
  change: number | null;
  /** Chronological series for the card's sparkline, or null when too short. */
  trend: number[] | null;
}

/** The three metric cards, in the one display order every eval surface uses. */
export function metricCards(row: EvalDashboardRow | null | undefined): MetricCardFigures[] {
  const previous = previousTrendPoint(row);
  return EVAL_METRIC_KEYS.map((key) => {
    const value = row?.last_batch?.[key] ?? null;
    const series = (row?.trend ?? [])
      .map((point) => point[key])
      .filter((v): v is number => v != null);
    return {
      key,
      value,
      change: metricChange(value, previous?.[key] ?? null),
      trend: series.length >= MIN_TREND_POINTS ? series : null,
    };
  });
}

/**
 * Which way a change points, read off the ALREADY FORMATTED string.
 *
 * Deliberately not re-derived from the number: `formatMetricChange` renders a
 * movement below a tenth of a point as an unsigned `"0pt"`, and a tone computed
 * from the raw sign would then colour a card green while its text says nothing
 * moved. Reading the sign the user can actually see keeps the two in agreement
 * by construction, and keeps that threshold defined in exactly one place.
 */
export function changeTone(formatted: string | null): ChangeTone {
  if (formatted === null) return "none";
  if (formatted.startsWith("+")) return "up";
  if (formatted.startsWith("-")) return "down";
  return "flat";
}

// ===========================================================================
// The trend chart
// ===========================================================================

/**
 * The trend points the chart may honestly draw: only those where all three
 * metrics were measured.
 *
 * `LineChart` has no concept of a gap — it renders a missing value as `0`, which
 * would draw a batch that measured nothing as a batch that scored zero on every
 * metric, and that is the one claim this whole feature exists to keep separate.
 * Dropping the point instead means the line joins the two batches that DID
 * measure, and the recent-runs table below still shows the dropped batch with
 * `—` in its metric cells, so nothing disappears from the screen.
 */
export function chartPoints(row: EvalDashboardRow | null | undefined): EvalBatchTrendPoint[] {
  return (row?.trend ?? []).filter((point) =>
    EVAL_METRIC_KEYS.every((key) => point[key] != null),
  );
}

/** Whether there is enough of a trend to draw. Below two points there is not. */
export function hasTrend(points: readonly EvalBatchTrendPoint[]): boolean {
  return points.length >= MIN_TREND_POINTS;
}

// ===========================================================================
// Run selection
// ===========================================================================

/** The two batches a comparison runs over, oldest first. */
export interface ComparePair {
  earlierBatchId: string;
  laterBatchId: string;
}

/**
 * The selected pair, ordered EARLIER → LATER, or null when the selection is not
 * exactly two runs.
 *
 * The order is derived from `started_at` and never from the click order or the
 * table's own order: the comparison's `change` is `later - earlier`, so a pair
 * handed over backwards reports every improvement as a regression and every
 * regression as an improvement, with nothing on screen to reveal it. Ties fall
 * back to the batch id, so the pair is stable rather than dependent on which of
 * two same-instant rows the array happened to hold first.
 *
 * Returning null below and above two selections is what makes the `Compare`
 * control's enabled condition — exactly two — a single expression rather than a
 * count repeated in the markup.
 */
export function comparePair(
  selectedIds: readonly string[],
  batches: readonly EvalBatch[],
): ComparePair | null {
  if (selectedIds.length !== COMPARE_SELECTION_SIZE) return null;
  const picked = batches.filter((b) => selectedIds.includes(b.id));
  if (picked.length !== COMPARE_SELECTION_SIZE) return null;
  const [a, b] = [...picked].sort((x, y) =>
    x.started_at === y.started_at
      ? x.id.localeCompare(y.id)
      : x.started_at.localeCompare(y.started_at),
  );
  if (!a || !b) return null;
  return { earlierBatchId: a.id, laterBatchId: b.id };
}

/** Add or remove one batch id from the selection. */
export function toggleSelection(selected: readonly string[], batchId: string): string[] {
  return selected.includes(batchId)
    ? selected.filter((id) => id !== batchId)
    : [...selected, batchId];
}

/**
 * The distinct agent versions a comparison offers to promote, oldest first.
 *
 * Deduped, because two batches of the SAME version are a normal comparison — the
 * `same_config` case — and two promote controls with identical accessible names
 * are two controls a reader (and a query by name) cannot tell apart.
 */
export function promotableVersions(earlier: number, later: number): number[] {
  return earlier === later ? [earlier] : [earlier, later].sort((a, b) => a - b);
}
