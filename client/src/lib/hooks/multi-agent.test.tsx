/* useAgentEstimates / useMultiAgentRun / useStartMultiRun — the three
   Multi-Agent Review data hooks.

   Mocked at the NETWORK boundary (`fetch`) rather than at `api`/`apiFetch`, so
   the request these hooks actually put on the wire is what gets asserted. A
   mutation that drops or reshapes the selected ids is a silently successful
   no-op: the server answers 200, React Query invalidates, the spinner runs and
   stops, and every signal the UI trusts says it worked. Only the outgoing body
   sees it (`client/INSIGHTS.md`, 2026-08-11).

   No shared QueryClient test helper exists in this package (AgentCard and PRRow
   each build one inline), so the wrapper below is local, on purpose. And
   `@testing-library/user-event` is not a dependency here — nothing in this file
   needs it, since these are hooks and not a rendered UI.

   Fake timers drive the poll window: real 2s waits would put several seconds
   into the suite for one assertion. Under fake timers a `refetchInterval`
   refetch FIRES on the timer but its data COMMITS on the render after it, so
   the call count is the honest signal and a `flush(1)` is what lands the
   rendered value (`client/INSIGHTS.md`, 2026-08-19). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, AgentRunEstimate, MultiAgentRun } from "@devdigest/shared";
import { ApiError } from "../api";
import { useAgentEstimates, useMultiAgentRun, useStartMultiRun } from "./multi-agent";

const column = (over: Partial<AgentColumn>): AgentColumn => ({
  run_id: "run-1",
  agent_id: "agent-1",
  agent_name: "Security Auditor",
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  status: "running",
  error: null,
  verdict: null,
  score: null,
  summary: null,
  duration_ms: null,
  cost_usd: null,
  findings: [],
  ...over,
});

const run = (columns: AgentColumn[]): MultiAgentRun => ({
  id: "mar-1",
  pr_id: "pr-1",
  pr_number: 482,
  ran_at: "2026-08-25T09:00:00.000Z",
  agent_count: columns.length,
  total_duration_ms: 0,
  total_cost_usd: null,
  columns,
  conflicts: [],
});

/** One agent still going, one already settled — the mid-fan-out shape. */
const IN_FLIGHT = run([
  column({ run_id: "run-1", agent_id: "agent-1", status: "running" }),
  column({ run_id: "run-2", agent_id: "agent-2", status: "done", score: 82 }),
]);

/** The same multi-run one poll later: every column terminal. `cancelled` is a
    terminal outcome too, and reporting it as still running would poll forever. */
const SETTLED = run([
  column({ run_id: "run-1", agent_id: "agent-1", status: "cancelled" }),
  column({ run_id: "run-2", agent_id: "agent-2", status: "done", score: 82 }),
]);

const ESTIMATES: AgentRunEstimate[] = [
  { agent_id: "agent-1", mean_duration_ms: 8200, mean_cost_usd: 0.11, sample_size: 10 },
  { agent_id: "agent-2", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
];

const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` only reads `ok`, `status` and `json()`. */
const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** The service's own error envelope, which is what `ApiError.code` comes from. */
const jsonErr = (status: number, code: string, message: string) =>
  ({
    ok: false,
    status,
    statusText: "Not Found",
    json: async () => ({ error: { code, message } }),
  }) as unknown as Response;

let qc: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Advance the fake clock inside `act`, flushing every promise it unblocks. */
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  qc.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useMultiAgentRun", () => {
  it("polls every 2s while a column is non-terminal and stops on the read that settles the last one", async () => {
    fetchMock.mockResolvedValue(jsonOk(IN_FLIGHT));
    const { result } = renderHook(() => useMultiAgentRun("pr-1"), { wrapper });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/pulls/pr-1/multi-agent");
    expect(result.current.data?.columns.map((c) => c.status)).toEqual(["running", "done"]);

    // One agent still running ⇒ the interval is live.
    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The read in which the last column settles. The refetch fires on the timer
    // but commits on the NEXT render, so the count is asserted here and the
    // rendered data one flush later.
    fetchMock.mockResolvedValue(jsonOk(SETTLED));
    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await flush(1);
    expect(result.current.data?.columns.map((c) => c.status)).toEqual(["cancelled", "done"]);

    // Five poll windows later, still three: a settled multi-run generates no
    // traffic at all, and `cancelled` counts as settled.
    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a 404 as an ApiError carrying not_found, never as undefined data, and does not poll", async () => {
    // The view branches on this: `not_found` is the no-run empty state offering
    // to start one, anything else is the error state. Collapsing the 404 into
    // `undefined` makes those two indistinguishable.
    fetchMock.mockResolvedValue(
      jsonErr(404, "not_found", "No multi-agent run for this pull request"),
    );
    const { result } = renderHook(() => useMultiAgentRun("pr-1"), { wrapper });

    await flush();
    expect(result.current.isError).toBe(true);
    const err = result.current.error;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("issues no request without a pull request id", async () => {
    const { result } = renderHook(() => useMultiAgentRun(null), { wrapper });
    await flush();
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useStartMultiRun", () => {
  it("POSTs exactly the selected agent ids and refreshes the multi-run read", async () => {
    let started = false;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        started = true;
        return Promise.resolve(jsonOk(IN_FLIGHT));
      }
      return Promise.resolve(
        started
          ? jsonOk(IN_FLIGHT)
          : jsonErr(404, "not_found", "No multi-agent run for this pull request"),
      );
    });

    const { result } = renderHook(
      () => ({ query: useMultiAgentRun("pr-1"), start: useStartMultiRun() }),
      { wrapper },
    );

    await flush();
    expect((result.current.query.error as ApiError | null)?.code).toBe("not_found");

    act(() => {
      result.current.start.mutate({ prId: "pr-1", agentIds: ["agent-1", "agent-2"] });
    });
    await flush();

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const post = calls.find((c) => c[1]?.method === "POST");
    expect(post).toBeDefined();
    expect(post![0]).toContain("/pulls/pr-1/multi-agent-run");
    // The selection is the whole request. A body that drops an id, sends `all`
    // or reshapes the key still answers 200 and still invalidates — asserting
    // the parsed body (so key order can never break this) is the only thing
    // that catches it.
    expect(JSON.parse(String(post![1]!.body))).toEqual({ agentIds: ["agent-1", "agent-2"] });

    // Invalidated rather than written into the cache, so the query above picks
    // the new run up — with its own polling, since a column is still running.
    await flush();
    expect(result.current.query.data?.columns).toHaveLength(2);
  });
});

describe("useAgentEstimates", () => {
  it("reads the workspace estimates once and keeps null distinct from zero", async () => {
    fetchMock.mockResolvedValue(jsonOk(ESTIMATES));
    const { result } = renderHook(() => useAgentEstimates(), { wrapper });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/agents/estimates");
    // An agent that has never completed a run reports nulls and a zero sample —
    // the screens render that as a dash, so a 0 leaking in here would print
    // "0 ms" and "$0.00" as if they were measurements.
    expect(result.current.data?.[1]).toEqual({
      agent_id: "agent-2",
      mean_duration_ms: null,
      mean_cost_usd: null,
      sample_size: 0,
    });
  });
});
