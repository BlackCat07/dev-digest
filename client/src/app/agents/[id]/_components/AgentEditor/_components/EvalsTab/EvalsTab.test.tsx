/* The agent editor's Evals tab, and the case editor inside it.

   Mocked at the NETWORK boundary (`fetch`) rather than at the hooks, matching
   `ContextTab.test.tsx` and `src/lib/hooks/eval.test.tsx`: the hooks under test
   here are the real ones, so a query key or a path that drifts shows up as a
   region that never leaves its skeleton instead of as a green run.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every other
   test file in `src/`. There is no shared QueryClient helper either; one is built
   inline per test, as `AgentCard.test.tsx` and `PRRow.test.tsx` each do.

   The tree reads THREE namespaces: `eval` for the tab and the editor, `prReview`
   for the one refusal a batch start can name (its nine messages live in the
   findings catalogue, because the finding card renders the same set), and
   `agents` because the shared strip above it does. Mounting with one missing does
   NOT fail — next-intl renders the key path and logs `IntlError: MISSING_MESSAGE`
   while the assertion passes — so all three are provided and every expected
   string is taken from the imported catalogue rather than retyped.

   jsdom implements no `EventSource`, so the live-progress test stubs one. The
   vendored `Skeleton` is a bare `div.skeleton` with no role or aria, so the
   loading assertions go through `container.getElementsByClassName`. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  EvalAgentCase,
  EvalBatch,
  EvalBatchCaseResult,
  EvalBatchTrendPoint,
  EvalDashboardRow,
} from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { EvalsTab } from "./EvalsTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

const trend = (
  batchId: string,
  version: number,
  recall: number | null,
  precision: number | null,
  citation: number | null,
): EvalBatchTrendPoint => ({
  batch_id: batchId,
  started_at: "2026-08-19T10:00:00.000Z",
  agent_version: version,
  recall,
  precision,
  citation_accuracy: citation,
  pass_rate: null,
  cost_usd: null,
});

/**
 * The dashboard row: 17 of 20 covered cases passed in batch `b2`, whose recall
 * rose four points and whose precision fell four against `b1`.
 */
const ROW: EvalDashboardRow = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  model: "gpt-4.1",
  cases_total: 4,
  last_batch: {
    batch_id: "b2",
    agent_version: 3,
    started_at: "2026-08-20T10:00:00.000Z",
    cases_covered: 20,
    cases_passed: 17,
    recall: 0.82,
    precision: 0.9,
    citation_accuracy: 0.75,
  },
  trend: [trend("b1", 2, 0.78, 0.94, 0.75), trend("b2", 3, 0.82, 0.9, 0.75)],
  alert: null,
};

const evalCase = (over: Partial<EvalAgentCase> & { id: string; name: string }): EvalAgentCase => ({
  owner_kind: "agent",
  owner_id: "ag1",
  input_diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,4 @@\n+const x = 1;\n",
  input_files: [{ path: "src/a.ts", additions: 1 }],
  input_meta: { title: "Add x", body: "why" },
  expected_output: { findings: [] },
  notes: null,
  expectation: "must_find",
  expected_anchors: [{ file: "src/a.ts", low_line: 2, high_line: 8 }],
  source_finding_id: "f1",
  // Snapshotted from the source finding; the row renders them as its chip.
  source_severity: "CRITICAL",
  source_category: "security",
  edited: false,
  last_execution: null,
  ...over,
});

/** One of each row state the tab has to tell apart. */
const CASES: EvalAgentCase[] = [
  evalCase({
    id: "c1",
    name: "alpha-passing",
    last_execution: {
      outcome: "passed",
      not_run_reason: null,
      expected_count: 1,
      actual_count: 2,
    },
  }),
  evalCase({
    id: "c2",
    name: "beta-failing",
    last_execution: {
      outcome: "failed",
      not_run_reason: null,
      expected_count: 1,
      actual_count: 0,
    },
  }),
  evalCase({
    id: "c3",
    name: "gamma-timeout",
    last_execution: {
      outcome: "not_run",
      not_run_reason: "deadline",
      expected_count: 1,
      actual_count: null,
    },
  }),
  // Negative, and never executed — two distinct states on one row.
  evalCase({ id: "c4", name: "delta-negative", expectation: "must_not_flag" }),
];

const BATCH: EvalBatch = {
  id: "b2",
  workspace_id: "ws1",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  agent_version: 3,
  system_prompt_snapshot: "You are a security reviewer.",
  model_snapshot: "gpt-4.1",
  status: "complete",
  label: null,
  started_at: "2026-08-20T10:00:00.000Z",
  finished_at: "2026-08-20T10:04:00.000Z",
  cases_covered: 20,
  cases_passed: 17,
  recall: 0.82,
  precision: 0.9,
  citation_accuracy: 0.75,
  cost_usd: 0.0051,
  error: null,
};

const C1_RESULT: EvalBatchCaseResult = {
  case_id: "c1",
  case_name: "alpha-passing",
  outcome: "passed",
  not_run_reason: null,
  expected_count: 1,
  actual_count: 2,
  kept_count: 2,
  dropped_count: 0,
  duration_ms: 1840,
  cost_usd: 0.0013,
};

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

/**
 * The plural-`other` branch of an ICU message, with `#` filled in.
 *
 * `msg` above cannot render an ICU plural, and retyping the English would fork
 * the copy this file is careful not to fork — so the branch is read out of the
 * catalogue instead.
 */
const plural = (template: string, count: number) =>
  (/other \{([^}]*)\}/.exec(template)?.[1] ?? template).replace("#", String(count));

// ---------------------------------------------------------------------------
// A fake EventSource. jsdom has none, so a component that subscribes to one
// throws a ReferenceError inside its effect and takes the whole tree down.
// ---------------------------------------------------------------------------
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, EventListener>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(kind: string, fn: EventListener) {
    this.listeners.set(kind, fn);
  }
  close() {
    this.closed = true;
  }
  /** Deliver one frame the way the run bus tags it: `event: <kind>`. */
  emit(kind: string, payload: unknown) {
    const ev = { data: JSON.stringify(payload) } as MessageEvent;
    const fn = this.listeners.get(kind);
    if (fn) fn(ev as unknown as Event);
    else this.onmessage?.(ev);
  }
}

const resultFrame = (seq: number) => ({
  runId: "b3",
  seq,
  kind: "result",
  msg: "case done",
  t: "00.0" + seq,
});

// ---------------------------------------------------------------------------

type Route = { status: number; body: unknown } | "pending";

let routes: Map<string, Route>;
let posts: { path: string; body: unknown }[];
let puts: { path: string; body: unknown }[];
const fetchMock = vi.fn();
let qc: QueryClient;

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as
    unknown as Response;

/** The three reads the tab makes on mount, plus the batch read the editor makes. */
const okRoutes = (): Map<string, Route> =>
  new Map<string, Route>([
    ["/eval/agents/ag1/dashboard?period=30d", { status: 200, body: ROW }],
    ["/eval/agents/ag1/cases", { status: 200, body: CASES }],
    ["/eval/agents/ag1/batches?period=30d", { status: 200, body: [BATCH] }],
    ["/eval/batches/b2", { status: 200, body: { batch: BATCH, cases: [C1_RESULT] } }],
  ]);

beforeEach(() => {
  routes = okRoutes();
  posts = [];
  puts = [];
  FakeEventSource.instances = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "POST") {
      posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      const route = routes.get(`POST ${path}`);
      if (route && route !== "pending") return jsonRes(route.status, route.body);
      return jsonRes(200, { ...BATCH, id: "b3", status: "running" });
    }
    if (init?.method === "PUT") {
      puts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      return jsonRes(200, CASES[0]);
    }
    const route = routes.get(path);
    // A route registered as `pending` never resolves — that is how the loading
    // state is held open long enough to assert.
    if (route === "pending") return new Promise<Response>(() => {});
    if (route) return jsonRes(route.status, route.body);
    return jsonRes(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  qc.clear();
  vi.unstubAllGlobals();
});

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ eval: evalMessages, prReview: prReviewMessages, agents: agentsMessages }}
      >
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** The `<li>` for a given case name. */
const rowFor = (name: string) =>
  screen.getAllByRole("listitem").find((li) => within(li).queryByText(name))!;

describe("AgentEditor — Evals tab", () => {
  it("renders four tiles, the pass ratio, changes in POINTS, and the scoring statement", async () => {
    // AC-55, AC-56, AC-57, AC-58.
    render(tree());

    // Three metric tiles, captioned as the dashboard captions them.
    expect(await screen.findByText(evalMessages.dashboard.metrics.recall)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.precision)).toBeInTheDocument();
    expect(
      screen.getByText(evalMessages.dashboard.metrics.citationAccuracy),
    ).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();

    // …and the fourth: cases passed over cases COVERED by that batch — never
    // over the set's current size, which is 4 and appears separately below.
    expect(screen.getByText(evalMessages.dashboard.metrics.casesPassed)).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
    expect(
      screen.getByText(plural(evalMessages.evalsTab.casesCount, 4)),
    ).toBeInTheDocument();

    // The pass chip beside the case list reads THE SAME pair as the tile, so the
    // two cannot disagree — it is not a count over the set's four rows.
    expect(
      screen.getByText(msg(evalMessages.evalsTab.passingBadge, { ratio: "17/20" })),
    ).toBeInTheDocument();

    // AC-56 is the one this whole file exists for: every change carries the
    // unit its value is displayed in. `82%` moved by four PERCENTAGE POINTS.
    expect(screen.getByText("+4pt")).toBeInTheDocument();
    expect(screen.getByText("-4pt")).toBeInTheDocument();
    expect(screen.getByText("0pt")).toBeInTheDocument();
    // The vendored MetricCard's own delta convention — a bare, unitless
    // `0.04` behind an arrow — must not appear anywhere on this screen.
    expect(screen.queryByText("0.04")).not.toBeInTheDocument();
    expect(screen.queryByText("-0.04")).not.toBeInTheDocument();

    // AC-57 / AC-58, both read from the catalogue rather than retyped here.
    expect(screen.getByText(evalMessages.evalsTab.mechanicalScoring)).toBeInTheDocument();
    // Exactly ONE link with this name. The dashboard link used to sit beside the
    // scoring statement as well as in the section label; two of them makes this
    // very query throw, so the count is asserted rather than assumed.
    const links = screen.getAllByRole("link", { name: evalMessages.evalsTab.dashboardLink });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/eval");
  });

  it("states each row's outcome in words, names a not-run reason, and marks a negative case", async () => {
    // AC-59, AC-60, AC-61, AC-62.
    render(tree());
    await screen.findByText("alpha-passing");

    // A passing row and a failing row are distinguishable with colour removed:
    // each carries the WORD, inside its own row.
    // `passed` / `failed` are stated ONCE, by the leading mark — a green tick
    // with the word printed beside it was the same claim twice. The mark is not
    // colour-only: the word is its accessible name, so it is asserted by NAME and
    // must NOT appear as visible text.
    expect(
      within(rowFor("alpha-passing")).getByRole("img", { name: evalMessages.evalsTab.passed }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("alpha-passing")).queryByText(evalMessages.evalsTab.passed),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor("beta-failing")).getByRole("img", { name: evalMessages.evalsTab.failed }),
    ).toBeInTheDocument();

    // `not run` says so AND names its reason — and is not the failure word.
    const timeout = rowFor("gamma-timeout");
    expect(
      within(timeout).getByText(
        msg(evalMessages.evalsTab.notRunWithReason, {
          reason: evalMessages.notRunReason.deadline,
        }),
      ),
    ).toBeInTheDocument();
    expect(within(timeout).queryByText(evalMessages.evalsTab.failed)).not.toBeInTheDocument();
    expect(
      within(timeout).queryByRole("img", { name: evalMessages.evalsTab.failed }),
    ).not.toBeInTheDocument();

    // Never executed is a third state again, distinct from `not run`.
    const negative = rowFor("delta-negative");
    expect(within(negative).getByText(evalMessages.evalsTab.neverRun)).toBeInTheDocument();
    expect(within(negative).queryByText(evalMessages.evalsTab.notRun)).not.toBeInTheDocument();

    // The expectation badge, and `assert empty` beside the counts on line two.
    expect(within(negative).getByText(evalMessages.expectation.mustNotFlag)).toBeInTheDocument();
    expect(within(negative).getByText(evalMessages.expectation.assertEmpty)).toBeInTheDocument();
    expect(screen.getAllByText(evalMessages.expectation.mustFind)).toHaveLength(3);

    // The source finding's severity and category, snapshotted onto the case and
    // rendered by the vendored primitives — CRITICAL carries its own word, so
    // the chip is never colour alone. `SEV` is keyed on the uppercase value and
    // its label is title case, which is why this reads `Critical`.
    expect(within(negative).getByText("Critical")).toBeInTheDocument();
    expect(within(negative).getByText("security")).toBeInTheDocument();

    // Expected and actual counts, per row.
    expect(
      within(rowFor("beta-failing")).getByText(
        msg(msg(evalMessages.evalsTab.counts, { expected: 1 }), { actual: 0 }),
      ),
    ).toBeInTheDocument();

    // Per-row run, edit and delete controls, each named for its case. Asserted
    // by accessible name and never by counting buttons — `MonoLink` and friends
    // render <button> too, so a count is a trap.
    for (const key of ["runRow", "editRow", "deleteRow"] as const) {
      expect(
        within(negative).getByRole("button", {
          name: msg(evalMessages.evalsTab[key], { name: "delta-negative" }),
        }),
      ).toBeInTheDocument();
    }
  });

  it("gives a zero-case agent the empty state that names the accept-or-dismiss step", async () => {
    // AC-63, and the run-all control's precondition with it.
    routes.set("/eval/agents/ag1/cases", { status: 200, body: [] });
    render(tree());

    expect(await screen.findByText(evalMessages.evalsTab.emptyCasesTitle)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.evalsTab.emptyCasesBody)).toBeInTheDocument();

    const runAll = screen.getByRole("button", {
      name: evalMessages.evalsTab.runAllDisabledNoCases,
    });
    expect(runAll).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(runAll);
    expect(posts).toHaveLength(0);
  });

  it("shows skeletons shaped like the tiles and rows that are coming", async () => {
    // AC-80. The vendored Skeleton has no role or aria, so it is found by class.
    routes.set("/eval/agents/ag1/dashboard?period=30d", "pending");
    routes.set("/eval/agents/ag1/cases", "pending");
    const { container } = render(tree());

    await waitFor(() =>
      // Four tiles plus three rows — the shapes, not a spinner.
      expect(container.getElementsByClassName("skeleton")).toHaveLength(7),
    );
    expect(screen.queryByText("alpha-passing")).not.toBeInTheDocument();
  });

  it("renders a failed read as an error next to the region that failed", async () => {
    // AC-81: the metrics read fails, the case list does not, and the list stays.
    routes.set("/eval/agents/ag1/dashboard?period=30d", {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    });
    render(tree());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(evalMessages.dashboard.error)).toBeInTheDocument();
    // The other region is unaffected — the failure is scoped to its own.
    expect(await screen.findByText("alpha-passing")).toBeInTheDocument();
    expect(screen.queryByText("17/20")).not.toBeInTheDocument();
  });

  it("replaces the run-all control with live progress that advances as events arrive", async () => {
    // AC-64. The batch history reports one `running` batch, so the tab is in the
    // state a click would have produced without depending on the mutation.
    routes.set("/eval/agents/ag1/batches?period=30d", {
      status: 200,
      body: [{ ...BATCH, id: "b3", status: "running" }],
    });
    render(tree());

    expect(
      await screen.findByText(msg(msg(evalMessages.evalsTab.progress, { done: 0 }), { total: 4 })),
    ).toBeInTheDocument();
    // The enabled run-all control is gone while the batch runs.
    expect(screen.queryByRole("button", { name: evalMessages.evalsTab.runAll })).not.toBeInTheDocument();

    const stream = FakeEventSource.instances.at(-1)!;
    expect(stream.url).toContain("/eval/batches/b3/events");

    // Two cases reach an outcome. The heartbeat in between must not count as
    // one: it measured nothing, which is the whole point of a heartbeat.
    act(() => {
      stream.emit("result", resultFrame(1));
      stream.emit("info", { runId: "b3", seq: 2, kind: "info", msg: "heartbeat", t: "00.15" });
      stream.emit("result", resultFrame(3));
    });

    expect(
      await screen.findByText(msg(msg(evalMessages.evalsTab.progress, { done: 2 }), { total: 4 })),
    ).toBeInTheDocument();
  });

  it("opens a case, flips to invalid JSON on a trailing comma, and closes Save and Run", async () => {
    // AC-65, AC-66, AC-68.
    render(tree());
    await screen.findByText("alpha-passing");

    fireEvent.click(
      within(rowFor("alpha-passing")).getByRole("button", {
        name: msg(evalMessages.evalsTab.editRow, { name: "alpha-passing" }),
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(msg(evalMessages.caseEditor.caseTitle, { name: "alpha-passing" })),
    ).toBeInTheDocument();

    // AC-65 — the Input strip carries all three tabs.
    for (const label of [
      evalMessages.caseEditor.tabs.diff,
      evalMessages.caseEditor.tabs.files,
      evalMessages.caseEditor.tabs.prMeta,
    ]) {
      expect(within(dialog).getByRole("button", { name: label })).toBeInTheDocument();
    }

    // AC-68 — the last-run strip states the outcome, both counts, the duration
    // and the cost. The duration and the cost live only on the BATCH's per-case
    // row, so they arrive with that read rather than with the case list.
    expect(within(dialog).getByText(evalMessages.caseEditor.lastRunPassed)).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        msg(
          msg(msg(msg(evalMessages.caseEditor.lastRunSummary, { expected: 1 }), { actual: 2 }), {
            duration: "1.8s",
          }),
          { cost: "$0.0013" },
        ),
      ),
    ).toBeInTheDocument();

    // Valid to start with: the badge says so and both controls carry their plain
    // names rather than a precondition.
    expect(within(dialog).getByText(evalMessages.caseEditor.validJson)).toBeInTheDocument();
    const expectedRegion = within(dialog).getByRole("region", {
      name: evalMessages.caseEditor.expectedOutput,
    });
    const editor = within(expectedRegion).getByRole("textbox");

    fireEvent.change(editor, { target: { value: '{"findings": [],}' } });

    // AC-66 — one trailing comma closes the gate, and both controls now say why.
    expect(within(dialog).getByText(evalMessages.caseEditor.invalidJson)).toBeInTheDocument();
    expect(within(dialog).queryByText(evalMessages.caseEditor.validJson)).not.toBeInTheDocument();

    const save = within(dialog).getByRole("button", {
      name: evalMessages.caseEditor.saveDisabledInvalidJson,
    });
    const run = within(dialog).getByRole("button", {
      name: evalMessages.caseEditor.runDisabledInvalidJson,
    });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(save);
    fireEvent.click(run);
    expect(puts).toHaveLength(0);
    expect(posts).toHaveLength(0);

    // Made valid again, the save sends the whole body — name, diff, expectation,
    // anchors and expected output. A save that dropped one would answer 200 and
    // close over a case that never took the edit.
    fireEvent.change(editor, { target: { value: '{"findings":[]}' } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: evalMessages.caseEditor.save }),
    );
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      path: "/eval/cases/c1",
      body: {
        name: "alpha-passing",
        input_diff: CASES[0]!.input_diff,
        expectation: "must_find",
        expected_anchors: [{ file: "src/a.ts", low_line: 2, high_line: 8 }],
        expected_output: { findings: [] },
      },
    });
  });

  it("presents a must_not_flag case as negative — a leading banner and a relabelled column", async () => {
    // AC-67.
    render(tree());
    await screen.findByText("delta-negative");

    fireEvent.click(
      within(rowFor("delta-negative")).getByRole("button", {
        name: msg(evalMessages.evalsTab.editRow, { name: "delta-negative" }),
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        msg(
          msg(msg(evalMessages.caseEditor.negativeBanner, { file: "src/a.ts" }), { low: 2 }),
          { high: 8 },
        ),
      ),
    ).toBeInTheDocument();

    // The expected-output column says what the JSON beside it ASSERTS, which is
    // the opposite of what the same JSON means on a positive case.
    expect(
      within(dialog).getByRole("region", {
        name: evalMessages.caseEditor.negativeExpectedOutputLabel,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("region", { name: evalMessages.caseEditor.expectedOutput }),
    ).not.toBeInTheDocument();

    // Never executed, so there is no last-run strip to state anything about.
    expect(
      within(dialog).queryByText(evalMessages.caseEditor.lastRunHeading),
    ).not.toBeInTheDocument();
  });
});
