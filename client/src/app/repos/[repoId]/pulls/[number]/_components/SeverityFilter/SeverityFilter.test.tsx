import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { SeverityFilter } from "./SeverityFilter";

afterEach(cleanup);

const COUNTS = { CRITICAL: 3, WARNING: 5, SUGGESTION: 2 };

function renderFilter(props: Partial<React.ComponentProps<typeof SeverityFilter>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <SeverityFilter counts={COUNTS} active={null} onChange={onChange} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onChange };
}

describe("SeverityFilter", () => {
  it("shows every level with its count", () => {
    renderFilter();
    expect(screen.getByRole("button", { name: /Critical\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Warning\s*5/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Suggestion\s*2/ })).toBeInTheDocument();
  });

  it("isolates a level on click", () => {
    const { onChange } = renderFilter();
    screen.getByRole("button", { name: /Critical/ }).click();
    expect(onChange).toHaveBeenCalledWith("CRITICAL");
  });

  it("clears the filter when the ACTIVE level is clicked again", () => {
    // Isolate semantics: the same chip toggles off rather than switching levels.
    const { onChange } = renderFilter({ active: "CRITICAL" });
    screen.getByRole("button", { name: /Critical/ }).click();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("switches directly from one level to another", () => {
    const { onChange } = renderFilter({ active: "CRITICAL" });
    screen.getByRole("button", { name: /Warning/ }).click();
    expect(onChange).toHaveBeenCalledWith("WARNING");
  });

  it("dims a level with nothing to isolate", () => {
    const { container } = renderFilter({ counts: { CRITICAL: 0, WARNING: 5, SUGGESTION: 2 } });
    expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();
  });

  it("never dims the ACTIVE level, even at zero count", () => {
    // Otherwise a filter set to a level the data lacks becomes unclearable.
    const { container, onChange } = renderFilter({
      counts: { CRITICAL: 0, WARNING: 5, SUGGESTION: 2 },
      active: "CRITICAL",
    });
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
    screen.getByRole("button", { name: /Critical/ }).click();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
