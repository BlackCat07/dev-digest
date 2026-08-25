/* The expandable finding row and its detail (AC-72, AC-74, AC-75, AC-76,
   AC-104).

   Mounted through `AgentTabsPane`, not through `FindingDetail` alone, because
   two of the four things under test are claims about the pair: that the
   category tag reads the SAME before and after expanding, and that a decision
   recorded in the panel survives the panel being collapsed away. Rendering the
   panel in isolation would assert neither.

   Mocked at the network boundary and nowhere else — the real hooks, the real
   query client and the real vendored primitives all run. Three constraints of
   this package shape the file:

   - **`@testing-library/user-event` is not a dependency here** and adding it is
     a `package.json` + lockfile change, with the lockfile do-not-touch. All
     interaction is `fireEvent`, matching every other test file in `src/`
     (`client/INSIGHTS.md`, 2026-08-10).
   - **There is no shared QueryClient test helper**; one is built inline, as
     `AgentCard.test.tsx` and `PRRow.test.tsx` do.
   - **Every namespace the subtree reaches is supplied.** This one reaches
     exactly `runs`; a missing namespace makes next-intl render the key path and
     log `IntlError: MISSING_MESSAGE` into an otherwise green run's stderr
     (`client/INSIGHTS.md`, 2026-08-11).

   No `EventSource` stub and no fake timers: nothing here mounts the trace
   drawer, and the assertions wait on real promises. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../../../messages/en/runs.json";
import { AgentTabsPane } from "../../AgentTabsPane";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WITH_FIX: AgentColumnFinding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Rate limit missing on /login",
  file: "src/routes/auth.ts",
  start_line: 28,
  end_line: 30,
  rationale: "An unauthenticated endpoint with no limiter is a credential-stuffing target.",
  suggestion: "Wrap the handler in the shared `rateLimit` plugin.",
  confidence: 0.82,
  accepted_at: null,
  dismissed_at: null,
};

/** The agent proposed no fix — `suggestion` is nullish on the contract. */
const WITHOUT_FIX: AgentColumnFinding = {
  ...WITH_FIX,
  id: "f2",
  severity: "SUGGESTION",
  category: "style",
  title: "Magic number 3600",
  file: "src/lib/cache.ts",
  start_line: 14,
  end_line: 14,
  rationale: "3600 appears twice with no name.",
  suggestion: null,
  confidence: 0.4,
};

const COLUMN: AgentColumn = {
  run_id: "run-done",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  verdict: "request_changes",
  score: 82,
  summary: "Two blocking issues.",
  duration_ms: 8200,
  cost_usd: 0.06,
  findings: [WITH_FIX, WITHOUT_FIX],
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Answers `POST /eval/cases` with this failure instead of a case.
 *
 * `code` is optional because the two failures the panel has to tell apart are
 * exactly "the server named a refusal" and "the server did not" — a 500 or a
 * dropped connection reaches `ApiError` with `code` undefined.
 */
let evalRefusal: { status: number; code?: string; message: string } | null;
let fetchMock: ReturnType<typeof vi.fn>;
let qc: QueryClient;

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const jsonErr = (status: number, code: string | undefined, message: string) =>
  ({
    ok: false,
    status,
    statusText: code ?? message,
    json: async () => ({ error: { code, message } }),
  }) as unknown as Response;

function route(url: string): Response {
  if (url.endsWith("/eval/cases")) {
    return evalRefusal
      ? jsonErr(evalRefusal.status, evalRefusal.code, evalRefusal.message)
      : jsonOk({ id: "case-1", owner_id: "a1" });
  }
  if (url.includes("/findings/")) return jsonOk({ finding: { id: "f1" } });
  return jsonOk([]);
}

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
        <AgentTabsPane columns={[COLUMN]} onOpenTrace={vi.fn()} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** The `<article>` of one finding — the disclosure and its panel together. */
const row = (index: number) => screen.getAllByRole("article")[index] as HTMLElement;
const calls = (fragment: string) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

beforeEach(() => {
  evalRefusal = null;
  fetchMock = vi.fn(async (url: string) => route(String(url)));
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  qc.clear();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindingDetail — expanding a finding", () => {
  it("keeps the category, adds the rationale and the fix, and offers exactly three worded actions", () => {
    render(tree());

    const first = row(0);
    // AC-104, before. Exactly one tag, because the expansion must WRAP this row
    // rather than render a second one beside it.
    expect(within(first).getAllByText("security")).toHaveLength(1);
    expect(within(first).queryByText("Rationale")).toBeNull();

    fireEvent.click(within(first).getByRole("button", { name: /Rate limit missing/ }));

    // AC-104, after — same tag, same word, still exactly one.
    expect(within(first).getAllByText("security")).toHaveLength(1);
    // AC-72 — both sections, with the agent's own prose under each.
    expect(within(first).getByText("Rationale")).toBeInTheDocument();
    expect(within(first).getByText(/credential-stuffing target/)).toBeInTheDocument();
    expect(within(first).getByText("Suggested fix")).toBeInTheDocument();
    expect(within(first).getByText(/Wrap the handler in the shared/)).toBeInTheDocument();

    // AC-74, N-1, N-2 — three worded actions and no other. Asserted BY ROLE: a
    // text query would count the two section labels as well. The first button
    // is the disclosure — it is the one control carrying `aria-expanded`, which
    // is what distinguishes "open this row" from "act on this finding".
    const controls = within(first).getAllByRole("button");
    expect(controls[0]).toHaveAttribute("aria-expanded", "true");
    expect(controls.slice(1).map((b) => b.textContent)).toEqual([
      "Accept",
      "Dismiss",
      "Turn into eval case",
    ]);
    expect(within(first).queryByRole("button", { name: /learn/i })).toBeNull();
    expect(within(first).queryByRole("button", { name: /reply/i })).toBeNull();

    // AC-72 — a finding with no suggestion renders its rationale and NO empty
    // fix heading. The label is what must be absent, not merely the prose.
    const second = row(1);
    fireEvent.click(within(second).getByRole("button", { name: /Magic number 3600/ }));
    expect(within(second).getByText("Rationale")).toBeInTheDocument();
    expect(within(second).getByText(/3600 appears twice/)).toBeInTheDocument();
    expect(within(second).queryByText("Suggested fix")).toBeNull();
  });
});

describe("FindingDetail — the three actions", () => {
  it("records an accept through the existing route and keeps the finding reading as decided", async () => {
    render(tree());

    const first = row(0);
    fireEvent.click(within(first).getByRole("button", { name: /Rate limit missing/ }));
    fireEvent.click(within(first).getByRole("button", { name: "Accept" }));

    // AC-75 — exactly one POST, to the existing finding-action route.
    expect(await within(first).findByText("Accepted")).toBeInTheDocument();
    const posts = calls("/findings/f1/accept");
    expect(posts).toHaveLength(1);
    expect((posts[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");

    // ...and the decision outlives the panel that recorded it: the multi-run
    // read has stopped polling by the time a reader decides anything, so the
    // row is the only thing that can remember.
    fireEvent.click(within(first).getByRole("button", { name: /Rate limit missing/ }));
    expect(within(first).getByText("Accepted")).toBeInTheDocument();
  });

  it("shows the reason the server refused an eval case rather than a generic failure", async () => {
    // AC-76 — the refusal an UNDECIDED finding earns. The control is left
    // operable precisely so this sentence can be reached.
    evalRefusal = {
      status: 400,
      code: "finding_has_no_decision",
      message: "Accept or dismiss this finding before turning it into an eval case",
    };
    render(tree());

    const first = row(0);
    fireEvent.click(within(first).getByRole("button", { name: /Rate limit missing/ }));
    fireEvent.click(within(first).getByRole("button", { name: "Turn into eval case" }));

    const alert = await within(first).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Accept or dismiss this finding before turning it into an eval case",
    );
    // The refusal is about the eval case, not about the finding: both decisions
    // stay operable above it, and taking one is what clears the refusal.
    expect(within(first).getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(within(first).getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("says the action did not go through when the failure carries no named code", async () => {
    // A 503 or a dropped connection reaches `ApiError` with no `code`, and
    // there is then no server sentence worth quoting — the status line
    // "503 Service Unavailable" is not one. Rendering nothing at all was the
    // defect: the reader presses the control and the screen does not move,
    // which is indistinguishable from a dead button.
    evalRefusal = { status: 503, message: "503 Service Unavailable" };
    render(tree());

    const first = row(0);
    fireEvent.click(within(first).getByRole("button", { name: /Rate limit missing/ }));
    fireEvent.click(within(first).getByRole("button", { name: "Turn into eval case" }));

    const alert = await within(first).findByRole("alert");
    expect(alert).toHaveTextContent(
      "That didn't go through — nothing was recorded. Try again in a moment.",
    );
    // The raw status line is NOT what gets shown — quoting it would be product
    // copy written by the transport.
    expect(alert).not.toHaveTextContent("503 Service Unavailable");
  });
});
