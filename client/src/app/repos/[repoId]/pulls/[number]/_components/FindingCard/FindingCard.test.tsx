import { describe, it, expect, afterEach, vi } from "vitest";
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
