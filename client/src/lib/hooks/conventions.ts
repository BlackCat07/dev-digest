/* hooks/conventions.ts — React Query hooks for the Conventions screen (L02). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { isScanning } from "../conventions";
import type {
  ComposedConventionSkill,
  ConventionScan,
  ConventionScanBudget,
  ConventionScanOptions,
  ConventionsPayload,
  CreateConventionSkillPayload,
  ExtractedConvention,
  Skill,
  UpdateConventionPayload,
} from "@devdigest/shared";

/** Poll interval while a scan is in flight. */
const SCAN_POLL_MS = 2000;

/**
 * The whole screen in one query.
 *
 * Scan, budget and candidates arrive together because they are read together
 * and they move together: a finished scan changes all three at once, and three
 * independent queries would let the header say "scanning…" over a list that had
 * already refreshed.
 *
 * Polling turns itself on only while a scan is running, so an idle screen makes
 * no requests at all.
 */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsPayload>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      isScanning(query.state.data?.scan ?? null) ? SCAN_POLL_MS : false,
  });
}

/**
 * What a scan would cost, on its own.
 *
 * The payload above already carries a budget; this exists for the pre-scan
 * confirmation, which needs a figure that is current at the moment the button is
 * pressed rather than one fetched when the screen loaded.
 */
export function useConventionBudget(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions-budget", repoId],
    queryFn: () => api.get<ConventionScanBudget>(`/repos/${repoId}/conventions/budget`),
    enabled: !!repoId,
  });
}

export function useStartConventionScan(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: ConventionScanOptions) =>
      api.post<ConventionScan>(`/repos/${repoId}/conventions/scan`, options),
    // Refetch rather than write the returned scan in: the response is the queued
    // row, and what the screen needs next is the payload whose polling that row
    // switches on.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/**
 * Accept, reject and edit are one mutation, because they are one endpoint.
 *
 * `repoId` is a parameter rather than part of the payload so the cache key can
 * be invalidated — a candidate's id does not carry its repo.
 */
export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConventionPayload }) =>
      api.patch<ExtractedConvention>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      // An accepted candidate is eligible for skill generation, and a generated
      // skill shows up in the Skills Lab — so that list is stale too.
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * Return every triaged candidate to untriaged — the "Deselect all" control.
 *
 * Clears rejections as well as acceptances: the button reads as "start the
 * triage again", and leaving rejections behind would make a second pass silently
 * shorter than the first.
 *
 * It PATCHes directly rather than looping {@link useUpdateConvention}, because
 * that hook invalidates on every success — N candidates would mean N refetches
 * of the whole payload. Here the invalidation happens once, at the end. If a
 * repo ever produces enough candidates for N requests to matter, the fix is a
 * bulk endpoint, not a smarter loop.
 */
export function useResetConventionTriage(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          api.patch<ExtractedConvention>(`/conventions/${id}`, { status: "pending" }),
        ),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/**
 * The skill text as it WOULD be written, without writing it.
 *
 * A query rather than something the modal assembles: the composer lives on the
 * server, so the preview is byte-for-byte what the create call saves. A second
 * renderer in the browser would drift and start showing text the user never
 * actually gets.
 *
 * Keyed on everything that changes the output — including `name`, because in
 * merged mode the name becomes the body's H1 and a preview that ignored the
 * field being typed into would be worse than none.
 */
export function useConventionSkillPreview(
  repoId: string,
  payload: CreateConventionSkillPayload,
) {
  return useQuery({
    queryKey: [
      "conventions-skill-preview",
      repoId,
      payload.name ?? "",
      payload.description ?? "",
      payload.candidate_ids.join(","),
    ],
    queryFn: () =>
      api.post<ComposedConventionSkill[]>(
        `/repos/${repoId}/conventions/skill/preview`,
        payload,
      ),
    enabled: payload.candidate_ids.length > 0,
    // The composition is deterministic for a given key, so nothing here goes
    // stale while the modal is open.
    staleTime: Infinity,
  });
}

/**
 * Compose the accepted candidates into one skill, or one per category.
 *
 * Returns the created skills so the caller can link straight to the first one —
 * the point of the screen is the hand-off to the Skills Lab, and making the user
 * go and find what they just made breaks it.
 */
export function useCreateConventionSkill(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateConventionSkillPayload) =>
      api.post<Skill[]>(`/repos/${repoId}/conventions/skill`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      // Each candidate now carries the new skill's id.
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}
