/* usePrBrief / useGenerateBrief — the two PR Brief hooks.

   Mocked at the NETWORK boundary (`fetch`) rather than at `api`/`apiFetch`, the
   `intent.test.tsx` / `onboarding.test.tsx` precedent. That is the only shape
   that catches the failure this suite exists for: a mutation that omits an
   optional request field still resolves 200, still invalidates and still runs
   the spinner, so asserting the RESPONSE proves nothing — the Intent card's
   Re-derive button shipped exactly that way (`INSIGHTS.md`, What Doesn't Work,
   2026-08-11). Mocking at `fetch` also keeps `apiFetch`'s conditional
   `content-type` inside the code path under test, which matters here because
   this POST does carry a body and therefore does declare the header.

   There is no shared QueryClient test helper in this package (the component
   tests that need one — AgentCard, PRRow — each build it inline), so the wrapper
   below is local, on purpose.

   Fake timers drive the poll window: real 2s waits would put several seconds
   into the suite for one assertion. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrRiskBrief } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief } from "./brief";

const DONE: PrRiskBrief = {
  pr_id: "pr-1",
  what: "Adds per-tenant rate limiting to the public API.",
  why: "One tenant's burst traffic currently starves every other tenant.",
  risk_level: "medium",
  risks: [
    {
      kind: "regression",
      title: "Every public route now passes through the limiter",
      explanation: "A misconfigured bucket rejects legitimate traffic on every route at once.",
      severity: "medium",
      file_refs: ["src/api/rate-limit.ts"],
    },
  ],
  review_focus: [
    { path: "src/api/rate-limit.ts", line: 42, reason: "The bucket sizing lives here." },
  ],
  diff_stats: {
    files_changed: 12,
    files_listed: 12,
    additions: 340,
    deletions: 88,
    symbols: 6,
    endpoints: 2,
  },
  status: "ok",
  reason: null,
  sources: [
    { kind: "pr_title", ref: "pull/482#title", status: "used", chars: 48, note: null },
    { kind: "repo_doc", ref: "CONTRIBUTING.md", status: "dropped_over_budget", chars: null, note: "over budget" },
  ],
  head_sha: "abc1234",
  cache_key: "k-abc1234",
  stale: false,
  generation_state: "done",
  generated_at: "2026-08-20T09:00:00.000Z",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  attempts: 1,
  tokens_in: 2100,
  tokens_out: 320,
  cost_usd: 0.004,
  error: null,
};

/** A generation in flight. The rest of the document is the previously stored brief. */
const RUNNING: PrRiskBrief = { ...DONE, generation_state: "running" };

/** A pull request nobody has generated a brief for — terminal, like `done`. */
const NEVER: PrRiskBrief = {
  ...DONE,
  what: null,
  why: null,
  risk_level: null,
  risks: [],
  review_focus: [],
  sources: [],
  status: "degraded",
  reason: null,
  head_sha: null,
  cache_key: null,
  generation_state: "never_generated",
  generated_at: null,
  provider: null,
  model: null,
  attempts: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  error: null,
};

const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` reads only `ok`, `status` and `json()`. */
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

describe("usePrBrief", () => {
  it("polls every 2s while a generation is running", async () => {
    fetchMock.mockResolvedValue(jsonOk(RUNNING));
    const { result } = renderHook(() => usePrBrief("pr-1"), { wrapper });

    await flush();
    expect(result.current.data?.generation_state).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/pulls/pr-1/brief");

    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling the moment the generation is no longer running", async () => {
    // Running once, then done — the card's running state has to clear itself and
    // it has to stop asking. A hook that kept polling would spend a request every
    // two seconds for as long as the tab stayed open.
    let answer: PrRiskBrief = RUNNING;
    fetchMock.mockImplementation(async () => jsonOk(answer));
    const { result } = renderHook(() => usePrBrief("pr-1"), { wrapper });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer = DONE;
    await flush(2000);
    // One more tick: the refetch fires on the timer and its result is committed
    // on the render AFTER it, so a zero-millisecond flush is one turn too early
    // (`INSIGHTS.md`, Tool & Library Notes, 2026-08-19).
    await flush(1);
    expect(result.current.data?.generation_state).toBe("done");
    const settled = fetchMock.mock.calls.length;

    // Five poll windows later, not one more request.
    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(settled);
  });

  it("makes no further request for a never-generated brief, or any at all with no prId", async () => {
    // `never_generated` is an ordinary state and not a pending one: nothing is
    // going to change until somebody presses the button, so an idle screen must
    // generate no traffic.
    fetchMock.mockResolvedValue(jsonOk(NEVER));

    const fresh = renderHook(() => usePrBrief("pr-1"), { wrapper });
    const missing = renderHook(() => usePrBrief(null), { wrapper });

    await flush();
    expect(fresh.result.current.data?.generation_state).toBe("never_generated");
    expect(missing.result.current.fetchStatus).toBe("idle");
    // One request: the disabled hook never fires one.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useGenerateBrief", () => {
  it("POSTs force:true so the control is never a no-op, and refreshes the stored brief", async () => {
    let stored: PrRiskBrief = NEVER;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        stored = RUNNING;
        return jsonOk({ status: "accepted", jobId: "job-1" });
      }
      return jsonOk(stored);
    });

    const { result } = renderHook(
      () => ({ query: usePrBrief("pr-1"), generate: useGenerateBrief("pr-1") }),
      { wrapper },
    );

    await flush();
    expect(result.current.query.data?.generation_state).toBe("never_generated");

    act(() => result.current.generate.mutate());
    await flush();

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const post = calls.find((call) => call[1]?.method === "POST");
    expect(post).toBeDefined();
    expect(post![0]).toContain("/pulls/pr-1/brief/generate");
    // `force: true` is the whole point of the control. Without it the server's
    // freshness check answers with the STORED brief unchanged and the button is a
    // silent no-op on exactly the case a reader presses it for. Asserting the
    // parsed body, not the raw string, so key order can never break this.
    expect(post![1]?.body).toBeDefined();
    expect(JSON.parse(String(post![1]!.body))).toEqual({ force: true });
    // A NON-EMPTY body is what makes the content-type header safe: Fastify's
    // "Body cannot be empty when content-type is application/json" trips on the
    // header WITHOUT a body, which is why `api.post` only sets it when a body is
    // actually sent.
    expect(String(post![1]!.body).length).toBeGreaterThan(0);

    // Invalidated rather than written into the cache: the response is an
    // acknowledgement, and what the card needs next is the brief whose `running`
    // state switches the polling above on.
    await flush();
    expect(result.current.query.data?.generation_state).toBe("running");
    await flush(2000);
    expect(calls.filter((call) => call[1]?.method !== "POST").length).toBeGreaterThan(2);
  });

  it("surfaces the server's refusal of a concurrent generation rather than swallowing it", async () => {
    // The server answers 422 while one generation is already running; the caller
    // renders it inline and the brief on screen is unaffected.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({
            error: {
              code: "validation_error",
              message: "A generation is already running for this pull request",
            },
          }),
        } as unknown as Response;
      }
      return jsonOk(RUNNING);
    });

    const { result } = renderHook(() => useGenerateBrief("pr-1"), { wrapper });

    act(() => result.current.mutate());
    await flush();

    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe(
      "A generation is already running for this pull request",
    );
  });
});
