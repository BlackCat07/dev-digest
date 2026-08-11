/* RiskAreas — the chip row's interaction contract.

   `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
   devDependency of this package and every other test file here uses `fireEvent`.

   The load-bearing cases are the two negatives. An unknown `kind` must still
   render, because `Risk.kind` is an open string in the contract and
   `Icon[undefined]` in JSX is the one way this component can crash a route. And
   an empty list must render NOTHING — not a heading, not a "no risks" line — we
   never verified there are none. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Risk } from "@devdigest/shared";
import { RiskAreas } from "./RiskAreas";

afterEach(cleanup);

const SECURITY: Risk = {
  kind: "security",
  title: "Auth surface touched",
  explanation: "The limiter decides who reaches the public API.",
  severity: "high",
  file_refs: ["src/middleware/ratelimit.ts"],
};

const PERF: Risk = {
  kind: "perf",
  title: "Adds a Redis round-trip per request",
  explanation: "Each public request now does an INCR and an EXPIRE.",
  severity: "low",
  file_refs: [],
};

describe("RiskAreas", () => {
  it("renders nothing at all for an empty list", () => {
    const { container } = render(<RiskAreas risks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one button per risk, labelled by its title", () => {
    render(<RiskAreas risks={[SECURITY, PERF]} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Auth surface touched/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redis round-trip/ })).toBeInTheDocument();
  });

  it("keeps every panel closed until a chip is clicked", () => {
    render(<RiskAreas risks={[SECURITY, PERF]} />);
    expect(screen.queryByText(SECURITY.explanation)).not.toBeInTheDocument();
    expect(screen.queryByText(PERF.explanation)).not.toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) {
      expect(b).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("opens a chip to reveal its explanation and the files it cites", () => {
    render(<RiskAreas risks={[SECURITY, PERF]} />);
    fireEvent.click(screen.getByRole("button", { name: /Auth surface touched/ }));

    expect(screen.getByText(SECURITY.explanation)).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Auth surface touched/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("closes the open chip when it is clicked again", () => {
    render(<RiskAreas risks={[SECURITY]} />);
    const chip = screen.getByRole("button", { name: /Auth surface touched/ });

    fireEvent.click(chip);
    expect(screen.getByText(SECURITY.explanation)).toBeInTheDocument();

    fireEvent.click(chip);
    expect(screen.queryByText(SECURITY.explanation)).not.toBeInTheDocument();
  });

  // The assertion that fails if someone reaches for a Set<number> and lets two
  // panels stand open — the block would then grow without bound as chips are
  // clicked, which is the reason it is a single-open disclosure.
  it("shows only one panel at a time — a second chip closes the first", () => {
    render(<RiskAreas risks={[SECURITY, PERF]} />);
    fireEvent.click(screen.getByRole("button", { name: /Auth surface touched/ }));
    fireEvent.click(screen.getByRole("button", { name: /Redis round-trip/ }));

    expect(screen.getByText(PERF.explanation)).toBeInTheDocument();
    expect(screen.queryByText(SECURITY.explanation)).not.toBeInTheDocument();
  });

  it("renders a risk whose kind the client does not know, instead of crashing", () => {
    // `Risk.kind` is `z.string()` on the wire: only the CLASSIFIER is constrained
    // to the closed enum, so a row written by a future vocabulary reaches this
    // component intact and must degrade to a neutral icon.
    const unknown: Risk = { ...SECURITY, kind: "quantum_entanglement", title: "Novel risk" };
    render(<RiskAreas risks={[unknown]} />);

    const chip = screen.getByRole("button", { name: /Novel risk/ });
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByText(unknown.explanation)).toBeInTheDocument();
  });

  it("omits the file list for a risk that cites nothing", () => {
    render(<RiskAreas risks={[PERF]} />);
    fireEvent.click(screen.getByRole("button", { name: /Redis round-trip/ }));
    expect(screen.getByText(PERF.explanation)).toBeInTheDocument();
    // No path-shaped text came along with it.
    expect(screen.queryByText(/\.ts$/)).not.toBeInTheDocument();
  });
});
