/* AgentPicker — the pull-request page's run control (SPEC-05, AC-45…AC-51, AC-84).

   Mounted with the REAL data hooks over a stubbed `fetch`, not with mocked hooks.
   The assertion this file exists for is the outgoing POST body: a fan-out that
   drops one of the ticked ids still answers 200, still invalidates, still
   navigates, and every signal the UI trusts says it worked. Only the request on
   the wire sees it (client/INSIGHTS.md, 2026-08-11), so the boundary is `fetch`.

   `fireEvent`, not `userEvent` — `@testing-library/user-event` is not a
   dependency of this package (client/INSIGHTS.md, 2026-08-10). There is no
   shared QueryClient helper either, so the wrapper below is local, as
   `AgentCard.test.tsx` and `PRRow.test.tsx` both do it.

   Keyboard operability is asserted as its load-bearing half — a real,
   tab-reachable element carrying an accessible name — and the activation is
   dispatched separately: jsdom fires no `click` for Enter on a focused native
   `<button>` (client/INSIGHTS.md, 2026-08-19).

   Copy is read from the real `messages/en/runs.json`, so a renamed key fails
   here instead of rendering a key path. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunEstimate, MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import { AgentPicker, type AgentPickerProps } from "./AgentPicker";
import { formatDurationSeconds } from "@/lib/format";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => push(...a), replace: vi.fn() }),
  usePathname: () => "/repos/repo-1/pulls/482",
}));

const M = messages.picker;

const agent = (id: string, name: string, enabled = true): Agent => ({
  id,
  name,
  description: "",
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  system_prompt: "",
  output_schema: null,
  enabled,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
});

/** Five agents — and the fourth is DISABLED on purpose: every workspace agent is
    listed, not only the enabled ones (AC-46). */
const AGENTS: Agent[] = [
  agent("a1", "Security Auditor"),
  agent("a2", "Performance Hawk"),
  agent("a3", "Style Nit"),
  agent("a4", "Docs Pedant", false),
  agent("a5", "Fresh Recruit"),
];

/** `a5` has never completed a run: both means null, sample size 0 — a dash, and
    never `0.0s`. `a3` has a duration but no cost, which this screen ignores. */
const ESTIMATES: AgentRunEstimate[] = [
  { agent_id: "a1", mean_duration_ms: 8200, mean_cost_usd: 0.06, sample_size: 10 },
  { agent_id: "a2", mean_duration_ms: 6000, mean_cost_usd: 0.05, sample_size: 7 },
  { agent_id: "a3", mean_duration_ms: 7100, mean_cost_usd: null, sample_size: 4 },
  { agent_id: "a4", mean_duration_ms: 5500, mean_cost_usd: 0.05, sample_size: 2 },
  { agent_id: "a5", mean_duration_ms: null, mean_cost_usd: null, sample_size: 0 },
];

const CREATED: MultiAgentRun = {
  id: "mar-1",
  pr_id: "pr-1",
  pr_number: 482,
  ran_at: "2026-08-25T09:00:00.000Z",
  agent_count: 2,
  total_duration_ms: 0,
  total_cost_usd: null,
  columns: [
    {
      run_id: "run-1",
      agent_id: "a1",
      agent_name: "Security Auditor",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      status: "running",
      error: null,
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    },
    {
      run_id: "run-3",
      agent_id: "a3",
      agent_name: "Style Nit",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      status: "running",
      error: null,
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    },
  ],
  conflicts: [],
};

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const fetchMock = vi.fn();
let agentsFixture: Agent[] = AGENTS;
let qc: QueryClient;

/** Route by path. `/agents/estimates` is checked first — it also ends in a
    segment `/agents` would otherwise swallow. */
function route(input: unknown): Response {
  const url = String(input);
  if (url.includes("/agents/estimates")) return jsonOk(ESTIMATES);
  if (url.endsWith("/agents")) return jsonOk(agentsFixture);
  if (url.includes("/multi-agent-run")) return jsonOk(CREATED);
  throw new Error(`unexpected fetch: ${url}`);
}

beforeEach(() => {
  push.mockReset();
  agentsFixture = AGENTS;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: unknown) => route(input));
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

function renderPicker(props: Partial<AgentPickerProps> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <QueryClientProvider client={qc}>
        <AgentPicker prId="pr-1" {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** Open the panel. The trigger is the header's run control (AC-45). */
function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: M.trigger }));
}

/** The POST bodies the component actually put on the wire. */
function postBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes("/multi-agent-run") && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init.body)));
}

describe("AgentPicker", () => {
  it("lists every workspace agent with its mean duration, fans the ticked ones out and navigates", async () => {
    renderPicker();
    openPanel();

    // Five agents — including the disabled one — each a real checkbox named
    // after its agent (AC-46).
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    expect(screen.getByRole("checkbox", { name: "Docs Pedant" })).toBeInTheDocument();

    // A duration per row, and a DASH for the agent that has never completed a
    // run — never "0.0s".
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText("8.2s")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("7.1s")).toBeInTheDocument();
    expect(within(rows[4]!).getByText(M.noEstimate)).toBeInTheDocument();
    expect(screen.queryByText("0.0s")).not.toBeInTheDocument();

    // The link to the agents screen sits below the list (AC-51).
    expect(screen.getByRole("link", { name: M.manageAgents })).toHaveAttribute("href", "/agents");

    // Tick two of five — the count lands in the primary action's accessible
    // name (AC-47).
    fireEvent.click(screen.getByRole("checkbox", { name: "Security Auditor" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Style Nit" }));
    const runAction = screen.getByRole("button", { name: "Run 2 agents" });
    expect(runAction).toHaveAttribute("aria-disabled", "false");

    // Keyboard operability, asserted as the half jsdom can actually observe: a
    // real, tab-reachable element carrying that accessible name. The activation
    // is dispatched separately, because jsdom fires no click for Enter.
    runAction.focus();
    expect(runAction).toHaveFocus();

    fireEvent.click(runAction);

    // ONE POST, carrying EXACTLY the two ticked ids and nothing else (AC-50).
    await waitFor(() => expect(postBodies()).toHaveLength(1));
    expect(postBodies()[0]).toEqual({ agentIds: ["a1", "a3"] });

    // …then the results route for this pull request.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/repo-1/multi-agent/482"));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("reports the run start and the created run ids to the header", async () => {
    const onRunStart = vi.fn();
    const onRunsStarted = vi.fn();
    renderPicker({ onRunStart, onRunsStarted });
    openPanel();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Security Auditor" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Style Nit" }));
    fireEvent.click(screen.getByRole("button", { name: "Run 2 agents" }));

    await waitFor(() => expect(onRunsStarted).toHaveBeenCalledWith(["run-1", "run-3"]));
    expect(onRunStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the primary action inert while nothing is ticked, and Clear returns it to that state", async () => {
    renderPicker();
    openPanel();
    await screen.findAllByRole("checkbox");

    // Nothing selected: aria-disabled, and activating it issues no request
    // (AC-48). `aria-disabled` rather than `disabled`, so the count stays
    // readable from the accessible name.
    const idle = screen.getByRole("button", { name: "Run 0 agents" });
    expect(idle).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(idle);
    expect(postBodies()).toHaveLength(0);

    // Tick two, then Clear — the count returns to 0 and the action is inert
    // again (AC-49).
    fireEvent.click(screen.getByRole("checkbox", { name: "Security Auditor" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance Hawk" }));
    expect(screen.getByRole("button", { name: "Run 2 agents" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: M.clear }));
    const cleared = screen.getByRole("button", { name: "Run 0 agents" });
    expect(cleared).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "Security Auditor" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(cleared);
    expect(postBodies()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("says why a fan-out was refused instead of looking like a mis-click", async () => {
    // The server names its refusals — `422 too_many_agents` (AC-8), `409
    // multi_agent_run_in_flight` (AC-9). This used to be swallowed: the spinner
    // ran, the panel did not move, and nothing was said, so the reviewer
    // concluded they had missed the button and pressed again.
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/multi-agent-run")) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: "multi_agent_run_in_flight",
              message: "This pull request already has a multi-agent run in progress",
            },
          }),
        } as unknown as Response;
      }
      return route(input);
    });

    renderPicker();
    openPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Security Auditor" }));
    fireEvent.click(screen.getByRole("button", { name: "Run 1 agent" }));

    // The server's own sentence, announced.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This pull request already has a multi-agent run in progress");

    // And the selection survives, so the reviewer can act on what they just read
    // rather than rebuilding it.
    expect(screen.getByRole("checkbox", { name: "Security Auditor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("renders the no-agents copy and no picker when the workspace has none", async () => {
    agentsFixture = [];
    renderPicker();
    openPanel();

    expect(await screen.findByText(M.noAgents)).toBeInTheDocument();
    // No picker: no rows, no Clear, no run action — there is nothing to select.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: M.clear })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Run \d/ })).not.toBeInTheDocument();
    // The way out is still offered (AC-84).
    expect(screen.getByRole("link", { name: M.manageAgents })).toHaveAttribute("href", "/agents");
  });

  it("dims the trigger on a merged pull request without blocking the run (EC-21)", async () => {
    renderPicker({ warnMerged: true });
    const trigger = screen.getByRole("button", { name: M.trigger });
    expect(trigger).toHaveStyle({ opacity: "0.6" });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Security Auditor" }));
    fireEvent.click(screen.getByRole("button", { name: "Run 1 agent" }));
    await waitFor(() => expect(postBodies()).toHaveLength(1));
    expect(postBodies()[0]).toEqual({ agentIds: ["a1"] });
  });
});

/* The formatter, exercised directly. `resultsRoute` moved to
   `src/lib/multi-agent-routes.ts` when the pull-request header became its second
   consumer, and its case moved with it to `src/lib/multi-agent-routes.test.ts`. */
describe("AgentPicker helpers", () => {
  it("reports a missing mean duration as absent, never as zero", () => {
    // The formatter now lives in `src/lib/format.ts` — the Configure-run screen
    // is its second consumer and it is one subtree over (`DDG-UI-002`). The
    // behaviour this picker depends on is unchanged and is still asserted from
    // here, because it is this screen that turns the null into a dash.
    expect(formatDurationSeconds(8200)).toBe("8.2s");
    expect(formatDurationSeconds(0)).toBe("0.0s");
    expect(formatDurationSeconds(null)).toBeNull();
    expect(formatDurationSeconds(undefined)).toBeNull();
  });
});
