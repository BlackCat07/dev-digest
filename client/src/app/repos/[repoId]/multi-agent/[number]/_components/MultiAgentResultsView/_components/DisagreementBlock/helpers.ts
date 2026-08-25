/* Pure helpers private to the disagreement block. No React, no fetch, no i18n:
   the filter rule is the one piece of logic on this screen a reader is likely
   to get backwards, so it is a function of its arguments and can be read (and
   tested) without mounting a tree.

   **Nothing here groups, scores or totals anything.** The groups, the stances
   and the counts arrive computed from the server in `MultiAgentRun.conflicts`;
   a second grouping assembled in the browser would disagree with the one every
   other reader of that record sees. These functions only choose which of the
   server's groups to show.

   `import type` from `@devdigest/shared` is mandatory, not stylistic: a runtime
   value import from that barrel pulls its ESM `.js` re-exports into webpack and
   500s every route that transitively reaches it, while `tsc` and `vitest` both
   stay green (`client/INSIGHTS.md`, 2026-08-03). */

import type { Conflict, ConflictTake } from "@devdigest/shared";
import { MIN_FLAGGERS_FOR_CONFLICT } from "./constants";

/**
 * True when this agent reported something at the location.
 *
 * `ignored` is the contract's word for "this agent of the multi-run looked and
 * said nothing here" — including a run that failed or was cancelled. It is a
 * stance, not a missing value, which is why every agent of the multi-run has a
 * take and none is absent from the list.
 */
export function hasFlagged(take: ConflictTake): boolean {
  return take.verdict !== "ignored";
}

/** How many agents of the multi-run flagged this location. */
export function flaggerCount(group: Conflict): number {
  return group.takes.reduce((n, take) => (hasFlagged(take) ? n + 1 : n), 0);
}

/** The `Show only conflicts` predicate — see `MIN_FLAGGERS_FOR_CONFLICT`. */
export function isMultiFlagger(group: Conflict): boolean {
  return flaggerCount(group) >= MIN_FLAGGERS_FOR_CONFLICT;
}

/** The groups the block draws, given the state of the filter. */
export function visibleGroups(
  groups: readonly Conflict[],
  onlyConflicts: boolean,
): readonly Conflict[] {
  return onlyConflicts ? groups.filter(isMultiFlagger) : groups;
}

/**
 * A React key for one group.
 *
 * File, line and title are the same triple the server orders groups by, so the
 * three together identify a group as precisely as anything on the wire does —
 * there is no group id.
 *
 * The title is part of it on purpose. A group's title changes exactly once in a
 * multi-run's life: it is the deterministic fallback (the highest-severity
 * finding's title) until note synthesis lands, and a short synthesised label
 * afterwards. Keying on the title remounts that one panel when the label
 * arrives, which is honest — its heading genuinely became a different thing —
 * whereas a positional key would reuse a panel across a list that also
 * reordered in the same read (two groups sharing a file and a line are ordered
 * by title).
 */
export function groupKey(group: Conflict): string {
  return `${group.file}:${group.line}:${group.title}`;
}
