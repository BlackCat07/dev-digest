/* SmartDiffViewer — what a reviewer sees, and what happens when they click.

   Mounted with `NextIntlClientProvider` ALONE and no QueryClient: the viewer is
   presentational and `DiffTab` owns the queries. A data hook creeping into this
   subtree fails these tests with "No QueryClient set", which is the boundary working
   as designed (client/INSIGHTS.md, 2026-08-03).

   Copy comes from `M.*` — the real `messages/en/prReview.json` — so a renamed key
   fails at TYPECHECK rather than turning an assertion green against a stale literal.

   `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a dependency of
   this package and the lockfile is do-not-touch (client/INSIGHTS.md, 2026-08-10). */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

const M = messages.smartDiff;

afterEach(cleanup);

/**
 * Where a badge press LEADS is the container's decision, so these tests assert the
 * finding id this viewer reports rather than any navigation. `PrDetailView` turns
 * that id into `?tab=findings&finding=<id>` via `router.push`, and e2e flow 12
 * walks the whole path in a real browser.
 */
let opened: string[] = [];
beforeEach(() => {
  opened = [];
});

const CORE_PATCH = [
  "@@ -24,2 +24,4 @@ export async function rateLimit(",
  " export async function rateLimit(req, res, next) {",
  "+  const key = bucketKey(req);",
  "+  return next();",
  " }",
].join("\n");

const CONFIG_PATCH = [
  "@@ -11,3 +11,4 @@ export const config = {",
  "   port: 3000,",
  '+  stripeKey: "sk_live_x",',
  "   redisUrl: process.env.REDIS_URL,",
  " };",
].join("\n");

const LOCK_PATCH = ['@@ -1,3 +1,4 @@', '   "lockfileVersion": 3,', '+  "packages": {}'].join("\n");

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0, patch: CORE_PATCH },
  { path: "src/config.ts", additions: 1, deletions: 0, patch: CONFIG_PATCH },
  { path: "package-lock.json", additions: 1, deletions: 0, patch: LOCK_PATCH },
] as PrFile[];

const SMART_DIFF: SmartDiff = {
  // Deliberately listed BOILERPLATE FIRST, so the reading-order assertion is about
  // this component's ordering rather than about the response happening to be sorted.
  groups: [
    {
      role: "boilerplate",
      files: [
        { path: "package-lock.json", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: "src/config.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [12] },
      ],
    },
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: "rateLimit, bucketKey",
          additions: 2,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

let n = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  n += 1;
  return {
    id: `f-${n}`,
    review_id: "r-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A live key is committed.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function mount(over: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  // TWO namespaces, and that is correct rather than sloppy: every string this
  // feature owns lives in `prReview.smartDiff`, but the card composes the shared
  // diff renderer (`CodeLine`, `OutdatedComments`), which owns its own copy under
  // `shell.diffViewer`. Providing only `prReview` leaves those reaching for a
  // namespace that is not there and fills the run with MISSING_MESSAGE noise. The
  // boundary the assertions rely on is unaffected — all feature copy is asserted
  // through `M.*`, so a card that started reading another feature's namespace would
  // still fail here.
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      <SmartDiffViewer
        files={FILES}
        smartDiff={SMART_DIFF}
        findings={[]}
        grouped
        onOpenFinding={(id) => opened.push(id)}
        {...over}
      />
    </NextIntlClientProvider>,
  );
}

/** Reading order of several strings in the rendered text. */
function readingOrder(container: HTMLElement, ...needles: string[]) {
  const text = container.textContent ?? "";
  return [...needles].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

describe("SmartDiffViewer — the groups", () => {
  it("renders every group with its label and description", () => {
    mount();
    for (const role of ["core", "wiring", "boilerplate"] as const) {
      expect(screen.getByText(M.groups[role].label)).toBeTruthy();
      expect(screen.getByText(M.groups[role].description)).toBeTruthy();
    }
  });

  /**
   * "Core is on top" — the acceptance criterion, asserted as an ORDER. The response
   * lists boilerplate first on purpose, so a viewer that simply echoed the response
   * would fail here while every presence-only assertion above still passed.
   */
  it("puts core first and boilerplate last, whatever order the response used", () => {
    const { container } = mount();
    expect(
      readingOrder(
        container,
        M.groups.core.label,
        M.groups.wiring.label,
        M.groups.boilerplate.label,
      ),
    ).toEqual([M.groups.core.label, M.groups.wiring.label, M.groups.boilerplate.label]);
  });

  it("counts the files in each group", () => {
    mount();
    expect(screen.getAllByText("1 file")).toHaveLength(3);
  });

  it("renders no group headers when ungrouped, but keeps every file", () => {
    mount({ grouped: false });
    expect(screen.queryByText(M.groups.core.label)).toBeNull();
    for (const f of FILES) expect(screen.getByText(f.path)).toBeTruthy();
  });

  it("renders the empty state when the PR has no files", () => {
    mount({ files: [] });
    expect(screen.getByText(M.noFiles)).toBeTruthy();
  });
});

describe("SmartDiffViewer — what starts open", () => {
  /** The acceptance criterion: a lock file is boilerplate and starts collapsed. */
  it("keeps the lock file collapsed", () => {
    const { container } = mount();
    expect(screen.getByText("package-lock.json")).toBeTruthy();
    expect(container.textContent).not.toContain("lockfileVersion");
  });

  it("opens a small core file", () => {
    const { container } = mount();
    expect(container.textContent).toContain("const key = bucketKey(req);");
  });

  it("keeps a wiring file with no findings collapsed", () => {
    const { container } = mount();
    expect(container.textContent).not.toContain("sk_live_x");
  });

  /** Findings beat role — pinned so it is not "simplified" back to role-only. */
  it("opens a boilerplate file that has a finding", () => {
    const { container } = mount({
      findings: [finding({ file: "package-lock.json", start_line: 2 })],
    });
    expect(container.textContent).toContain("lockfileVersion");
  });

  it("opens on click, and closes again", () => {
    const { container } = mount();
    const header = screen.getByText("package-lock.json").closest("button")!;
    fireEvent.click(header);
    expect(container.textContent).toContain("lockfileVersion");
    fireEvent.click(header);
    expect(container.textContent).not.toContain("lockfileVersion");
  });
});

describe("SmartDiffViewer — the findings badge", () => {
  it("is a real button naming its count, its file and where it leads", () => {
    mount({ findings: [finding(), finding({ id: "f-b", start_line: 12, severity: "WARNING" })] });
    // A `<span>` badge or an onClick div would fail this — the badge has to be
    // reachable by keyboard, and `getByRole` is what proves it.
    expect(
      screen.getByRole("button", {
        name: /Open the first of 2 findings in src\/config\.ts in the Agent runs tab/,
      }),
    ).toBeTruthy();
  });

  it("counts findings, not finding-lines", () => {
    mount({ findings: [finding(), finding({ id: "f-b", start_line: 12 })] });
    // Two findings on ONE line is still two problems.
    expect(screen.getByText("2 findings")).toBeTruthy();
  });

  it("says '1 finding', not '1 findings'", () => {
    mount({ findings: [finding()] });
    expect(screen.getByText("1 finding")).toBeTruthy();
  });

  it("shows no badge on a file with no findings", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Open the first/ })).toBeNull();
  });

  it("labels a blocker as 'blocker', not 'Critical'", () => {
    mount({ findings: [finding({ severity: "CRITICAL" })] });
    expect(screen.getAllByText(M.severity.blocker).length).toBeGreaterThan(0);
    expect(screen.queryByText("Critical")).toBeNull();
  });
});

/* The navigation, which is what this tab is FOR.

   A badge does not move the reader inside the file — it reports the finding it
   stands for, and the container routes to that finding's card in the Agent-runs
   tab. Every case below therefore asserts an ID: getting the wrong one lands the
   reader on somebody else's problem, which is the failure this feature exists to
   prevent and the one a "did it navigate?" assertion cannot see. */
describe("SmartDiffViewer — where a badge leads", () => {
  const clickFileBadge = () =>
    fireEvent.click(screen.getByRole("button", { name: /Open the first of|Open the finding in/ }));
  const lineBadges = () => screen.getAllByRole("button", { name: /Open this finding|on this line/ });

  it("opens the file's WORST finding, not the first one it was handed", () => {
    mount({
      findings: [
        finding({ id: "sugg", severity: "SUGGESTION", start_line: 11 }),
        finding({ id: "blocker", severity: "CRITICAL", start_line: 13 }),
      ],
    });
    clickFileBadge();
    expect(opened).toEqual(["blocker"]);
  });

  it("opens a finding whose line this patch never rendered", () => {
    // The badge counts it, so the badge must be able to reach it: an off-diff
    // finding has a card like any other, and there is no line to land on.
    mount({ findings: [finding({ id: "off", start_line: 999 })] });
    clickFileBadge();
    expect(opened).toEqual(["off"]);
  });

  it("makes each decorated line a real button of its own", () => {
    mount({
      findings: [
        finding({ id: "on-12", start_line: 12, severity: "CRITICAL" }),
        finding({ id: "on-13", start_line: 13, severity: "WARNING" }),
      ],
    });
    // Keyboard-reachable, like the file badge — `getByRole` is what proves the tag
    // is a `<button>` and not a `<span>` with an onClick.
    expect(lineBadges()).toHaveLength(2);
    fireEvent.click(lineBadges()[1]!);
    expect(opened).toEqual(["on-13"]);
  });

  it("opens the worst finding on a line that hosts several", () => {
    mount({
      findings: [
        finding({ id: "minor", start_line: 12, severity: "SUGGESTION" }),
        finding({ id: "major", start_line: 12, severity: "CRITICAL" }),
      ],
    });
    // One tag stands for both and leads with the worst, so the click follows it.
    fireEvent.click(lineBadges()[0]!);
    expect(opened).toEqual(["major"]);
  });

  it("navigates nowhere on a plain disclosure toggle", () => {
    mount({ findings: [finding()] });
    fireEvent.click(screen.getByText("package-lock.json").closest("button")!);
    fireEvent.click(screen.getByText("src/config.ts").closest("button")!);
    expect(opened).toEqual([]);
  });
});

describe("SmartDiffViewer — line decoration", () => {
  it("puts a severity tag on the finding's line and not on its neighbours", () => {
    mount({ findings: [finding({ severity: "WARNING" })] });
    // One tag on the line, one in the header badge — and not one per rendered row.
    expect(screen.getAllByText(M.severity.warning)).toHaveLength(2);
  });

  /**
   * Only one tag fits on a row, so a line with several findings would otherwise
   * undercount and the header's total could not be reconciled with the tags below it.
   * Measured on a real PR: 31 findings on 23 distinct lines, 8 of them invisible.
   */
  it("multiplies the tag when a line hosts several findings, and leads with the worst", () => {
    mount({
      findings: [
        finding({ id: "a", severity: "SUGGESTION" }),
        finding({ id: "b", severity: "CRITICAL" }),
        finding({ id: "c", severity: "WARNING" }),
      ],
    });
    // All three sit on line 12: one tag, worst severity, ×3.
    expect(screen.getByText(`${M.severity.blocker} ×3`)).toBeTruthy();
    // …and the header badge's total agrees with it.
    expect(screen.getByText("3 findings")).toBeTruthy();
  });

  it("shows no multiplier for a line with a single finding", () => {
    mount({ findings: [finding({ severity: "WARNING" })] });
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.getAllByText(M.severity.warning).length).toBeGreaterThan(0);
  });

  it("reports findings whose line this patch does not contain", () => {
    mount({ findings: [finding({ start_line: 999 })] });
    expect(screen.getByText("1 finding is on lines outside this patch")).toBeTruthy();
  });

  it("says nothing about off-diff findings when every one is anchored", () => {
    mount({ findings: [finding()] });
    expect(screen.queryByText(/on lines outside this patch/)).toBeNull();
  });
});

describe("SmartDiffViewer — the summary row", () => {
  it("quotes the server's summary under a 'What this does:' label", () => {
    mount();
    expect(screen.getByText(M.whatThisDoes)).toBeTruthy();
    expect(screen.getByText("rateLimit, bucketKey")).toBeTruthy();
  });

  it("renders no summary row for a file the server could not summarise", () => {
    mount({ findings: [finding()] });
    // `src/config.ts` is open (it has a finding) and its summary is null, so the
    // label appears once — for the core file — not twice.
    expect(screen.getAllByText(M.whatThisDoes)).toHaveLength(1);
  });
});

describe("SmartDiffViewer — inline commenting still works", () => {
  /**
   * The regression that matters most. Reusing `CodeLine` rather than reimplementing
   * it is the whole reason the barrel was widened; if a future edit forks the line
   * renderer, the hover "+" disappears from this card only and nothing else notices.
   */
  it("offers the add-comment affordance on a hovered line", () => {
    const { container } = mount({
      commenting: {
        comments: [],
        canComment: true,
        showComments: true,
        posting: false,
        onSubmit: vi.fn(),
      },
    });
    const row = container.querySelector("#sd-line-src\\/middleware\\/ratelimit\\.ts-RIGHT-25");
    expect(row).toBeTruthy();
    fireEvent.mouseEnter(row!.parentElement!);
    expect(screen.getByLabelText("Add a comment on this line")).toBeTruthy();
  });
});
