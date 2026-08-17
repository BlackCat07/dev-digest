/** Tunables for Prior PRs (L04). Exported so the tests assert against them. */

/**
 * How many earlier pull requests the response carries.
 *
 * Ten rather than the five the card shows collapsed: the block has a "show all"
 * affordance, and a reviewer scanning who else has been in this code wants a page
 * of it, not a teaser. `total` still reports the pre-cap count, so a capped list is
 * never mistaken for the whole history.
 */
export const MAX_PRIOR_PRS = 10;

/**
 * How many shared paths each row carries as its evidence.
 *
 * The overlap is the reason a row is listed, so some of it has to travel; the whole
 * of it does not. A pull request that rewrote 300 files overlaps a 40-file diff by
 * 40 paths, and the row only has to make the case, with `shared_file_count`
 * reporting the true size.
 */
export const MAX_SHARED_FILES = 5;
