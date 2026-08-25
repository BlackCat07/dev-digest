/* Pure helpers private to the multi-agent results view. No React, no fetch, no
   i18n — every function here is a function of its arguments, so the branch
   AC-83 turns on and the shape the trace drawer is handed can both be read (and
   tested) without mounting a tree.

   `import type` from `@devdigest/shared` is mandatory, not stylistic: a runtime
   value import from that barrel pulls its ESM `.js` re-exports into webpack and
   500s every route that transitively reaches it, while `tsc` and `vitest` both
   stay green (`client/INSIGHTS.md`, 2026-08-03). */

import type {
  AgentColumnFinding,
  FindingCategory,
  FindingRecord,
  PrMeta,
} from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/**
 * True for the one error that is a routine answer rather than a failure: this
 * pull request has never been fanned out (AC-83).
 *
 * **Branch on the CODE, never on the message or on `data == null`.**
 * `useMultiAgentRun` deliberately lets the 404 surface as an `ApiError` instead
 * of swallowing it into `undefined`, precisely so "no run yet" and "something
 * broke" stay two different screens; a view that tested `data == null` alone
 * would render the error state where the empty state belongs. The message is
 * server prose and can be reworded; `code` is the contract.
 */
export function isNoRunError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "not_found";
}

/**
 * The `:number` segment as a pull-request number, or `null` when the URL does
 * not carry one.
 *
 * A route param is user input, so it is parsed rather than trusted: a
 * non-numeric or non-positive segment resolves no pull request and the screen
 * says so, instead of issuing `GET /pulls/NaN/multi-agent`.
 */
export function parsePrNumber(segment: string): number | null {
  const parsed = Number(segment);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Number → row uuid, through the pulls list the pull-request screens already
 * cache.
 *
 * The route is keyed by the number a reviewer can read off GitHub, but every
 * pull-request API is keyed by the row's uuid — the same resolution
 * `PrDetailView` does, through the same (cached) query, so the two screens
 * cannot disagree about which row a number means.
 */
export function findPrId(pulls: readonly PrMeta[] | undefined, number: number | null): string | null {
  if (number == null) return null;
  return pulls?.find((p) => p.number === number)?.id ?? null;
}

/**
 * A column's findings in the shape the run-trace drawer takes (AC-64).
 *
 * The drawer's props are fixed — it is a relocated, shared unit that "gains no
 * prop it does not already take" — so the column's findings are adapted to
 * `FindingRecord` here rather than the drawer being taught a second shape.
 * Everything the drawer's Findings section renders (severity, title, file,
 * lines, rationale, suggestion) is carried across unaltered.
 *
 * Two fields need a word each:
 *
 *  - `review_id` is not on the wire and the drawer never reads it. It is the id
 *    of the review row the finding belongs to; the column read does not carry
 *    one, and inventing a plausible-looking id would be worse than an empty
 *    string that is visibly not an id.
 *  - `category` is `string` on `AgentColumnFinding` and the five-value enum on
 *    `FindingRecord`, because the underlying column is plain `text` with no
 *    CHECK constraint behind it. The value is passed through EXACTLY as it
 *    arrived rather than defaulted to a category the agent did not choose — the
 *    drawer does not render it, and where this screen does render it
 *    (`FindingCategoryTag`) an off-enum value is narrowed away rather than cast.
 *
 * `kind` and `scope` are omitted rather than adapted: both are optional on
 * `FindingRecord` and neither reaches anything the drawer draws, so widening
 * them would be work in service of nothing.
 */
export function toFindingRecords(findings: readonly AgentColumnFinding[]): FindingRecord[] {
  return findings.map((f) => ({
    id: f.id,
    review_id: "",
    severity: f.severity,
    category: f.category as FindingCategory,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: f.rationale,
    suggestion: f.suggestion,
    confidence: f.confidence,
    accepted_at: f.accepted_at,
    dismissed_at: f.dismissed_at,
  }));
}

/**
 * Milliseconds as the seconds figure `runs.page.meta` suffixes with `s`.
 *
 * One decimal, matching the Configure-run screen's estimate, so the figure the
 * reviewer was quoted before the run and the figure they read after it are
 * written the same way and can be compared at a glance.
 */
export function formatTotalSeconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "0.0";
  return (ms / 1000).toFixed(1);
}
