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
 * The agent table's grid tracks, and the column order that must agree with them.
 *
 * The two live side by side deliberately: a column added to one list and not the
 * other shifts every cell to its right by one, which is a defect no type and no
 * gate can see. The trend cell has a track and no label — a sparkline is
 * decoration and captions nothing.
 */
export const AGENT_GRID =
  "minmax(150px, 1.7fr) minmax(96px, 1fr) 64px 78px 96px 68px 68px 68px 64px";

/** The agent table's header labels, left to right, under the `eval` namespace. */
export const AGENT_COLUMN_KEYS: readonly string[] = [
  "dashboard.agentColumns.agent",
  "dashboard.agentColumns.model",
  "dashboard.agentColumns.version",
  "dashboard.agentColumns.lastRun",
  "dashboard.agentColumns.cases",
  "dashboard.agentColumns.recall",
  "dashboard.agentColumns.precision",
  "dashboard.agentColumns.citation",
];

/** The recent-runs table's grid tracks. Same rule as `AGENT_GRID`. */
export const RUNS_GRID =
  "minmax(140px, 1.6fr) 86px 64px 68px 68px 68px 78px minmax(72px, 1fr)";

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
 * Which metric the row sparkline draws, and in which colour.
 *
 * Recall, because it is the first metric in the display order every eval surface
 * uses and the row has room for exactly one line. The colour matches the same
 * metric's series on the per-agent trend chart, so one metric is one colour
 * across both screens.
 */
export const SPARKLINE_METRIC: EvalMetricKey = "recall";
export const SPARKLINE_COLOR = "var(--accent)";

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
