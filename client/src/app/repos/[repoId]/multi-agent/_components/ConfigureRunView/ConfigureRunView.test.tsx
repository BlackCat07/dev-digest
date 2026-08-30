/* ConfigureRunView — the Configure-run screen.

   Mocked at the network boundary and nowhere else: the real hooks, the real
   query client and the real vendored primitives all run, so a hook that stops
   sending `agentIds` or a primitive that stops being a checkbox is visible
   here. `@testing-library/user-event` is NOT a dependency of this package
   (adding it is a package.json + lockfile change, and the lockfile is
   do-not-touch), so interaction is `fireEvent`, matching every other test file
   in `src/`. There is no shared QueryClient helper either — one is built inline,
   as `AgentCard.test.tsx` and `PRRow.test.tsx` do.

   Both namespaces the subtree reaches are supplied. A component composing a
   shared unit legitimately reads two, and a missing one makes next-intl render
   the key path and log `IntlError: MISSING_MESSAGE` into an otherwise green
   run's stderr (`client/INSIGHTS.md`, 2026-08-11). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentRunEstimate, PrMeta, Repo, ReviewRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../messages/en/runs.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { RepoProvider } from "@/lib/repo-context";
import { ConfigureRunView } from "./ConfigureRunView";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/repos/r1/multi-agent",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

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

const pull = (number: number, status: PrMeta["status"], title: string): PrMeta => ({
  id: `pr-${number}`,
  number,
  title,
  author: "octocat",
  branch: `feat/${number}`,
  base: "main",
  head_sha: `sha${number}`,
  additions: 10,
  deletions: 2,
  files_count: 3,
  status,
});

/** Seven pull requests, five of them open — the design's own picker: five
    entries against a sidebar badge of seven.

    DELIBERATELY SHUFFLED. A fixture that already arrives in the expected order
    passes with the sort deleted, because `Array.prototype.sort` is stable in
    V8, and the assertion then proves nothing about the ordering rule. */
const PULLS: PrMeta[] = [
  pull(3, "open", "Document the API"),
  pull(7, "needs_review", "Add rate limiting"),
  pull(1, "needs_review", "Initial scaffold"),
  pull(6, "merged", "Ship the importer"),
  pull(4, "stale", "Bump dependencies"),
  pull(2, "closed", "Abandoned spike"),
  pull(5, "reviewed", "Refactor the loader"),
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
  agent("a5", "Docs Reviewer"),
];

/** AC-57's worked example, plus one agent that has never completed a run. */
const ESTIMATES: AgentRunEstimate[] = [
  { agent_id: "a1", mean_duration_ms: 8200, mean_cost_usd: 0.06, sample_size: 10 },
  { agent_id: "a2", mean_duration_ms: 6000, mean_cost_usd: 0.05, sample_size: 10 },
  { agent_id: "a3", mean_duration_ms: 7100, mean_cost_usd: 0.04, sample_size: 9 },
  { agent_id: "a4", mean_duration_ms: 5500, mean_cost_usd: 0.05, sample_size: 4 },
  { agent_id: "a5", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
];

const review = (
  id: string,
  agentId: string,
  summary: string,
  createdAt: string,
): ReviewRecord => ({
  id,
  pr_id: "pr-7",
  agent_id: agentId,
  run_id: `run-${id}`,
  kind: "review",
  verdict: "request_changes",
  summary,
  score: 62,
  model: "gpt-4.1",
  created_at: createdAt,
  findings: [],
});

const REVIEWS: ReviewRecord[] = [
  review("rv1", "a1", "An older pass, superseded.", "2026-08-01T09:00:00.000Z"),
  review("rv2", "a1", "Two blocking issues in the retry path.", "2026-08-09T09:00:00.000Z"),
  review("rv3", "a3", "Looks correct; one edge case worth a test.", "2026-08-09T10:00:00.000Z"),
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let pulls: PrMeta[];
let agents: Agent[];
let estimates: AgentRunEstimate[];
let fetchMock: ReturnType<typeof vi.fn>;
let qc: QueryClient;

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** Routes by path suffix, so `apiFetch`'s `API_BASE` prefix is irrelevant. */
function route(url: string): unknown {
  if (url.endsWith("/agents/estimates")) return estimates;
  if (url.endsWith("/agents")) return agents;
  if (url.endsWith("/repos")) return [REPO];
  if (url.endsWith("/repos/r1/pulls")) return pulls;
  if (url.endsWith("/reviews")) return REVIEWS;
  if (url.endsWith("/multi-agent-run")) return { multi_agent_run_id: "ma-1", columns: [] };
  return [];
}

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, shell: shellMessages }}>
        <RepoProvider>
          <ConfigureRunView repoId="r1" />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  pulls = PULLS;
  agents = AGENTS;
  estimates = ESTIMATES;
  push.mockReset();
  fetchMock = vi.fn(async (url: string) => jsonOk(route(String(url))));
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

/** The pull-request step's select, once the read has landed. */
const prSelect = () => screen.findByRole("combobox", { name: /Choose a pull request/ });

const runAction = (count: number) =>
  screen.getByRole("button", { name: `Run ${count} ${count === 1 ? "agent" : "agents"}` });

const card = (name: string) => screen.getByRole("group", { name });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigureRunView", () => {
  it("offers only the repository's open pull requests, newest number first, and keeps the agent step and the run action disabled until one is chosen", async () => {
    render(tree());

    // AC-53 — five options out of seven pull requests, strictly descending. The
    // merged and the closed one are absent; a `stale` and an `open` one are not,
    // because those are review statuses of a pull request that IS open.
    const select = await prSelect();
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual([
      "Select PR",
      "#7 · Add rate limiting",
      "#5 · Refactor the loader",
      "#4 · Bump dependencies",
      "#3 · Document the API",
      "#1 · Initial scaffold",
    ]);
    expect(labels.join(" ")).not.toContain("Ship the importer");
    expect(labels.join(" ")).not.toContain("Abandoned spike");

    // AC-52 — two numbered steps, and step 1 above step 2. The order is the
    // design: step 2 cannot show an agent's last verdict here, and the run
    // action cannot know where to POST, until step 1 is answered.
    // The step labels are the words alone — the digit is the badge's job, so
    // each label appears exactly once and the disabled panel carries its own
    // heading rather than repeating step 2's.
    const step1 = screen.getByText("Choose a pull request");
    const step2 = screen.getByText("Choose agents");
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(step1.compareDocumentPosition(step2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // AC-54 — the agent step is worded, not merely dimmed, and no agent card
    // exists yet.
    expect(
      screen.getByText("Choose a pull request first — then pick the agents to run on it."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(runAction(0)).toHaveAttribute("aria-disabled", "true");

    // AC-59 — no selection, so nothing to estimate: a dash, never 0.0s · $0.00.
    expect(within(screen.getByRole("status")).getByText("Estimated —")).toBeInTheDocument();
  });

  it("renders one card per agent for the chosen pull request, each with that agent's latest verdict there and its estimate, and none for an agent that has never run there", async () => {
    render(tree());
    fireEvent.change(await prSelect(), { target: { value: "7" } });

    // AC-55 — one card per agent, named, with the mean duration and mean cost.
    const security = await screen.findByRole("group", { name: "Security Reviewer" });
    expect(screen.getAllByRole("group")).toHaveLength(5);
    expect(within(security).getByRole("checkbox", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(within(security).getByText("Estimated 8.2s · $0.06")).toBeInTheDocument();

    // The LATEST verdict on this pull request, not the first one found.
    await waitFor(() =>
      expect(
        within(card("Security Reviewer")).getByText("Two blocking issues in the retry path."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("An older pass, superseded.")).not.toBeInTheDocument();

    // AC-55's observable — an agent that has never run HERE renders no verdict
    // line at all. Exact text, because an empty line is invisible to a query
    // that only looks for absent words, and "it ran and said nothing" is a
    // different and much worse claim than "it has not run".
    expect(card("Style Reviewer").textContent).toBe("Style ReviewerEstimated 5.5s · $0.05");
    // AC-58 — and an agent with no estimate at all shows a dash, not a zero.
    expect(card("Docs Reviewer").textContent).toBe("Docs ReviewerEstimated —");
  });

  it("aggregates the selection as the LONGEST duration and the SUMMED cost, ignores an agent with no estimate, and fans the pull request out to exactly the ids selected", async () => {
    render(tree());
    fireEvent.change(await prSelect(), { target: { value: "7" } });
    await screen.findByRole("group", { name: "Security Reviewer" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Security Reviewer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Correctness Reviewer" }));

    const status = screen.getByRole("status");
    expect(within(status).getByText("Estimated 8.2s · $0.10")).toBeInTheDocument();

    // AC-56 — `Select all` takes every card, and the run action's count follows.
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(runAction(5)).toHaveAttribute("aria-disabled", "false");

    // AC-57 / AC-58 — 8.2, 6.0, 7.1 and 5.5 give a maximum of 8.2 (they run
    // concurrently, so it is not 26.8); $0.06 + $0.05 + $0.04 + $0.05 gives
    // $0.20; and the fifth agent, which has never run, moves neither figure.
    expect(within(status).getByText("Estimated 8.2s · $0.20")).toBeInTheDocument();

    // AC-50's sibling on this screen: one POST carrying exactly the selection,
    // then the results route for that pull request. Asserting the response
    // would prove nothing — a mutation that drops the list still resolves 200.
    fireEvent.click(runAction(5));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/7"));

    const posted = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(String(posted?.[0])).toContain("/pulls/pr-7/multi-agent-run");
    expect(JSON.parse(String((posted?.[1] as RequestInit).body))).toEqual({
      agentIds: ["a1", "a2", "a3", "a4", "a5"],
    });
  });

  it("renders the aggregate as unavailable, never as zero, when no selected agent has an estimate", async () => {
    agents = [agent("n1", "New Reviewer"), agent("n2", "Newer Reviewer")];
    estimates = [
      { agent_id: "n1", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
      { agent_id: "n2", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
    ];
    render(tree());
    fireEvent.change(await prSelect(), { target: { value: "7" } });
    await screen.findByRole("group", { name: "New Reviewer" });

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(runAction(2)).toHaveAttribute("aria-disabled", "false");

    // AC-59 — a dash. `0.0s · $0.00` would read as "free and instant".
    const status = screen.getByRole("status");
    expect(within(status).getByText("Estimated —")).toBeInTheDocument();
    expect(status.textContent).not.toContain("$0.00");
    expect(status.textContent).not.toContain("0.0s");
  });

  it("renders the pull-request step's empty state, and no select, when every pull request is merged or closed", async () => {
    pulls = [pull(9, "merged", "Ship it"), pull(8, "closed", "Drop it")];
    const { container } = render(tree());

    // Wait for the READ, not for the absence: `queryByRole` passes the instant
    // the tree mounts, before any pull request has arrived, so a `waitFor` over
    // it is satisfied by the loading state and proves nothing. The step's
    // skeleton clearing is the one signal that the list actually landed.
    await waitFor(() => expect(container.getElementsByClassName("skeleton")).toHaveLength(0));

    // AC-105 / EC-31 — an empty state under the step's own numbered heading,
    // not a picker you can open and find nothing in. The agent step stays
    // disabled behind it (AC-54).
    expect(screen.getByText("Choose a pull request")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The numbered badge is rendered from the step's index, beside its label.
    expect(screen.getByText("1", { selector: "span" })).toBeInTheDocument();

    // AC-105 states the STATE, in words. The step heading names the step; only
    // this sentence says that there is nothing here to choose from, and its
    // absence is the whole of the defect it pins.
    expect(
      screen.getByText(
        "No open pull requests — everything in this repository is merged or closed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose a pull request first — then pick the agents to run on it."),
    ).toBeInTheDocument();
    expect(runAction(0)).toHaveAttribute("aria-disabled", "true");
  });

  it("lists every open pull request with no cap and no truncation", async () => {
    // EC-20 — 400 open pull requests yield 400 options. A cap would silently
    // hide the pull request the reviewer came for, and "not in the list" and
    // "not imported" would become the same observation.
    pulls = Array.from({ length: 400 }, (_, i) => pull(i + 1, "needs_review", `Change ${i + 1}`));
    render(tree());

    const options = within(await prSelect()).getAllByRole("option");
    expect(options).toHaveLength(401); // 400 + the "Select PR" placeholder
    expect(options[1]?.textContent).toBe("#400 · Change 400");
    expect(options[400]?.textContent).toBe("#1 · Change 1");
  });
});
