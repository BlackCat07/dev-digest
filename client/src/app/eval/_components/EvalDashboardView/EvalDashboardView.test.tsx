/* The workspace eval dashboard.

   Mocked at the NETWORK boundary (`fetch`) and not at the hooks, matching
   `EvalsTab.test.tsx` and `src/lib/hooks/eval.test.tsx`: the hooks under test
   here are the real ones, so a query key or a path that drifts shows up as a
   region stuck on its skeleton rather than as a green run.

   The REAL `AppShell` is mounted, not a stub, which is what lets "the rest of
   the screen is still usable" be asserted against the actual sidebar. It needs
   `next/navigation` mocked, a `QueryClient` and the `shell` namespace; the repo
   list and PR count it reads go through the same stubbed `fetch`. Note the
   sidebar renders `nav.ts`'s own English labels rather than the catalogue's, so
   "Eval Dashboard" appears THREE times on this screen (sidebar, breadcrumb, h1)
   — every assertion on it is scoped or plural for that reason.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every other
   test file in `src/`. There is no shared QueryClient helper either; one is built
   inline per test. The vendored `Skeleton` is a bare `div.skeleton` with no role
   or aria, so the loading assertions go through `container.getElementsByClassName`.
   And jsdom implements no `EventSource`: nothing here subscribes to one, but it
   is stubbed anyway so that a future subscription fails as an assertion rather
   than as a `ReferenceError` that takes the whole tree down. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  EvalBatch,
  EvalBatchTrendPoint,
  EvalDashboardRow,
  EvalWorkspaceDashboard,
} from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import shellMessages from "../../../../../messages/en/shell.json";
import { EvalDashboardView } from "./EvalDashboardView";
import { SPARKLINE_TESTID } from "./constants";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/eval",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const trend = (
  batchId: string,
  version: number,
  recall: number | null,
): EvalBatchTrendPoint => ({
  batch_id: batchId,
  started_at: "2026-08-20T10:00:00.000Z",
  agent_version: version,
  recall,
  precision: 0.9,
  citation_accuracy: 0.75,
  pass_rate: null,
  cost_usd: null,
});

/** An agent with two completed batches — the only row that earns a sparkline. */
const ROW_WITH_TREND: EvalDashboardRow = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  model: "gpt-4.1",
  cases_total: 20,
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
  trend: [trend("b1", 2, 0.78), trend("b2", 3, 0.82)],
  alert: null,
};

/**
 * An agent that has never completed a batch. It APPEARS, with null metrics and
 * an empty trend — omitting it would leave a reader unable to tell a disabled
 * agent from a missing one.
 */
const ROW_NO_BATCH: EvalDashboardRow = {
  agent_id: "ag2",
  agent_name: "Perf Reviewer",
  model: "gpt-4.1-mini",
  cases_total: 0,
  last_batch: null,
  trend: [],
  alert: null,
};

/** A row whose agent has been DELETED: still readable, and not navigable. */
const ROW_AGENT_GONE: EvalDashboardRow = {
  agent_id: null,
  agent_name: null,
  model: "gpt-4o",
  cases_total: 4,
  last_batch: {
    batch_id: "b9",
    agent_version: 1,
    started_at: "2026-08-18T10:00:00.000Z",
    cases_covered: 4,
    cases_passed: 4,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
  },
  // One point: a "trend" of one batch is a dot on an empty grid.
  trend: [trend("b9", 1, 1)],
  alert: null,
};

const batch = (over: Partial<EvalBatch> & { id: string }): EvalBatch => ({
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
  ...over,
});

const DASHBOARD: EvalWorkspaceDashboard = {
  period: "30d",
  rows: [ROW_WITH_TREND, ROW_NO_BATCH, ROW_AGENT_GONE],
  recent_batches: [
    batch({ id: "b2" }),
    batch({ id: "b9", agent_id: null, agent_name: null, agent_version: 1 }),
  ],
};

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

/** The branch next-intl picks for `count`, so a plural string is not retyped. */
const plural = (template: string, count: number) => {
  const branch = count === 1 ? /one \{([^}]*)\}/ : /other \{([^}]*)\}/;
  return (branch.exec(template)?.[1] ?? template).replace("#", String(count));
};

type Route = { status: number; body: unknown } | "pending";

let routes: Map<string, Route>;
let posts: { path: string; body: unknown }[];
const fetchMock = vi.fn();
let qc: QueryClient;

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as
    unknown as Response;

const okRoutes = (): Map<string, Route> =>
  new Map<string, Route>([["/eval/dashboard?period=30d", { status: 200, body: DASHBOARD }]]);

beforeEach(() => {
  routes = okRoutes();
  posts = [];
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "POST") {
      posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      const route = routes.get(`POST ${path}`);
      if (route && route !== "pending") return jsonRes(route.status, route.body);
      return jsonRes(200, { created: [], skipped: [] });
    }
    const route = routes.get(path);
    // A route registered as `pending` never resolves — that is how the loading
    // state is held open long enough to assert.
    if (route === "pending") return new Promise<Response>(() => {});
    if (route) return jsonRes(route.status, route.body);
    // Everything the shell reads (repos, pulls) answers empty.
    return jsonRes(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
      addEventListener() {}
    },
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

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ eval: evalMessages, shell: shellMessages }}
      >
        <EvalDashboardView />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** The agent table, scoped — "Agents" is also a sidebar label and a nav entry. */
const agentsRegion = () =>
  screen.getByRole("region", { name: evalMessages.dashboard.agentsHeading });

const runsRegion = () => screen.getByRole("region", { name: evalMessages.dashboard.recentRuns });

const rowFor = (name: string) =>
  screen.getByRole("button", { name: msg(evalMessages.dashboard.openAgent, { name }) });

describe("EvalDashboardView", () => {
  it("cards only the agents with a completed batch, counts the rest, and omits the sparkline below two batches", async () => {
    // AC-70, AC-71, AC-72. AC-45 is a statement about the READ, which still
    // returns the never-run agent — this asserts what the SECTION renders.
    render(tree());

    // The agent that HAS run: its three metrics as percentages, and one sentence
    // carrying the version, the age and the pass ratio over the batch's OWN
    // covered count.
    const withTrend = await waitFor(() => rowFor("Security Reviewer"));
    expect(within(withTrend).getByText("82%")).toBeInTheDocument();
    /* Both ends of the sentence are pinned, plus the SHAPE of the stamp between
       them — an absolute `YYYY-MM-DD HH:mm`, which is what distinguishes two runs
       an hour apart and is the thing a regression to `formatAge`'s "1h" would
       quietly undo. The stamp's exact value is not pinned: `formatDateTime` uses
       the local-time getters, so it moves with the runner's timezone. */
    expect(
      within(withTrend).getByText(
        (content) =>
          content.startsWith("Last run v3 · 2026-08-") &&
          /· \d{4}-\d{2}-\d{2} \d{2}:\d{2} ·/.test(content) &&
          content.endsWith("17/20 pass"),
      ),
    ).toBeInTheDocument();

    // The agent with NO completed batch is not carded — a card reading `—` three
    // times is what this section stopped showing — but it is not dropped in
    // silence either: one line says how many were left out.
    const region = agentsRegion();
    expect(
      screen.queryByRole("button", {
        name: msg(evalMessages.dashboard.openAgent, { name: "Perf Reviewer" }),
      }),
    ).not.toBeInTheDocument();
    expect(within(region).queryByText(evalMessages.dashboard.rowNoBatch)).not.toBeInTheDocument();
    expect(
      within(region).getByText(plural(evalMessages.dashboard.neverRunCount, 1)),
    ).toBeInTheDocument();

    // The deleted agent HAS a batch, so it is still carded — history stays
    // readable — presented as unavailable and NOT navigable: no page to open.
    expect(within(region).getByText(evalMessages.agentUnavailable)).toBeInTheDocument();
    expect(within(region).getAllByRole("button")).toHaveLength(1);

    // Exactly one card earns a sparkline: two completed batches. A one-point
    // trend is a dot on an empty grid, which reads as a bug.
    expect(within(region).getAllByTestId(SPARKLINE_TESTID)).toHaveLength(1);

    // The cross-agent recent-runs table: one row per BATCH, and a batch whose
    // agent is gone is still listed. Each metric keeps its NUMBER beside its bar.
    const runs = runsRegion();
    expect(within(runs).getAllByText("82%")).toHaveLength(2);
    expect(within(runs).getByText(evalMessages.agentUnavailable)).toBeInTheDocument();
  });

  it("navigates to an agent's eval page when its row is activated", async () => {
    // AC-70's "each row navigating to that agent's eval page".
    render(tree());

    fireEvent.click(await waitFor(() => rowFor("Security Reviewer")));

    expect(push).toHaveBeenCalledWith("/eval/ag1");
  });

  it("renders skeletons while the read is in flight, with the shell still around them", async () => {
    // AC-80.
    routes.set("/eval/dashboard?period=30d", "pending");
    const { container } = render(tree());

    await waitFor(() =>
      expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0),
    );
    // The sidebar is real, and still usable. "Skills" is a nav.ts label and
    // appears nowhere else on this screen; "Eval Dashboard" appears three times.
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the failure next to the region that failed, leaving the sidebar and breadcrumb rendered", async () => {
    // AC-81.
    routes.set("/eval/dashboard?period=30d", { status: 500, body: { error: "boom" } });
    render(tree());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(evalMessages.dashboard.error)).toBeInTheDocument();

    // Sidebar and breadcrumb are both still there — the error replaced a region,
    // not the segment. (A segment-level error.tsx could not do this, which is why
    // this repo has none.)
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.page.crumbSkillsLab)).toBeInTheDocument();
  });

  it("names every agent `Run all agents` skipped, and why", async () => {
    // AC-48's "names the id and reason of every agent skipped".
    routes.set("POST /eval/dashboard/runs", {
      status: 200,
      body: {
        created: [],
        skipped: [
          { agent_id: "ag2", reason: "no_cases" },
          { agent_id: "ag-gone", reason: "agent_disabled" },
        ],
      },
    });
    render(tree());

    fireEvent.click(
      await screen.findByRole("button", { name: evalMessages.dashboard.runAllAgents }),
    );

    // A skip the dashboard can name is named; one it cannot falls back to the
    // id, which is still attributable.
    expect(
      await screen.findByText(
        msg(evalMessages.dashboard.skipped, {
          name: "Perf Reviewer",
          reason: evalMessages.dashboard.skipReason.no_cases,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        msg(evalMessages.dashboard.skipped, {
          name: "ag-gone",
          reason: evalMessages.dashboard.skipReason.agent_disabled,
        }),
      ),
    ).toBeInTheDocument();
    expect(posts.map((p) => p.path)).toContain("/eval/dashboard/runs");
  });
});
