/* useOnboardingTour / useGenerateOnboarding — the two Onboarding Tour hooks.

   Covers AC-34's data half of `specs/onboarding-generator.md`: the running state
   the screen renders arrives from a poll that starts and stops on the payload's
   own `generation_state`, so an idle screen makes no requests at all.

   Mocked at the NETWORK boundary (`fetch`) rather than at `api`/`apiFetch`, the
   `intent.test.tsx` precedent — it is the only shape that catches a mutation
   silently omitting a field, and it keeps `apiFetch`'s conditional
   `content-type` inside the code path under test. That conditional matters here
   specifically: this POST carries NO body, and a `content-type: application/json`
   without one trips Fastify's "Body cannot be empty when content-type is
   application/json".

   There is no shared QueryClient test helper in this package, so the wrapper
   below is local, on purpose. Fake timers drive the poll window: real 2s waits
   would put several seconds into the suite for one assertion. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingTour } from "@devdigest/shared";
import { useOnboardingTour, useGenerateOnboarding } from "./onboarding";

const READY: OnboardingTour = {
  sections: [],
  status: "ok",
  reason: null,
  generation_state: "ready",
  generated_at: "2026-08-19T09:00:00.000Z",
  indexed_sha: "abc1234",
  stale: false,
  files_indexed: 312,
  files_skipped: 0,
  model: "deepseek/deepseek-v4-flash",
  attempts: 1,
  tokens_in: 900,
  tokens_out: 300,
  cost_usd: 0.004,
};

const RUNNING: OnboardingTour = { ...READY, generation_state: "running" };

/** A repository nobody has generated a tour for — terminal, like `ready`. */
const NEVER: OnboardingTour = {
  ...READY,
  generation_state: "never_generated",
  generated_at: null,
  indexed_sha: null,
  status: "degraded",
  reason: "index_missing",
  model: null,
  attempts: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
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

describe("useOnboardingTour", () => {
  it("polls every 2s while a generation is running (AC-34)", async () => {
    fetchMock.mockResolvedValue(jsonOk(RUNNING));
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });

    await flush();
    expect(result.current.data?.generation_state).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/repos/r1/onboarding");

    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling the moment the generation is no longer running (AC-34)", async () => {
    // Running once, then ready — the screen's running state has to clear itself,
    // and it has to stop asking. A hook that kept polling would spend a request
    // every two seconds for as long as the tab stayed open.
    let answer: OnboardingTour = RUNNING;
    fetchMock.mockImplementation(async () => jsonOk(answer));
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer = READY;
    await flush(2000);
    // One more tick: the refetch fires on the timer and the result is committed
    // on the render after it, so a zero-millisecond flush is one turn too early.
    await flush(1);
    expect(result.current.data?.generation_state).toBe("ready");
    const settled = fetchMock.mock.calls.length;

    // Five poll windows later, not one more request.
    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(settled);
  });

  it("makes no request at all for a never-generated tour, or with no repo id", async () => {
    fetchMock.mockResolvedValue(jsonOk(NEVER));

    const fresh = renderHook(() => useOnboardingTour("r1"), { wrapper });
    const missing = renderHook(() => useOnboardingTour(null), { wrapper });

    await flush();
    expect(fresh.result.current.data?.generation_state).toBe("never_generated");
    // `never_generated` is an ordinary state, not a pending one: nothing is
    // going to change until somebody presses the button.
    expect(missing.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useGenerateOnboarding", () => {
  it("POSTs to the generate route with no body, and refreshes the tour", async () => {
    let stored: OnboardingTour = NEVER;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        stored = RUNNING;
        return jsonOk({ status: "accepted", jobId: "job-1" });
      }
      return jsonOk(stored);
    });

    const { result } = renderHook(
      () => ({ query: useOnboardingTour("r1"), generate: useGenerateOnboarding("r1") }),
      { wrapper },
    );

    await flush();
    expect(result.current.query.data?.generation_state).toBe("never_generated");

    act(() => result.current.generate.mutate());
    await flush();

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const post = calls.find((call) => call[1]?.method === "POST");
    expect(post).toBeDefined();
    expect(post![0]).toContain("/repos/r1/onboarding/generate");
    // NO body, and therefore no `content-type` — the repository is in the path
    // and a generation always replaces the single stored tour, so there is no
    // flag for the caller to set and none to forget.
    expect(post![1]?.body).toBeUndefined();
    expect((post![1]?.headers ?? {}) as Record<string, string>).not.toHaveProperty("content-type");

    // Invalidated rather than written into the cache: what the screen needs next
    // is the tour whose `running` state switches the polling above on.
    await flush();
    expect(result.current.query.data?.generation_state).toBe("running");
    await flush(2000);
    expect(calls.filter((call) => call[1]?.method !== "POST").length).toBeGreaterThan(2);
  });

  it("surfaces the server’s refusal of a concurrent generation rather than swallowing it", async () => {
    // The server answers 422 while one generation is already running; the caller
    // renders it inline and the tour on screen is unaffected.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({
            error: {
              code: "validation_error",
              message: "A generation is already running for this repository",
            },
          }),
        } as unknown as Response;
      }
      return jsonOk(RUNNING);
    });

    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });

    act(() => result.current.mutate());
    await flush();

    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe(
      "A generation is already running for this repository",
    );
  });
});
