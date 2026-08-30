/* The CI Runs screen.

   Mocked at the NETWORK boundary (`fetch`) and not at the hooks, matching
   `EvalDashboardView.test.tsx` and `src/lib/hooks/ci.test.tsx`: the hooks under
   test here are the real ones, so a query key or a path that drifts shows up as
   a table stuck on its skeletons rather than as a green run.

   The REAL `AppShell` is mounted, not a stub, which is what lets "the rest of
   the screen is still usable" be asserted against the actual sidebar. It needs
   `next/navigation` mocked, a `QueryClient` and the `shell` namespace; the repo
   list and PR count it reads go through the same stubbed `fetch`.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every other
   test file in `src/`. There is no shared QueryClient helper either; one is built
   inline. The vendored `Skeleton` is a bare `div.skeleton` with no role or aria,
   so the loading assertion goes through `container.getElementsByClassName`.

   The status assertions ITERATE `CI_STATUS_VALUES` rather than spelling four of
   them: a fifth `CiRunStatus` member added to the contract is then covered with
   no edit to this file, and a member with no catalogue word fails here instead
   of rendering a coloured dot with nothing beside it. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NAV } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";
import shellMessages from "../../../../../messages/en/shell.json";
import { CI_STATUS_VALUES, ciStatusDisplay, type CiStatusValue } from "@/lib/ci";
import { activeKeyFor } from "@/components/app-shell/helpers";
import { CiRunsView } from "./CiRunsView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ci-runs",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

/** A catalogue string by its dotted key, so the i18n boundary is not re-forked here. */
const copy = (path: string): string => {
  let node: unknown = ciMessages;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : "";
};

/** The WORD a status must state. Empty when the catalogue has none — a failure. */
const wordFor = (value: CiStatusValue): string => copy(ciStatusDisplay(value)?.labelKey ?? "");

const run = (over: Partial<CiRun> & { id: string }): CiRun => ({
  ci_installation_id: "inst1",
  pr_number: 42,
  ran_at: "2026-08-20T10:00:00.000Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.0051,
  github_url: "https://github.com/acme/payments-api/actions/runs/1",
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 42,
  repo: "acme/payments-api",
  head_sha: "abc1234",
  blockers: 1,
  reason: null,
  ...over,
});

/**
 * Two rows per status: one carrying it as the run's `status`, one carrying it as
 * the read-back's `reason`. Both must state the same word — a run whose artifact
 * could not be read is a row with a named reason, not a dropped run.
 */
const ALL_STATUS_RUNS: CiRun[] = CI_STATUS_VALUES.flatMap((value) => [
  run({ id: `status:${value}`, status: value, reason: null }),
  run({ id: `reason:${value}`, status: null, reason: value }),
]);

type Route = { status: number; body: unknown } | "pending";

let routes: Map<string, Route>;
const fetchMock = vi.fn();
let qc: QueryClient;

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as
    unknown as Response;

beforeEach(() => {
  routes = new Map<string, Route>([["/ci-runs", { status: 200, body: [run({ id: "r1" })] }]]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const route = routes.get(path);
    // A route registered as `pending` never resolves — that is how the loading
    // state is held open long enough to assert.
    if (route === "pending") return new Promise<Response>(() => {});
    if (route) return jsonRes(route.status, route.body);
    // Everything the shell reads (repos, pulls) answers empty.
    return jsonRes(200, []);
  });
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

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, shell: shellMessages }}>
        <CiRunsView />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** The table, scoped — "CI Runs" is also a sidebar label, a breadcrumb and the h1. */
const table = () => screen.getByRole("region", { name: ciMessages.runs.title });

describe("CiRunsView", () => {
  it("lists the workspace's runs, each row linked and each status stated as a word", async () => {
    // AC-62 and AC-64. Every status value AND every read-back reason renders a
    // word, not a colour: the two rows per value are the same status arriving
    // from the two places it can arrive from.
    routes.set("/ci-runs", { status: 200, body: ALL_STATUS_RUNS });
    const { container } = render(tree());

    // The rows have landed once the skeletons are gone — waiting on the region
    // itself would pass while the table is still in its loading state.
    await waitFor(() => expect(container.getElementsByClassName("skeleton")).toHaveLength(0));
    const region = table();

    for (const value of CI_STATUS_VALUES) {
      const word = wordFor(value);
      expect(word, `no catalogue word for status "${value}"`).not.toBe("");
      // Twice: once from `status`, once from `reason`.
      expect(within(region).getAllByText(word)).toHaveLength(2);
    }

    // The columns the table promises, and the run's provenance as a real link.
    for (const key of ["timestamp", "pullRequest", "source", "findings", "cost", "status"]) {
      expect(within(region).getByText(copy(`runs.table.${key}`))).toBeInTheDocument();
    }
    const links = within(region).getAllByRole("link", { name: /acme\/payments-api #42/ });
    expect(links[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/1",
    );
  });

  it("renders skeletons shaped like the table while the read is in flight", async () => {
    // AC-63, first state. The vendored `Skeleton` is a bare `div.skeleton` with
    // no role or aria, so this is the only handle on it.
    routes.set("/ci-runs", "pending");
    const { container } = render(tree());

    await waitFor(() =>
      expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0),
    );
    // Not the empty state, and not an error: the three states are told apart.
    expect(screen.queryByText(ciMessages.runs.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The sidebar is real, and still usable. "Skills" is a nav.ts label and
    // appears nowhere else on this screen.
    expect(screen.getByRole("link", { name: "Skills" })).toHaveAttribute("href", "/skills");
  });

  it("renders the empty-state copy when the workspace has no runs", async () => {
    // AC-63, second state — the empty table is exactly what this must not be.
    routes.set("/ci-runs", { status: 200, body: [] });
    const { container } = render(tree());

    expect(await screen.findByText(ciMessages.runs.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.runs.emptyBody)).toBeInTheDocument();
    expect(container.getElementsByClassName("skeleton")).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a failed read inline beside the table, leaving the shell usable", async () => {
    // AC-63, third state. The failure replaced the ROWS, not the segment: the
    // sidebar, the breadcrumb and every nav link are still there — which is the
    // requirement a segment-level error.tsx could not meet.
    routes.set("/ci-runs", { status: 500, body: { error: "boom" } });
    render(tree());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(ciMessages.runs.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(ciMessages.runs.emptyTitle)).not.toBeInTheDocument();

    // A nav link still works, and the breadcrumb is still rendered in the topbar.
    expect(screen.getByRole("link", { name: "Skills" })).toHaveAttribute("href", "/skills");
    expect(
      within(screen.getByRole("banner")).getByText(ciMessages.page.crumb),
    ).toBeInTheDocument();
  });

  it("is reachable from a sidebar entry that is marked active on /ci-runs", async () => {
    // AC-62. The sidebar marks an entry active by `ctx.activeKey === item.key`,
    // so the two halves of that comparison are what must agree: a NAV key that
    // drifts from what `activeKeyFor` returns renders a link that is never
    // highlighted, which no rendered assertion would notice.
    const entry = NAV.flatMap((group) => group.items).find((item) => item.key === "ci-runs");
    expect(entry?.href).toBe("/ci-runs");
    expect(activeKeyFor("/ci-runs")).toBe(entry?.key);

    render(tree());

    const link = await screen.findByRole("link", { name: entry?.label });
    expect(link).toHaveAttribute("href", "/ci-runs");
  });
});
