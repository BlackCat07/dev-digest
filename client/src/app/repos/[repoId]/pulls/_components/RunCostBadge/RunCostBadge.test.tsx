import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";

// No NextIntlClientProvider needed: the component renders no prose.
describe("RunCostBadge", () => {
  it("compact renders the cost alone", () => {
    render(<RunCostBadge costUsd={0.014} />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("detail leads with the token total, then the cost", () => {
    const { container } = render(
      <RunCostBadge costUsd={0.0013} tokensIn={8200} tokensOut={919} variant="detail" />,
    );
    expect(screen.getByText("9,119 tok")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
    expect(container.textContent).toBe("9,119 tok·$0.0013");
  });

  it("inline leads with the cost, then the token flow", () => {
    const { container } = render(
      <RunCostBadge costUsd={0.014} tokensIn={8200} tokensOut={1300} variant="inline" />,
    );
    expect(container.textContent).toBe("$0.014·8.2K→1.3K");
  });

  it('renders "—" for a null cost in every variant', () => {
    const { container: compact } = render(<RunCostBadge costUsd={null} />);
    expect(compact.textContent).toBe("—");

    const { container: detail } = render(
      <RunCostBadge costUsd={null} tokensIn={8200} tokensOut={919} variant="detail" />,
    );
    // Tokens survive even when the cost is unknown — they come from a different column.
    expect(detail.textContent).toBe("9,119 tok·—");

    const { container: inline } = render(
      <RunCostBadge costUsd={null} tokensIn={null} tokensOut={null} variant="inline" />,
    );
    expect(inline.textContent).toBe("—·—");
  });

  it('renders a free run as "$0", distinct from missing data', () => {
    const { container } = render(<RunCostBadge costUsd={0} />);
    expect(container.textContent).toBe("$0");
  });

  it("passes the tooltip through", () => {
    render(<RunCostBadge costUsd={0.014} title="Cost of the latest completed run" />);
    expect(screen.getByTitle("Cost of the latest completed run")).toBeInTheDocument();
  });
});
