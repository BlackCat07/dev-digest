/* api-errors.ts — reading a refusal the server named.

   Promoted out of `FindingDetail/helpers.ts` on its second consumer: the
   finding-action row and both fan-out controls all have to tell "the server
   said no, and here is why" apart from "something broke". A helper two route
   subtrees need lives in `src/lib/`, not under one of them. */
import { ApiError } from "./api";

/**
 * The server's own sentence for a refusal it NAMED, or `null`.
 *
 * `code` is the discriminator on purpose. A named refusal — `too_many_agents`,
 * `multi_agent_run_in_flight`, `not_found` — carries a message written for a
 * reader and is safe to show verbatim. An unnamed failure (a 500, a dropped
 * connection) carries whatever the transport said, which is not; the caller
 * falls back to its own copy for those.
 */
export function refusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.code ? error.message : null;
}
