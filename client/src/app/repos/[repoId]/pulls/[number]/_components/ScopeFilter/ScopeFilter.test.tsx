/* ScopeFilter — same ISOLATE semantics as its neighbour `SeverityFilter`, on a
   second, orthogonal axis. These cases are deliberately the shape of
   `SeverityFilter.test.tsx`: if the two units ever drift apart, the divergence
   shows up as one of these failing rather than as a screen that filters
   differently depending on which chip row you use.

   The counts here arrive as a prop; that they tally only LABELLED findings is
   `countByScope`'s job and is pinned end to end in `FindingsPanel.test.tsx`. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingScope } from "@devdigest/shared";
import type { FindingsByScope } from "@/lib/scope";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ScopeFilter } from "./ScopeFilter";

afterEach(cleanup);

const COUNTS: FindingsByScope = { in_scope: 4, out_of_scope: 2 };

function tree(counts: FindingsByScope, active: FindingScope | null, onChange: (n: FindingScope | null) => void) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ScopeFilter counts={counts} active={active} onChange={onChange} />
    </NextIntlClientProvider>
  );
}

function renderFilter(counts: FindingsByScope = COUNTS, active: FindingScope | null = null) {
  const onChange = vi.fn();
  const utils = render(tree(counts, active, onChange));
  return {
    ...utils,
    onChange,
    setActive: (next: FindingScope | null) => utils.rerender(tree(counts, next, onChange)),
  };
}

describe("ScopeFilter", () => {
  it("shows both scope labels with their counts, in a labelled filter group", () => {
    renderFilter();
    expect(
      screen.getByRole("group", { name: messages.scopeFilter.label }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /In scope\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Out of scope\s*2/ })).toBeInTheDocument();
  });

  it("isolates a scope on click, and clears the filter when the ACTIVE chip is clicked again", () => {
    const { onChange, setActive } = renderFilter();

    fireEvent.click(screen.getByRole("button", { name: /Out of scope/ }));
    expect(onChange).toHaveBeenLastCalledWith("out_of_scope");

    // Isolate semantics: the same chip toggles OFF rather than staying stuck on
    // one scope — the default (null) is the only state that shows everything.
    setActive("out_of_scope");
    fireEvent.click(screen.getByRole("button", { name: /Out of scope/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("switches straight from one scope to the other", () => {
    const { onChange } = renderFilter(COUNTS, "in_scope");
    fireEvent.click(screen.getByRole("button", { name: /Out of scope/ }));
    expect(onChange).toHaveBeenLastCalledWith("out_of_scope");
  });

  it("dims a scope with nothing to isolate, but never the active one", () => {
    // Dimming the active chip at zero count would make the filter unclearable
    // from here — the same invariant SeverityFilter pins.
    const { container } = renderFilter({ in_scope: 4, out_of_scope: 0 });
    expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();
    cleanup();

    const { container: c2, onChange } = renderFilter(
      { in_scope: 4, out_of_scope: 0 },
      "out_of_scope",
    );
    expect(c2.querySelector('[aria-disabled="true"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Out of scope/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
