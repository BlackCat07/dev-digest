/* hooks/eval.ts — React Query + SSE hooks for the Eval Pipeline (L06).

     POST   /eval/cases                        → turn a decided finding into a case
     GET    /eval/agents/:agentId/cases        → that agent's whole eval set
     PUT    /eval/cases/:caseId                → save a hand-edited case
     DELETE /eval/cases/:caseId                → drop a case (batch history is kept)
     POST   /eval/agents/:agentId/batches      → start a batch (whole set, or one case)
     GET    /eval/batches/:batchId             → one batch + its per-case results
     GET    /eval/batches/:batchId/events      → SSE progress for a running batch
     GET    /eval/agents/:agentId/batches      → that agent's batch history
     GET    /eval/agents/:agentId/dashboard    → that agent's page payload
     GET    /eval/compare                     → two batches of one agent, side by side
     GET    /eval/dashboard                    → one row per agent + recent batches
     POST   /eval/dashboard/runs               → run every eligible agent
     POST   /agents/:id/versions/:v/promote    → promote a stored version

   Everything goes through `apiFetch` (via `api`), never a bare `fetch` in a
   component: `ApiError` carries `status` AND `code`, which is what lets the
   finding card render a NAMED refusal (`case_limit_reached`, `diff_too_large`, …)
   inline instead of a bare status.

   Contract types are imported TYPE-ONLY, and each import statement keeps its
   module specifier on the same line as the `import type` keywords — a value
   import of the vendored contract barrel resolves under `tsc` and under `vitest`
   and then 500s every route that transitively reaches it
   (`client/INSIGHTS.md`, 2026-08-03). Runtime values come from `../eval`. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import { DEFAULT_EVAL_PERIOD } from "../eval";
import type { Agent, EvalAgentCase, EvalBatch, EvalPeriod } from "@devdigest/shared";
import type { EvalBatchCaseResult, EvalCaseSave, EvalComparison } from "@devdigest/shared";
import type { EvalDashboardRow, EvalRunAllResult, EvalWorkspaceDashboard } from "@devdigest/shared";
import type { RunEvent } from "@devdigest/shared";

/**
 * Poll window while a batch is `running`.
 *
 * A batch is asynchronous by design — the request is acknowledged with a
 * `running` batch id BEFORE the first case executes — so a hook that waited for
 * a result would wait up to the 15-minute batch deadline. The live stream below
 * carries progress; these polls are what make the stored row (and its metrics on
 * completion) converge without a reload, the same shape `usePrRuns` uses.
 */
const EVAL_POLL_MS = 4000;

/** `?period=` on the reads that take one. The default matches the API's. */
function periodQuery(period: EvalPeriod | undefined): string {
  return `?${new URLSearchParams({ period: period ?? DEFAULT_EVAL_PERIOD })}`;
}

// ===========================================================================
// Reads
// ===========================================================================

/**
 * The whole-workspace eval dashboard: one row per agent plus a cross-agent list
 * of recent batches.
 *
 * `period` is part of the query key, so switching the filter is a new cache
 * entry rather than a refetch that flashes the old window's rows.
 */
export function useEvalDashboard(period?: EvalPeriod) {
  return useQuery({
    queryKey: ["eval-dashboard", period ?? DEFAULT_EVAL_PERIOD],
    queryFn: () => api.get<EvalWorkspaceDashboard>(`/eval/dashboard${periodQuery(period)}`),
  });
}

/** One agent's eval page payload — its last batch, trend and `alert`. */
export function useAgentEvalDashboard(agentId: string | null | undefined, period?: EvalPeriod) {
  return useQuery({
    queryKey: ["eval-agent-dashboard", agentId, period ?? DEFAULT_EVAL_PERIOD],
    queryFn: () =>
      api.get<EvalDashboardRow>(`/eval/agents/${agentId}/dashboard${periodQuery(period)}`),
    enabled: !!agentId,
  });
}

/** One agent's eval set, in the server's total order (name, then case id). */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalAgentCase[]>(`/eval/agents/${agentId}/cases`),
    enabled: !!agentId,
  });
}

/**
 * One agent's batch history, newest first.
 *
 * Polls only while a batch of this agent is `running`, so an idle Evals tab
 * makes no requests at all; the interval self-clears when the last running
 * batch reaches `complete` or `error`.
 */
export function useAgentEvalBatches(agentId: string | null | undefined, period?: EvalPeriod) {
  return useQuery({
    queryKey: ["eval-batches", agentId, period ?? DEFAULT_EVAL_PERIOD],
    queryFn: () => api.get<EvalBatch[]>(`/eval/agents/${agentId}/batches${periodQuery(period)}`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((b) => b.status === "running") ? EVAL_POLL_MS : false,
  });
}

/** One batch and every case result inside it. */
export interface EvalBatchDetail {
  batch: EvalBatch;
  cases: EvalBatchCaseResult[];
}

/**
 * One batch with its per-case results.
 *
 * Polls while the batch is `running` and stops on `complete`/`error`: the
 * per-case rows and the batch's metrics are both written by the runner, so this
 * is what fills the case-result strip in without a reload.
 */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/eval/batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) =>
      query.state.data?.batch.status === "running" ? EVAL_POLL_MS : false,
  });
}

/**
 * Two batches of one agent, side by side.
 *
 * Disabled until both ids are present — the comparison control is enabled only
 * when exactly two runs are selected, and a one-sided request would be a `422`
 * the user never asked for.
 */
export function useEvalComparison(
  earlierBatchId: string | null | undefined,
  laterBatchId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-compare", earlierBatchId, laterBatchId],
    queryFn: () =>
      api.get<EvalComparison>(
        `/eval/compare?${new URLSearchParams({ a: earlierBatchId!, b: laterBatchId! })}`,
      ),
    enabled: !!earlierBatchId && !!laterBatchId,
  });
}

// ===========================================================================
// Writes
// ===========================================================================

/**
 * Turn one decided finding into an eval case.
 *
 * **The body is `{ finding_id }` and nothing else.** The expectation is derived
 * SERVER-side from the finding's decision — `must_find` for an accepted
 * finding, `must_not_flag` for a dismissed one — so a client that also sent an
 * expectation would be a second source of truth for the one field the whole
 * feature scores against. `eval.test.tsx` asserts the outgoing body's exact key
 * set for this reason.
 *
 * The response carries the case, whose `owner_id` is the agent it landed on —
 * which is how this invalidates the right set without the caller having to know
 * which agent produced the finding.
 */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalAgentCase>("/eval/cases", { finding_id: findingId }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
      qc.invalidateQueries({ queryKey: ["eval-agent-dashboard", data.owner_id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

export interface SaveEvalCaseInput {
  caseId: string;
  body: EvalCaseSave;
}

/**
 * Save a hand-edited case.
 *
 * The whole `EvalCaseSave` is sent as submitted — name, diff, expectation,
 * anchors and expected output. Dropping one field here is the failure mode this
 * module's test exists for: the server persists what it was given, answers
 * `200`, and the editor closes over a case that never took the edit.
 */
export function useSaveEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, body }: SaveEvalCaseInput) =>
      api.put<EvalAgentCase>(`/eval/cases/${caseId}`, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

export interface DeleteEvalCaseInput {
  caseId: string;
  /** The agent whose set this case belongs to — used only to scope the refetch. */
  agentId: string;
}

/**
 * Delete a case.
 *
 * Only the SET is invalidated. Every stored batch keeps the metrics and counts
 * it recorded — a deleted case does not retroactively change a number someone
 * has already read — so the history and dashboard caches are deliberately left
 * alone here.
 */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: DeleteEvalCaseInput) =>
      api.del<{ ok: boolean }>(`/eval/cases/${caseId}`),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export interface StartEvalBatchInput {
  agentId: string;
  /** Optional human label for this batch. */
  label?: string;
  /** Run exactly one case instead of the whole set. */
  caseId?: string;
}

/**
 * Start a batch — the whole set, or a single case when `caseId` is given.
 *
 * An object body is always sent, even when it is empty: `{}` satisfies a route
 * schema of two optional fields, where a body-less POST depends on that schema
 * also being optional as a whole. `apiFetch` sets `content-type` only when a
 * body is actually present, so a non-empty `{}` is the safe end of that
 * conditional.
 *
 * Resolves with a `running` batch whose id the caller subscribes to; it does not
 * wait for the batch.
 */
export function useStartEvalBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, label, caseId }: StartEvalBatchInput) =>
      api.post<EvalBatch>(`/eval/agents/${agentId}/batches`, {
        ...(label !== undefined ? { label } : {}),
        ...(caseId !== undefined ? { case_id: caseId } : {}),
      }),
    onSuccess: (data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-agent-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-batch", data.id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

/**
 * Run every eligible agent — one batch per enabled agent holding at least one
 * case, plus a named reason for every agent skipped.
 *
 * No body at all, which is what keeps `content-type` off the request: this
 * route declares none, and a body-less POST that carried the JSON header would
 * trip Fastify's "Body cannot be empty when content-type is application/json".
 */
export function useRunAllEvalBatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/eval/dashboard/runs"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-batches"] });
      qc.invalidateQueries({ queryKey: ["eval-agent-dashboard"] });
    },
  });
}

export interface PromoteAgentVersionInput {
  agentId: string;
  version: number;
}

/**
 * Promote a stored agent version.
 *
 * The response is the UPDATED agent, whose `version` is a NEW number higher
 * than every existing one — not the promoted one. The caller renders the number
 * off this response rather than the input, which is the only way the screen can
 * show what actually happened.
 */
export function usePromoteAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: PromoteAgentVersionInput) =>
      api.post<Agent>(`/agents/${agentId}/versions/${version}/promote`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

// ===========================================================================
// Live progress
// ===========================================================================

/** The four SSE `event:` names the run bus tags its frames with. */
const SSE_EVENT_KINDS = ["info", "tool", "result", "error"] as const;

/**
 * Subscribe to a batch's SSE progress stream.
 *
 * Returns the accumulated events and a `running` flag that stays true until the
 * stream closes. The server replays its buffer to a late subscriber and then
 * ends the stream, so a subscriber arriving after the batch finished gets every
 * event and `running: false` rather than an open connection that never speaks.
 *
 * The wire shape is the run bus's own `RunEvent`, keyed on the batch id in
 * `runId` — this hook accumulates frames and interprets none of `data`; what a
 * progress line MEANS belongs to the view that renders it.
 *
 * `EventSource` and not a poll because the batch publishes one event per case
 * outcome plus a heartbeat: polling would either miss outcomes or ask fifteen
 * minutes of questions to catch them.
 */
export function useEvalBatchEvents(batchId: string | null | undefined) {
  /**
   * One keyed record rather than an `events` + `running` pair, and NO reset in
   * the effect body: the batch this state belongs to is stored WITH it, so both
   * returned values are derived from the id currently asked for. Resetting with
   * a synchronous `setState` inside the effect is the derive-don't-store
   * antipattern (and what `react-hooks/set-state-in-effect` flags) — every
   * write below happens in a subscription callback, which is what an effect is
   * for.
   */
  const [stream, setStream] = React.useState<{
    batchId: string | null;
    events: RunEvent[];
    closed: boolean;
  }>({ batchId: null, events: [], closed: false });

  React.useEffect(() => {
    if (!batchId) return;

    const es = new EventSource(`${API_BASE}/eval/batches/${batchId}/events`);
    const onMsg = (ev: MessageEvent) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(ev.data) as RunEvent;
      } catch {
        return; /* keepalive / dataless frame */
      }
      setStream((prev) =>
        prev.batchId === batchId
          ? { ...prev, events: [...prev.events, parsed] }
          : { batchId, events: [parsed], closed: false },
      );
    };
    es.onmessage = onMsg;
    for (const kind of SSE_EVENT_KINDS) {
      es.addEventListener(kind, onMsg as EventListener);
    }
    // The stream ENDING is delivered as `error` by EventSource, which is also
    // how a completed batch's replay-then-close arrives. Both mean "stop".
    es.onerror = () => {
      es.close();
      setStream((prev) =>
        prev.batchId === batchId
          ? { ...prev, closed: true }
          : { batchId, events: [], closed: true },
      );
    };

    return () => es.close();
  }, [batchId]);

  const current = stream.batchId === batchId;
  return {
    events: current ? stream.events : [],
    running: !!batchId && !(current && stream.closed),
  };
}
