/* Constants for the Configure-run screen. Two of the three encode an invariant
   the code beside them has to agree with, which is why they live here and not
   in a global bucket. */

import type { PrStatus } from "@devdigest/shared";

/**
 * The two `PrStatus` values that mean a pull request is **not** open.
 *
 * SPEC-05 AC-53 defines "open" by exclusion rather than by inclusion, and that
 * is deliberate: `merged` and `closed` are the only two values that come from
 * GitHub's own state, while `needs_review`, `reviewed` and `stale` are review
 * statuses the server derives *for a pull request that is open*. Listing the
 * three positives would silently drop a sixth review status the day one is
 * added; excluding the two negatives cannot.
 *
 * Note the deliberate asymmetry with the pull-request page's own agent picker
 * (AC-45…AC-51): that one is unaffected by this filter, because it already
 * knows which pull request it is on and a merged one can still be fanned out
 * from there.
 */
export const NON_OPEN_PR_STATUSES: ReadonlySet<PrStatus> = new Set<PrStatus>(["merged", "closed"]);

/**
 * The placeholder for a figure that does not exist — never `0`, never `$0.00`.
 *
 * Not a translation key on purpose: it is a typographic placeholder rather than
 * copy, exactly as `lib/format.ts` already returns it for a null cost, and the
 * same character is what `runs.configure.estimateUnavailable` spells out when
 * the whole estimate is missing.
 */
export const NO_ESTIMATE = "—";
