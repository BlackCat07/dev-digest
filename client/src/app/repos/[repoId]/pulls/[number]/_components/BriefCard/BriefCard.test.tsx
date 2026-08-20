/* BriefCard — the state ladder IS the feature, so there is one case per state.

   Mounted with `NextIntlClientProvider` ALONE and no QueryClient: the card is
   presentational and `OverviewTab` owns both brief hooks. If a data hook ever
   moves into this subtree these tests fail with "No QueryClient set", which is
   the boundary working as designed (`client/INSIGHTS.md`, 2026-08-03).

   Copy is asserted through `M.*` — the real `messages/en/prBrief.json` — never
   through hand-copied literals. A renamed key then fails at TYPECHECK, and a
   card that went back to reading another feature's namespace fails here, because
   only `prBrief` is provided. That is not a hypothetical: the intent card once
   read `brief.json` and rendered "Brief not available yet." on the Intent card
   (`client/INSIGHTS.md`, 2026-08-10).

   `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
   dependency of this package and adding it is a `package.json` + lockfile change
   (`client/INSIGHTS.md`, 2026-08-10). And jsdom synthesises no `click` for Enter
   on a focused native `<button>`, so AC-53's automated half asserts what is
   load-bearing — that every control is a real, tab-reachable element with an
   accessible name — and the activation is dispatched separately. The spec marks
   AC-53 `Verify: demonstration` for exactly this reason. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrRiskBrief, Risk } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prBrief.json";
import { BriefCard, type BriefCardProps } from "./BriefCard";

afterEach(cleanup);

const M = messages;

const WHAT = "Adds a per-tenant token bucket in front of the public API.";
const WHY = "A single tenant's retry storm took the payments endpoints down twice.";

const HIGH_RISK: Risk = {
  kind: "security",
  title: "Auth surface touched",
  explanation: "The limiter decides who reaches the public API.",
  severity: "high",
  // Two refs, one of which the review-focus list also names: a path can legitimately
  // appear as both a risk's reference and a place to look first, and the assertions
  // below have to tell the unlinked label apart from the control.
  file_refs: ["src/middleware/ratelimit.ts", "src/api/public.ts"],
};

const LOW_RISK: Risk = {
  kind: "perf",
  title: "Adds a Redis round-trip per request",
  explanation: "Each public request now does an INCR and an EXPIRE.",
  severity: "low",
  file_refs: [],
};

const BRIEF: PrRiskBrief = {
  pr_id: "pr-1",
  what: WHAT,
  why: WHY,
  risk_level: "high",
  // Stored LOW first, so the worst-first rendering is a real assertion rather
  // than a restatement of the fixture's order.
  risks: [LOW_RISK, HIGH_RISK],
  review_focus: [
    { path: "src/middleware/ratelimit.ts", line: 42, reason: "The limiter itself." },
    { path: "src/config.ts", line: null, reason: "Where the per-tenant limits come from." },
  ],
  diff_stats: {
    files_changed: 12,
    files_listed: 10,
    additions: 240,
    deletions: 18,
    symbols: 5,
    endpoints: 3,
  },
  status: "ok",
  reason: null,
  sources: [{ kind: "pr_title", ref: "pull/482", status: "used", chars: 48, note: null }],
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

/** A brief in one state, built from the happy one so a new contract field cannot
    be forgotten in eight places. */
const brief = (over: Partial<PrRiskBrief> = {}): PrRiskBrief => ({ ...BRIEF, ...over });

function renderCard(props: Partial<BriefCardProps> = {}) {
  const onGenerate = vi.fn();
  const onOpenFile = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ prBrief: M }}>
      <BriefCard
        brief={null}
        isLoading={false}
        isGenerating={false}
        error={null}
        generateError={null}
        onGenerate={onGenerate}
        onOpenFile={onOpenFile}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onGenerate, onOpenFile };
}

/** The given strings — each already asserted to be on screen — sorted into the
    order they are actually READ in, so a failure prints the real order. */
function readingOrder(container: HTMLElement, ...needles: string[]) {
  const text = container.textContent ?? "";
  return [...needles].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

describe("BriefCard", () => {
  it("renders a placeholder shaped like the card while the brief is being read", () => {
    // AC-47. The vendored `Skeleton` is a bare `div.skeleton` with no role and no
    // aria, so the class is the only handle on the bars themselves; the wrapper
    // carries the status role and the accessible name.
    const { container } = renderCard({ isLoading: true });
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", M.loading);
    // A read in flight is not "never generated" and not a failure — mistaking it
    // for either would invite a generation on every page load.
    expect(screen.queryByText(M.empty)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers exactly ONE empty state when no brief has ever been generated", () => {
    // AC-46 — one offer, not one per empty list. An empty risks list, an empty
    // review-focus list and an absent why must not each announce themselves.
    const { onGenerate } = renderCard({
      brief: brief({ generation_state: "never_generated", what: null, why: null }),
    });
    expect(screen.getByText(M.empty)).toBeInTheDocument();
    expect(screen.getByText(M.emptyHint)).toBeInTheDocument();
    expect(screen.queryByText(M.risksNone)).not.toBeInTheDocument();
    expect(screen.queryByText(M.reviewFocusNone)).not.toBeInTheDocument();

    // The state's own control is the offer, in the words that fit it — a brief
    // that never existed cannot be "regenerated".
    expect(screen.queryByRole("button", { name: M.regenerate })).not.toBeInTheDocument();
    const cta = screen.getByRole("button", { name: M.emptyCta });
    fireEvent.click(cta);
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("keeps the previously stored brief on screen while a new generation runs", () => {
    // AC-45. Opening a pull request starts a generation whenever the stored brief
    // no longer matches its state, so `running` is the common case on a first
    // open — blanking the card would hide a readable brief nearly every time.
    renderCard({ brief: brief({ generation_state: "running", stale: true }) });
    expect(screen.getByText(M.running)).toBeInTheDocument();
    expect(screen.getByText(M.runningHint)).toBeInTheDocument();
    expect(screen.getByText(WHAT)).toBeInTheDocument();
    // The running notice already says a newer brief is coming; the stale notice
    // saying it a second way is noise.
    expect(screen.queryByText(M.stale)).not.toBeInTheDocument();
  });

  it("renders the level, the two statements, every risk and a working review-focus row", () => {
    const { container, onOpenFile, onGenerate } = renderCard({ brief: brief() });

    // AC-37 — a word AND an icon, so the level survives the removal of colour.
    const level = screen.getByText(M.level.high);
    expect(level.querySelector("svg")).toBeTruthy();
    expect(screen.getByText(M.levelLabel)).toBeInTheDocument();

    // AC-38 — two separately labelled statements.
    expect(screen.getByText(M.whatLabel)).toBeInTheDocument();
    expect(screen.getByText(WHAT)).toBeInTheDocument();
    expect(screen.getByText(M.whyLabel)).toBeInTheDocument();
    expect(screen.getByText(WHY)).toBeInTheDocument();

    // AC-39 — all four parts of each risk, with the severity as a word plus an
    // icon. `severity.*` and not `level.*`: two vocabularies for two facts, the
    // whole pull request's level and one risk's severity.
    const severity = screen.getByText(M.severity.high);
    expect(severity.querySelector("svg")).toBeTruthy();
    expect(screen.getByText(M.severity.low)).toBeInTheDocument();
    expect(screen.getByText(HIGH_RISK.title)).toBeInTheDocument();
    expect(screen.getByText(HIGH_RISK.explanation)).toBeInTheDocument();
    expect(screen.getByText(M.riskFilesLabel)).toBeInTheDocument();
    expect(screen.getByText("src/api/public.ts")).toBeInTheDocument();
    expect(screen.getByText(LOW_RISK.explanation)).toBeInTheDocument();
    // A risk citing nothing says so rather than showing an empty file row.
    expect(screen.getByText(M.riskNoFiles)).toBeInTheDocument();
    // Worst first, though the fixture stores the low one first.
    expect(readingOrder(container, LOW_RISK.title, HIGH_RISK.title)).toEqual([
      HIGH_RISK.title,
      LOW_RISK.title,
    ]);

    // A cited path is plain TEXT, never a control: without an `href` the shared
    // mono-link primitive renders a button that does nothing, which is worse than
    // a label (EC-33). A review-focus row is the opposite case.
    expect(screen.queryByRole("button", { name: "src/api/public.ts" })).not.toBeInTheDocument();

    // AC-40 — the row is a real control, and it hands the card's caller the path
    // and the line. The card knows about paths; it knows nothing about routes.
    const row = screen.getByRole("button", {
      name: M.reviewFocusOpenLine
        .replace("{path}", "src/middleware/ratelimit.ts")
        .replace("{line}", "42"),
    });
    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts", 42);

    // A row with no line is still a control, and it passes no line rather than
    // the previous row's.
    fireEvent.click(
      screen.getByRole("button", {
        name: M.reviewFocusOpen.replace("{path}", "src/config.ts"),
      }),
    );
    expect(onOpenFile).toHaveBeenLastCalledWith("src/config.ts", null);

    // AC-52 — the figures come from the brief's own recorded values.
    expect(screen.getByText(/6,120 tokens in/)).toBeInTheDocument();
    expect(screen.getByText(/480 tokens out/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.014/)).toBeInTheDocument();
    expect(screen.queryByText(M.costUnpriced)).not.toBeInTheDocument();
    // The deterministic figures, including how many changed files the model was
    // never shown — 12 changed, 10 listed.
    expect(screen.getByText(/12 changed files/)).toBeInTheDocument();
    expect(screen.getByText(/2 changed files were not shown/)).toBeInTheDocument();

    // AC-44's client half: the control is the one mutation, and it is reachable.
    const regenerate = screen.getByRole("button", { name: M.regenerate });
    fireEvent.click(regenerate);
    expect(onGenerate).toHaveBeenCalledOnce();

    // AC-53, the automated half: real, tab-reachable elements with accessible
    // names. jsdom fires no click for Enter on a focused native button, so the
    // activation itself is demonstrated rather than asserted here.
    regenerate.focus();
    expect(regenerate).toHaveFocus();
    row.focus();
    expect(row).toHaveFocus();

    // AC-36's negative half, asserted on this card because the design draws the
    // verdict banner at the top of this very section: none of its figures is
    // here. It is review output, and a brief exists before any agent has run.
    expect(container.textContent).not.toMatch(/blocker|score|Request changes/i);
  });

  it("renders the stale notice above a stored brief that still shows in full", () => {
    // AC-50 — the content AND the notice, with regeneration one control away.
    const { container } = renderCard({ brief: brief({ stale: true }) });
    expect(screen.getByText(M.stale)).toBeInTheDocument();
    expect(screen.getByText(M.staleHint)).toBeInTheDocument();
    expect(screen.getByText(WHAT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: M.regenerate })).toBeEnabled();
    // The caveat reads before what it qualifies.
    expect(readingOrder(container, M.stale, WHAT)).toEqual([M.stale, WHAT]);
  });

  it("names the reason on a partial brief and still renders what the brief holds", () => {
    // AC-48 — the notice and the content are in the tree at once, the shape the
    // blast card already uses for a partial index. `restates_title` is the
    // partial case that also nulls the what, so the why must stand alone.
    renderCard({
      brief: brief({ status: "partial", reason: "restates_title", what: null }),
    });
    expect(screen.getByText(M.partial)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(M.reason.restates_title.slice(0, 40)))).toBeInTheDocument();
    expect(screen.getByText(WHY)).toBeInTheDocument();
    expect(screen.getByText(M.whyLabel)).toBeInTheDocument();
    // A null what renders the why alone, not an empty labelled region.
    expect(screen.queryByText(M.whatLabel)).not.toBeInTheDocument();
    expect(screen.getByText(HIGH_RISK.title)).toBeInTheDocument();
  });

  it("falls back to the generic sentence for a reason it does not recognise", () => {
    // AC-49 — never the enum literal, and never the message-key path `next-intl`
    // prints for a missing message. A degraded brief keeps its figures and drops
    // the model's sections: "no risk was identified" would be a claim, and
    // nobody looked.
    const { container } = renderCard({
      brief: brief({
        status: "degraded",
        // Deliberately outside `BriefReason` — a later lesson can add a twelfth
        // value and this screen must not print it raw.
        reason: "quantum_flux" as PrRiskBrief["reason"],
        what: null,
        why: null,
        risk_level: null,
        risks: [],
        review_focus: [],
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
      }),
    });
    expect(screen.getByText(M.degraded)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(M.reasonUnknown.slice(0, 40)))).toBeInTheDocument();
    expect(container.textContent).not.toContain("quantum_flux");
    expect(container.textContent).not.toContain("prBrief.reason");
    expect(container.textContent).not.toContain("reasonUnknown");
    // The honest half survives: the figures that needed no model.
    expect(screen.getByText(/12 changed files/)).toBeInTheDocument();
    // And nothing claims a quiet pull request.
    expect(screen.queryByText(M.risksNone)).not.toBeInTheDocument();
    expect(screen.queryByText(M.reviewFocusNone)).not.toBeInTheDocument();
    expect(screen.queryByText(M.levelLabel)).not.toBeInTheDocument();
  });

  it("says so in the card when the brief could not be read, and shows nothing it does not have", () => {
    // AC-51 — inline, inside the card. The shell around it is untouched, which
    // `PrDetailView.test.tsx` asserts against the real sidebar and breadcrumb.
    renderCard({ error: new Error("500 Internal Server Error") });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(M.error);
    expect(alert).toHaveTextContent(M.errorHint);
    expect(alert).toHaveTextContent("500 Internal Server Error");
    // A failed READ is not an empty brief and must not offer to generate one as
    // if the pull request had none.
    expect(screen.queryByText(M.empty)).not.toBeInTheDocument();
  });

  it("distinguishes a refused regeneration from a null price, and never reads either as free", () => {
    // Two different silences this feature refuses to keep. First: a generation
    // the server refused because one is already running — the spinner stopping
    // with nothing to show is the failure mode the Intent card's Re-derive
    // button shipped with.
    renderCard({
      brief: brief(),
      generateError: new Error("A brief generation is already running for this pull request."),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("already running");
    expect(screen.getByText(WHAT)).toBeInTheDocument();

    // Second: `cost_usd === null` means no price is KNOWN for this model. `$0`
    // is a real value this app renders for a genuinely free one, so the two must
    // never collapse into one figure.
    cleanup();
    renderCard({ brief: brief({ cost_usd: null }) });
    expect(screen.getByText(M.costUnpriced)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\b/)).not.toBeInTheDocument();
  });
});
