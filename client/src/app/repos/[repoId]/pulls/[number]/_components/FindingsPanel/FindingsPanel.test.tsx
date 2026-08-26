import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

/* Hoisted so the accept/dismiss mutation is observable from a test: the eval-case
   refusal must leave `Accept` and `Dismiss` WORKING, and "still enabled" is a
   weaker claim than "still reaches the action hook". `vi.mock` factories are
   hoisted above the imports, so a plain module-level `const` would be undefined
   inside one. */
const { actionMutate } = vi.hoisted(() => ({ actionMutate: vi.fn() }));

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: actionMutate, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "One query per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

/**
 * Intl AND a query client.
 *
 * The query client is load-bearing, not boilerplate: this panel owns the
 * turn-into-an-eval-case mutation, and a React Query hook with no client throws
 * `No QueryClient set` during render — every test in this file would fail before
 * reaching its first assertion, while `tsc --noEmit` stayed clean. A fresh client
 * per render keeps one test's cache out of the next one's; there is no shared
 * helper for this in the package, so this one is local like `AgentCard`'s.
 */
function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* Both namespaces: the panel reads `prReview`, and the draft modal it
          opens reads `eval`. A missing namespace does not throw — next-intl
          renders the key path — so a modal asserted by its own label would pass
          against a screen full of `caseDraft.subtitle`. */}
      <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

/* The landing of a diff badge press: `?finding=<id>` reaches this panel through
   the run that holds it.

   `f2` is deliberately the SECOND card. Everything about the default render —
   `defaultExpanded={i === 0}`, `focusIdx` starting at 0 — favours the first one, so
   a case targeting the first would pass with the feature entirely absent. */
describe("FindingsPanel — landing on a targeted finding", () => {
  const card = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[data-finding-id="${id}"]`)!;

  it("expands the targeted card, not merely the first one", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />);
    // The rationale lives in the body, so it is only on screen when expanded.
    expect(screen.getByText("One query per user.")).toBeInTheDocument();
  });

  it("moves the j/k cursor onto it, so it arrives outlined", () => {
    const { container } = renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />,
    );
    // `focused` is drawn as a ring; the outline is the whole point of landing.
    expect(card(container, "f2").style.boxShadow).not.toBe("none");
    expect(card(container, "f1").style.boxShadow).toBe("none");
  });

  it("leaves the cursor at the top when nothing is targeted", () => {
    const { container } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(card(container, "f1").style.boxShadow).not.toBe("none");
    expect(card(container, "f2").style.boxShadow).toBe("none");
  });

  it("still resets the cursor when a filter change shrinks the list", () => {
    // The reset effect skips its FIRST run so the landing survives; this is the
    // behaviour that skip must not have cost.
    const { container } = renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Warning/ }));
    // Only the WARNING remains, and the cursor is back on the first visible card.
    expect(card(container, "f2").style.boxShadow).not.toBe("none");
    expect(container.querySelector('[data-finding-id="f1"]')).toBeNull();
  });
});

describe("FindingsPanel — severity isolate filter", () => {
  // The filter is OWNED by this panel (one chip row per review run), so these
  // drive the real chips rather than passing a prop.
  const chip = (level: string) => screen.getByRole("button", { name: new RegExp(level) });

  it("renders a chip per level, counting only this run's findings", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chip("Critical")).toHaveTextContent("1");
    expect(chip("Warning")).toHaveTextContent("1");
    expect(chip("Suggestion")).toHaveTextContent("0");
  });

  it("shows every finding until a level is isolated", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("isolates a level on click", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("clears the filter when the active chip is clicked again", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("switches straight from one level to another", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("shows the empty state for a level this run has none of", () => {
    // Suggestion is at 0 here, so its chip is dimmed — assert via a run that has
    // only one level, where isolating the other is reachable.
    renderWithIntl(<FindingsPanel findings={[FINDINGS[0]!]} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("No findings match")).not.toBeInTheDocument();
  });

  it("renders no chip row for a run with no findings", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.queryByRole("button", { name: /Critical/ })).not.toBeInTheDocument();
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — scope isolate filter", () => {
  // The scope row is a SECOND, orthogonal isolate beside the severity chips, and
  // this panel owns its state, so these drive the real chips. The third finding
  // is UNLABELLED on purpose: it stands for every finding written before the
  // Intent Layer.
  const SCOPED: FindingRecord[] = [
    { ...FINDINGS[0]!, scope: "in_scope" },
    { ...FINDINGS[1]!, scope: "out_of_scope" },
    { ...FINDINGS[1]!, id: "f3", title: "Limiter has no test", severity: "SUGGESTION" },
  ];

  it("counts only LABELLED findings, so the two chips can sum to less than the list", () => {
    renderWithIntl(<FindingsPanel findings={SCOPED} prId="pr1" />);
    expect(screen.getByRole("button", { name: /In scope\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Out of scope\s*1/ })).toBeInTheDocument();
    // 1 + 1, with three findings on screen — the unlabelled one is in neither
    // bucket, and is still shown.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Limiter has no test")).toBeInTheDocument();
  });

  it("isolating a scope hides the unlabelled findings too, until the chip is cleared", () => {
    renderWithIntl(<FindingsPanel findings={SCOPED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /In scope/ }));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    // The sharp edge: "show only in-scope" excludes anything that does not
    // actually carry the label.
    expect(screen.queryByText("Limiter has no test")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /In scope/ }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Limiter has no test")).toBeInTheDocument();
  });
});

/* L06 — the panel half of `Turn into eval case`.

   The card's own tests already cover what the control looks like in each state;
   what only this panel can get wrong is the ROUTING: one press must produce one
   request, and its outcome must land on the card that asked and on no other. A
   single `evalFindingId` plus the mutation's own state is what makes that true,
   and a copy of `isPending`/`error` in `useState` is what would make it false —
   one render behind, on whichever card was pressed last.

   The load-bearing claim here is a NEGATIVE one: the press must add nothing. It
   POSTs to `/eval/cases/drafts`, which writes no row, and the case reaches the
   agent's set only when the modal that opens is saved. A test that only asserted
   the card's label would pass against the old behaviour, so the request URLs are
   asserted too.

   `fetch` is stubbed rather than the hook mocked: the refusal reaches the card as
   `ApiError.code`, so the code path worth exercising starts at the response
   envelope. (The outgoing body itself is `src/lib/hooks/eval.test.tsx`'s subject.) */
describe("FindingsPanel — turning a finding into an eval case", () => {
  const c = messages.finding;
  /** One accepted, one dismissed: both are decided, so both offer the control. */
  const DECIDED: FindingRecord[] = [
    { ...FINDINGS[0]!, accepted_at: "2026-08-20T10:00:00.000Z" },
    { ...FINDINGS[1]!, dismissed_at: "2026-08-20T10:05:00.000Z" },
  ];
  const fetchMock = vi.fn();
  /** `apiFetch` reads only `ok`, `status`, `statusText` and `json()`. */
  const res = (status: number, body: unknown) =>
    ({
      ok: status < 400,
      status,
      statusText: "",
      json: async () => body,
    }) as unknown as Response;
  const posts = () =>
    (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
      (call) => call[1]?.method === "POST",
    );
  const postsTo = (fragment: string) => posts().filter((call) => call[0].includes(fragment));

  /** What `POST /eval/cases/drafts` answers with — a case that does not exist. */
  const DRAFT = {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    name: "src/config.ts:11-11",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  key",
    input_files: [{ path: "src/config.ts" }],
    input_meta: { repo: "acme/api", pr_number: 7, pr_title: "Stripe", review_id: "r1" },
    expectation: "must_find",
    expected_anchors: [{ file: "src/config.ts", low_line: 11, high_line: 11 }],
    expected_output: [{ severity: "CRITICAL", title: "Hardcoded secret" }],
    source: {
      finding_id: "f1",
      title: "Hardcoded secret",
      file: "src/config.ts",
      low_line: 11,
      high_line: 11,
      severity: "CRITICAL",
      category: "security",
      decision: "accepted",
    },
  };

  /* `targetFindingId` expands BOTH cards: `defaultExpanded` opens only the first,
     and the second card's action row has to be on screen for "the refusal landed
     on one card" to be an assertion rather than a tautology. */
  const renderDecided = () =>
    renderWithIntl(<FindingsPanel findings={DECIDED} prId="pr1" targetFindingId="f2" />).container;
  const card = (container: HTMLElement, id: string) =>
    within(container.querySelector<HTMLElement>(`[data-finding-id="${id}"]`)!);

  beforeEach(() => {
    fetchMock.mockReset();
    actionMutate.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("derives a draft and opens the editor — and files NOTHING until it is saved", async () => {
    let settle: ((r: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );

    const container = renderDecided();
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }));

    // In flight: the pressed card says so, the other one is untouched.
    expect(
      await card(container, "f1").findByRole("button", { name: c.turnIntoEvalCaseOpening }),
    ).toBeInTheDocument();
    expect(
      card(container, "f2").getByRole("button", { name: c.turnIntoEvalCase }),
    ).toBeInTheDocument();
    // ONE request — not one per rendered card, and not one per re-render — and
    // it is the DRAFT endpoint, which writes no row.
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![0]).toContain("/eval/cases/drafts");

    settle!(res(200, DRAFT));

    // The editor opens over the derived case, and the card does NOT say the case
    // was added: nothing has been added.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }),
    ).toBeInTheDocument();
    expect(
      card(container, "f1").queryByRole("button", { name: c.turnIntoEvalCaseAdded }),
    ).not.toBeInTheDocument();
    // The set endpoint was never touched.
    expect(postsTo("/eval/cases")).toHaveLength(1);
  });

  it("marks the card added only once the editor saves the case", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/eval/cases/drafts")
          ? res(200, DRAFT)
          : res(201, { id: "case-1", owner_id: "ag1" }),
      ),
    );

    const container = renderDecided();
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }));
    const dialog = within(await screen.findByRole("dialog"));

    fireEvent.click(dialog.getByRole("button", { name: evalMessages.caseEditor.save }));

    expect(
      await card(container, "f1").findByRole("button", { name: c.turnIntoEvalCaseAdded }),
    ).toBeInTheDocument();
    // The editor closes, and the OTHER card is still offered — one save marks one
    // finding.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      card(container, "f2").getByRole("button", { name: c.turnIntoEvalCase }),
    ).toBeInTheDocument();
    // Exactly two requests: derive, then file. Nothing in between.
    expect(postsTo("/eval/cases/drafts")).toHaveLength(1);
    expect(postsTo("/eval/cases").filter((call) => !call[0].includes("drafts"))).toHaveLength(1);
  });

  it("leaves the finding unmarked when the editor is dismissed", async () => {
    fetchMock.mockResolvedValue(res(200, DRAFT));

    const container = renderDecided();
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }));
    const dialog = within(await screen.findByRole("dialog"));

    fireEvent.click(dialog.getByRole("button", { name: evalMessages.caseDraft.cancel }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Dismissing a draft is not saving one: the control is offered again, and no
    // second request went anywhere.
    expect(
      card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it("renders the refusal on the card that asked, leaving Accept and Dismiss working", async () => {
    fetchMock.mockResolvedValue(
      res(422, { error: { code: "case_limit_reached", message: "limit" } }),
    );

    const container = renderDecided();
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }));

    // The reason is NAMED, in the catalogue's words — not a status code, and not
    // the server's own sentence. It arrives from the DRAFT request, so a finding
    // that cannot become a case says so before an editor opens on it.
    const alert = await card(container, "f1").findByRole("alert");
    expect(alert).toHaveTextContent(c.evalRefusal.case_limit_reached);
    expect(card(container, "f2").queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The load-bearing half: the refusal is about the EVAL CASE, so deciding the
    // finding is still available — and still reaches the action hook.
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.accept }));
    expect(actionMutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.dismiss }));
    expect(actionMutate).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
    // Still on screen: deciding the finding does not retract the refusal, and
    // neither decision started a second eval request.
    expect(card(container, "f1").getByRole("alert")).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it("moves the refusal with the reader, so a second press clears the first card", async () => {
    fetchMock.mockResolvedValue(res(422, { error: { code: "duplicate_source_finding" } }));

    const container = renderDecided();
    fireEvent.click(card(container, "f1").getByRole("button", { name: c.turnIntoEvalCase }));
    expect(await card(container, "f1").findByRole("alert")).toBeInTheDocument();

    fireEvent.click(card(container, "f2").getByRole("button", { name: c.turnIntoEvalCase }));
    expect(await card(container, "f2").findByRole("alert")).toBeInTheDocument();
    // One refusal on screen at a time: the state that says WHOSE request this is
    // is the same state that decides where its outcome renders.
    expect(card(container, "f1").queryByRole("alert")).not.toBeInTheDocument();
  });
});
