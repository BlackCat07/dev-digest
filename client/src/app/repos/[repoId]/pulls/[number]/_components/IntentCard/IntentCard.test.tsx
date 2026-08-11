/* IntentCard — the state ladder is the feature, so there is one case per state.

   Mounted with `NextIntlClientProvider` ALONE and no QueryClient: the card is
   presentational and `OverviewTab` owns both intent hooks. If a data hook ever
   moves into this subtree these tests fail with "No QueryClient set", which is
   the boundary working as designed (client/INSIGHTS.md, 2026-08-03).

   Copy is asserted through `M.*` — the real `messages/en/intent.json` — not
   through hand-copied literals. A renamed key then fails at TYPECHECK, and a
   card that went back to reading another namespace (it once read `brief`, and
   rendered "Brief not available yet." on the Intent card) fails here, because
   only the `intent` namespace is provided. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/intent.json";
import { IntentCard, type IntentCardProps } from "./IntentCard";

afterEach(cleanup);

const M = messages;

const SENTENCE = "Add per-tenant rate limiting to the public API.";
/** The quote renders wrapped in typographic quote marks, so exact-match would miss. */
const QUOTED = new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const INTENT: PrIntent = {
  pr_id: "pr-1",
  intent: SENTENCE,
  in_scope: ["Token-bucket middleware", "Per-tenant limits in config"],
  out_of_scope: ["Billing and invoicing"],
  head_sha: "abc1234",
  confidence: 0.88,
  sources: [
    { kind: "pr_body", ref: "pull/482#body", status: "used", chars: 812, note: null },
    {
      kind: "linked_issue",
      ref: "acme/payments-api#331",
      status: "unfetched",
      chars: null,
      note: "issue body not reachable",
    },
  ],
  missing_context: ["Linked issue #331 could not be read"],
  risk_areas: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "The limiter decides who reaches the public API.",
      severity: "high",
      file_refs: ["src/middleware/ratelimit.ts"],
    },
    {
      kind: "perf",
      title: "Adds a Redis round-trip",
      explanation: "Each public request now does an INCR.",
      severity: "low",
      file_refs: [],
    },
  ],
  status: "ok",
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  tokens_in: 1200,
  tokens_out: 180,
  cost_usd: 0.0041,
  derived_at: "2026-08-10T09:00:00.000Z",
  error: null,
};

function renderCard(props: Partial<IntentCardProps> = {}) {
  const onRederive = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ intent: M }}>
      <IntentCard
        intent={null}
        isLoading={false}
        isDeriving={false}
        error={null}
        headSha="abc1234"
        onRederive={onRederive}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onRederive };
}

/**
 * The given strings — each already asserted to be on screen — sorted into the
 * order they are actually READ in. Compared against the expected sequence, so a
 * failure prints the real order rather than `false`.
 */
function readingOrder(container: HTMLElement, ...needles: string[]) {
  const text = container.textContent ?? "";
  return [...needles].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

describe("IntentCard", () => {
  it("shows skeletons, and neither an error nor an empty state, while the intent is being read", () => {
    // A read in flight must not be mistaken for "never derived" — that would
    // invite a re-derive on every page load.
    const { container } = renderCard({ isLoading: true });
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText(M.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a failed READ distinctly from a derivation that recorded status 'failed'", () => {
    // Two different failures: the GET broke, versus the classifier ran and lost.
    // Collapsing them would tell the user to re-derive when the API is down.
    renderCard({ error: new Error("500 Internal Server Error") });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(M.card.error);
    expect(alert).toHaveTextContent("500 Internal Server Error");
    expect(screen.queryByText(M.card.failed)).not.toBeInTheDocument();
  });

  it("offers the empty state and a working re-derive control when the PR was never classified", () => {
    const { onRederive } = renderCard({ intent: null });
    expect(screen.getByText(M.unavailable)).toBeInTheDocument();
    expect(screen.getByText(M.unavailableHint)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: M.card.rederive });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onRederive).toHaveBeenCalledOnce();
  });

  it("replaces the whole body while a derivation is in flight, on top of a previous answer", () => {
    // The load-bearing half is the SECOND render: a re-derive over an existing
    // intent must not leave the old sentence on screen next to a "deriving" note,
    // because the stale text still reads as current. It is replaced.
    const { container, unmount } = renderCard({ intent: INTENT, isDeriving: true });
    expect(screen.queryByText(QUOTED)).not.toBeInTheDocument();
    expect(screen.queryByText(M.card.riskAreas)).not.toBeInTheDocument();
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: M.card.deriving })).toBeDisabled();
    unmount();

    // And with nothing stored yet, the empty state gives way to the same thing.
    renderCard({ intent: null, isDeriving: true });
    expect(screen.queryByText(M.unavailable)).not.toBeInTheDocument();
  });

  it("renders a failed derivation as its message and gaps — never as an intent quote", () => {
    // `intent` text is deliberately still present on this row: the failed branch
    // must not quote it, whatever the row happens to carry.
    renderCard({
      intent: { ...INTENT, status: "failed", error: "model call timed out after 30s" },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(M.card.failed);
    expect(alert).toHaveTextContent("model call timed out after 30s");

    expect(screen.getByText(M.card.missingContext)).toBeInTheDocument();
    expect(screen.getByText("Linked issue #331 could not be read")).toBeInTheDocument();

    expect(screen.queryByText(QUOTED)).not.toBeInTheDocument();
    expect(screen.queryByText("88%")).not.toBeInTheDocument();
  });

  it("renders an 'ok' derivation in full, with the confidence in the header and the gap last", () => {
    const { container } = renderCard({ intent: INTENT });

    expect(screen.getByText(QUOTED)).toBeInTheDocument();
    expect(screen.getByText(M.card.inScope)).toBeInTheDocument();
    expect(screen.getByText("Token-bucket middleware")).toBeInTheDocument();
    expect(screen.getByText(M.card.outOfScope)).toBeInTheDocument();
    expect(screen.getByText("Billing and invoicing")).toBeInTheDocument();
    expect(screen.getByText(M.card.confidence)).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText(M.card.missingContext)).toBeInTheDocument();
    // The audit trail is deliberately NOT on the card — it is stored and logged,
    // but it is not what a reader of a PR needs.
    expect(screen.queryByText("acme/payments-api#331")).not.toBeInTheDocument();

    // ORDER, not presence, twice over. The confidence sits in the card's HEADER,
    // so it is read before the intent sentence rather than buried under the
    // columns; and a gap the derivation did not itself flag is reported last.
    expect(readingOrder(container, M.card.confidence, SENTENCE)).toEqual([
      M.card.confidence,
      SENTENCE,
    ]);
    expect(readingOrder(container, M.card.missingContext, SENTENCE)).toEqual([
      SENTENCE,
      M.card.missingContext,
    ]);
  });

  it("keeps the gap LAST on a 'partial' derivation, exactly as on an 'ok' one", () => {
    // `partial` used to promote the gap above the intent sentence. That put
    // "Could not read X" between the card's header and the sentence it qualifies,
    // where it read as an error banner on a card that is not in error — a
    // `partial` derivation still produced a perfectly good intent. The position is
    // now the same for every status, so the block is where a reader learns to look.
    const { container } = renderCard({ intent: { ...INTENT, status: "partial" } });

    expect(screen.getByText(M.card.missingContext)).toBeInTheDocument();
    expect(screen.getByText(QUOTED)).toBeInTheDocument();
    expect(
      readingOrder(container, M.card.missingContext, SENTENCE, M.card.riskAreas),
    ).toEqual([SENTENCE, M.card.riskAreas, M.card.missingContext]);
  });

  it("paints the risk areas between the scope columns and the derivation's receipt", () => {
    // The ORDER is the assertion, not merely the presence. The mock puts risk
    // areas under a divider below the scope columns and above the card's own
    // receipt, and an ordering bug in exactly this region once survived green
    // typecheck, eslint and the whole suite (see this spec's History) because the
    // tests only checked that things were on screen.
    const { container } = renderCard({ intent: INTENT });

    expect(screen.getByText(M.card.riskAreas)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Auth surface touched/ })).toBeInTheDocument();
    expect(readingOrder(container, M.card.inScope, M.card.riskAreas)).toEqual([
      M.card.inScope,
      M.card.riskAreas,
    ]);
  });

  it("omits the whole risk block, heading included, when the derivation found none", () => {
    // Not an empty state and not a "no risks" reassurance: we never verified that
    // there are none, so the card says nothing at all.
    renderCard({ intent: { ...INTENT, risk_areas: [] } });
    expect(screen.queryByText(M.card.riskAreas)).not.toBeInTheDocument();
  });

  it("notes an intent derived from an earlier commit only when BOTH head SHAs are known and differ", () => {
    renderCard({ intent: { ...INTENT, head_sha: "0ld0ld0" }, headSha: "abc1234" });
    expect(screen.getByText(M.card.staleHeadSha)).toBeInTheDocument();
    cleanup();

    // Same SHA: current, so no note.
    renderCard({ intent: INTENT, headSha: "abc1234" });
    expect(screen.queryByText(M.card.staleHeadSha)).not.toBeInTheDocument();
    cleanup();

    // Either side unknown is NOT evidence of staleness — a missing SHA would
    // otherwise nag on every card that never recorded one.
    renderCard({ intent: { ...INTENT, head_sha: "0ld0ld0" }, headSha: null });
    expect(screen.queryByText(M.card.staleHeadSha)).not.toBeInTheDocument();
    cleanup();

    renderCard({ intent: { ...INTENT, head_sha: null }, headSha: "abc1234" });
    expect(screen.queryByText(M.card.staleHeadSha)).not.toBeInTheDocument();
  });
});
