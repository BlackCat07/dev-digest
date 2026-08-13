import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("logs no style shorthand/longhand warning when `focused` flips", () => {
    // The card sets a per-side borderLeft*, so ANY border shorthand alongside it
    // (`border`, but also `borderColor` / `borderWidth`) makes React warn
    // "Updating a style property during rerender (borderColor) when a conflicting
    // property is set (borderLeftColor)" as soon as the shorthand's value
    // changes. `focused` changes on every severity-filter change and every j/k
    // move, so this fired constantly in the console.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = renderWithIntl(<FindingCard f={FINDING} focused={false} />);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} focused />
      </NextIntlClientProvider>,
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} focused={false} />
      </NextIntlClientProvider>,
    );
    const conflicts = err.mock.calls.filter((c) => String(c[0]).includes("conflicting property"));
    expect(conflicts).toEqual([]);
    err.mockRestore();
  });
});

/**
 * L03 — the scope badge (client spec Behaviour #13).
 *
 * The load-bearing half is the NEGATIVE case: an in-scope finding and an
 * UNLABELLED one (every finding written before the Intent Layer, and every
 * finding from a PR whose intent could not be derived) must render with no scope
 * marker at all — visually identical to a pre-L03 card. A badge that appeared on
 * those would relabel the entire existing findings history, and nothing else in
 * the suite would notice.
 */
describe("FindingCard — out-of-scope badge", () => {
  const OUT_OF_SCOPE = "out of scope";

  it("badges a finding the reviewer labelled out_of_scope", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: "out_of_scope" }} onAction={() => {}} />);
    expect(screen.getByText(OUT_OF_SCOPE)).toBeInTheDocument();
  });

  it("shows no scope marker for an in-scope finding", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: "in_scope" }} onAction={() => {}} />);
    expect(screen.queryByText(OUT_OF_SCOPE)).not.toBeInTheDocument();
  });

  // Both spellings of "unlabelled": the column is nullish in the contract, so a
  // row can arrive as null (written since the migration) or with the key absent
  // (parsed from an older payload). Neither may be badged.
  it.each([
    ["null", { scope: null }],
    ["absent", {}],
  ])("shows no scope marker when scope is %s", (_label, patch) => {
    renderWithIntl(<FindingCard f={{ ...FINDING, ...patch }} onAction={() => {}} />);
    expect(screen.queryByText(OUT_OF_SCOPE)).not.toBeInTheDocument();
  });
});

/* The last step of a badge press in Smart Diff: the card brings ITSELF into view.

   jsdom does not implement `scrollIntoView` at all — the property is `undefined`,
   so `vi.spyOn` throws "does not exist" and it has to be assigned. */
describe("FindingCard — landing on a targeted card", () => {
  // `src/test/setup.ts` shims `scrollIntoView` (jsdom has none), so this can be a
  // plain spy — no assignment onto the prototype, and nothing left behind for the
  // next file.
  let scrollIntoView: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  });
  afterEach(() => scrollIntoView.mockRestore());

  it("scrolls into view when it is the finding the screen was navigated to", () => {
    renderWithIntl(<FindingCard f={FINDING} targeted defaultExpanded onAction={() => {}} />);
    // `start`, not `center`: a long rationale makes this card taller than the
    // viewport, and only `start` guarantees the TITLE is what the reader sees.
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("does not scroll a card nobody asked for", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls once, not on every re-render", () => {
    // Accepting, dismissing or a background refetch re-renders this card with
    // `targeted` still true; without the ref guard each would yank the page back
    // while the reader was somewhere else.
    const { rerender } = renderWithIntl(
      <FindingCard f={FINDING} targeted defaultExpanded onAction={() => {}} />,
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard
          f={{ ...FINDING, accepted_at: "2026-08-12T10:00:00.000Z" }}
          targeted
          defaultExpanded
          onAction={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
