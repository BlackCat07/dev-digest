/* hooks/ci.ts — React Query hooks for Export-to-CI and CI Runs (L06).

     POST /agents/:id/export-ci/preview   → every file that WOULD be committed
     POST /agents/:id/export-ci           → commit them and open (or reuse) a PR
     GET  /agents/:id/ci-installations    → where this agent is installed
     GET  /ci-runs                        → the workspace's CI runs, newest first
     POST /ci-runs/refresh                → read new runs back from GitHub Actions

   Everything goes through `apiFetch` (via `api`), never a bare `fetch` in a
   component: `ApiError` carries `status` AND `code`, which is what lets the
   wizard render the server's own named refusal inline instead of a bare status.

   NO `EventSource` and no SSE hook. Read-back is a mutation plus a query, by
   design: jsdom implements none, so a component whose hook CONSTRUCTS one dies
   with a `ReferenceError` inside the effect and takes the whole tree down —
   the failure then reads as a broken component rather than a missing global
   (`client/INSIGHTS.md`, 2026-08-23).

   Contract types are imported TYPE-ONLY. A value import of the vendored barrel
   resolves under `tsc` and under `vitest` and then 500s every route that
   transitively reaches it (`client/INSIGHTS.md`, 2026-08-03); the runtime values
   — the defaults restated below — come from `../ci`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { CI_DEFAULT_BASE, CI_DEFAULT_POST_AS, CI_DEFAULT_TARGET, CI_DEFAULT_TRIGGERS } from "../ci";
import type { CiExport, CiExportInput, CiExportPreview, CiInstallation, CiRun } from "@devdigest/shared";

/**
 * What a caller supplies. Everything but the agent and the repository is
 * optional HERE and mandatory ON THE WIRE — see `exportBody`.
 */
export interface CiExportRequest {
  agentId: string;
  repo: string;
  target?: CiExportInput["target"];
  post_as?: CiExportInput["post_as"];
  triggers?: readonly string[];
  base?: string;
}

/**
 * The request body, with every field present.
 *
 * A mutation that omits an optional field is a silently successful no-op: the
 * server applies its own default, answers 200, and the wizard reports an install
 * configured the way the user did not choose (`client/INSIGHTS.md`, 2026-08-11).
 * The defaults are therefore filled in HERE, so the body on the wire is complete
 * and assertable, and `ci.test.tsx` asserts exactly that.
 *
 * `action` is the caller's, not the input's: `files` is a preview (generate and
 * return, no GitHub write), `open_pr` is the install.
 */
function exportBody(input: CiExportRequest, action: CiExportInput["action"]): CiExportInput {
  return {
    repo: input.repo,
    target: input.target ?? CI_DEFAULT_TARGET,
    action,
    post_as: input.post_as ?? CI_DEFAULT_POST_AS,
    triggers: [...(input.triggers ?? CI_DEFAULT_TRIGGERS)],
    base: input.base ?? CI_DEFAULT_BASE,
  };
}

// ===========================================================================
// Reads
// ===========================================================================

/**
 * Where this agent is installed, each row carrying the status and time of its
 * OWN most recent CI run.
 *
 * One request, not one per installation: `last_run_status` / `last_run_at` are
 * derived server-side from the newest `ci_runs` row, and both are `null` for an
 * installation that has never run — which is the ordinary state right after an
 * export, not an error.
 */
export function useAgentCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** The workspace's CI runs, newest first, in the server's total order. */
export function useCiRuns() {
  return useQuery({
    queryKey: ["ci-runs"],
    queryFn: () => api.get<CiRun[]>("/ci-runs"),
  });
}

// ===========================================================================
// Writes
// ===========================================================================

/**
 * Generate the file set without touching GitHub.
 *
 * A mutation rather than a query even though it reads nothing: the wizard asks
 * for it when the user leaves the Target step, and the answer depends on a
 * repository typed into a field — a query would either fire on every keystroke
 * or need an `enabled` flag that duplicates the step state.
 */
export function useCiPreview() {
  return useMutation({
    mutationFn: (input: CiExportRequest) =>
      api.post<CiExportPreview>(`/agents/${input.agentId}/export-ci/preview`, exportBody(input, "files")),
  });
}

/**
 * Commit the file set and open the pull request.
 *
 * Idempotent on the server: the branch is created-or-updated with one commit,
 * and an already-open pull request on that branch is reused rather than opened
 * twice — which is why "Update CI" is this same call with the repository field
 * pre-filled, and not a second mechanism.
 */
export function useExportToCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportRequest) =>
      api.post<CiExport>(`/agents/${input.agentId}/export-ci`, exportBody(input, "open_pr")),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["ci-installations", input.agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/**
 * Read new runs back from the GitHub Actions API.
 *
 * No body at all, which is what keeps `content-type` off the request: this route
 * declares none, and a body-less POST that carried the JSON header would trip
 * Fastify's "Body cannot be empty when content-type is application/json".
 */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRun[]>("/ci-runs/refresh"),
    onSuccess: (data) => {
      qc.setQueryData(["ci-runs"], data);
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
