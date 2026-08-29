/* MultiAgentResultsView — the multi-agent results screen.

   Mocked at the network boundary and nowhere else: the real hooks, the real
   query client, the real vendored primitives and the real (relocated) trace
   drawer all run, so a hook that stops polling, a primitive that stops being a
   radio, or a drawer that stops streaming is visible here.

   Three constraints of this package shape the file and are not preferences:

   - **`@testing-library/user-event` is not a dependency here**, and adding it
     is a `package.json` + lockfile change with the lockfile do-not-touch. All
     interaction is `fireEvent`, matching every other test file in `src/`.
   - **jsdom implements no `EventSource` and `src/test/setup.ts` does not shim
     one** (`client/INSIGHTS.md`, 2026-08-23). The drawer this screen mounts
     constructs one on purpose whenever the column is still running, so a stub
     is installed per file. Without it the failure is a `ReferenceError` INSIDE
     the effect, which takes the whole tree down and reads as a broken
     component rather than a missing global. The stub is also the evidence for
     AC-98: it counts the streams.
   - **Both namespaces the subtree reaches are supplied.** A component composing
     a shared unit legitimately reads two, and a missing one makes next-intl
     render the key path and log `IntlError: MISSING_MESSAGE` into an otherwise
     green run's stderr (`client/INSIGHTS.md`, 2026-08-11).

   The polling test uses fake timers and never `waitFor`/`findBy`:
   @testing-library/dom only detects Jest's fake timers, so under vitest's a
   `waitFor` would sit on a clock nobody advances. `flush()` advances the clock
   inside `act` instead — the same shape `src/lib/hooks/multi-agent.test.tsx`
   uses, and there as here the CALL COUNT is the honest signal, because an
   interval refetch commits its data on the render after the timer. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  AgentColumn,
  AgentColumnFinding,
  MultiAgentRun,
  PrMeta,
  Repo,
  RunTrace,
} from "@devdigest/shared";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { RepoProvider } from "@/lib/repo-context";
import { MultiAgentResultsView } from "./MultiAgentResultsView";

const push = vi.fn();
const replace = vi.fn();
let searchParams: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/repos/r1/multi-agent/482",
  useSearchParams: () => searchParams,
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// ---------------------------------------------------------------------------
// The EventSource jsdom does not have
// ---------------------------------------------------------------------------

/** Every stream the tree opened, and every one it closed, by URL. */
const streams = { opened: [] as string[], closed: [] as string[] };

class FakeEventSource {
  constructor(public url: string) {
    streams.opened.push(url);
  }
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {
    streams.closed.push(this.url);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO: Repo = {
  id: "r1",
  workspace_id: "w1",
  owner: "acme",
  name: "engine",
  full_name: "acme/engine",
  default_branch: "main",
  clone_path: "/tmp/engine",
  last_polled_at: null,
  created_by: null,
};

const PULLS: PrMeta[] = [
  {
    id: "pr-482",
    number: 482,
    title: "Add rate limiting",
    author: "octocat",
    branch: "feat/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 120,
    deletions: 8,
    files_count: 6,
    status: "needs_review",
  },
];

const agent = (id: string, name: string): Agent => ({
  id,
  name,
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You review code.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
});

const AGENTS: Agent[] = [
  agent("a1", "Security Reviewer"),
  agent("a2", "Performance Reviewer"),
  agent("a3", "Correctness Reviewer"),
  agent("a4", "Style Reviewer"),
];

const finding = (
  id: string,
  severity: AgentColumnFinding["severity"],
  category: string,
  title: string,
  file: string,
  line: number,
  confidence: number,
): AgentColumnFinding => ({
  id,
  severity,
  category,
  title,
  file,
  start_line: line,
  end_line: line + 2,
  rationale: `Why ${title.toLowerCase()} matters.`,
  suggestion: null,
  confidence,
  accepted_at: null,
  dismissed_at: null,
});

const FINDINGS: AgentColumnFinding[] = [
  finding("f1", "CRITICAL", "security", "Rate limit missing on /login", "src/routes/auth.ts", 28, 0.82),
  finding("f2", "WARNING", "perf", "N+1 query in the loader", "src/db/loader.ts", 88, 0.61),
  finding("f3", "SUGGESTION", "style", "Magic number 3600", "src/lib/cache.ts", 14, 0.4),
];

const column = (over: Partial<AgentColumn> & Pick<AgentColumn, "run_id" | "agent_id" | "agent_name" | "status">): AgentColumn => ({
  provider: "openai",
  model: "gpt-4.1",
  error: null,
  verdict: null,
  score: null,
  summary: null,
  duration_ms: null,
  cost_usd: null,
  findings: [],
  ...over,
});

/** One column of each status — the four cases the trace affordance is asserted
    on separately, because the failed one is the easiest to drop and the one
    where the log matters most. */
const COLUMNS: AgentColumn[] = [
  column({
    run_id: "run-done",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    status: "done",
    verdict: "request_changes",
    score: 82,
    summary: "Two blocking issues in the retry path.",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: FINDINGS,
  }),
  column({
    run_id: "run-running",
    agent_id: "a2",
    agent_name: "Performance Reviewer",
    status: "running",
  }),
  column({
    run_id: "run-failed",
    agent_id: "a3",
    agent_name: "Correctness Reviewer",
    status: "failed",
    summary: "Provider returned 503 after three attempts.",
    duration_ms: 1400,
    cost_usd: 0.01,
  }),
  column({
    run_id: "run-cancelled",
    agent_id: "a4",
    agent_name: "Style Reviewer",
    status: "cancelled",
    duration_ms: 900,
    cost_usd: 0,
  }),
];

const RUN: MultiAgentRun = {
  id: "ma-1",
  pr_id: "pr-482",
  pr_number: 482,
  ran_at: "2026-08-24T10:00:00.000Z",
  agent_count: 4,
  total_duration_ms: 8200,
  total_cost_usd: 0.07,
  columns: COLUMNS,
  conflicts: [],
};

/** The same multi-run with every column settled. */
const SETTLED: MultiAgentRun = {
  ...RUN,
  columns: COLUMNS.map((c) => (c.status === "running" ? { ...c, status: "done", score: 71 } : c)),
};

const TRACE: RunTrace = {
  config: { agent: "Security Reviewer", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 3, grounding: "3/3 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [],
  specs_read: [],
  log: [],
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let agents: Agent[];
let multiRun: MultiAgentRun;
/** When set, `GET /pulls/:id/multi-agent` answers with this instead. */
let multiRunError: { status: number; code: string; message: string } | null;
let fetchMock: ReturnType<typeof vi.fn>;
let qc: QueryClient;

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const jsonErr = (status: number, code: string, message: string) =>
  ({
    ok: false,
    status,
    statusText: code,
    json: async () => ({ error: { code, message } }),
  }) as unknown as Response;

/** Routes by path suffix, so `apiFetch`'s `API_BASE` prefix is irrelevant. */
function route(url: string): Response {
  if (url.endsWith("/multi-agent")) {
    return multiRunError
      ? jsonErr(multiRunError.status, multiRunError.code, multiRunError.message)
      : jsonOk(multiRun);
  }
  if (url.endsWith("/trace")) return jsonOk(TRACE);
  if (url.endsWith("/agents")) return jsonOk(agents);
  if (url.endsWith("/repos")) return jsonOk([REPO]);
  if (url.endsWith("/repos/r1/pulls")) return jsonOk(PULLS);
  return jsonOk([]);
}

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, shell: shellMessages }}>
        <RepoProvider>
          <MultiAgentResultsView repoId="r1" number="482" />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  agents = AGENTS;
  multiRun = RUN;
  multiRunError = null;
  searchParams = new URLSearchParams();
  streams.opened = [];
  streams.closed = [];
  push.mockReset();
  replace.mockReset();
  fetchMock = vi.fn(async (url: string) => route(String(url)));
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

const col = (name: string) => screen.getByRole("group", { name });
const multiAgentCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes("/multi-agent")).length;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiAgentResultsView — columns mode", () => {
  it("opens in columns mode and renders one column per agent, each with its status as a word, its cost, its findings and a footer count", async () => {
    render(tree());

    // AC-60 — a radio group of two mutually exclusive options, columns first.
    const modes = await screen.findByRole("radiogroup", { name: "View mode" });
    expect(within(modes).getByRole("radio", { name: "Columns" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(modes).getByRole("radio", { name: "Tabs" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // AC-62 — four columns, each naming its agent.
    expect(screen.getAllByRole("group")).toHaveLength(4);

    // AC-62/AC-63 — the header's figures, then three rows carrying severity,
    // category, title and file:line.
    const done = col("Security Reviewer");
    // A settled-well column carries NO status chip — the score beside it is what
    // says the run finished. The word is kept only for the statuses AC-67 and
    // AC-68 are about, asserted further down.
    expect(within(done).queryByText("Done")).toBeNull();
    expect(within(done).getByText("82")).toBeInTheDocument();
    // The head's ONE metric line: duration and cost together, mono and
    // tabular. `lib/format.ts`'s adaptive precision, the same formatter every
    // other run-cost figure in the tree uses: 3dp below a dollar, because 2dp
    // renders a real sub-cent run as a misleading "$0.00".
    expect(within(done).getByText("8.2s · $0.060")).toBeInTheDocument();
    expect(within(done).getByText("Rate limit missing on /login")).toBeInTheDocument();
    expect(within(done).getByText("src/routes/auth.ts:28")).toBeInTheDocument();
    expect(within(done).getByText("src/db/loader.ts:88")).toBeInTheDocument();
    expect(within(done).getByText("src/lib/cache.ts:14")).toBeInTheDocument();
    // AC-63/AC-88 — severity is a glyph in the severity colour, and the word
    // is its ACCESSIBLE NAME rather than visible text: colour is never the
    // sole carrier. Queried by role for that reason — `getByText` would find
    // nothing here even though the row states its severity.
    expect(within(done).getByRole("img", { name: "Critical" })).toBeInTheDocument();
    expect(within(done).getByRole("img", { name: "Warning" })).toBeInTheDocument();
    // AC-63 — every column row carries its category beside the title. The
    // reference export omits the tag in columns mode, but the criterion is
    // explicit ("carrying the severity, the category, the title and the file
    // and line") and an approved criterion outranks the export.
    expect(within(done).getByText("security")).toBeInTheDocument();
    expect(within(done).getByText("3 findings")).toBeInTheDocument();

    // AC-67 — "running" as a WORD, reachable by a text query, not a spinner.
    expect(within(col("Performance Reviewer")).getByText("Running")).toBeInTheDocument();

    // AC-68 — the failed column shows the outcome and the reason the run
    // recorded, and NO score. The gauge renders its figure as a bare number, so
    // the absence of any number-only node in that column is the assertion (the
    // metric line reads "1.4s · $0.010" and the footer "0 findings").
    const failed = col("Correctness Reviewer");
    expect(within(failed).getByText("Provider returned 503 after three attempts.")).toBeInTheDocument();
    expect(within(failed).queryByText(/^\d{1,3}$/)).toBeNull();

    // AC-19 — cancelled is its own outcome, not a failure.
    const cancelled = col("Style Reviewer");
    expect(within(cancelled).getByText("Cancelled")).toBeInTheDocument();

    // AC-69 — an empty column says so, and its footer reads 0.
    expect(within(cancelled).getByText("No findings.")).toBeInTheDocument();
    expect(within(cancelled).getByText("0 findings")).toBeInTheDocument();

    // AC-86 — the header describes the fan-out as bounded concurrency inside
    // the executor. Neither worktrees nor a job queue are involved.
    const meta = screen.getByText(/parallel fan-out, up to 4 at once/);
    expect(meta).toHaveTextContent(
      "4 agents · parallel fan-out, up to 4 at once · 8.2s total · $0.070",
    );

    // The sub-bar names the pull request, not just its number — the reference's
    // second header row carries `#482` AND the title, read from the same cached
    // pulls list that resolved the number to the uuid, so the two can never
    // describe different rows. Scoped to the sub-bar: the shell's breadcrumb
    // renders `#482` too, and an unscoped query matches both. Anchored on the
    // TITLE, which is a direct child of the sub-bar — the stats sit in their own
    // right-aligned group, so the meta text's parent is that group, not the row.
    const title = screen.getByText("Add rate limiting");
    const subBar = title.parentElement;
    expect(subBar).not.toBeNull();
    expect(within(subBar as HTMLElement).getByText("#482")).toBeInTheDocument();
    expect(within(subBar as HTMLElement).getByText(/parallel fan-out/)).toBeInTheDocument();

    // AC-66 — the view itself opened nothing; no drawer is open.
    expect(streams.opened).toEqual([]);
  });

  it("shows a failed run's own reason when the run died before writing a review row", async () => {
    // AC-68's hard case. `summary` is the REVIEWS row's summary, and a run that
    // failed on its first provider call never wrote one — so the reason has to
    // come from the run's own `error`, or the column shows the status word and
    // nothing else. The fixture is deliberately `summary: null`: with a summary
    // present the fallback would pass this test while the defect survived.
    multiRun = {
      ...RUN,
      agent_count: 1,
      columns: [
        column({
          run_id: "run-failed",
          agent_id: "a3",
          agent_name: "Correctness Reviewer",
          status: "failed",
          error: "Provider rejected the request: context length exceeded.",
          summary: null,
          duration_ms: 1400,
        }),
      ],
    };

    render(tree());

    const failed = await screen.findByRole("group", { name: "Correctness Reviewer" });
    expect(
      within(failed).getByText("Provider rejected the request: context length exceeded."),
    ).toBeInTheDocument();
    // The outcome half of AC-68 is still a word, and still not a score.
    expect(within(failed).getByText("Failed")).toBeInTheDocument();
    expect(within(failed).queryByText(/^\d{1,3}$/)).toBeNull();
  });
});

describe("MultiAgentResultsView — tabs mode", () => {
  it("carries the mode in the URL and, mounted there, renders one tab per agent with its score, no merged tab, and each finding's category and confidence", async () => {
    render(tree());

    // AC-61 — switching writes the mode into the URL.
    fireEvent.click(await screen.findByRole("radio", { name: "Tabs" }));
    expect(replace).toHaveBeenCalledWith("/repos/r1/multi-agent/482?mode=tabs");

    // ...and mounting AT that URL renders tabs. A fresh mount, because that is
    // what a reload is.
    cleanup();
    searchParams = new URLSearchParams("mode=tabs");
    render(tree());

    // AC-71 — one tab per agent, carrying the agent's name and the run's score,
    // and NO fifth merged tab.
    const firstTab = await screen.findByRole("button", { name: /^Security Reviewer/ });
    const strip = firstTab.parentElement as HTMLElement;
    const tabs = within(strip).getAllByRole("button");
    expect(tabs.map((b) => b.textContent)).toEqual([
      "Security Reviewer82",
      "Performance Reviewer",
      "Correctness Reviewer",
      "Style Reviewer",
    ]);

    // The first tab is the pane on first render.
    const pane = col("Security Reviewer");
    // AC-73 — confidence as a percentage in the collapsed row.
    expect(within(pane).getByText("82% confidence")).toBeInTheDocument();
    expect(within(pane).getByText("61% confidence")).toBeInTheDocument();
    // AC-104 — the category is on the collapsed row, from the same shared tag
    // the columns use.
    expect(within(pane).getByText("security")).toBeInTheDocument();
    expect(within(pane).getByText("perf")).toBeInTheDocument();
    expect(within(pane).getByText("3 findings")).toBeInTheDocument();

    // Switching tab switches the pane, and the switched-to column's emptiness
    // is stated rather than shown as a blank body.
    fireEvent.click(within(strip).getByRole("button", { name: /^Style Reviewer/ }));
    const styled = col("Style Reviewer");
    expect(within(styled).getByText("No findings.")).toBeInTheDocument();
    expect(within(styled).getByText("0 findings")).toBeInTheDocument();
  });
});

describe("MultiAgentResultsView — polling", () => {
  it("re-reads while a column is non-terminal, renders the same columns after a reload mid-run, and stops once the last one settles", async () => {
    vi.useFakeTimers();
    const flush = (ms = 0) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    render(tree());
    await flush();
    await flush();

    // AC-70 — mounted mid-run, the payload's two settled and two unsettled
    // columns all render, and polling resumes.
    expect(screen.getAllByRole("group")).toHaveLength(4);
    const first = multiAgentCalls();
    expect(first).toBeGreaterThan(0);

    // AC-65 — one column is `running`, so the interval is live.
    await flush(2000);
    expect(multiAgentCalls()).toBe(first + 1);

    // The read in which the last column settles. The refetch fires on the timer
    // and commits on the NEXT render, so the count is asserted here and the
    // rendered status one flush later.
    multiRun = SETTLED;
    await flush(2000);
    expect(multiAgentCalls()).toBe(first + 2);
    await flush(1);
    // Settled: the running word is gone and the score has arrived. Asserting the
    // ABSENCE of "Running" is what this test is really about — the poll stops
    // when the last column leaves a non-terminal status.
    expect(within(col("Performance Reviewer")).queryByText("Running")).toBeNull();

    // Five poll windows later, unmoved: a settled multi-run generates no
    // traffic at all.
    await flush(10_000);
    expect(multiAgentCalls()).toBe(first + 2);

    vi.useRealTimers();
  });
});

describe("MultiAgentResultsView — the trace drawer", () => {
  it("offers the trace on a running, a done, a failed and a cancelled column, and writes that column's run id into ?trace=", async () => {
    render(tree());
    await screen.findByRole("radiogroup", { name: "View mode" });

    // AC-94 — four statuses, asserted separately. The affordance is scoped by
    // the column's group name, because four identical controls are on screen.
    const cases: [string, string][] = [
      ["Security Reviewer", "run-done"],
      ["Performance Reviewer", "run-running"],
      ["Correctness Reviewer", "run-failed"],
      ["Style Reviewer", "run-cancelled"],
    ];
    for (const [name, runId] of cases) {
      replace.mockReset();
      fireEvent.click(within(col(name)).getByRole("button", { name: "View trace" }));
      expect(replace).toHaveBeenCalledWith(`/repos/r1/multi-agent/482?trace=${runId}`);
    }
  });

  it("opens the drawer for a settled column with no stream, and for a running column with exactly one", async () => {
    searchParams = new URLSearchParams("trace=run-done");
    render(tree());

    // AC-96 — a terminal column's drawer opens on the trace tab, so nothing
    // streams. That is also AC-98's "none when no stream is wanted".
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Security Reviewer/)).toBeInTheDocument();
    expect(streams.opened).toEqual([]);
    // AC-64 — the drawer is handed that column's findings, not an empty list.
    await waitFor(() =>
      expect(within(dialog).getByText("Rate limit missing on /login")).toBeInTheDocument(),
    );

    // AC-93 — closing clears the param rather than holding the open state in
    // React, so Back reopens the drawer and a copied link still carries it.
    replace.mockReset();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(replace).toHaveBeenCalledWith("/repos/r1/multi-agent/482");

    // AC-95 / AC-98 — a non-terminal column's drawer streams, exactly once.
    cleanup();
    streams.opened = [];
    searchParams = new URLSearchParams("trace=run-running");
    render(tree());
    await screen.findByRole("dialog");
    await waitFor(() => expect(streams.opened).toHaveLength(1));
    expect(streams.opened[0]).toContain("/runs/run-running/events");
  });

  it("treats a ?trace= naming a run of no column as absent rather than as an error", async () => {
    searchParams = new URLSearchParams("trace=run-from-another-pull-request");
    render(tree());

    // The screen still renders; only the drawer is missing.
    await screen.findByRole("radiogroup", { name: "View mode" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(streams.opened).toEqual([]);
  });
});

describe("MultiAgentResultsView — empty and error states", () => {
  it("renders the no-run empty state with an action that starts one when the pull request has never been fanned out", async () => {
    multiRunError = { status: 404, code: "not_found", message: "no multi-agent run for this pull request" };
    render(tree());

    // AC-83 — a 404 is a routine answer, not a failure. The branch is on the
    // error CODE: a view testing `data == null` alone would land here on every
    // error there is.
    expect(await screen.findByText("No multi-agent run yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose agents to run" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent");
  });

  it("renders the no-agents empty state, with a link to the agents screen, when the workspace has no agents", async () => {
    agents = [];
    multiRunError = { status: 404, code: "not_found", message: "no multi-agent run for this pull request" };
    render(tree());

    // AC-84 — and it takes precedence over the no-run state: offering "choose
    // agents to run" would send the reader to a screen with nothing to choose.
    expect(await screen.findByText("Enable agents to run reviews")).toBeInTheDocument();
    expect(screen.queryByText("No multi-agent run yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("renders the error state, not the empty state, for any error that is not a not_found", async () => {
    multiRunError = { status: 500, code: "internal_error", message: "the read blew up" };
    render(tree());

    // AC-83's other half. `ErrorState` is the design system's `role="alert"`.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("the read blew up")).toBeInTheDocument();
    expect(screen.queryByText("No multi-agent run yet")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
