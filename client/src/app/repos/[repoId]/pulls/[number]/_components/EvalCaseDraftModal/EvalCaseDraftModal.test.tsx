import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCaseDraft } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import { EvalCaseDraftModal } from "./EvalCaseDraftModal";

/**
 * The modal `Turn into eval case` opens, over a case that does not exist.
 *
 * Most of what matters here is a NEGATIVE claim — pressing `Run case` must add
 * nothing to the agent's eval set — and no rendered label can express that. So
 * `fetch` is stubbed as a URL router and the assertions are on WHICH endpoints
 * were reached: `/trial-runs` writes nothing, `/eval/cases` files the case, and
 * `/batches` records a run against the agent's dashboard. A test that only read
 * the run strip would pass against a version that opened a batch per press.
 *
 * `fetch` rather than a module mock, for the reason `FindingsPanel.test.tsx`
 * gives: the refusal arrives as an `ApiError` built from the response envelope,
 * so the path worth exercising starts at the response.
 */

const DRAFT: EvalCaseDraft = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  name: "src/config.ts:12-12",
  input_diff: [
    "--- a/src/config.ts",
    "+++ b/src/config.ts",
    "@@ -10,6 +10,7 @@",
    " export const config = {",
    '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
    "-  legacyKey: null,",
    "};",
  ].join("\n"),
  input_files: [{ path: "src/config.ts" }],
  input_meta: { repo: "acme/api", pr_number: 311, pr_title: "Add Stripe", review_id: "r1" },
  expectation: "must_find",
  expected_anchors: [{ file: "src/config.ts", low_line: 12, high_line: 12 }],
  expected_output: [
    {
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key in commit",
      file: "src/config.ts",
      start_line: 12,
    },
  ],
  source: {
    finding_id: "f1",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    low_line: 12,
    high_line: 12,
    severity: "CRITICAL",
    category: "security",
    decision: "accepted",
  },
};

const c = messages.caseEditor;
const d = messages.caseDraft;

const trialResult = (over: Record<string, unknown> = {}) => ({
  outcome: "passed",
  not_run_reason: null,
  expected_count: 1,
  actual_count: 1,
  kept_count: 1,
  dropped_count: 0,
  duration_ms: 1840,
  cost_usd: 0.02,
  actual_output: { findings: [] },
  ...over,
});

/** `apiFetch` reads only `ok`, `status`, `statusText` and `json()`. */
const res = (status: number, body: unknown) =>
  ({ ok: status < 400, status, statusText: "", json: async () => body }) as unknown as Response;

const fetchMock = vi.fn();
const calls = () =>
  (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
    (call) => call[1]?.method === "POST",
  );
const callsTo = (fragment: string) => calls().filter((call) => call[0].includes(fragment));

function renderModal(overrides: Partial<React.ComponentProps<typeof EvalCaseDraftModal>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalCaseDraftModal draft={DRAFT} onClose={onClose} onSaved={onSaved} {...overrides} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onSaved };
}

const runCase = () => screen.getByRole("button", { name: c.runCase });
const save = () => screen.getByRole("button", { name: c.save });
/** `Save` while the JSON gate is closed: its accessible name IS the reason. */
const blockedSave = () => screen.getByRole("button", { name: c.saveDisabledInvalidJson });
/** The footer's own close, not the dialog chrome's — both are labelled "Close". */
const footerClose = () => screen.getAllByRole("button", { name: c.close }).at(-1)!;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EvalCaseDraftModal — what it states before anything is saved", () => {
  it("names the assertion, the agent it would land on, and seeds the expected output", () => {
    const { container } = renderModal();

    // The direction of the case, in words: a reader who misses it reads every
    // count below backwards.
    expect(screen.getByText(d.positiveCase)).toBeInTheDocument();
    expect(
      screen.getByText(/MUST find “Hardcoded Stripe secret key in commit” at src\/config\.ts:12/),
    ).toBeInTheDocument();
    // Where it WOULD go — stated because nothing has gone anywhere yet.
    expect(screen.getByText("Saves to Security Reviewer")).toBeInTheDocument();
    // The skeleton is prefilled, so the reader checks an assertion instead of
    // inventing one.
    expect(container.querySelector("textarea")!.value).toContain(
      '"title": "Hardcoded Stripe secret key in commit"',
    );
    expect(screen.getByText(c.validJson)).toBeInTheDocument();
    expect(screen.getByText(d.notRunYet)).toBeInTheDocument();
  });

  it("renders the diff’s file headers as context, not as an addition and a deletion", () => {
    // `+++`/`---` open every unified diff, and a naive startsWith("+") paints
    // the header green and red before a single real change.
    const { container } = renderModal();
    const rows = Array.from(container.querySelectorAll("pre div"));
    const header = rows.find((r) => r.textContent === "+++ b/src/config.ts")!;
    const added = rows.find((r) => r.textContent?.includes("sk_live_"))!;
    expect(header.getAttribute("style")).toContain("transparent");
    expect(added.getAttribute("style")).toContain("--code-add");
  });

  it("restores the seeded skeleton after the assertion is edited away", () => {
    const { container } = renderModal();
    const box = container.querySelector("textarea")!;

    fireEvent.change(box, { target: { value: "[]" } });
    expect(box.value).toBe("[]");

    fireEvent.click(screen.getByRole("button", { name: d.findingSkeleton }));
    expect(box.value).toContain('"start_line": 12');
  });
});

describe("EvalCaseDraftModal — running the draft without saving it", () => {
  it("runs on every press, tallies the outcomes, and files NOTHING", async () => {
    // The whole point of the control: a case that passes twice out of three will
    // flake in every batch it appears in, and one green banner hides that.
    const answers = [trialResult(), trialResult({ outcome: "failed", actual_count: 0 })];
    let i = 0;
    fetchMock.mockImplementation(() => Promise.resolve(res(200, answers[i++] ?? trialResult())));

    renderModal();

    fireEvent.click(runCase());
    expect(await screen.findByText(c.lastRunPassed)).toBeInTheDocument();
    // The figures the design states, from the response and not recomputed.
    expect(screen.getByText(/expected 1, got 1 · 1\.8s · \$0\.02/)).toBeInTheDocument();

    fireEvent.click(runCase());
    expect(await screen.findByText(c.lastRunFailed)).toBeInTheDocument();
    expect(screen.getByText("2 runs · 1 passed")).toBeInTheDocument();
    // Two runs that disagree is the answer the reader came for, so the hint is
    // on screen rather than only before the first run.
    expect(screen.getByText(d.reproHint)).toBeInTheDocument();

    // Two trial runs, and NOTHING else: no case filed, no batch opened.
    expect(callsTo("/trial-runs")).toHaveLength(2);
    expect(callsTo("/eval/cases")).toHaveLength(0);
    expect(callsTo("/batches")).toHaveLength(0);
  });

  it("sends the draft’s own diff and anchors, so what is run is what gets saved", async () => {
    fetchMock.mockResolvedValue(res(200, trialResult()));
    renderModal();

    fireEvent.click(runCase());
    await screen.findByText(c.lastRunPassed);

    const body = JSON.parse(String(callsTo("/trial-runs")[0]![1]!.body));
    expect(body.input_diff).toBe(DRAFT.input_diff);
    expect(body.expectation).toBe("must_find");
    expect(body.expected_anchors).toEqual(DRAFT.expected_anchors);
  });

  it("states a refusal without closing anything, and stays runnable", async () => {
    fetchMock.mockResolvedValue(
      res(422, { error: { code: "diff_too_large", message: "that diff is too large" } }),
    );
    const { onSaved } = renderModal();

    fireEvent.click(runCase());
    expect(await screen.findByRole("alert")).toHaveTextContent("that diff is too large");
    // A failed run is not a failed case: nothing was saved and nothing closed.
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps Run case working when the expected output is not valid JSON", async () => {
    // The gate is about what will be STORED. A run is scored on the expectation
    // and the anchors, so a trailing comma has nothing to do with whether the
    // finding reproduces — and refusing to answer that would be the wrong
    // reading of one badge.
    fetchMock.mockResolvedValue(res(200, trialResult()));
    const { container } = renderModal();
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "[{,}]" } });

    expect(screen.getByText(c.invalidJson)).toBeInTheDocument();
    expect(blockedSave()).toHaveAttribute("aria-disabled", "true");
    expect(runCase()).not.toHaveAttribute("aria-disabled");

    fireEvent.click(runCase());
    expect(await screen.findByText(c.lastRunPassed)).toBeInTheDocument();
  });

  it("refuses to save while the expected output is not valid JSON", () => {
    const { container, onSaved } = renderModal();
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "[{,}]" } });

    fireEvent.click(blockedSave());
    // `aria-disabled` keeps the control reachable and announced; the handler is
    // what enforces the precondition, so a press must still do nothing.
    expect(calls()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("EvalCaseDraftModal — saving", () => {
  it("files the edited case and hands the created row back", async () => {
    fetchMock.mockResolvedValue(res(201, { id: "case-1", owner_id: "ag1" }));
    const { container, onSaved } = renderModal();

    fireEvent.change(screen.getByLabelText(c.nameLabel), {
      target: { value: "stripe-key-leak" },
    });
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "[]" } });
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "case-1", owner_id: "ag1" }));
    const body = JSON.parse(String(callsTo("/eval/cases")[0]![1]!.body));
    expect(body).toEqual({
      finding_id: "f1",
      name: "stripe-key-leak",
      input_diff: DRAFT.input_diff,
      expected_output: [],
    });
    // `Run on save` is off by default, so no recorded batch was started.
    expect(callsTo("/batches")).toHaveLength(0);
  });

  it("starts a recorded batch only when Run on save is switched on", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/batches")
          ? res(202, { id: "batch-1", status: "running" })
          : res(201, { id: "case-1", owner_id: "ag1" }),
      ),
    );
    const { onSaved } = renderModal();

    // The toggle is a control, not a label: it is what turns a saved case into
    // one recorded run against the agent's dashboard.
    fireEvent.click(within(screen.getByText(d.runOnSave).closest("label")!).getByRole("switch"));
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(callsTo("/eval/cases")).toHaveLength(1);
    expect(callsTo("/eval/agents/ag1/batches")).toHaveLength(1);
    expect(JSON.parse(String(callsTo("/batches")[0]![1]!.body))).toEqual({ case_id: "case-1" });
  });

  it("keeps the modal open — and does not lose the save — when that batch is refused", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/batches")
          ? res(422, { error: { code: "batch_already_running", message: "one is running" } })
          : res(201, { id: "case-1", owner_id: "ag1" }),
      ),
    );
    const { onSaved } = renderModal();

    fireEvent.click(within(screen.getByText(d.runOnSave).closest("label")!).getByRole("switch"));
    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("one is running");
    // The case IS saved, so the modal must not offer to save it again — and the
    // way out now closes through `onSaved`, because the finding really was added.
    expect(save()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(footerClose());
    expect(onSaved).toHaveBeenCalledWith({ id: "case-1", owner_id: "ag1" });
  });

  it("dismisses without saving on Cancel and on Escape", () => {
    const { onClose, onSaved } = renderModal();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: d.cancel }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(calls()).toHaveLength(0);
  });
});
