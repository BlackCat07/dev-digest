import type { EvalDashboardRow, EvalExpectation, EvalPeriod } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";
import { formatCost } from "./format";

/* eval.ts — runtime values and display formatters for the Eval Pipeline screens
   (L06): the eval dashboard, an agent's Evals tab, the case editor and the
   comparison modal.

   In `src/lib/` and NOT derived from the shared contract, for the reason
   `src/lib/severity.ts`, `src/lib/scope.ts` and `src/lib/risk.ts` exist: a
   client import of the vendored contract barrel must stay TYPE-ONLY (the single
   `import type` line above is the only one this file has). That barrel
   re-exports with ESM `.js` extensions webpack will not map back to `.ts`, so a
   runtime import from it resolves under `tsc` AND under `vitest` and then 500s
   every route that transitively reaches it (`client/INSIGHTS.md`, 2026-08-03).
   The `EvalExpectation` and `EvalPeriod` zod enums therefore cannot supply their
   own members here even though they hold them — the arrays below are hand-kept
   and the `Record<…>` keys are what makes the compiler catch a drift.

   No user-visible string lives in this file: every label is a KEY into
   `messages/en/eval.json`, resolved by the caller with `useTranslations("eval")`.
   The formatters return numbers-with-units, which are locale-independent here
   (the app ships only `messages/en`). */

// ===========================================================================
// The period filter
// ===========================================================================

/** One option of the dashboard's period filter: a contract value + its key. */
export interface EvalPeriodOption {
  value: EvalPeriod;
  /** Resolves under the `eval` namespace. */
  labelKey: string;
}

/**
 * The period filter's options, shortest window first.
 *
 * The `labelKey` sits beside the value rather than being derived as
 * `` `period.${value}` `` so that a renamed catalogue key is a compile-visible
 * edit in one place instead of a string that silently resolves to nothing —
 * next-intl renders the key path and logs to stderr rather than failing.
 */
export const EVAL_PERIODS: readonly EvalPeriodOption[] = [
  { value: "7d", labelKey: "period.7d" },
  { value: "30d", labelKey: "period.30d" },
  { value: "90d", labelKey: "period.90d" },
  { value: "all", labelKey: "period.all" },
];

/**
 * The window a dashboard read covers when the URL names none.
 *
 * `30d` is also what the API applies when `?period=` is absent; a client default
 * that disagreed would make the filter chip and the rendered rows describe two
 * different windows, with nothing to catch it.
 */
export const DEFAULT_EVAL_PERIOD: EvalPeriod = "30d";

// ===========================================================================
// The three metrics
// ===========================================================================

/**
 * The three scored metrics, as the contract spells them.
 *
 * Taken from `EvalDashboardRow.alert.metric` rather than written out, so the
 * keys a screen iterates and the metric the server may flag as regressed cannot
 * drift apart. The values are deliberately the contract's own FIELD names, which
 * is what lets a caller read `batch[key]` instead of carrying a second lookup.
 */
export type EvalMetricKey = NonNullable<EvalDashboardRow["alert"]>["metric"];

/**
 * Display order for the metric tiles, cards, chart series and table columns:
 * recall, precision, citation accuracy.
 *
 * One order for every surface — four separate units in two route subtrees render
 * these three, and a per-unit order is how a reader ends up comparing the first
 * tile on one screen with the second column on another.
 */
export const EVAL_METRIC_KEYS: readonly EvalMetricKey[] = [
  "recall",
  "precision",
  "citation_accuracy",
];

/**
 * Metric → its catalogue key, sentence case, under the `eval` namespace.
 *
 * Needed because the contract's field names are `snake_case` while the catalogue
 * is `camelCase`; a caller composing `` `metric.${key}` `` would ask for
 * `metric.citation_accuracy` and get the key path rendered back at it. The
 * ALL-CAPS tile labels are a different set (`dashboard.metrics.*`) — these are
 * the ones that read as a noun inside a sentence, e.g. the alert strip.
 */
export const EVAL_METRIC_LABEL_KEY: Record<EvalMetricKey, string> = {
  recall: "metric.recall",
  precision: "metric.precision",
  citation_accuracy: "metric.citationAccuracy",
};

// ===========================================================================
// The expectation badge
// ===========================================================================

/** How one expectation renders as a `Badge` from `@devdigest/ui`. */
export interface EvalExpectationBadge {
  /** Resolves under the `eval` namespace. */
  labelKey: string;
  color: string;
  bg: string;
  icon: IconName;
}

/**
 * Expectation → its badge, keyed by the contract enum so a third expectation
 * cannot be added to the contract without this map failing to compile.
 *
 * `must_find` reads as information (`--info`) and `must_not_flag` as a guard
 * rail (`--warn`): the negative case is the one a reader has to notice, because
 * every count on its row means the opposite of the row above it. Neither is
 * `--crit` — a case is an assertion, not a problem. The icon is a second,
 * non-colour channel for the same distinction, and the label carries the third:
 * a status this UI shows never rests on colour alone.
 */
export const EVAL_EXPECTATION_BADGE: Record<EvalExpectation, EvalExpectationBadge> = {
  must_find: {
    labelKey: "expectation.mustFind",
    color: "var(--info)",
    bg: "var(--bg-hover)",
    icon: "Target",
  },
  must_not_flag: {
    labelKey: "expectation.mustNotFlag",
    color: "var(--warn)",
    bg: "var(--bg-hover)",
    icon: "Slash",
  },
};

// ===========================================================================
// Display formatters — the single delta convention on every eval screen
// ===========================================================================

/**
 * A 0–1 metric as a whole percentage: `0.82` → `"82%"`.
 *
 * Null (nothing measured — a zero denominator) renders `"—"`, never `"0%"`: the
 * contract makes every metric nullable precisely so "we could not measure
 * recall" and "recall is 0%" stay distinguishable, and collapsing them here
 * would throw that away at the last step. Rounding matches `toPercent` in
 * `src/lib/conventions.ts` and `src/lib/skill.ts`, so one agent's adherence and
 * its recall are rounded the same way on one screen.
 */
export function formatMetricPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/**
 * A signed change in a 0–1 metric, in PERCENTAGE POINTS: `0.04` → `"+4pt"`.
 *
 * This is the single delta convention for the whole feature, and it is the whole
 * reason this module exists. A metric shown as `82%` must render its change as
 * `4pt` and never as `0.04`: the raw number is a change in a ratio, which reads
 * as "0.02 of what?" beside a value in percent. Four separate units — the Evals
 * tab's tiles, the per-agent metric cards, the dashboard rows and the comparison
 * modal's cards — render this, so a second local formatter anywhere puts two
 * conventions on one screen. There is no reason for a caller to write its own.
 *
 * Note the vendored `MetricCard` renders its own `delta` prop as
 * `Math.abs(delta).toFixed(2)` with an arrow and NO unit — that is the `↓ 0.02`
 * convention this replaces. Pass the metric through `value`/`suffix` and render
 * the change from here; the primitive is not ours to restyle.
 *
 * `null` in → `null` out, so the caller renders the catalogue's `notMeasured`
 * rather than a zero change: a change is null whenever either side of the
 * comparison was never measured, and `"0pt"` would claim the metric held still.
 *
 * A change smaller than one point keeps one decimal (`0.004` → `"+0.4pt"`)
 * instead of rounding to `"0pt"`, so a real regression is never announced as no
 * movement. Below the one-decimal resolution it is `"0pt"`, unsigned — a signed
 * `"-0.0pt"` would be noise dressed as a direction.
 */
export function formatMetricChange(change: number | null | undefined): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const points = change * 100;
  const magnitude = Math.abs(points);
  if (magnitude < 0.05) return "0pt";
  const sign = points > 0 ? "+" : "-";
  return `${sign}${magnitude < 1 ? magnitude.toFixed(1) : String(Math.round(magnitude))}pt`;
}

/**
 * A signed change in cost: `0.0013` → `"+$0.0013"`.
 *
 * Cost is compared exactly like a metric and is NOT one — it carries currency
 * rather than a 0–1 ratio, so it gets the currency unit and not points. The
 * magnitude goes through `formatCost` so the comparison modal's fourth card and
 * every other cost in the app pick their precision the same way; a run costing
 * $0.0004 must not read as `$0.00`.
 *
 * `null` in → `null` out, for the same reason as `formatMetricChange`.
 */
export function formatCostChange(change: number | null | undefined): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  if (change === 0) return formatCost(0);
  return `${change > 0 ? "+" : "-"}${formatCost(Math.abs(change))}`;
}

/**
 * The pass count as a ratio of what a batch set out to cover: `"17/20"`.
 *
 * Both figures come from the SAME batch — `cases_passed` over `cases_covered` of
 * the most recent COMPLETED batch — and never from the set's current size, which
 * is a third number a screen may also show. The gap is meaningful: a case added
 * after that batch is in the set and was never covered by it, so mixing the two
 * denominators makes a passing agent look like a failing one.
 *
 * A missing figure renders `"—"` on its own side rather than `0`: a running
 * batch has neither yet, and `"0/20"` would read as twenty failures.
 */
export function formatCaseCounts(
  passed: number | null | undefined,
  covered: number | null | undefined,
): string {
  if (passed == null && covered == null) return "—";
  return `${passed ?? "—"}/${covered ?? "—"}`;
}
