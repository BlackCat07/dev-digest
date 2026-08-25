/* DisagreementBlock — the locations the agents did not all agree on.

   Two halves, deliberately:

   - The block on its own, with only an i18n provider around it. Every rule
     about WHICH groups render and WHAT a cell says is a function of the
     server's `conflicts` array, so nothing here needs a network, a query client
     or a timer.
   - One mount of the whole results view, in each mode, because "below the
     results in BOTH modes, from one mount point" (AC-77) is a claim about the
     view and cannot be observed from inside the block.

   Three constraints of this package shape the file and are not preferences:

   - **`@testing-library/user-event` is not a dependency here**, and adding it
     is a `package.json` + lockfile change with the lockfile do-not-touch. All
     interaction is `fireEvent`, matching every other test file in `src/`
     (`client/INSIGHTS.md`, 2026-08-10).
   - **There is no shared QueryClient test helper** — the view half builds one
     inline, as `AgentCard.test.tsx` and `PRRow.test.tsx` do.
   - **Every namespace the subtree reaches is supplied.** A missing one makes
     next-intl render the key path and log `IntlError: MISSING_MESSAGE` into an
     otherwise green run's stderr (`client/INSIGHTS.md`, 2026-08-11).

   The view half keeps every column terminal and opens no drawer, so no timer
   runs and nothing constructs an `EventSource` — jsdom has none and
   `src/test/setup.ts` does not shim one (`client/INSIGHTS.md`, 2026-08-23).

   **No test here pins the ORDER of two groups across a synthesis boundary**
   (EC-32). A group's title is the deterministic fallback until note synthesis
   lands and a short synthesised label afterwards, and groups sharing a file and
   a line are ordered by title — so the visible order can legitimately shift
   once, mid-poll. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  AgentColumn,
  Conflict,
  ConflictTake,
  MultiAgentRun,
  PrMeta,
  Repo,
} from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../messages/en/runs.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import { RepoProvider } from "@/lib/repo-context";
import { MultiAgentResultsView } from "../../MultiAgentResultsView";
import { DisagreementBlock } from "./DisagreementBlock";

// ---------------------------------------------------------------------------
// Fixtures — the three shapes the filter has to tell apart
// ---------------------------------------------------------------------------

const take = (
  agentId: string,
  persona: string,
  verdict: ConflictTake["verdict"],
  note = "",
): ConflictTake => ({ agent_id: agentId, persona, verdict, note });

/** One WARNING and three `ignored` — ONE flagger. The common shape, and the one
    `Show only conflicts` removes. */
const ONE_FLAGGER: Conflict = {
  file: "src/lib/rate-limit.ts",
  line: 28,
  title: "Rate limit window never resets",
  takes: [
    take("a1", "Security Reviewer", "WARNING", "Flags the window as fixed rather than sliding."),
    take("a2", "Performance Reviewer", "ignored", "Looked at the file and raised nothing here."),
    take("a3", "Correctness Reviewer", "ignored"),
    take("a4", "Style Reviewer", "ignored"),
  ],
};

/** One WARNING, one SUGGESTION and two `ignored` — TWO flaggers, of different
    severities. Stays. */
const TWO_FLAGGERS_MIXED: Conflict = {
  file: "src/db/loader.ts",
  line: 88,
  title: "Loader issues one query per row",
  takes: [
    take("a1", "Security Reviewer", "WARNING", "Treats it as a denial-of-service surface."),
    take("a2", "Performance Reviewer", "SUGGESTION", "Calls it a batching opportunity."),
    take("a3", "Correctness Reviewer", "ignored"),
    take("a4", "Style Reviewer", "ignored"),
  ],
};

/** Two WARNINGs and two `ignored` — TWO flaggers agreeing on the severity. Also
    stays: the filter counts flaggers, not distinct verdicts. */
const TWO_FLAGGERS_SAME: Conflict = {
  file: "src/lib/cache.ts",
  line: 14,
  title: "Cache TTL is a magic number",
  takes: [
    take("a1", "Security Reviewer", "WARNING", "Unbounded staleness on a permissions cache."),
    take("a3", "Correctness Reviewer", "WARNING", "The value disagrees with the config default."),
    take("a2", "Performance Reviewer", "ignored"),
    take("a4", "Style Reviewer", "ignored"),
  ],
};

const GROUPS: Conflict[] = [ONE_FLAGGER, TWO_FLAGGERS_MIXED, TWO_FLAGGERS_SAME];

// ---------------------------------------------------------------------------
// The block on its own
// ---------------------------------------------------------------------------

function block(groups: readonly Conflict[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <DisagreementBlock groups={groups} />
    </NextIntlClientProvider>,
  );
}

const panels = () => screen.getAllByRole("group");
const filter = () => screen.getByRole("checkbox", { name: "Show only conflicts" });

/** `noUncheckedIndexedAccess` is on in this package, and an index into a query
    result is genuinely `T | undefined`. Throwing here fails the test at the
    line that made the wrong assumption rather than three assertions later. */
function at(elements: readonly HTMLElement[], index: number): HTMLElement {
  const element = elements[index];
  if (!element) throw new Error(`expected an element at index ${index}`);
  return element;
}

describe("DisagreementBlock", () => {
  afterEach(cleanup);

  it("renders one panel per group with its file:line, its title, one cell per agent and the words for a silent one", () => {
    block(GROUPS);

    // AC-77/AC-78 — every group the server returned, in the order it returned
    // them. The block computes no grouping of its own.
    expect(panels()).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Where agents disagree" })).toBeInTheDocument();

    const first = at(panels(), 0);
    expect(within(first).getByText("src/lib/rate-limit.ts:28")).toBeInTheDocument();
    expect(within(first).getByText("Rate limit window never resets")).toBeInTheDocument();

    // One cell per agent OF THE MULTI-RUN — four, including the three that
    // said nothing. A block that dropped the silent agents would read as
    // "one agent reviewed this line".
    const cells = within(first).getAllByRole("listitem");
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => within(c).getByText(/Reviewer$/).textContent)).toEqual([
      "Security Reviewer",
      "Performance Reviewer",
      "Correctness Reviewer",
      "Style Reviewer",
    ]);

    // AC-79 — the WORDS, in the cell, three times over. Not a neutral colour.
    expect(within(first).getAllByText("did not flag")).toHaveLength(3);
    expect(within(at(cells, 1)).getByText("did not flag")).toBeInTheDocument();

    // AC-88 — the one agent that flagged names its severity in text beside the
    // colour, and its generated sentence renders as a sentence.
    expect(within(at(cells, 0)).getByText("Warning")).toBeInTheDocument();
    expect(
      within(at(cells, 0)).getByText("Flags the window as fixed rather than sliding."),
    ).toBeInTheDocument();

    // AC-80 — one statement, said once, that the sentences are generated.
    expect(
      screen.getByText(
        "These sentences are generated from what each agent reported — they are not quotations.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps only the groups two or more agents flagged when Show only conflicts is on, and restores them when it is off", () => {
    block(GROUPS);

    // Unfiltered: all three, single-flagger included.
    expect(screen.getByText("Rate limit window never resets")).toBeInTheDocument();
    expect(screen.getByText("Loader issues one query per row")).toBeInTheDocument();
    expect(screen.getByText("Cache TTL is a magic number")).toBeInTheDocument();

    fireEvent.click(filter());
    expect(filter()).toHaveAttribute("aria-checked", "true");

    // AC-81, and the three cases the rule is easiest to get backwards on:
    //  - one WARNING + three `ignored`  → ONE flagger  → gone
    //  - one WARNING + one SUGGESTION   → TWO flaggers → stays
    //  - two WARNINGs                   → TWO flaggers → stays
    // The filtered list being SHORTER than the unfiltered one is the expected
    // outcome: single-flagger groups are the majority of the block.
    expect(screen.queryByText("Rate limit window never resets")).toBeNull();
    expect(screen.getByText("Loader issues one query per row")).toBeInTheDocument();
    expect(screen.getByText("Cache TTL is a magic number")).toBeInTheDocument();
    expect(panels()).toHaveLength(2);

    fireEvent.click(filter());
    expect(panels()).toHaveLength(3);
    expect(screen.getByText("Rate limit window never resets")).toBeInTheDocument();
  });

  it("renders the block with its empty statement, and no filter, when the multi-run produced no groups", () => {
    block([]);

    // EC-10 — the block is rendered, not omitted: a reader has to be able to
    // tell "the agents agreed" from "this screen forgot to draw something".
    expect(screen.getByRole("heading", { name: "Where agents disagree" })).toBeInTheDocument();
    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("states the same emptiness when the filter hides every group", () => {
    block([ONE_FLAGGER]);
    fireEvent.click(filter());

    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Mounted in the results view — AC-77's "in both modes, from one mount point"
// ---------------------------------------------------------------------------

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

const AGENTS: Agent[] = ["a1", "a2"].map((id, i) => ({
  id,
  name: i === 0 ? "Security Reviewer" : "Performance Reviewer",
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
}));

/** Both columns terminal: nothing polls, and no drawer is asked for, so the
    tree constructs no `EventSource`. */
const COLUMNS: AgentColumn[] = AGENTS.map((a, i) => ({
  run_id: `run-${a.id}`,
  agent_id: a.id,
  agent_name: a.name,
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  verdict: "comment",
  score: 80 + i,
  summary: null,
  duration_ms: 4000,
  cost_usd: 0.02,
  findings: [],
}));

const RUN: MultiAgentRun = {
  id: "ma-1",
  pr_id: "pr-482",
  pr_number: 482,
  ran_at: "2026-08-24T10:00:00.000Z",
  agent_count: 2,
  total_duration_ms: 4000,
  total_cost_usd: 0.04,
  columns: COLUMNS,
  conflicts: [TWO_FLAGGERS_MIXED],
};

let qc: QueryClient;

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** Routes by path suffix, so `apiFetch`'s `API_BASE` prefix is irrelevant. */
function route(url: string): Response {
  if (url.endsWith("/multi-agent")) return jsonOk(RUN);
  if (url.endsWith("/agents")) return jsonOk(AGENTS);
  if (url.endsWith("/repos")) return jsonOk([REPO]);
  if (url.endsWith("/repos/r1/pulls")) return jsonOk(PULLS);
  return jsonOk([]);
}

function view() {
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

describe("DisagreementBlock — mounted in the results view", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    push.mockReset();
    replace.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => route(String(url))),
    );
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    cleanup();
    qc.clear();
    vi.unstubAllGlobals();
  });

  it("renders below the results in columns mode and in tabs mode, from one mount point", async () => {
    // Columns mode is the default on first render.
    render(view());
    expect(
      await screen.findByRole("heading", { name: "Where agents disagree" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Columns" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Loader issues one query per row")).toBeInTheDocument();

    // ...and mounted at the tabs URL, which is what a reload in tabs mode is.
    // AC-77 is one mount point outside the mode branch, so the same block —
    // not a second copy — is below the results in both.
    cleanup();
    searchParams = new URLSearchParams("mode=tabs");
    render(view());
    expect(
      await screen.findByRole("heading", { name: "Where agents disagree" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tabs" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Where agents disagree")).toHaveLength(1);
    expect(screen.getByText("Loader issues one query per row")).toBeInTheDocument();
  });
});
