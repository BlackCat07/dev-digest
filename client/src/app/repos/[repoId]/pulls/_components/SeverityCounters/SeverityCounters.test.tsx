import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

describe("SeverityCounters", () => {
  it("renders only non-zero levels, worst first", () => {
    const { container } = render(
      <SeverityCounters counts={{ CRITICAL: 2, WARNING: 0, SUGGESTION: 3 }} />,
    );
    // Zero levels are dropped entirely — the strip stays short on wide tables.
    expect(container.textContent).toBe("23");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("orders CRITICAL before WARNING before SUGGESTION", () => {
    const { container } = render(
      <SeverityCounters counts={{ CRITICAL: 1, WARNING: 2, SUGGESTION: 3 }} />,
    );
    expect(container.textContent).toBe("123");
  });

  it('renders "—" for an all-zero set when zero="dash"', () => {
    render(<SeverityCounters counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} zero="dash" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it('renders NOTHING for an all-zero set when zero="hide"', () => {
    // Load-bearing for the timeline: a dash there would collide with the cost
    // badge's own "—" (RunHistory.test.tsx asserts a single dash in the row).
    const { container } = render(
      <SeverityCounters counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} zero="hide" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("treats absent counts exactly like all-zero", () => {
    const { container: nullish } = render(<SeverityCounters counts={null} zero="hide" />);
    expect(nullish).toBeEmptyDOMElement();

    cleanup();
    render(<SeverityCounters counts={undefined} zero="dash" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("passes the native tooltip through on both branches", () => {
    const { container } = render(
      <SeverityCounters counts={{ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }} title="tip" />,
    );
    expect(container.querySelector('[title="tip"]')).not.toBeNull();

    cleanup();
    const { container: empty } = render(
      <SeverityCounters counts={null} zero="dash" title="tip" />,
    );
    expect(empty.querySelector('[title="tip"]')).not.toBeNull();
  });
});
