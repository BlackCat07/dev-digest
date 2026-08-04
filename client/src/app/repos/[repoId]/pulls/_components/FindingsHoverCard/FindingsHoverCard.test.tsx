import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsHoverPanel, FindingsHoverTrigger } from "./FindingsHoverCard";
import { sortBySeverity, stripMarkdown } from "./helpers";

afterEach(cleanup);

const finding = (o: Partial<FindingRecord> = {}): FindingRecord => ({
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key in commit",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "Line 12 contains a literal `sk_live_` key, which **exposes** it.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
  ...o,
});

function renderPanel(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsHoverPanel", () => {
  it("lists each finding with its file:line", () => {
    renderPanel(<FindingsHoverPanel findings={[finding()]} />);
    expect(screen.getByText("1 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
  });

  it("renders a line RANGE only when start and end differ", () => {
    renderPanel(<FindingsHoverPanel findings={[finding({ start_line: 61, end_line: 74 })]} />);
    expect(screen.getByText("src/config.ts:61-74")).toBeInTheDocument();
  });

  it("strips markdown from the clamped rationale", () => {
    // The body is a two-line clamp, so raw ** / backticks would be visible.
    renderPanel(<FindingsHoverPanel findings={[finding()]} />);
    expect(screen.getByText(/Line 12 contains a literal sk_live_ key, which exposes it\./)).toBeInTheDocument();
  });

  it("makes rows clickable only when a handler is given", () => {
    const onFindingClick = vi.fn();
    const { container } = renderPanel(
      <FindingsHoverPanel findings={[finding()]} onFindingClick={onFindingClick} />,
    );
    const row = container.querySelector('[role="button"]')!;
    expect(row).not.toBeNull();
    (row as HTMLElement).click();
    expect(onFindingClick).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));

    cleanup();
    // On the PR detail page the findings are already on screen, so the panel is a
    // pure preview with nothing to navigate to.
    const { container: plain } = renderPanel(<FindingsHoverPanel findings={[finding()]} />);
    expect(plain.querySelector('[role="button"]')).toBeNull();
  });

  it("shows loading, error and empty states", () => {
    renderPanel(<FindingsHoverPanel findings={[]} loading />);
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();

    cleanup();
    renderPanel(<FindingsHoverPanel findings={[]} error />);
    expect(screen.getByText("Couldn’t load findings.")).toBeInTheDocument();

    cleanup();
    renderPanel(<FindingsHoverPanel findings={[]} />);
    expect(screen.getByText("No findings.")).toBeInTheDocument();
  });
});

describe("FindingsHoverTrigger", () => {
  it("mounts the panel only after a hover, and unmounts on leave", () => {
    vi.useFakeTimers();
    const panel = vi.fn(() => <span>panel body</span>);
    const { container } = render(
      <FindingsHoverTrigger panel={panel}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );

    // Mount-based laziness: the panel factory hasn't run at rest, so a
    // data-fetching panel registers no query until the user hovers.
    expect(panel).not.toHaveBeenCalled();

    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByText("panel body")).toBeInTheDocument();

    fireEvent.mouseLeave(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(300)); // past the close grace period
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("positions the panel with `fixed`, so an overflow:hidden ancestor can't clip it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FindingsHoverTrigger panel={() => <span>panel body</span>}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));
    // jsdom's getBoundingClientRect is all zeros, so assert the positioning
    // STRATEGY rather than the coordinates.
    const panel = screen.getByText("panel body").parentElement!;
    expect(panel.style.position).toBe("fixed");
    vi.useRealTimers();
  });

  it("stays open while scrolling INSIDE the panel", () => {
    // The close-on-scroll listener is capture-phase (the app scrolls an inner
    // <main>, so scroll never reaches window by bubbling) — which also catches
    // the panel's own overflow:auto list. Without the containment check, the
    // first wheel movement over a long findings list shut the panel.
    vi.useFakeTimers();
    const { container } = render(
      <FindingsHoverTrigger panel={() => <span>panel body</span>}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));

    fireEvent.scroll(screen.getByText("panel body"));
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByText("panel body")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("closes when the SCROLLING CONTAINER moves, since a fixed panel can't follow it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <div>
        <FindingsHoverTrigger panel={() => <span>panel body</span>}>
          <span>counters</span>
        </FindingsHoverTrigger>
      </div>,
    );
    fireEvent.mouseEnter(container.firstElementChild!.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByText("panel body")).toBeInTheDocument();

    fireEvent.scroll(document);
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("survives the gap between trigger and panel", () => {
    // Leaving the trigger starts a GRACE timer, not an immediate close: the panel
    // is offset from the trigger, so travelling to it crosses dead space. An
    // immediate close made the panel unreachable AND let the follow-up click fall
    // through to the row underneath, which navigates.
    vi.useFakeTimers();
    const { container } = render(
      <FindingsHoverTrigger panel={() => <span>panel body</span>}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));

    fireEvent.mouseLeave(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(60)); // mid-flight across the gap
    expect(screen.getByText("panel body")).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("panel body").parentElement!);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByText("panel body")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("closes once the pointer leaves the panel too", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FindingsHoverTrigger panel={() => <span>panel body</span>}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));
    const panel = screen.getByText("panel body").parentElement!;
    fireEvent.mouseEnter(panel);
    fireEvent.mouseLeave(panel);
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not open before the hover-intent delay elapses", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FindingsHoverTrigger panel={() => <span>panel body</span>}>
        <span>counters</span>
      </FindingsHoverTrigger>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(50));
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("FindingsHoverCard helpers", () => {
  it("sorts worst-severity first and puts unknown severities last", () => {
    const order = sortBySeverity([
      finding({ id: "s", severity: "SUGGESTION" }),
      finding({ id: "x", severity: "INFO" as FindingRecord["severity"] }),
      finding({ id: "c", severity: "CRITICAL" }),
      finding({ id: "w", severity: "WARNING" }),
    ]).map((f) => f.id);
    expect(order).toEqual(["c", "w", "s", "x"]);
  });

  it("strips bold markers and backticks only", () => {
    expect(stripMarkdown("a **b** `c`")).toBe("a b c");
  });
});
