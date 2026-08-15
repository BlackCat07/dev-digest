/* hooks/prior-prs.ts — React Query hook for the Prior PRs block (L04).

     GET /pulls/:id/prior-prs  → earlier PRs that touched this PR's changed files

   Its own hook, and its own query key, deliberately: the block renders inside the
   Blast Radius card but is a different question over different rows
   (`server/src/modules/prior-prs/`), and keeping the two queries apart is what lets
   the impact map paint without waiting on a history read. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrPriorPrs } from "@devdigest/shared";

/**
 * The pull requests that already touched these files.
 *
 * No polling and no mutation, for the same reason `usePrBlast` has neither: the
 * server derives the whole answer per request, so it is final the moment it
 * arrives.
 *
 * The response is never `null` and an empty `prs` is never self-explanatory — a
 * repository whose pull requests were never opened in the studio has no `pr_files`
 * to compare against, and the payload's `status` / `reason` / `coverage` are what
 * separate that from "nothing else touched this code". Branch on `status`, never on
 * `prs.length`.
 */
export function usePriorPrs(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-prior-prs", prId],
    queryFn: () => api.get<PrPriorPrs>(`/pulls/${prId}/prior-prs`),
    enabled: !!prId,
  });
}
