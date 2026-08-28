/** Constants for FindingCard. */

import type { EvalRefusalReason } from "@devdigest/shared";

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";

/**
 * `EvalRefusalReason` → the `prReview` key that spells that refusal out.
 *
 * Two type annotations, both load-bearing:
 *
 * - `satisfies Record<EvalRefusalReason, MessageKey>` makes a member ADDED to the
 *   contract a compile error here, rather than a card that quietly falls back to
 *   the generic sentence. A refusal nobody wrote copy for is the one failure mode
 *   this map exists to prevent.
 * - the `Record<string, …>` annotation is what lets the card look up an
 *   `ApiError.code` — a plain `string` off the wire, which may be a code this
 *   build has never heard of — with no cast into a union it may not belong to.
 *   With `noUncheckedIndexedAccess` on, the read is `… | undefined`, so the
 *   fallback below is not optional.
 */
type EvalRefusalMessageKey = `finding.evalRefusal.${EvalRefusalReason}`;

export const EVAL_REFUSAL_MESSAGE_KEY: Readonly<Record<string, EvalRefusalMessageKey>> = {
  review_has_no_agent: "finding.evalRefusal.review_has_no_agent",
  finding_has_no_decision: "finding.evalRefusal.finding_has_no_decision",
  duplicate_source_finding: "finding.evalRefusal.duplicate_source_finding",
  conflicting_anchor: "finding.evalRefusal.conflicting_anchor",
  case_limit_reached: "finding.evalRefusal.case_limit_reached",
  diff_too_large: "finding.evalRefusal.diff_too_large",
  anchor_not_in_diff: "finding.evalRefusal.anchor_not_in_diff",
  cross_agent_compare: "finding.evalRefusal.cross_agent_compare",
  batch_already_running: "finding.evalRefusal.batch_already_running",
} satisfies Record<EvalRefusalReason, EvalRefusalMessageKey>;

/** Shown when the server refuses with a code this build does not know. */
export const EVAL_REFUSAL_FALLBACK_KEY = "finding.evalRefusalUnknown";
