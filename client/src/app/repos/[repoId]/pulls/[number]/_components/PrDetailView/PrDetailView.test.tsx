/* PrDetailView — the CROSS-TAB FLOW, which is the one thing no unit test can see.

   A review-focus row on the brief card is a promise that spans three units: the
   card raises a path, this view turns it into `?tab=diff&file=…&line=…`, and the
   diff tab expands that file and scrolls to that line. `BriefCard.test.tsx`
   proves the card hands its caller a path; `SmartDiffViewer.test.tsx` proves a
   `targetFile` expands a collapsed file. Neither proves the URL in between, and
   the URL is the part AC-40 is actually about — it is what makes the landing
   survive a reload and a shared link.

   So this file mounts the REAL tree — the real shell, the real header, the real
   Overview and Files-changed tabs — and stubs only the two boundaries the app has:
   `fetch` and `next/navigation`. `AppShell` mounts cleanly in jsdom given a
   `next/navigation` mock, a QueryClient and the `shell` namespace
   (`client/INSIGHTS.md`, 2026-08-19), which is what lets "the rest of the screen
   is still usable" be checked against the real sidebar and breadcrumb.

   `fetch` rather than the hook modules: the hooks are the seam under test here
   (`usePrBrief` polls on `generation_state`, `useGenerateBrief` sends `force`),
   and mocking `@/lib/hooks` would replace the barrel the shell itself reads.

   `fireEvent`, not `userEvent` — not a dependency of this package
   (`client/INSIGHTS.md`, 2026-08-10). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrDetail, PrMeta, PrRiskBrief, Repo } from "@devdigest/shared";
import prBriefMessages from "../../../../../../../../messages/en/prBrief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import { RepoProvider } from "@/lib/repo-context";
import { PrDetailView } from "./PrDetailView";

/* The URL, mutable, because this test is ABOUT the URL. `push`/`replace` record
   what the view asked for and update the params the next render reads, so a
   navigation can be followed the way a browser would follow it. A `vi.mock`
   factory may read a mutable module-level variable — the hoisting complaint
   applies to the factory's own initialisation, not to a value its returned
   closures read at render time (`client/INSIGHTS.md`, 2026-08-19). */
let params: URLSearchParams;
let pushed: string[];
let replaced: string[];

function navigate(url: string, log: string[]) {
  log.push(url);
  params = new URLSearchParams(url.split("?")[1] ?? "");
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => navigate(url, pushed),
    replace: (url: string) => navigate(url, replaced),
  }),
  usePathname: () => "/repos/r1/pulls/482",
  useSearchParams: () => params,
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

const REPOS = [{ id: "r1", full_name: "acme/payments-api", url: "" }] as unknown as Repo[];

const PR_META = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to the public API",
  author: "ada",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc1234def",
  additions: 240,
  deletions: 18,
  files_count: 2,
  status: "open",
} as unknown as PrMeta;

/* `src/server.ts` is the target on purpose: Smart Diff classifies it `wiring`, and
   the expansion rule opens only small `core` files and files carrying findings —
   so it starts COLLAPSED and its body appearing is evidence the target, not the
   rule, opened it (AC-41). `src/config.ts` is the small `core` file that was open
   anyway, which is what makes the distinction visible. */
const TARGET = "src/server.ts";
const TARGET_LINE = 12;
const TARGET_BODY = "registerRateLimit(app);";

const PR_DETAIL = {
  ...PR_META,
  body: "Closes #331.",
  commits: [],
  files: [
    {
      path: "src/config.ts",
      additions: 1,
      deletions: 0,
      patch: ["@@ -4,2 +4,3 @@ export const config = {", "   port: 3000,", "+  bucketSize: 20,"].join(
        "\n",
      ),
    },
    {
      path: TARGET,
      additions: 1,
      deletions: 0,
      // Two context lines then the addition, so the head-side numbering runs
      // 10, 11, 12 and `TARGET_LINE` names a row this patch actually renders.
      patch: [
        "@@ -10,2 +10,3 @@ export function build() {",
        "   app.register(cors);",
        "   app.register(helmet);",
        `+  ${TARGET_BODY}`,
      ].join("\n"),
    },
  ],
} as unknown as PrDetail;

const SMART_DIFF = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: TARGET, pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

const BRIEF: PrRiskBrief = {
  pr_id: "pr-1",
  what: "Adds a per-tenant token bucket in front of the public API.",
  why: "One tenant's retry storm took the payments endpoints down twice.",
  risk_level: "high",
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "The limiter decides who reaches the public API.",
      severity: "high",
      file_refs: [TARGET],
    },
  ],
  review_focus: [{ path: TARGET, line: TARGET_LINE, reason: "Where the limiter is wired in." }],
  diff_stats: {
    files_changed: 2,
    files_listed: 2,
    additions: 240,
    deletions: 18,
    symbols: 1,
    endpoints: 1,
  },
  status: "ok",
  reason: null,
  sources: [],
  head_sha: "abc1234def",
  cache_key: "k1",
  stale: false,
  generation_state: "done",
  generated_at: "2026-08-19T09:00:00.000Z",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  attempts: 1,
  tokens_in: 6120,
  tokens_out: 480,
  cost_usd: 0.0141,
  error: null,
};

const BLAST = {
  pr_id: "pr-1",
  changed_files: [TARGET],
  changed_symbols: [],
  downstream: [],
  impacted: [],
  counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  status: "ok",
  reason: null,
  indexed_sha: "abc1234def",
};

const PRIOR_PRS = {
  pr_id: "pr-1",
  prs: [],
  total: 0,
  truncated: false,
  coverage: { with_file_lists: 1, total: 1 },
  status: "ok",
  reason: null,
};

/** Every endpoint this screen reaches, answered from a fixture. Anything not
    named here — comments, reviews, run history, active runs — is an empty list,
    which is a real state and keeps those cards out of the way. */
function route(url: string): unknown {
  if (url.endsWith("/repos")) return REPOS;
  if (url.endsWith("/repos/r1/pulls")) return [PR_META];
  if (url.endsWith("/pulls/pr-1")) return PR_DETAIL;
  if (url.endsWith("/pulls/pr-1/brief")) return BRIEF;
  if (url.endsWith("/pulls/pr-1/intent")) return null;
  if (url.endsWith("/pulls/pr-1/blast")) return BLAST;
  if (url.endsWith("/pulls/pr-1/prior-prs")) return PRIOR_PRS;
  if (url.endsWith("/pulls/pr-1/smart-diff")) return SMART_DIFF;
  return [];
}

let qc: QueryClient;

/** The tree under test. Rebuilt rather than remounted, so a URL written by a
    navigation lands the way it would after the router re-rendered the route. */
function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          prBrief: prBriefMessages,
          prReview: prReviewMessages,
          intent: intentMessages,
          blast: blastMessages,
          shell: shellMessages,
          runs: runsMessages,
        }}
      >
        <RepoProvider>
          <PrDetailView repoId="r1" number="482" />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  params = new URLSearchParams();
  pushed = [];
  replaced = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => route(String(url)),
      text: async () => JSON.stringify(route(String(url))),
    })),
  );
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PrDetailView — the brief's cross-tab landing", () => {
  it("takes a review-focus row to the diff tab, in the URL, with the file expanded there", async () => {
    const { container, rerender } = render(tree());

    // The row, by the sentence naming where it goes. A path carries no
    // consecutive spaces, so the accessible-name whitespace normalisation that
    // bites commands and snippets cannot bite this query.
    const row = await screen.findByRole("button", {
      name: prBriefMessages.reviewFocusOpenLine
        .replace("{path}", TARGET)
        .replace("{line}", String(TARGET_LINE)),
    });
    // Nothing of the diff is on screen yet — this is the Overview tab.
    expect(container.textContent).not.toContain(TARGET_BODY);

    fireEvent.click(row);

    // AC-40 — the landing is in the URL, so it survives a reload and a shared
    // link. `push`, not `replace`: Back has to return the reader to the card.
    expect(replaced).toEqual([]);
    expect(pushed).toHaveLength(1);
    const url = new URL(pushed[0]!, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("diff");
    expect(url.searchParams.get("file")).toBe(TARGET);
    expect(url.searchParams.get("line")).toBe(String(TARGET_LINE));

    // Follow the navigation the way the router would.
    rerender(tree());

    // AC-41 — `src/server.ts` is `wiring` with no findings, so the expansion rule
    // keeps it shut; its body is here because it was TARGETED. `src/config.ts`
    // was open anyway, which is what makes that a real distinction.
    expect(await screen.findByText(/registerRateLimit/)).toBeInTheDocument();

    // AC-42 — the targeted line's anchor exists and its scroll margin is the
    // MEASURED header height rather than a constant: that header is ~128px,
    // ~156px on a merged or closed pull request, and taller when its meta row
    // wraps, so any single number lands some pull requests underneath it.
    const anchor = document.getElementById(`sd-line-${TARGET}-RIGHT-${TARGET_LINE}`);
    expect(anchor).toBeTruthy();
    expect(anchor!.style.scrollMarginTop).toContain("--dd-sticky-h");

    // The shell is untouched by the whole journey: the breadcrumb is the real
    // one, so "still navigable" is checked rather than assumed.
    // The repo is named more than once — the sidebar's switcher and the
    // breadcrumb — which is itself the evidence that this is the real shell and
    // not a stub.
    expect(screen.getAllByText("acme/payments-api").length).toBeGreaterThan(0);
    expect(screen.getAllByText("#482").length).toBeGreaterThan(0);
  });

  it("drops the file target when the reader changes tabs by hand", async () => {
    params = new URLSearchParams({ tab: "diff", file: TARGET, line: String(TARGET_LINE) });
    render(tree());

    // Arriving on the diff tab with a target: the file is open before anything is
    // clicked, which is what a shared link has to do.
    expect(await screen.findByText(/registerRateLimit/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Overview/ }));

    // The landing belongs to the navigation that asked for it, not to the tab.
    // Without this, coming back to `Files changed` later would re-open and
    // re-scroll to a file nobody asked about — and the tab would keep announcing
    // a missing target long after the row that named it was forgotten.
    expect(pushed).toEqual([]);
    expect(replaced).toHaveLength(1);
    const url = new URL(replaced[0]!, "http://localhost");
    expect(url.searchParams.get("tab")).toBe("overview");
    expect(url.searchParams.get("file")).toBeNull();
    expect(url.searchParams.get("line")).toBeNull();
    expect(url.searchParams.get("finding")).toBeNull();
  });

  it("says so on the diff tab when the targeted file is not among the ones GitHub sent", async () => {
    // AC-43, and it is reachable on real data despite AC-24: the brief grounds
    // against the pull request's full `pr_files` list while this tab renders one
    // GitHub page of at most 100 files, so a large pull request has changed files
    // the tab never receives (EC-3).
    params = new URLSearchParams({ tab: "diff", file: "src/never/sent.ts" });
    render(tree());

    expect(
      await screen.findByText(
        prReviewMessages.smartDiff.targetMissing.replace("{path}", "src/never/sent.ts"),
      ),
    ).toBeInTheDocument();
    // The rest of the tab is intact — the reader is not left on a blank view.
    // `findBy`, because the notice lands with the pull request's own file list
    // while the cards wait on the role grouping's own request.
    expect(await screen.findByText("src/config.ts")).toBeInTheDocument();
  });

  it("renders the brief above the intent and blast cards, and no verdict banner", async () => {
    // AC-36, asserted here because the vertical order is a fact about this
    // container rather than about any one card — and the negative half needs the
    // real Overview tree: the design mock draws the verdict banner at the top of
    // this very section, but it is review output rendered on `Agent runs`, and a
    // brief exists before any agent has run.
    const { container } = render(tree());
    await screen.findByText(prBriefMessages.whatLabel);

    const text = container.textContent ?? "";
    const order = [prBriefMessages.title, intentMessages.label, blastMessages.label].map((label) =>
      text.indexOf(label),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(screen.queryByText(prReviewMessages.verdict.prScore)).not.toBeInTheDocument();
    expect(screen.queryByText(prReviewMessages.verdict.requestChanges)).not.toBeInTheDocument();
  });
});
