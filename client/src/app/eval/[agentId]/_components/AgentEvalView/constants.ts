/* Unit-private constants for one agent's eval page.

   Everything here encodes an invariant this screen's markup has to agree with —
   the recent-runs grid tracks and the column order that must match them, the
   three metric colours and their legend keys, and how a change's direction is
   coloured. What a SECOND surface needs (the metric order, the metric label
   keys, the period options, the delta formatters) already lives in
   `src/lib/eval.ts` and is imported from there; nothing is copied down.

   No user-visible string lives here: every label is a KEY into
   `messages/en/eval.json`, resolved by the caller with `useTranslations("eval")`. */
import type { EvalMetricKey } from "@/lib/eval";

/**
 * Metric → the colour its trend series and its card sparkline are drawn in.
 *
 * The same three hues the agent editor's Evals tab uses for the same three
 * metrics, so one metric is one colour wherever it appears. Colour is decoration
 * only: every card carries its caption and its signed change in words, and the
 * chart carries a named legend.
 */
export const METRIC_COLOR: Record<EvalMetricKey, string> = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation_accuracy: "var(--info)",
};

/**
 * Metric → its ALL-CAPS card caption, under the `eval` namespace.
 *
 * The `dashboard.metrics.*` set, which is what the workspace dashboard and the
 * Evals tab both caption these numbers with — a third wording for the same
 * figure is how a reader ends up comparing two things they think are different.
 */
export const METRIC_CARD_LABEL_KEY: Record<EvalMetricKey, string> = {
  recall: "dashboard.metrics.recall",
  precision: "dashboard.metrics.precision",
  citation_accuracy: "dashboard.metrics.citationAccuracy",
};

/** Metric → the chart legend's short name for it. */
export const METRIC_LEGEND_KEY: Record<EvalMetricKey, string> = {
  recall: "dashboard.legend.recall",
  precision: "dashboard.legend.precision",
  citation_accuracy: "dashboard.legend.citation",
};

/**
 * Points the trend chart needs before it is drawn.
 *
 * Two: a single point is not a trend, and a line through one point is an empty
 * grid with a dot in it. Below this the screen says so in words
 * (`agentPage.noTrend`) rather than drawing an axis with nothing on it.
 */
export const MIN_TREND_POINTS = 2;

/** How many runs a comparison takes. Not a magic 2 spread over three files. */
export const COMPARE_SELECTION_SIZE = 2;

/** The recent-runs table's grid tracks, and the column order that matches them. */
export const RUNS_GRID = "28px 96px 64px 68px 68px 68px 78px minmax(72px, 1fr)";

/**
 * The recent-runs table's header labels, left to right, after the checkbox
 * column — which has a track and no caption, because a column of checkboxes
 * captions nothing.
 */
export const RUNS_COLUMN_KEYS: readonly string[] = [
  "dashboard.table.ranAt",
  "dashboard.table.version",
  "dashboard.table.recall",
  "dashboard.table.precision",
  "dashboard.table.citation",
  "dashboard.table.pass",
  "dashboard.table.cost",
];

/** Which way a rendered change points. `none` = nothing was measured. */
export type ChangeTone = "up" | "down" | "flat" | "none";

/**
 * Change direction → the colour it is drawn in.
 *
 * Colour is the second channel only: a change is always rendered as a signed
 * number with its unit (`+4pt`, `-$0.0004`), so a reader with colour removed
 * still knows which way it went. `flat` and `none` share a muted grey because
 * neither is a direction — one is a movement too small to name, the other is an
 * absent measurement — and their text is what tells them apart.
 */
export const CHANGE_TONE_COLOR: Record<ChangeTone, string> = {
  up: "var(--ok)",
  down: "var(--crit)",
  flat: "var(--text-muted)",
  none: "var(--text-muted)",
};

/** Keys for the skeleton rows drawn while a read is in flight. */
export const SKELETON_ROW_KEYS: readonly string[] = ["a", "b", "c", "d"];
