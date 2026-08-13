/* usePrIntent / useDeriveIntent — the two Intent Layer hooks.

   Mocked at the NETWORK boundary (`fetch`) rather than at `api`/`apiFetch`, so
   the request these hooks actually put on the wire is what gets asserted. That is
   the only thing that catches the failure this suite exists for: the re-derive
   POST once carried no body, so `force` was never set, the server returned the
   stored row, and the mutation still resolved 200 and still invalidated — a
   perfectly successful no-op. Nothing but asserting the REQUEST sees it.

   No shared QueryClient test helper exists in this package (the two component
   tests that need one — AgentCard, PRRow — each build it inline), so the wrapper
   below is local, on purpose.

   Fake timers drive the poll window: real 2s waits would put four seconds into
   the suite for one assertion. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntent } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "./intent";

const INTENT: PrIntent = {
  pr_id: "pr-1",
  intent: "Add per-tenant rate limiting to the public API.",
  in_scope: ["Token-bucket middleware"],
  out_of_scope: [],
  head_sha: "abc1234",
  confidence: 0.9,
  sources: [{ kind: "pr_body", ref: "pull/482#body", status: "used", chars: 400, note: null }],
  missing_context: [],
  // Empty: this suite asserts poll timing and the request body, not rendering.
  risk_areas: [],
  status: "ok",
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  tokens_in: 900,
  tokens_out: 120,
  cost_usd: 0.002,
  derived_at: "2026-08-10T09:00:00.000Z",
  error: null,
};

const RUNNING: PrIntent = { ...INTENT, intent: null, status: "running", in_scope: [] };

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

describe("usePrIntent", () => {
  it("polls every 2s while the derivation is running", async () => {
    fetchMock.mockResolvedValue(jsonOk(RUNNING));
    const { result } = renderHook(() => usePrIntent("pr-1"), { wrapper });

    await flush();
    expect(result.current.data?.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("makes no further request for a terminal status, for a never-derived PR, or with no prId", async () => {
    // `null` is a real answer, not an error and not a reason to keep asking: an
    // idle PR detail screen must generate no traffic at all.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(jsonOk(url.includes("/pulls/pr-ok/") ? INTENT : null)),
    );

    const done = renderHook(() => usePrIntent("pr-ok"), { wrapper });
    const fresh = renderHook(() => usePrIntent("pr-new"), { wrapper });
    const missing = renderHook(() => usePrIntent(null), { wrapper });

    await flush();
    expect(done.result.current.data?.status).toBe("ok");
    expect(fresh.result.current.data).toBeNull();
    expect(missing.result.current.fetchStatus).toBe("idle");
    // Two requests: the disabled hook never fires one.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Five poll windows later, still two.
    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useDeriveIntent", () => {
  it("POSTs force:true so the button is never a no-op, and refreshes the stored intent", async () => {
    let stored: PrIntent | null = null;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        stored = INTENT;
        return Promise.resolve(jsonOk(INTENT));
      }
      return Promise.resolve(jsonOk(stored));
    });

    const { result } = renderHook(
      () => ({ query: usePrIntent("pr-1"), derive: useDeriveIntent("pr-1") }),
      { wrapper },
    );

    await flush();
    expect(result.current.query.data).toBeNull();

    act(() => result.current.derive.mutate());
    await flush();

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const post = calls.find((c) => c[1]?.method === "POST");
    expect(post).toBeDefined();
    expect(post![0]).toContain("/pulls/pr-1/intent");
    // `force: true` is the whole point of the control. Without it the server's
    // freshness check returns the STORED row unchanged, and the button is a
    // silent no-op on exactly the case a user presses it for — a PR whose intent
    // is `ok` at the current head but was derived from the title alone. Asserting
    // the parsed body, not the raw string, so key order can never break this.
    expect(post![1]?.body).toBeDefined();
    expect(JSON.parse(String(post![1]!.body))).toEqual({ force: true });
    // A NON-EMPTY body is what makes the content-type header safe: Fastify's
    // "Body cannot be empty when content-type is application/json" trips on the
    // header WITHOUT a body, which is why `api.post` only sets it when a body is
    // actually sent.
    expect(String(post![1]!.body).length).toBeGreaterThan(0);

    // Invalidated rather than written into the cache, so a derivation that came
    // back still `running` gets picked up by the query's own polling.
    await flush();
    expect(result.current.query.data?.status).toBe("ok");
  });
});
