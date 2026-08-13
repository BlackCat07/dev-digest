/* hooks/smart-diff.ts — the request itself.

   Stubs `fetch` rather than mocking `api`/`apiFetch`, for the reason
   `hooks/intent.test.tsx` documents: asserting the RESPONSE is what let a silently
   successful no-op mutation ship, and only the outgoing request shows that class of
   bug. It also keeps `apiFetch`'s conditional `content-type` inside the code path
   under test. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePrSmartDiff } from "./smart-diff";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const RESPONSE = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/a.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("usePrSmartDiff", () => {
  it("GETs the PR's smart-diff and returns the grouping", async () => {
    fetchMock.mockResolvedValue(ok(RESPONSE));
    const { result } = renderHook(() => usePrSmartDiff("pr-1"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(RESPONSE);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/pulls/pr-1/smart-diff");
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
  });

  /**
   * The PR route is keyed by NUMBER and every PR API by the row's uuid, so `prId` is
   * null on first paint while the pulls list resolves. Without `enabled` the tab
   * fires a request at `/pulls/null/smart-diff` every time it mounts.
   */
  it("makes no request until the PR id is known", () => {
    renderHook(() => usePrSmartDiff(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not poll — there is no in-flight state to wait out", async () => {
    fetchMock.mockResolvedValue(ok(RESPONSE));
    const { result } = renderHook(() => usePrSmartDiff("pr-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const after = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchMock.mock.calls.length).toBe(after);
  });
});
