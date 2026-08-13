/* hooks/smart-diff.ts — the Smart Diff read (L03b).

     GET /pulls/:id/smart-diff → the PR's changed files grouped by role

   ONE hook, and no mutation sibling. That is deliberate and it is the client half
   of the feature's acceptance criterion: viewing the reviewer-ordered diff must not
   cost a model call. `hooks/intent.ts` — the file this is modelled on — ships a
   `useDeriveIntent` POST beside its query, and copying that shape wholesale is
   exactly how a "re-classify" button would appear and quietly start billing. There
   is nothing to re-derive here: the server recomputes the whole answer from stored
   rows on every request. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/**
 * The role grouping for one PR.
 *
 * No polling: unlike an intent derivation there is no `running` state to wait out —
 * the response is computed synchronously from `pr_files` and the stored reviews, so
 * it is either current or the request failed.
 *
 * Empty groups are a real, expected answer rather than an error: a PR whose detail
 * route has never written `pr_files` has nothing to group. The viewer renders that
 * as "no changed files", not as a failure.
 */
export function usePrSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    // `prId` is null until the PR number → uuid lookup resolves; without this the
    // tab fires a request at `/pulls/null/smart-diff` on first paint.
    enabled: !!prId,
  });
}
