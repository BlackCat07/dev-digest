/* Unit-private constants for the workspace eval dashboard.

   Everything here encodes an invariant this screen's markup has to agree with —
   the two grid track lists and the column order that must match them, how a
   metric is coloured, and how many points a sparkline needs — so it sits beside
   the component that must agree with it rather than in a global constants file.
   What a SECOND surface needs (the metric order, the period options, the delta
   formatter) already lives in `src/lib/eval.ts` and is imported from there;
   nothing is copied down.

   No user-visible string lives here: every label is a KEY into
   `messages/en/eval.json`, resolved by the caller with `useTranslations("eval")`. */
import type { EvalMetricKey } from "@/lib/eval";

/**
 * The recent-runs table's grid tracks, and the column order that must agree with
 * them.
 *
 * The two live side by side deliberately: a column added to one list and not the
 * other shifts every cell to its right by one, which is a defect no type and no
 * gate can see. The three metric tracks are wide because each now holds a bar
 * AND its number, not a number alone.
 */
export const RUNS_GRID =
  "minmax(130px, 1.4fr) 80px 52px minmax(96px, 1fr) minmax(96px, 1fr) minmax(96px, 1fr) 60px 74px";

/** The recent-runs table's header labels, left to right. */
export const RUNS_COLUMN_KEYS: readonly string[] = [
  "dashboard.table.agent",
  "dashboard.table.ranAt",
  "dashboard.table.version",
  "dashboard.table.recall",
  "dashboard.table.precision",
  "dashboard.table.citation",
  "dashboard.table.pass",
  "dashboard.table.cost",
];

/**
 * Points a sparkline needs before it is drawn.
 *
 * Two, and it is not cosmetic. `Sparkline` maps each point to `i / (n - 1)`, so
 * a single point divides by zero and draws a path of `NaN` coordinates — an
 * invisible failure rather than an error — and a one-point trend renders as a
 * dot on an empty grid, which reads as a bug. An agent with fewer than two
 * completed batches therefore gets no sparkline at all.
 */
export const MIN_SPARKLINE_POINTS = 2;

/**
 * Which metric the card sparkline draws.
 *
 * Recall, because it is the first metric in the display order every eval surface
 * uses and a card has room for exactly one line. Its colour is not declared here
 * — it comes from `EVAL_METRIC_COLOR` in `src/lib/eval.ts`, so the line and the
 * `RECALL` figure beside it cannot end up different blues.
 */
export const SPARKLINE_METRIC: EvalMetricKey = "recall";

/**
 * The three stat columns on an agent card, and the SHORT caption each carries.
 *
 * `PREC` and `CITE` rather than the full words: at 62px a column captioned
 * `PRECISION` wraps, and the reference abbreviates for the same reason. The
 * full words stay in use wherever there is room (the tiles, the tab).
 */
export const CARD_STAT_LABEL_KEY: Record<EvalMetricKey, string> = {
  recall: "dashboard.cardStats.recall",
  precision: "dashboard.cardStats.precision",
  citation_accuracy: "dashboard.cardStats.citation",
};

/**
 * Marks the sparkline wrapper so its presence and absence are assertable.
 *
 * A `data-testid` and not a role: the sparkline is a decorative `<svg>` with no
 * accessible name, it shares the tag with every icon on the row, and adding a
 * caption for it would mean a new catalogue key. "A one-batch agent's row has no
 * sparkline element" is the requirement, and this is the only handle on it that
 * does not depend on counting SVGs.
 */
export const SPARKLINE_TESTID = "agent-trend-sparkline";

/**
 * Keys for the skeleton rows drawn while the dashboard read is in flight.
 *
 * A constant list rather than `Array.from({ length: 4 })`, so the rows carry
 * stable keys that are not array indices — the same rule the real rows follow.
 */
export const SKELETON_ROW_KEYS: readonly string[] = ["a", "b", "c", "d"];
