/* Unit-private constants for the agent editor's Evals tab.

   Everything here encodes an invariant this tab's markup has to agree with — the
   tile order, the four tile labels, and how one row's status renders — so it
   sits beside the component that must agree with it rather than in a global
   constants file. What a SECOND surface needs (the metric order, the
   expectation badge, the delta formatter) is already in `src/lib/eval.ts` and is
   imported from there; nothing is copied down.

   No user-visible string lives here: every label is a KEY into
   `messages/en/eval.json`, resolved by the caller with `useTranslations("eval")`. */
import type { IconName } from "@devdigest/ui";
import type { EvalMetricKey } from "@/lib/eval";

/**
 * Metric → its ALL-CAPS tile label, under the `eval` namespace.
 *
 * The `dashboard.metrics.*` set and not `metric.*`: these are the tile captions
 * (`RECALL`, `PRECISION`, `CITATION ACCURACY`) the eval dashboard already uses,
 * so an agent's tab and the workspace dashboard caption the same number the same
 * way. Keyed by `EvalMetricKey`, so a fourth metric on the contract cannot be
 * added without this map failing to compile.
 */
export const METRIC_TILE_LABEL_KEY: Record<EvalMetricKey, string> = {
  recall: "dashboard.metrics.recall",
  precision: "dashboard.metrics.precision",
  citation_accuracy: "dashboard.metrics.citationAccuracy",
};

/** The fourth tile — a ratio rather than a percentage, hence its own key. */
export const CASES_TILE_LABEL_KEY = "dashboard.metrics.casesPassed";

/** How one case's last outcome renders. Four kinds, and each carries a WORD. */
export type EvalRowStatusKind = "never" | "passed" | "failed" | "not_run";

export interface EvalRowStatusStyle {
  icon: IconName;
  color: string;
  /** Resolves under the `eval` namespace. */
  labelKey: string;
}

/**
 * Status → icon, colour and label key.
 *
 * Four distinct icons on purpose. `not_run` must not read as a failure — nothing
 * was measured, rather than measured and wrong — so it takes `Slash` in `--warn`
 * where `failed` takes `XCircle` in `--crit`; and `never` run is a third state
 * again, muted with `Dot`. The label is the load-bearing channel: with colour
 * removed a reader still sees `passed`, `failed`, `not run` or `never run`,
 * which is the requirement. The icon is the second channel, never the only one.
 */
export const ROW_STATUS_STYLE: Record<EvalRowStatusKind, EvalRowStatusStyle> = {
  never: { icon: "Dot", color: "var(--text-muted)", labelKey: "evalsTab.neverRun" },
  passed: { icon: "CheckCircle", color: "var(--ok)", labelKey: "evalsTab.passed" },
  failed: { icon: "XCircle", color: "var(--crit)", labelKey: "evalsTab.failed" },
  not_run: { icon: "Slash", color: "var(--warn)", labelKey: "evalsTab.notRun" },
};

/** Where the tab's dashboard link points. The workspace dashboard, not this agent. */
export const EVAL_DASHBOARD_HREF = "/eval";

/**
 * Keys for the skeleton rows drawn while the case set is in flight.
 *
 * A constant list rather than `Array.from({ length: 3 })`, so the rows carry
 * stable keys that are not array indices — the same rule the real rows follow.
 */
export const SKELETON_ROW_KEYS: readonly string[] = ["a", "b", "c"];

/**
 * How a batch-start refusal is phrased — ONE named reason, plus a fallback.
 *
 * The wording lives in the `prReview` catalogue because the finding card renders
 * the same nine refusals and there must be exactly one place each is phrased.
 * Only `batch_already_running` is reachable from this surface — starting a batch
 * is the one write here that names a refusal — so this is a one-entry lookup and
 * not a copy of the card's nine-entry map. That map is `FindingCard`'s own
 * unit-private constant; reaching into another unit's `constants.ts` is the
 * import this repo's structure rules forbid, and promoting it would mean editing
 * `src/lib/`, which this task does not own.
 *
 * `Record<string, …>` because the value being looked up is an `ApiError.code` off
 * the wire, which may be a code this build has never heard of; with
 * `noUncheckedIndexedAccess` on the read is `… | undefined`, so the fallback is
 * not optional.
 */
export const BATCH_REFUSAL_MESSAGE_KEY: Readonly<Record<string, string>> = {
  batch_already_running: "finding.evalRefusal.batch_already_running",
};

/** Shown when a batch start is refused with a code this build does not know. */
export const BATCH_REFUSAL_FALLBACK_KEY = "finding.evalRefusalUnknown";

/** Which way a rendered metric change points. `none` = nothing was measured. */
export type ChangeTone = "up" | "down" | "flat" | "none";

/**
 * Change direction → the colour it is drawn in.
 *
 * Colour is the second channel only: the change itself is always rendered as a
 * signed number with its unit (`+4pt`, `-2pt`), so a reader with colour removed
 * still knows which way it went. `flat` and `none` share a muted grey because
 * neither is a direction — one is a movement too small to name, the other is an
 * absent measurement, and both are told apart by their text.
 */
export const CHANGE_TONE_COLOR: Record<ChangeTone, string> = {
  up: "var(--ok)",
  down: "var(--crit)",
  flat: "var(--text-muted)",
  none: "var(--text-muted)",
};
