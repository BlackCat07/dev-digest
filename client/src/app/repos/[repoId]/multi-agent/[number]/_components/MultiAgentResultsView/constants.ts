/* Constants for the multi-agent results view.

   Three of the four encode an invariant that code elsewhere has to agree with,
   which is why they sit next to that code rather than in a global bucket: the
   two URL keys are shared with another route, and the mode list is what the
   radio group, the URL parser and the mode branch must all read the same way. */

/**
 * The two mutually exclusive ways to read a multi-run (AC-60).
 *
 * A `const` tuple rather than a bare union so the radio group can map over it
 * and the URL parser can test membership against the same list — a second copy
 * of "columns | tabs" anywhere is how a third mode gets rendered as a control
 * that resolves to the default.
 */
export const RESULTS_MODES = ["columns", "tabs"] as const;
export type ResultsMode = (typeof RESULTS_MODES)[number];

/**
 * Columns on first render (AC-60). The default is OMITTED from the URL rather
 * than written as `?mode=columns`, so an untouched link stays clean and any
 * unrecognised value falls back here instead of rendering nothing.
 */
export const DEFAULT_RESULTS_MODE: ResultsMode = "columns";

/** The search-param key carrying the selected mode (AC-61). */
export const MODE_PARAM = "mode";

/**
 * The search-param key carrying the open drawer's run id (AC-93).
 *
 * **It must stay `trace`, and it must match the pull-request page's.** Both
 * routes mount the same relocated `RunTraceDrawer` from the same barrel, and a
 * reader who learns `?trace=<run_id>` on one screen is entitled to the same URL
 * on the other. Nothing type-checks the agreement — the other reader is
 * `PrDetailView.tsx`'s own `search.get("trace")`.
 */
export const TRACE_PARAM = "trace";

/** Where the no-agents empty state sends the reader (AC-84). */
export const AGENTS_ROUTE = "/agents";
