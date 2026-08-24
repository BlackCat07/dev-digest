/* One agent's eval page, and the comparison modal inside it.

   Mocked at the NETWORK boundary (`fetch`) and not at the hooks, matching
   `EvalsTab.test.tsx` and `src/lib/hooks/eval.test.tsx`: the hooks under test are
   the real ones, so a query key or a path that drifts shows up as a region stuck
   on its skeleton rather than as a green run.

   The REAL `AppShell` is mounted — it needs `next/navigation` mocked, a
   `QueryClient` and the `shell` namespace — so the "leave the rest of the screen
   usable" requirement is asserted against the actual sidebar. The sidebar
   renders `nav.ts`'s own English labels, so several strings appear twice on this
   screen and every ambiguous assertion is scoped with `within`.

   `@testing-library/user-event` is NOT a dependency of this package, so
   interaction is `fireEvent`. There is no shared QueryClient helper; one is built
   inline. The vendored `Skeleton` is a bare `div.skeleton` with no role, so
   loading is asserted through `container.getElementsByClassName`. Nothing here
   asserts on the chart's internals: `ResponsiveContainer` renders at zero size
   under jsdom, so the named legend is the accessible channel and the only one
   checked. jsdom implements no `EventSource` either — nothing subscribes, and it
   is stubbed anyway so a future subscription fails as an assertion rather than
   as a `ReferenceError` that takes the tree down. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  EvalBatch,
  EvalBatchTrendPoint,
  EvalComparison,
  EvalDashboardRow,
} from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";
import shellMessages from "../../../../../../messages/en/shell.json";
import { AgentEvalView } from "./AgentEvalView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/eval/ag1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ agentId: "ag1" }),
}));

const trend = (
  batchId: string,
  version: number,
  recall: number | null,
  precision: number | null,
): EvalBatchTrendPoint => ({
  batch_id: batchId,
  started_at: "2026-08-19T10:00:00.000Z",
  agent_version: version,
  recall,
  precision,
  citation_accuracy: 0.75,
  pass_rate: null,
  cost_usd: null,
});

/**
 * Recall rose four points and precision fell four against the previous batch —
 * and `alert` names precision, because the SERVER decides which metric regressed
 * and by how much. The client owns only the wording and the unit.
 */
const ROW: EvalDashboardRow = {
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
  trend: [trend("b1", 2, 0.78, 0.94), trend("b2", 3, 0.82, 0.9)],
  alert: { metric: "precision", change: -0.04 },
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

/** Three batches, so the selection can be driven to zero, one, two and three. */
const BATCHES: EvalBatch[] = [
  batch({ id: "b3", agent_version: 4, started_at: "2026-08-21T10:00:00.000Z" }),
  batch({ id: "b2", agent_version: 3, started_at: "2026-08-20T10:00:00.000Z" }),
  batch({ id: "b1", agent_version: 2, started_at: "2026-08-19T10:00:00.000Z" }),
];

/**
 * Two batches of the SAME agent version: `same_config`, so the prompt region
 * states the prompt is unchanged instead of drawing an empty diff. Precision's
 * change is null — one side was never measured — which must read "not measured"
 * and never `0pt`.
 */
const COMPARISON: EvalComparison = {
  earlier_batch_id: "b1",
  later_batch_id: "b2",
  earlier_agent_version: 6,
  later_agent_version: 6,
  earlier_system_prompt: "You are a security reviewer.",
  later_system_prompt: "You are a security reviewer.",
  same_config: true,
  recall: { earlier: 0.78, later: 0.82, change: 0.04 },
  precision: { earlier: null, later: 0.9, change: null },
  citation_accuracy: { earlier: 0.75, later: 0.75, change: 0 },
  cost_usd: { earlier: 0.004, later: 0.0051, change: 0.0011 },
};

/** Promoting v6 while v7 is current produces v8 — the RESULTING version. */
const PROMOTED_AGENT: Agent = {
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
  version: 8,
};

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

type Route = { status: number; body: unknown } | "pending";

let routes: Map<string, Route>;
let posts: string[];
const fetchMock = vi.fn();
let qc: QueryClient;

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as
    unknown as Response;

const okRoutes = (): Map<string, Route> =>
  new Map<string, Route>([
    ["/eval/agents/ag1/dashboard?period=30d", { status: 200, body: ROW }],
    ["/eval/agents/ag1/batches?period=30d", { status: 200, body: BATCHES }],
    // The pair is ordered EARLIER → LATER by started_at, never by click order.
    ["/eval/compare?a=b1&b=b2", { status: 200, body: COMPARISON }],
  ]);

beforeEach(() => {
  routes = okRoutes();
  posts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "POST") {
      posts.push(path);
      if (path === "/agents/ag1/versions/6/promote") return jsonRes(200, PROMOTED_AGENT);
      return jsonRes(200, {});
    }
    const route = routes.get(path);
    if (route === "pending") return new Promise<Response>(() => {});
    if (route) return jsonRes(route.status, route.body);
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
        <AgentEvalView agentId="ag1" />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

const runsRegion = () =>
  screen.getByRole("region", { name: evalMessages.agentPage.runsHeading });

const compareButton = () =>
  within(runsRegion()).getByRole("button", { name: /^Compare/ });

/**
 * The selection checkboxes, once the batch history has landed.
 *
 * The region exists from the first paint — it renders its own skeletons — so
 * waiting for the SECTION resolves immediately and finds no rows. Waiting for
 * the checkboxes is what actually waits for the read.
 */
const selectionBoxes = () =>
  waitFor(() => within(runsRegion()).getAllByRole("checkbox"));

describe("AgentEvalView", () => {
  it("renders three metric cards with changes in POINTS, the named trend series, and the alert strip from the payload", async () => {
    // AC-73, AC-74.
    render(tree());

    // The three cards, captioned as every other eval surface captions them.
    expect(await screen.findByText(evalMessages.dashboard.metrics.recall)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.precision)).toBeInTheDocument();
    expect(
      screen.getByText(evalMessages.dashboard.metrics.citationAccuracy),
    ).toBeInTheDocument();

    // Values as percentages, changes in PERCENTAGE POINTS — `MetricCard`'s own
    // `delta` prop would have rendered `↓ 0.04` with no unit at all.
    const cards = screen.getByRole("region", { name: evalMessages.evalsTab.metricsTitle });
    expect(within(cards).getByText("82%")).toBeInTheDocument();
    expect(within(cards).getByText("+4pt")).toBeInTheDocument();
    expect(within(cards).getByText("-4pt")).toBeInTheDocument();
    expect(within(cards).queryByText("0.04")).not.toBeInTheDocument();

    // The alert names the metric the SERVER flagged and the size of the fall,
    // in the client's unit.
    const alert = screen.getByRole("status");
    expect(within(alert).getByText(evalMessages.alert.title)).toBeInTheDocument();
    expect(
      within(alert).getByText(
        msg(evalMessages.alert.regression, {
          metric: evalMessages.metric.precision,
          change: "-4pt",
        }),
      ),
    ).toBeInTheDocument();

    // The trend chart's three named series. Nothing asserts on the chart itself:
    // ResponsiveContainer has no size under jsdom.
    const chart = screen.getByRole("region", { name: evalMessages.agentPage.trendHeading });
    expect(within(chart).getByText(evalMessages.dashboard.legend.recall)).toBeInTheDocument();
    expect(within(chart).getByText(evalMessages.dashboard.legend.precision)).toBeInTheDocument();
    expect(within(chart).getByText(evalMessages.dashboard.legend.citation)).toBeInTheDocument();
    expect(
      within(chart).queryByText(evalMessages.agentPage.noTrend),
    ).not.toBeInTheDocument();

    // And the recent-runs table: one row per batch, each selectable.
    expect(within(runsRegion()).getAllByRole("checkbox")).toHaveLength(3);
  });

  it("enables Compare only at exactly two selected runs, and states the precondition in its accessible name in every disabled state", async () => {
    // AC-75, asserted at zero, one, two and three selections.
    render(tree());
    const boxes = await selectionBoxes();

    // Zero.
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(compareButton()).toHaveAccessibleName(evalMessages.compare.openDisabled);

    // One.
    fireEvent.click(boxes[0]!);
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(compareButton()).toHaveAccessibleName(evalMessages.compare.openDisabled);

    // Two — enabled, and the precondition drops out of the name.
    fireEvent.click(boxes[1]!);
    expect(compareButton()).toHaveAttribute("aria-disabled", "false");
    expect(compareButton()).toHaveAccessibleName(evalMessages.compare.open);

    // Three — disabled again, and saying why again.
    fireEvent.click(boxes[2]!);
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(compareButton()).toHaveAccessibleName(evalMessages.compare.openDisabled);
  });

  it("compares two runs: four cards, `not measured` for a null change, the prompt-unchanged sentence with no diff body, and the agent's RESULTING version on promotion", async () => {
    // AC-76, AC-77, AC-78, AC-79.
    render(tree());
    const boxes = await selectionBoxes();

    // b2 and b1 — the last two rows, newest-first — so the pair the request
    // carries is b1 → b2, ordered by started_at and not by click order.
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[2]!);
    fireEvent.click(compareButton());

    // The modal mounts before its read resolves — it owns its own skeletons —
    // so the content is awaited rather than the dialog.
    const dialog = await screen.findByRole("dialog");

    // Four cards: three metrics plus cost, each earlier → later → change.
    expect(await within(dialog).findByText(evalMessages.metric.recall)).toBeInTheDocument();
    expect(within(dialog).getByText(evalMessages.metric.precision)).toBeInTheDocument();
    expect(within(dialog).getByText(evalMessages.metric.citationAccuracy)).toBeInTheDocument();
    expect(within(dialog).getByText(evalMessages.compare.cost)).toBeInTheDocument();
    expect(within(dialog).getByText("78%")).toBeInTheDocument();
    expect(within(dialog).getByText("82%")).toBeInTheDocument();
    expect(within(dialog).getByText(/\+4pt/)).toBeInTheDocument();

    // A null change says so, and does NOT render a zero.
    expect(
      within(dialog).getByText(new RegExp(evalMessages.notMeasured)),
    ).toBeInTheDocument();

    // Same agent version on both sides: the sentence REPLACES the diff body.
    expect(
      within(dialog).getByText(
        msg(evalMessages.compare.promptUnchanged, { version: 6 }),
      ),
    ).toBeInTheDocument();
    expect(dialog.querySelectorAll("pre")).toHaveLength(0);

    // Promotion reports the version the agent ENDED on — v8 from promoting v6 —
    // never the one that was promoted.
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: msg(evalMessages.compare.promote, { version: 6 }),
      }),
    );
    expect(
      await within(dialog).findByText(
        msg(evalMessages.compare.promoted, { version: 8 }),
      ),
    ).toBeInTheDocument();
    expect(posts).toContain("/agents/ag1/versions/6/promote");
    expect(
      within(dialog).queryByText(msg(evalMessages.compare.promoted, { version: 6 })),
    ).not.toBeInTheDocument();
  });

  it("renders skeletons while the reads are in flight and an inline error when one fails, with the sidebar still rendered", async () => {
    // AC-80, AC-81.
    routes.set("/eval/agents/ag1/dashboard?period=30d", { status: 500, body: { error: "boom" } });
    routes.set("/eval/agents/ag1/batches?period=30d", "pending");
    const { container } = render(tree());

    // The failed region says so; the region still loading keeps its skeletons.
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(evalMessages.agentPage.error)).toBeInTheDocument();
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);

    // The real sidebar is untouched. "Skills" is a nav.ts label and appears
    // nowhere else on this screen.
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.page.crumbSkillsLab)).toBeInTheDocument();
  });
});
