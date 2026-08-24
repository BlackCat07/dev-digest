/* hooks/brief.ts — React Query hooks for the PR Brief (Why + Risk, L05).

     GET  /pulls/:id/brief           → the single brief this PR has
     POST /pulls/:id/brief/generate  → generate it now (202, job id)

   Both routes ship with this feature (`server/src/modules/brief/routes.ts`);
   the shape comes from the contract in `@devdigest/shared`
   (`contracts/pr-brief.ts`), and every import of it here is `import type` — a
   runtime value import from that barrel resolves under `tsc` and under vitest
   and then 500s every route that transitively reaches it under `next build`
   (`INSIGHTS.md`, Recurring Errors, 2026-08-03). Any runtime constant this
   feature needs belongs in `src/lib/`, not in an import from the barrel. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { GenerateBriefPayload, PrRiskBrief } from "@devdigest/shared";

/** Poll interval while a generation is in flight. */
const BRIEF_POLL_MS = 2000;

/**
 * The one body this feature ever POSTs, typed against the contract so a field
 * renamed there fails here rather than at the server's validation. Module-level
 * because it is a constant: a fresh object per render would be a new value the
 * mutation closes over for no reason.
 */
const FORCE_BODY: GenerateBriefPayload = { force: true };

/**
 * The 202 a generation request answers with.
 *
 * Declared here rather than in `@devdigest/shared` because it is an
 * acknowledgement, not a document: no screen renders it, and the brief that
 * follows arrives through the query below rather than through this response —
 * the same call `OnboardingGenerateAccepted` (`hooks/onboarding.ts`) and
 * `RepoIntelState` (`hooks/repo-intel.ts`) make. `degraded` / `reason` appear
 * when the server accepted the request but has no handler registered for the
 * job.
 */
export interface BriefGenerateAccepted {
  status: string;
  jobId?: string;
  degraded?: boolean;
  reason?: string;
}

/**
 * The brief for one pull request.
 *
 * The response is never `null` and an empty `risks` is never self-explanatory: a
 * pull request nobody has generated a brief for
 * (`generation_state: "never_generated"`), one whose generation failed
 * (`status: "degraded"` with a `reason`) and one whose change genuinely carries
 * no risk (`status: "ok"`, `risk_level: "low"`) all arrive with little to render,
 * and only `generation_state` / `status` / `reason` separate them. Branch on
 * those, never on `risks.length`.
 *
 * Polling turns itself on only while a generation is `running`, so an idle
 * screen makes no requests at all — the function-form `refetchInterval` keyed on
 * the query's OWN data that `usePrIntent` and `useOnboardingTour` already use.
 * That is what clears the running state without the card owning a timer: an
 * effect plus `setInterval` on the view would have to be torn down on unmount,
 * on a pull-request change and on completion, and gets one of the three wrong.
 * `never_generated` and `done` are both terminal for the interval — a brief that
 * is `done` and `degraded` is finished, not pending, and asking again would
 * spend a request every two seconds for as long as the tab stayed open.
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<PrRiskBrief>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    refetchInterval: (query) =>
      query.state.data?.generation_state === "running" ? BRIEF_POLL_MS : false,
  });
}

/**
 * Generate this pull request's brief — the empty state's call to action and the
 * card's Regenerate control, which are one mutation because they are one
 * endpoint.
 *
 * **`force: true` is what makes the control do anything.** Without it the server
 * applies its freshness check — the cache key computed from the pull request's
 * current state against the stored one — and answers with the STORED brief
 * unchanged. That is a silently successful no-op: a 200 carrying a valid record,
 * an invalidation, a spinner that runs and stops, and nothing generated, in
 * precisely the case a reader presses the button for (a brief whose key still
 * matches but whose linked issue was edited, or whose document changed without
 * changing size — the two things the key cannot see). The Intent card's
 * Re-derive button shipped exactly that bug (`INSIGHTS.md`, What Doesn't Work,
 * 2026-08-11), and the only thing that sees this class of failure is asserting
 * the outgoing body at the `fetch` boundary, which `brief.test.tsx` does.
 *
 * A real, NON-EMPTY body is also what makes `apiFetch` set
 * `content-type: application/json` — safe here for exactly that reason. A POST
 * that declares the header with an EMPTY body is what trips Fastify's "Body
 * cannot be empty when content-type is application/json"; don't "simplify" that
 * conditional in `src/lib/api.ts`.
 *
 * Invalidates rather than writing the response into the cache: the response is
 * an acknowledgement carrying a job id, and what the card needs next is the
 * brief whose `generation_state: "running"` switches the polling above on.
 *
 * A second request while one is already running is refused by the server rather
 * than queued, and arrives here as an `ApiError` the caller renders inline; the
 * brief on screen is unaffected.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<BriefGenerateAccepted>(`/pulls/${prId}/brief/generate`, FORCE_BODY),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-brief", prId] }),
  });
}
