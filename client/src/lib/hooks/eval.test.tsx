/* The Eval Pipeline hooks — asserted at the NETWORK boundary.

   `fetch` is stubbed, not `api`/`apiFetch`, because the failures this suite
   exists for are all in the OUTGOING request. A mutation that omits a field is a
   silently successful no-op: the server persists what it was given, answers
   `200`, the mutation resolves and the cache invalidates, so every signal a UI
   normally trusts says it worked (`client/INSIGHTS.md`, 2026-08-11). Nothing but
   the request itself sees it. Stubbing `fetch` also keeps `apiFetch`'s own
   `content-type` conditional inside the code path under test — the header is set
   only when a body is actually sent, and a body-less POST that declares it trips
   Fastify's "Body cannot be empty when content-type is application/json".

   No shared QueryClient test helper exists in this package (AgentCard and PRRow
   each build one inline), so the wrapper below is local, on purpose.

   Fake timers drive the batch poll window: real 4s waits would put twelve
   seconds into the suite for one assertion. Note that a `refetchInterval`
   refetch FIRES on the timer while its data commits on the render after, so the
   call count is the honest signal and the rendered payload lags it by one commit
   (`client/INSIGHTS.md`, 2026-08-19). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalAgentCase, EvalBatch, EvalCaseSave } from "@devdigest/shared";
import {
  useAgentEvalBatches,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useCreateEvalCase,
  useDeleteEvalCase,
  useEvalBatch,
  useEvalComparison,
  useEvalDashboard,
  useRunAllEvalBatches,
  useSaveEvalCase,
  useStartEvalBatch,
} from "./eval";

const CASE: EvalAgentCase = {
  id: "case-1",
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "rate limiter drops the tenant key",
  input_diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -70,4 +70,6 @@\n+x\n",
  input_files: null,
  input_meta: null,
  expected_output: { findings: [] },
  notes: null,
  expectation: "must_find",
  expected_anchors: [{ file: "src/a.ts", low_line: 72, high_line: 75 }],
  source_finding_id: "finding-1",
  edited: false,
  last_execution: null,
};

const RUNNING_BATCH: EvalBatch = {
  id: "batch-1",
  workspace_id: "ws-1",
  agent_id: "agent-1",
  agent_name: "Security Reviewer",
  agent_version: 7,
  system_prompt_snapshot: "You are a reviewer.",
  model_snapshot: "anthropic/claude-3.5-sonnet",
  status: "running",
  label: null,
  started_at: "2026-08-23T09:00:00.000Z",
  finished_at: null,
  cases_covered: null,
  cases_passed: null,
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  error: null,
};

const COMPLETE_BATCH: EvalBatch = {
  ...RUNNING_BATCH,
  status: "complete",
  finished_at: "2026-08-23T09:04:00.000Z",
  cases_covered: 4,
  cases_passed: 2,
  recall: 0.5,
  precision: 0.75,
  citation_accuracy: null,
  cost_usd: 0.0031,
};

const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` only reads `ok`, `status` and `json()`. */
const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let qc: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Advance the fake clock inside `act`, flushing every promise it unblocks. */
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Call = [string, RequestInit | undefined];
const calls = () => fetchMock.mock.calls as Call[];
const urls = () => calls().map((c) => c[0]);
const byMethod = (method: string) => calls().filter((c) => c[1]?.method === method);
/** `api.get` passes no `init` at all, so a read is the call with no method. */
const gets = () => calls().filter((c) => c[1]?.method === undefined);

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

describe("useCreateEvalCase", () => {
  it("POSTs the finding id ALONE and refreshes that agent's set", async () => {
    let set: EvalAgentCase[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        set = [CASE];
        return Promise.resolve(jsonOk(CASE));
      }
      return Promise.resolve(jsonOk(set));
    });

    const { result } = renderHook(
      () => ({ cases: useAgentEvalCases("agent-1"), create: useCreateEvalCase() }),
      { wrapper },
    );

    await flush();
    expect(result.current.cases.data).toEqual([]);

    act(() => result.current.create.mutate("finding-1"));
    await flush();

    const post = byMethod("POST")[0];
    expect(post).toBeDefined();
    expect(post![0]).toContain("/eval/cases");

    // The expectation (`must_find` / `must_not_flag`) is DERIVED SERVER-SIDE
    // from the finding's decision. A client that also sent one would be a second
    // source of truth for the single field the whole feature scores against, so
    // the assertion is on the exact key SET and not merely on `finding_id` being
    // present.
    const body = JSON.parse(String(post![1]!.body));
    expect(body).toEqual({ finding_id: "finding-1" });
    expect(Object.keys(body)).toEqual(["finding_id"]);

    // A real body is what makes the JSON content-type safe — this is the other
    // branch of `apiFetch`'s conditional, asserted in the run-all test below.
    expect(post![1]!.headers).toMatchObject({ "content-type": "application/json" });

    // Invalidated on the agent the RESPONSE names, so the caller never has to
    // know which agent produced the finding.
    await flush();
    expect(result.current.cases.data).toEqual([CASE]);
  });
});

describe("the period-scoped reads", () => {
  it("send ?period= on every one of them, defaulting to the API's own 30d", async () => {
    // Url-aware: a list read must not be handed an object, or the poll
    // predicate on the history query calls `.some` on it.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        jsonOk(
          url.includes("/batches")
            ? []
            : { period: "30d", rows: [], recent_batches: [] },
        ),
      ),
    );

    renderHook(
      () => ({
        // No argument: the client default must match what the API applies when
        // `?period=` is absent, or the filter chip and the rendered rows describe
        // two different windows with nothing to catch it.
        workspaceDefault: useEvalDashboard(),
        workspace7d: useEvalDashboard("7d"),
        agentDashboard: useAgentEvalDashboard("agent-1", "all"),
        agentBatches: useAgentEvalBatches("agent-1", "90d"),
      }),
      { wrapper },
    );
    await flush();

    expect(urls()).toContain("http://localhost:3001/eval/dashboard?period=30d");
    expect(urls()).toContain("http://localhost:3001/eval/dashboard?period=7d");
    expect(urls()).toContain("http://localhost:3001/eval/agents/agent-1/dashboard?period=all");
    expect(urls()).toContain("http://localhost:3001/eval/agents/agent-1/batches?period=90d");
  });

  it("stay idle without the ids they are scoped by", async () => {
    fetchMock.mockResolvedValue(jsonOk([]));

    const { result } = renderHook(
      () => ({
        cases: useAgentEvalCases(null),
        // The comparison needs BOTH batches: one-sided it would be a 422 the
        // user never asked for.
        onlyOneSide: useEvalComparison("batch-1", null),
        batch: useEvalBatch(undefined),
      }),
      { wrapper },
    );
    await flush(10_000);

    expect(result.current.cases.fetchStatus).toBe("idle");
    expect(result.current.onlyOneSide.fetchStatus).toBe("idle");
    expect(result.current.batch.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSaveEvalCase / useDeleteEvalCase", () => {
  it("PUTs every field of the edited case, and a delete leaves batch history alone", async () => {
    const edit: EvalCaseSave = {
      name: "renamed case",
      input_diff: CASE.input_diff,
      expectation: "must_not_flag",
      expected_anchors: [{ file: "src/a.ts", low_line: 72, high_line: 75 }],
      expected_output: { findings: [] },
    };
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve(jsonOk({ ok: true }));
      if (init?.method === "PUT") return Promise.resolve(jsonOk(CASE));
      return Promise.resolve(jsonOk([]));
    });

    const { result } = renderHook(
      () => ({
        batches: useAgentEvalBatches("agent-1"),
        save: useSaveEvalCase(),
        remove: useDeleteEvalCase(),
      }),
      { wrapper },
    );
    await flush();
    const afterHistoryRead = gets().length;

    act(() => result.current.save.mutate({ caseId: "case-1", body: edit }));
    await flush();

    const put = byMethod("PUT")[0];
    expect(put).toBeDefined();
    expect(put![0]).toContain("/eval/cases/case-1");
    // The WHOLE submitted case, field for field. Dropping `expected_anchors`
    // here is the silently-successful no-op: the case saves, the editor closes,
    // and the anchors the scorer measures against are the old ones.
    expect(JSON.parse(String(put![1]!.body))).toEqual(edit);

    act(() => result.current.remove.mutate({ caseId: "case-1", agentId: "agent-1" }));
    await flush();

    const del = byMethod("DELETE")[0];
    expect(del).toBeDefined();
    expect(del![0]).toContain("/eval/cases/case-1");

    // A deleted case does not retroactively change a number someone has already
    // read, so the batch history is NOT refetched: only the set is.
    expect(gets().length).toBe(afterHistoryRead);
  });
});

describe("useStartEvalBatch / useEvalBatch", () => {
  it("starts one case or the whole set, then polls only while the batch runs", async () => {
    let batch: EvalBatch = RUNNING_BATCH;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        jsonOk(init?.method === "POST" ? RUNNING_BATCH : { batch, cases: [] }),
      ),
    );

    const { result } = renderHook(
      () => ({ batch: useEvalBatch("batch-1"), start: useStartEvalBatch() }),
      { wrapper },
    );
    await flush();
    expect(result.current.batch.data?.batch.status).toBe("running");
    expect(gets().length).toBe(1);

    // Whole set: an object body, even though it is empty. `{}` satisfies a route
    // schema of two optional fields, where a body-less POST additionally needs
    // that schema to be optional as a whole.
    act(() => result.current.start.mutate({ agentId: "agent-1" }));
    await flush();
    expect(JSON.parse(String(byMethod("POST")[0]![1]!.body))).toEqual({});
    expect(byMethod("POST")[0]![0]).toContain("/eval/agents/agent-1/batches");

    // One case: `case_id`, the contract's own spelling, and no stray `caseId`.
    act(() => result.current.start.mutate({ agentId: "agent-1", caseId: "case-1", label: "x" }));
    await flush();
    expect(JSON.parse(String(byMethod("POST")[1]![1]!.body))).toEqual({
      label: "x",
      case_id: "case-1",
    });

    // The poll: the call count is the honest signal, the payload lags one commit.
    const beforePoll = gets().length;
    await flush(4000);
    expect(gets().length).toBeGreaterThan(beforePoll);

    // Two poll windows, not one plus a zero-ms flush: the refetch fires ON the
    // timer and its data commits on the render AFTER, so a 0ms second flush is
    // one turn early (`client/INSIGHTS.md`, 2026-08-19).
    batch = COMPLETE_BATCH;
    await flush(4000);
    await flush(4000);
    expect(result.current.batch.data?.batch.status).toBe("complete");

    // Terminal: no further request, however long the screen stays open.
    const settled = gets().length;
    await flush(30_000);
    expect(gets().length).toBe(settled);
  });
});

describe("useRunAllEvalBatches", () => {
  it("POSTs with no body at all, so no JSON content-type is declared", async () => {
    fetchMock.mockResolvedValue(jsonOk({ created: [RUNNING_BATCH], skipped: [] }));

    const { result } = renderHook(() => useRunAllEvalBatches(), { wrapper });
    act(() => result.current.mutate());
    await flush();

    const post = byMethod("POST")[0];
    expect(post).toBeDefined();
    expect(post![0]).toContain("/eval/dashboard/runs");
    expect(post![1]!.body).toBeUndefined();
    // The header WITHOUT a body is what trips Fastify's "Body cannot be empty
    // when content-type is application/json" — this is the branch of `apiFetch`'s
    // conditional that keeps a body-less POST clean.
    expect(post![1]!.headers).toEqual({});
    expect(result.current.data?.created).toHaveLength(1);
  });
});
