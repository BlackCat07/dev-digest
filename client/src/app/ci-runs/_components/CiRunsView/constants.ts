/* Unit-private constants for the CI Runs screen.

   Everything here encodes an invariant this screen's markup has to agree with —
   the grid track list and the column order that must match it — so it sits
   beside the component that must agree with it rather than in a global
   constants file. What a SECOND surface needs (the status words and their
   colours, the URL check) already lives in `src/lib/ci.ts` and is imported from
   there; nothing is copied down.

   No user-visible string lives here: every label is a KEY into
   `messages/en/ci.json`, resolved by the caller with `useTranslations("ci")`. */

/**
 * The runs table's grid tracks, and the column order that must agree with them.
 *
 * The two live side by side deliberately: a column added to one list and not the
 * other shifts every cell to its right by one, which is a defect no type and no
 * gate can see.
 */
export const RUNS_GRID =
  "150px minmax(180px, 1.6fr) 90px 84px 84px minmax(140px, 200px)";

/** The runs table's header labels, left to right. Must match `RUNS_GRID`. */
export const RUNS_COLUMN_KEYS: readonly string[] = [
  "runs.table.timestamp",
  "runs.table.pullRequest",
  "runs.table.source",
  "runs.table.findings",
  "runs.table.cost",
  "runs.table.status",
];

/**
 * Keys for the skeleton rows drawn while the runs read is in flight.
 *
 * A constant list rather than `Array.from({ length: 5 })`, so the rows carry
 * stable keys that are not array indices — the same rule the real rows follow.
 */
export const SKELETON_ROW_KEYS: readonly string[] = ["a", "b", "c", "d", "e"];

/**
 * What a cell renders when the value behind it is null.
 *
 * "We have no number" and "the number is zero" are different claims, and a run
 * that recorded no cost must not read as a free one — the same rule
 * `agent_runs.cost_usd`'s own doc-comment states on the server side.
 */
export const NO_VALUE = "—";
