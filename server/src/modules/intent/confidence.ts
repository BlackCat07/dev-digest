import type { IntentSource, IntentSourceKind, IntentStatus } from '@devdigest/shared';
import {
  INTENT_MIN_CONFIDENCE,
  INTENT_SELF_REPORT_FLOOR,
  INTENT_UNFETCHED_CONFIDENCE_CEILING,
  SOURCE_CONFIDENCE_WEIGHTS,
} from './constants.js';

/**
 * How confident the stored intent is, derived from what the classifier actually
 * had in front of it.
 *
 * Pure and deterministic: no clock, no I/O, no `this`. Given the same audit
 * trail and the same self-report it returns the same number, which is what makes
 * the properties below testable and what makes the figure defensible when a user
 * asks why the card says 0.45.
 *
 * The precedent is `conventions/adherence.ts`'s `deriveConfidence`, and the
 * stated principle is the same one: an unchecked claim must never sort above a
 * checked one. Here that means the MODEL'S OWN ESTIMATE MAY ONLY LOWER THE
 * FIGURE, NEVER RAISE IT. A model that had nothing but a title and reports 0.95
 * is not more right about the sources than the list of sources is.
 */

/**
 * THE INVARIANT, stated so it can be pinned without reading the body.
 *
 * Write `available(S)` for what the sources alone are worth and `stored(S, r)`
 * for what this function returns:
 *
 * ```
 * weights(S)   = Σ SOURCE_CONFIDENCE_WEIGHTS[k] over the DISTINCT kinds k of S
 *                whose status is 'used'
 * available(S) = max(INTENT_MIN_CONFIDENCE, clamp01(weights(S))),
 *                then capped at INTENT_UNFETCHED_CONFIDENCE_CEILING when any
 *                source of S is 'unfetched'
 * discount(r)  = INTENT_SELF_REPORT_FLOOR
 *                + (1 - INTENT_SELF_REPORT_FLOOR) * clamp01(r)   ∈ [FLOOR, 1]
 * stored(S, r) = max(INTENT_MIN_CONFIDENCE, available(S) * discount(r))
 * ```
 *
 * Four properties follow, and all four are load-bearing:
 *
 *  1. **The self-report may only ever LOWER the figure.** `discount(r) ≤ 1`, so
 *     `stored(S, r) ≤ available(S)` for every `r`, with equality exactly at
 *     `r = 1`. `stored` is monotonically non-decreasing in `r`. A model that had
 *     nothing but a title and reports 0.95 is not more right about the sources
 *     than the list of sources is — self-reported LLM confidence is documented
 *     as overconfident and poorly calibrated, which is the whole reason the
 *     figure is derived rather than trusted.
 *  2. **For a FIXED self-report, adding a used `pr_body` strictly raises the
 *     figure.** `discount(r)` is strictly positive (it is at least `FLOOR`), and
 *     `available` is strictly larger with the body: `pr_body`'s weight is
 *     positive, kinds are counted once, and the unfetched ceiling (0.6) sits
 *     above every value reachable without a body (0.45 at most), so the cap can
 *     never flatten the two into a tie either. The `INTENT_MIN_CONFIDENCE` floor
 *     cannot flatten them either: any set with a used `pr_body` stores at least
 *     `0.35 * FLOOR`, which is above the floor, so the floor only ever lifts the
 *     body-less side.
 *  3. **Any `unfetched` source caps the figure**, and the same fact forces
 *     `status: 'partial'` (see {@link intentStatusFor}). An intent derived over
 *     something we could not read is never allowed to look as good as one
 *     derived over something we could.
 *  4. **Pure.** No clock, no I/O, no `this`. Same audit trail + same self-report
 *     → same number, which is what makes the figure defensible when a user asks
 *     why the card says 0.45.
 *
 * WHY A DISCOUNT AND NOT A `Math.min`. The obvious spelling —
 * `min(available, selfReport)`, optionally with a floor proportional to
 * `available` — FALSIFIES property 2, which is what shipped and what this
 * replaces. Under a hard `min`, every self-report at or below the smaller
 * `available` collapses both sides onto the same number: with no body the sources
 * are worth 0.15 and with one 0.50, so any self-report ≤ 0.15 stored 0.15 for
 * both. Adding a proportional floor `max(available * FLOOR, min(available, r))`
 * does not rescue it — it only moves the collision, because a self-report that
 * lands inside BOTH clamped ranges (e.g. r = 0.42 against ranges [0.225, 0.45]
 * and [0.40, 0.80]) is again returned verbatim for both. Multiplying is the only
 * one of the three that is strictly monotone in `available` for every fixed `r`,
 * which is exactly what property 2 asks for.
 */
export function deriveConfidence(sources: readonly IntentSource[], selfReport: number): number {
  // Counted once per KIND, not once per source: three linked issues are not
  // three times the certainty, and letting them stack is what would push a
  // no-description PR past the ceiling and break property 2.
  const kinds = new Set<IntentSourceKind>();
  for (const source of sources) {
    if (source.status === 'used') kinds.add(source.kind);
  }

  let available = 0;
  for (const kind of kinds) available += SOURCE_CONFIDENCE_WEIGHTS[kind];
  available = Math.max(INTENT_MIN_CONFIDENCE, clamp01(available));

  if (hasUnfetched(sources)) {
    available = Math.min(available, INTENT_UNFETCHED_CONFIDENCE_CEILING);
  }

  // The one direction the model is allowed to move this, applied as a BOUNDED
  // DISCOUNT on what the sources were worth rather than as a competing figure.
  const discount =
    INTENT_SELF_REPORT_FLOOR + (1 - INTENT_SELF_REPORT_FLOOR) * clamp01(selfReport);
  return Math.max(INTENT_MIN_CONFIDENCE, available * discount);
}

/** Whether anything the classifier was offered could not be read. */
export function hasUnfetched(sources: readonly IntentSource[]): boolean {
  return sources.some((source) => source.status === 'unfetched');
}

/**
 * `partial` when a source came back `unfetched`, `ok` otherwise.
 *
 * Lives beside {@link deriveConfidence} because both are the same fact read two
 * ways — the cap and the status must never disagree about whether context was
 * missing.
 */
export function intentStatusFor(sources: readonly IntentSource[]): IntentStatus {
  return hasUnfetched(sources) ? 'partial' : 'ok';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
