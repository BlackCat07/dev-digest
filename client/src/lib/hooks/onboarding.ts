/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour (L05).

     GET  /repos/:id/onboarding           → the single tour this repository has
     POST /repos/:id/onboarding/generate  → generate it now (202, job id)

   Both routes ship with this feature (`server/src/modules/onboarding/routes.ts`);
   the shape comes from the contract in `@devdigest/shared`
   (`contracts/onboarding.ts`), and every import of it here is `import type` — a
   runtime value import from that barrel resolves under `tsc` and under vitest
   and then 500s every route that transitively reaches it under `next build`
   (`INSIGHTS.md`, Recurring Errors, 2026-08-03). This feature's runtime helpers
   live in `src/lib/onboarding.ts`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTour } from "@devdigest/shared";

/** Poll interval while a generation is in flight. */
const TOUR_POLL_MS = 2000;

/**
 * The 202 a generation request answers with.
 *
 * Declared here rather than in `@devdigest/shared` because it is an
 * acknowledgement, not a document: the screen never renders it, and the only
 * thing it does with the body is nothing at all — the tour that follows arrives
 * through the query above, not through this response. `RepoIntelState` in
 * `hooks/repo-intel.ts` is the same call. `degraded` / `reason` appear when the
 * server accepted the request but has no handler registered for the job.
 */
export interface OnboardingGenerateAccepted {
  status: string;
  jobId?: string;
  degraded?: boolean;
  reason?: string;
}

/**
 * The tour for one repository.
 *
 * The response is never `null` and an empty `sections` is never
 * self-explanatory: a repository nobody has generated a tour for
 * (`generation_state: "never_generated"`) and one whose generation was refused
 * by a missing index (`status: "degraded"`) both arrive with little to render,
 * and only `generation_state` / `status` / `reason` separate them. Branch on
 * those, never on `sections.length`.
 *
 * Polling turns itself on only while a generation is `running`, so an idle
 * screen makes no requests at all — the function-form `refetchInterval` keyed on
 * the query's OWN data that `useConventions` and `usePrIntent` already use. This
 * is what clears the running state without the screen owning a timer: an effect
 * plus `setInterval` on the view would have to be torn down on unmount, on a
 * repository change and on completion, and gets one of the three wrong.
 * `never_generated` and `ready` are both terminal for the interval.
 */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingTour>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.generation_state === "running" ? TOUR_POLL_MS : false,
  });
}

/**
 * Generate this repository's tour — the empty state's call to action and the
 * header's Regenerate control, which are one mutation because they are one
 * endpoint.
 *
 * **The POST carries no body, and that is deliberate.** There is nothing to
 * send: the repository is in the path, and a generation always replaces the
 * single stored tour, so there is no flag for the caller to set and therefore
 * none to forget (the silent no-op `useDeriveIntent`'s `force` exists to
 * prevent). `apiFetch` sends no `content-type` when there is no body, which is
 * exactly what a body-less POST needs — a POST that declares
 * `application/json` with an empty body trips Fastify's "Body cannot be empty
 * when content-type is application/json". Don't "simplify" that conditional in
 * `src/lib/api.ts`.
 *
 * Invalidates rather than writing the response into the cache: the response is
 * an acknowledgement carrying a job id, and what the screen needs next is the
 * tour whose `generation_state: "running"` switches the polling above on.
 *
 * A second request while one is already running is refused by the server rather
 * than queued, and arrives here as an `ApiError` with `status: 422` — the
 * caller renders it inline and the tour on screen is unaffected.
 */
export function useGenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<OnboardingGenerateAccepted>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding", repoId] }),
  });
}
