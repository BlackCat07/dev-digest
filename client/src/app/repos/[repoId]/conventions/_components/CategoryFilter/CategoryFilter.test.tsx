import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CategoryFilter } from "./CategoryFilter";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "naming", label: "Naming" },
  { value: "structure", label: "Structure" },
];

describe("CategoryFilter", () => {
  it("is a real select, so keyboard and screen readers keep working", () => {
    // The whole reason this control is hand-rolled is its box model; the
    // semantics must stay the platform's.
    render(
      <CategoryFilter value="all" options={OPTIONS} onChange={() => {}} ariaLabel="All categories" />,
    );
    expect(screen.getByRole("combobox", { name: "All categories" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("reports the chosen value", () => {
    const onChange = vi.fn();
    render(
      <CategoryFilter value="all" options={OPTIONS} onChange={onChange} ariaLabel="All categories" />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "naming" } });
    expect(onChange).toHaveBeenCalledWith("naming");
  });

  it("borrows Button's md metrics so it lines up in a row of buttons", () => {
    // These four numbers are the contract with `vendor/ui/primitives/Button.tsx`
    // and the only reason this unit exists. If Button's `md` size changes, this
    // test is what says so.
    render(
      <CategoryFilter value="all" options={OPTIONS} onChange={() => {}} ariaLabel="All categories" />,
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveStyle({ fontSize: "13px", borderRadius: "6px", lineHeight: "1.2" });
    expect(select.style.paddingTop).toBe("7px");
    expect(select.style.paddingBottom).toBe("7px");
  });
});
