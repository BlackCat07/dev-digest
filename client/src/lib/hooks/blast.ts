/* hooks/blast.ts — React Query hook for the Blast Radius (L04).

     GET /pulls/:id/blast  → the impact map for this PR

   The route ships with this feature (`server/src/modules/blast/routes.ts`); the
   shape comes from the contract in `@devdigest/shared` (`contracts/blast.ts`). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBlastRadius } from "@devdigest/shared";

/**
 * The impact map for one PR.
 *
 * **No polling and no mutation, unlike `usePrIntent`.** There is nothing to wait
 * for: the server derives the whole map from index rows on every read, so the
 * answer is final the moment it arrives — there is no `running` state to watch and
 * no "re-derive" for a user to press. Re-indexing is a repository-level action and
 * already has its own control (`POST /repos/:id/resync`).
 *
 * The response is never `null`. A PR with no impact, a repo with no index and a PR
 * whose files were never imported all come back as a valid map carrying the
 * `status`/`reason` that says which of those it is — so the card branches on
 * `status`, never on emptiness.
 */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<PrBlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
