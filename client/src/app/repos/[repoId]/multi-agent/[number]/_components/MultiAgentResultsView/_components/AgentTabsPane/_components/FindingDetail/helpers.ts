/** Pure helpers for FindingDetail. */

import { ApiError } from "@/lib/api";

/**
 * The sentence the server sent for a NAMED refusal, or `null`.
 *
 * `POST /eval/cases` refuses with a named code and a sentence written for that
 * code — `finding_has_no_decision` arrives as "Accept or dismiss this finding
 * before turning it into an eval case", which tells the reader what to do next.
 * Surfacing that is the whole point (AC-76); a generic "something went wrong"
 * would be strictly less than the server already said.
 *
 * The branch is on `ApiError.code`, not on the message, and nothing is
 * stringified. A failure carrying **no** code is not a refusal — it is a
 * transport error or a 500, whose `message` is `"503 Service Unavailable"` — so
 * `null` here means "no server sentence worth showing", NOT "nothing happened".
 * The caller owes such a failure the product's own generic sentence: returning
 * `null` and rendering nothing left a dropped connection completely silent,
 * which reads as a control that does not work.
 */
export function refusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.code ? error.message : null;
}
