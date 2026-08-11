/* hooks/intent.ts — React Query hooks for the Intent Layer (L03).

     GET  /pulls/:id/intent  → the persisted derivation for this PR
     POST /pulls/:id/intent  → re-derive it now

   Both routes ship with this feature (`server/src/modules/intent/routes.ts`);
   the shapes come from the contract in `@devdigest/shared`
   (`contracts/intent.ts`). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntent } from "@devdigest/shared";

/** Poll interval while a derivation is in flight. */
const INTENT_POLL_MS = 2000;

/**
 * The stored intent for one PR.
 *
 * `null` is a real, expected answer — a PR that has never been classified has no
 * row, and the card renders its "not derived yet" state from it rather than from
 * an error.
 *
 * Polling turns itself on only while a derivation is `running`, so an idle
 * screen makes no requests at all (the same shape `useConventions` uses for a
 * running scan). Every other status is terminal for this query: `ok`, `partial`
 * and `failed` all stop the interval.
 */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntent | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? INTENT_POLL_MS : false,
  });
}

/**
 * Re-derive the intent on demand — the card's refresh control.
 *
 * **`force: true` is what makes the button do anything.** Without it the server
 * applies its freshness check (`needsDerivation`: no row, `failed`, a changed
 * head SHA, or an abandoned `running` row) and returns the STORED record
 * unchanged — so on the common case, a PR whose intent is `ok` at the current
 * head, pressing Re-derive was a silent no-op. That is the whole point of the
 * control: the user is saying "I know there is a row, derive it again anyway",
 * usually because the first derivation ran before the PR's description and
 * changed files had been persisted and came back with the title alone.
 *
 * The cost is deliberate and bounded: one cheap classifier call per press, and
 * the route is rate-limited to 5/minute.
 *
 * A real body is now sent, which is what finally sets
 * `content-type: application/json` — safe here precisely because the body is
 * non-empty. `apiFetch` sends no header when there is no body, and a POST that
 * declares the header with an EMPTY body is what trips Fastify's "Body cannot be
 * empty"; don't "simplify" that conditional in `api.ts`.
 *
 * Invalidates rather than writing the response into the cache, so a derivation
 * that came back still `running` gets picked up by the query above and its
 * polling.
 */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntent>(`/pulls/${prId}/intent`, { force: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-intent", prId] }),
  });
}
