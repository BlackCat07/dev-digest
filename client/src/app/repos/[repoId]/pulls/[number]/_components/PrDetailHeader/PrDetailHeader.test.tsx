/* PrDetailHeader — the standing entry into a pull request's multi-agent results.

   The one thing this file exists for: before it, `/repos/:repoId/multi-agent/:number`
   was reachable ONLY from the picker's `router.push` at the moment a fan-out
   started. The read (`GET /pulls/:id/multi-agent`) kept answering afterwards, so
   the results were still there — with no way to them but typing the URL.

   Two states, and the difference between them is the whole requirement:

   - the read SUCCEEDS → the button is there and navigates to this PR's results;
   - the read 404s → the pull request was simply never fanned out, so the button
     is absent. Not disabled, not an error message: `useMultiAgentRun` surfaces
     the 404 as an `ApiError` on purpose, and the header's job is to leave the
     actions row exactly as it was.

   Mounted with the REAL hook over a stubbed `fetch`, the way `AgentPicker.test.tsx`
   does it — the branch under test is the hook's own error/success split, so
   mocking the hook would test the mock. `fireEvent`, not `userEvent`: the latter
   is not a dependency of this package (`client/INSIGHTS.md`, 2026-08-10). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import type { PrDetail } from "@/lib/types";
import { PrDetailHeader } from "./PrDetailHeader";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => push(...a), replace: vi.fn() }),
  usePathname: () => "/repos/repo-1/pulls/482",
}));

const OPEN_FROM_PR = messages.results.openFromPr;

const PR = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to the public API",
  author: "ada",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc1234def",
  additions: 240,
  deletions: 18,
  files_count: 2,
  status: "open",
  body: "",
  commits: [],
  files: [],
} as unknown as PrDetail;

/** A settled run — one done column, so the hook's poll never turns on and the
    test has no timers to reason about. */
const RUN: MultiAgentRun = {
  id: "mar-1",
  pr_id: "pr-1",
  pr_number: 482,
  ran_at: "2026-08-25T09:00:00.000Z",
  agent_count: 1,
  total_duration_ms: 8200,
  total_cost_usd: 0.06,
  columns: [
    {
      run_id: "run-1",
      agent_id: "a1",
      agent_name: "Security Auditor",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      status: "done",
      error: null,
      verdict: "approve",
      score: 88,
      summary: "Nothing blocking.",
      duration_ms: 8200,
      cost_usd: 0.06,
      findings: [],
    },
  ],
  conflicts: [],
};

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** The server's real "this PR was never fanned out" answer — a 404 carrying
    `code: "not_found"`, which `apiFetch` turns into an `ApiError`. */
const notFound = () =>
  ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({ error: { code: "not_found", message: "No multi-agent run" } }),
  }) as unknown as Response;

const fetchMock = vi.fn();
/** What `GET /pulls/pr-1/multi-agent` answers for the case at hand. */
let multiAgentAnswer: () => Response = () => jsonOk(RUN);

let qc: QueryClient;

beforeEach(() => {
  push.mockReset();
  multiAgentAnswer = () => jsonOk(RUN);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/pulls/pr-1/multi-agent")) {
      return Promise.resolve(multiAgentAnswer());
    }
    // Everything else the header's subtree reaches — the picker's agents and
    // estimates — is an empty list, which is a real state.
    return Promise.resolve(jsonOk([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <PrDetailHeader
          pr={PR}
          prId="pr-1"
          tab="overview"
          findingsCount={0}
          githubUrl="https://github.com/acme/payments-api/pull/482"
          onSetTab={() => {}}
          onRunStart={() => {}}
          onRunsStarted={() => {}}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PrDetailHeader — multi-agent results entry", () => {
  it("offers a way into the results once this pull request has a multi-agent run", async () => {
    mount();

    const button = await screen.findByRole("button", { name: OPEN_FROM_PR });
    fireEvent.click(button);

    expect(push).toHaveBeenCalledWith("/repos/repo-1/multi-agent/482");
  });

  it("renders no entry, and no error, when the pull request was never fanned out", async () => {
    multiAgentAnswer = notFound;
    mount();

    // Wait for the read to have happened at all, so "absent" is a statement
    // about the 404 and not about a query that had not yet run.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/pulls/pr-1/multi-agent")),
      ).toBe(true),
    );

    expect(screen.queryByRole("button", { name: OPEN_FROM_PR })).not.toBeInTheDocument();
    // The rest of the actions row is untouched — a 404 is routine, not a failure.
    expect(screen.getByRole("button", { name: /view on github/i })).toBeInTheDocument();
  });
});
