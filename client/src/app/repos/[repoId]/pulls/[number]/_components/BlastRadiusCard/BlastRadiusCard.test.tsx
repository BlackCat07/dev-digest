/* BlastRadiusCard — the state ladder is the feature, so there is one case per state.

   Mounted with `NextIntlClientProvider` ALONE and no QueryClient: the card is
   presentational and `OverviewTab` owns the hook. If a data hook ever moves into this
   subtree these tests fail with "No QueryClient set", which is the boundary working as
   designed (client/INSIGHTS.md, 2026-08-03).

   Copy is asserted through `M.*` — the real `messages/en/blast.json` — not through
   hand-copied literals. A renamed key then fails at TYPECHECK, and a card that went
   back to reading another namespace fails here, because only `blast` is provided
   (client/INSIGHTS.md, 2026-08-10).

   The assertion this file exists for: **an empty map must never render the same way
   twice for different reasons.** "Nothing calls this code", "the index is partial" and
   "nothing was analysed" are three different answers, and a card that blurred them
   would be worse than no card. `fireEvent` throughout — `@testing-library/user-event`
   is not a dependency of this package (client/INSIGHTS.md, 2026-08-10). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard, type BlastRadiusCardProps } from "./BlastRadiusCard";

// The graph view renders mermaid, which needs a real browser. Stub it to the chart
// text so the toggle can still be asserted — what matters here is WHICH view is
// mounted and what it was handed, not how mermaid draws it.
vi.mock("@/components/mermaid-diagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => <pre data-testid="mermaid">{chart}</pre>,
}));

afterEach(cleanup);

const M = messages;
const REPO = "acme/payments-api";

const MAP: PrBlastRadius = {
  pr_id: "pr-1",
  changed_files: ["src/middleware/ratelimit.ts"],
  changed_symbols: [
    { name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
    { name: "bucketKey", file: "src/middleware/ratelimit.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      file: "src/middleware/ratelimit.ts",
      kind: "function",
      callers: [
        { name: "router", file: "src/api/public/index.ts", line: 23 },
        { name: "webhookHandler", file: "src/api/public/webhooks.ts", line: 45 },
      ],
      caller_count: 4,
      truncated: true,
      endpoints_affected: ["GET /api/public/items"],
      crons_affected: [],
      impacted: [
        {
          label: "GET /api/public/items",
          kind: "endpoint",
          file: "src/api/public/index.ts",
          depth: 1,
        },
      ],
    },
    {
      symbol: "bucketKey",
      file: "src/middleware/ratelimit.ts",
      kind: "function",
      callers: [{ name: "resetBuckets", file: "src/jobs/reset.ts", line: 4 }],
      caller_count: 1,
      truncated: false,
      endpoints_affected: [],
      crons_affected: ["reset-rate-buckets (hourly)"],
      impacted: [
        {
          label: "reset-rate-buckets (hourly)",
          kind: "cron",
          file: "src/jobs/reset.ts",
          depth: 1,
        },
      ],
    },
  ],
  impacted: [
    { label: "GET /api/public/items", kind: "endpoint", file: "src/api/public/index.ts", depth: 1 },
    { label: "reset-rate-buckets (hourly)", kind: "cron", file: "src/jobs/reset.ts", depth: 1 },
  ],
  counts: { symbols: 2, callers: 5, endpoints: 1, crons: 1 },
  status: "ok",
  reason: null,
  indexed_sha: "indexsha1",
};

function mount(over: Partial<BlastRadiusCardProps> = {}) {
  const props: BlastRadiusCardProps = {
    blast: MAP,
    isLoading: false,
    error: null,
    repoFullName: REPO,
    repoId: "repo-1",
    // The history footer has its own suite (`_components/PriorPrs`). Here it is
    // held in its loading state so it renders one skeleton and no copy — these
    // cases are about the map, and a footer full of text would make every
    // "renders exactly one notice" assertion below ambiguous.
    priorPrs: null,
    priorPrsLoading: true,
    priorPrsError: null,
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: M }}>
      <BlastRadiusCard {...props} />
    </NextIntlClientProvider>,
  );
}

/** A map with everything empty, parameterised by the state under test. */
function emptyMap(over: Partial<PrBlastRadius>): PrBlastRadius {
  return {
    ...MAP,
    changed_symbols: [],
    downstream: [],
    impacted: [],
    counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    ...over,
  };
}

describe("BlastRadiusCard — the map", () => {
  it("shows the four figures from the server, not ones it recomputed", () => {
    mount();
    // Counts come off `counts` verbatim: `callers` is a PRE-CAP total, so deriving it
    // from the rendered rows here would disagree with the server on purpose.
    const stats = screen.getByText(M.stat.callers).parentElement;
    expect(stats).toHaveTextContent("5");
    expect(screen.getByText(M.stat.endpoints).parentElement).toHaveTextContent("1");
    expect(screen.getByText(M.stat.crons).parentElement).toHaveTextContent("1");
  });

  it("opens the first symbol and leaves the rest collapsed", () => {
    mount();
    const headers = screen.getAllByRole("button", { expanded: false });
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("rateLimit()");
    expect(headers.some((h) => h.textContent?.includes("bucketKey()"))).toBe(true);
    // The collapsed row's callers are not in the document at all.
    expect(screen.queryByText("src/jobs/reset.ts:4")).not.toBeInTheDocument();
  });

  it("expands a collapsed symbol on click", () => {
    mount();
    const bucketKey = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("bucketKey()"))!;
    fireEvent.click(bucketKey);
    expect(screen.getByText("src/jobs/reset.ts:4")).toBeInTheDocument();
  });

  it("collapses the first symbol on click, so the default is an override not a lock", () => {
    mount();
    const rateLimit = screen.getByRole("button", { expanded: true });
    fireEvent.click(rateLimit);
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
  });

  it("links every caller to its own line on GitHub, pinned to the INDEXED sha", () => {
    mount();
    const link = screen.getByText("src/api/public/index.ts:23").closest("a")!;
    // `indexed_sha`, not the PR head: caller line numbers were measured against the
    // commit the index was built at.
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/indexsha1/src/api/public/index.ts#L23",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to HEAD when the map carries no indexed sha", () => {
    mount({ blast: { ...MAP, indexed_sha: null } });
    const link = screen.getByText("src/api/public/index.ts:23").closest("a")!;
    expect(link.getAttribute("href")).toContain("/blob/HEAD/");
  });

  it("still lists callers when no repo name is available to link with", () => {
    mount({ repoFullName: null });
    // The fact is the caller; the URL is a convenience. Losing the link must not
    // lose the row.
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("src/api/public/index.ts:23").closest("a")).toBeNull();
  });

  it("reports the pre-cap count on the row and says the list is truncated", () => {
    mount();
    expect(screen.getByText("4 callers")).toBeInTheDocument();
    // 2 rendered of 4 — the note is what stops "4 callers" over two rows reading as a bug.
    expect(screen.getByText("top 2 of 4")).toBeInTheDocument();
  });

  it("does not claim truncation for a complete caller list", () => {
    mount();
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.textContent?.includes("bucketKey()"))!,
    );
    expect(screen.queryByText("top 1 of 1")).not.toBeInTheDocument();
  });

  it("badges an endpoint and a cron differently", () => {
    mount();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button").find((b) => b.textContent?.includes("bucketKey()"))!,
    );
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
  });

  it("says how far an indirect endpoint was reached from", () => {
    mount({
      blast: {
        ...MAP,
        downstream: [
          {
            ...MAP.downstream[0]!,
            impacted: [
              { label: "GET /api/mounted", kind: "endpoint", file: "src/api/mounted.ts", depth: 2 },
            ],
            endpoints_affected: ["GET /api/mounted"],
          },
        ],
      },
    });
    expect(screen.getByText("GET /api/mounted")).toHaveAttribute(
      "title",
      expect.stringContaining("2 import hops"),
    );
  });
});

describe("BlastRadiusCard — two symbols sharing a name", () => {
  /** A layered repo: `createTask` in the repository layer AND in the service layer. */
  const layered: PrBlastRadius = {
    ...MAP,
    downstream: [
      {
        ...MAP.downstream[0]!,
        symbol: "createTask",
        file: "src/modules/tasks/service.ts",
        callers: [{ name: "taskRoutes", file: "src/modules/tasks/routes.ts", line: 10 }],
        caller_count: 1,
        truncated: false,
        impacted: [],
        endpoints_affected: [],
        crons_affected: [],
      },
      {
        ...MAP.downstream[1]!,
        symbol: "createTask",
        file: "src/modules/tasks/repo.ts",
        callers: [{ name: "createTask", file: "src/modules/tasks/service.ts", line: 11 }],
        caller_count: 1,
        truncated: false,
        impacted: [],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
    impacted: [],
    counts: { symbols: 2, callers: 2, endpoints: 0, crons: 0 },
  };

  it("shows the declaring file so the two rows are not read as a duplicate", () => {
    mount({ blast: layered });
    expect(screen.getByText("src/modules/tasks/service.ts")).toBeInTheDocument();
    expect(screen.getByText("src/modules/tasks/repo.ts")).toBeInTheDocument();
  });

  it("gives each row its OWN callers", () => {
    mount({ blast: layered });
    // The first row is open by default; its caller is the routes file.
    expect(screen.getByText("src/modules/tasks/routes.ts:10")).toBeInTheDocument();
    // The second row's caller is a different file, and is not shown until expanded.
    expect(screen.queryByText("src/modules/tasks/service.ts:11")).not.toBeInTheDocument();
  });

  it("does not show a file when the name is unique in the map", () => {
    mount();
    // MAP has rateLimit and bucketKey — distinct names, so no path clutters the rows.
    expect(screen.queryByText("src/middleware/ratelimit.ts")).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — impact no symbol accounts for", () => {
  it("shows endpoints the changed files declare themselves in their own row", () => {
    // The case that made this row necessary: a PR editing a `routes.ts` has endpoints
    // at depth 0 attributed to no symbol. Without the row the stat row would count
    // them while the body of the card showed nothing.
    mount({
      blast: emptyMap({
        status: "ok",
        impacted: [
          { label: "GET /agents", kind: "endpoint", file: "src/modules/agents/routes.ts", depth: 0 },
        ],
        counts: { symbols: 0, callers: 0, endpoints: 1, crons: 0 },
      }),
    });
    expect(screen.getByText(M.directImpact)).toBeInTheDocument();
    expect(screen.getByText("GET /agents")).toBeInTheDocument();
  });

  it("does not repeat an endpoint a symbol row already claims", () => {
    mount();
    // Both of MAP's impacted entries are attributed to symbols, so the extra row must
    // not appear at all.
    expect(screen.queryByText(M.directImpact)).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — tree and graph", () => {
  it("shows the tree first, with the graph one click away", () => {
    mount();
    expect(screen.getByRole("button", { name: M.view.tree })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: M.view.graph }));
    expect(screen.getByTestId("mermaid")).toBeInTheDocument();
  });

  it("graphs the impact in the direction it travels: symbol → caller", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: M.view.graph }));
    const chart = screen.getByTestId("mermaid").textContent ?? "";
    expect(chart).toContain("flowchart LR");
    expect(chart).toMatch(/s0 --> s0c0/);
    // The changed symbol is the source of every edge, never the target — an arrow
    // pointing the other way would draw the map backwards.
    expect(chart).not.toMatch(/s0c0 --> s0\b/);
  });

  it("offers no view toggle when there is nothing to graph", () => {
    mount({ blast: emptyMap({ status: "ok" }) });
    expect(screen.queryByRole("button", { name: M.view.graph })).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard — an empty map always says why", () => {
  it("calls an empty ok map a finding, naming the symbols it checked", () => {
    mount({
      blast: emptyMap({
        status: "ok",
        changed_symbols: MAP.changed_symbols,
        counts: { symbols: 2, callers: 0, endpoints: 0, crons: 0 },
      }),
    });
    expect(screen.getByText(M.empty.title)).toBeInTheDocument();
    expect(screen.getByText(/2 changed symbol\(s\), no downstream callers/)).toBeInTheDocument();
  });

  it("warns that a partial index may be hiding callers, ABOVE the data", () => {
    mount({ blast: { ...MAP, status: "partial", reason: "index_partial" } });
    expect(screen.getByText(M.partial.title)).toBeInTheDocument();
    // The caveat still carries the real rows it qualifies.
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it.each([
    ["index_missing", M.degraded.reason.index_missing],
    ["flag_off", M.degraded.reason.flag_off],
    ["no_changed_files", M.degraded.reason.no_changed_files],
  ] as const)("explains a degraded map caused by %s", (reason, sentence) => {
    mount({ blast: emptyMap({ status: "degraded", reason, indexed_sha: null }) });
    expect(screen.getByText(M.degraded.title)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(sentence.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
  });

  it("never presents a degraded map as evidence of no impact", () => {
    mount({ blast: emptyMap({ status: "degraded", reason: "index_missing" }) });
    // The one sentence that must be on screen: nothing was analysed.
    expect(screen.getByText(new RegExp(M.degraded.hint.slice(0, 30)))).toBeInTheDocument();
    // And the "nothing calls this" copy must NOT be, because that is a claim.
    expect(screen.queryByText(M.empty.title)).not.toBeInTheDocument();
  });

  it("shows the figures even when degraded, rather than hiding them", () => {
    mount({ blast: emptyMap({ status: "degraded", reason: "index_missing" }) });
    expect(screen.getByText(M.stat.callers).parentElement).toHaveTextContent("0");
  });
});

describe("BlastRadiusCard — loading and read errors", () => {
  it("renders skeletons while the map is being read", () => {
    const { container } = mount({ blast: null, isLoading: true });
    // The vendored Skeleton is a bare `div.skeleton` with no role, so the class is
    // the only handle (client/INSIGHTS.md, 2026-08-10).
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(M.empty.title)).not.toBeInTheDocument();
  });

  it("keeps a read failure inline and says the rest of the page is fine", () => {
    mount({ blast: null, isLoading: false, error: new Error("boom") });
    expect(screen.getByText(M.error.title)).toBeInTheDocument();
    // A failed READ is not a degraded MAP; it must not borrow that copy.
    expect(screen.queryByText(M.degraded.title)).not.toBeInTheDocument();
  });
});
