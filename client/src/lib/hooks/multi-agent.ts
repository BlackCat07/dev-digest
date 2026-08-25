/* hooks/multi-agent.ts — React Query hooks for Multi-Agent Review (SPEC-05).

     GET  /agents/estimates            → what each agent's next run should take/cost
     GET  /pulls/:id/multi-agent       → the PR's most recent multi-agent run
     POST /pulls/:id/multi-agent-run   → fan one PR out to a chosen set of agents

   The shapes come from the contract in `@devdigest/shared`
   (`contracts/observability.ts`), and every import of it here is `import type` —
   a runtime value import from that barrel resolves under `tsc` and under vitest
   and then 500s every route that transitively reaches it under `next build`
   (`INSIGHTS.md`, 2026-08-03). Everything goes through `api`/`apiFetch`; no
   component calls `fetch`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentColumn,
  AgentRunEstimate,
  MultiAgentRun,
  MultiAgentRunRequest,
} from "@devdigest/shared";

/** Poll interval while any column of a multi-run is still going (AC-65).
    2000 ms is this codebase's established "something is running" cadence — the
    brief, conventions, intent and onboarding hooks all use it. */
const MULTI_AGENT_POLL_MS = 2000;

/**
 * The three `agent_runs.status` values that mean the column will not change
 * again. `running` is the only non-terminal one.
 *
 * Exported because the polling rule (AC-65) and the results view's per-column
 * rendering (a non-terminal column shows "running" and opens its drawer on the
 * live-log tab) have to agree on one definition; a second copy in the view is
 * exactly the drift that makes a column poll forever or stop early.
 */
export const TERMINAL_COLUMN_STATUSES = ["done", "failed", "cancelled"] as const;

/** True once this column's run has settled, whatever the outcome. */
export function isColumnTerminal(column: Pick<AgentColumn, "status">): boolean {
  return (TERMINAL_COLUMN_STATUSES as readonly string[]).includes(column.status);
}

/**
 * Per-agent run estimates for the whole workspace — one row per agent.
 *
 * `null` and `0` are not interchangeable in this response: `mean_duration_ms:
 * null` with `sample_size: 0` means the agent has never completed a run and
 * renders as a dash, while `mean_cost_usd: null` means no sampled run recorded
 * a cost. Branch on the nulls, never on falsiness.
 *
 * Not keyed by anything: the estimates are workspace-wide and both screens that
 * read them (the picker and Configure-run) want the same list. `staleTime`
 * matches `useProviderModels` — the means move on the scale of whole runs, so
 * re-reading them on every mount buys nothing.
 */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentRunEstimate[]>("/agents/estimates"),
    staleTime: 5 * 60_000,
  });
}

/**
 * The pull request's most recent multi-agent run.
 *
 * **A 404 is a routine answer and must stay an error, not `undefined`.** The
 * server answers `{"error":{"code":"not_found",…}}` when this PR has never been
 * fanned out, and the view branches on `code === "not_found"` (the no-run empty
 * state with an action that starts one) versus everything else (the error
 * state) — AC-83. Swallowing it into `undefined` collapses "no run yet" and
 * "something broke" into one indistinguishable blank. `apiFetch` already throws
 * an `ApiError` carrying `status`/`code`; this hook simply does not catch it.
 *
 * `retry: false` for the same reason `useRunTrace` sets it: a 404 here is a
 * steady state, not a transient failure, and the global default (`retry: 1`)
 * would double every read on a PR that has never been fanned out and push the
 * empty state behind a backoff.
 *
 * Polling turns itself on only while a column is non-terminal and stops on the
 * read in which the last one settles (AC-65), so a finished multi-run generates
 * no traffic at all. The view opens no `EventSource` of its own (AC-66) — this
 * query is the whole live-update mechanism for the columns.
 */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    retry: false,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => !isColumnTerminal(c))
        ? MULTI_AGENT_POLL_MS
        : false,
  });
}

/** What the picker and the Configure-run screen hand to the mutation. */
export interface StartMultiRunInput {
  prId: string;
  /** Exactly the agents the user selected — no widening, no `all`. */
  agentIds: string[];
}

/**
 * Fan one pull request out to a chosen set of agents.
 *
 * The body is typed as `MultiAgentRunRequest` so a field renamed in the
 * contract fails here rather than at the server's validation, and the ids are
 * passed straight through: the list the user selected is the list that goes on
 * the wire. This is the assertion the test exists for — a mutation that drops
 * or reshapes the selection still resolves 200 and still invalidates, and every
 * signal the UI trusts says it worked.
 *
 * Invalidates rather than writing the response into the cache, so the read
 * above picks the run up with its own polling. The PR's active-runs and runs
 * queries are invalidated too: the fan-out creates one `agent_runs` row per
 * agent, and both of those lists are now stale on the pull-request page.
 */
export function useStartMultiRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: StartMultiRunInput) => {
      const body: MultiAgentRunRequest = { agentIds };
      return api.post<MultiAgentRun>(`/pulls/${prId}/multi-agent-run`, body);
    },
    onSuccess: (_data, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent-run", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}
