/**
 * How many agents must have flagged a location for `Show only conflicts` to
 * keep its group (AC-81).
 *
 * Two, and the number is the whole rule — which is why it is named here rather
 * than written as a `>= 2` in the predicate that reads it.
 *
 * **The filter is not what its name suggests, and the reason is worth reading
 * once.** Every group in this block already carries a disagreement: the server
 * emits a group only where at least one agent of the multi-run flagged the
 * location and at least one other did not (AC-29/AC-100), so a location every
 * agent flagged produces no group at all. The rule this filter replaced —
 * "more than one distinct verdict value, counting `ignored`" — is therefore a
 * no-op: every group satisfies it by construction.
 *
 * What the toggle actually removes is the SINGLE-flagger group, which is the
 * common shape, so the filtered list is normally much shorter than the
 * unfiltered one. That is correct, not a rendering bug.
 *
 * The name carries a known tension, recorded in SPEC-06 rather than hidden:
 * two agents both flagging a location is an *overlap*, not literally a
 * conflict. The name is the design's and stays.
 */
export const MIN_FLAGGERS_FOR_CONFLICT = 2;
