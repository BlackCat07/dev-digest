/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

const finding = (o: Partial<FindingRecord> = {}): FindingRecord => ({
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key in commit",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A live key is committed.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rv1",
  accepted_at: null,
  dismissed_at: null,
  ...o,
});

/** Findings for run-1, `n` per level — the counters are derived from these. */
function findingsFor(crit: number, warn: number, sugg: number): Map<string, FindingRecord[]> {
  const mk = (severity: FindingRecord["severity"], n: number) =>
    Array.from({ length: n }, (_, i) => finding({ id: `${severity}-${i}`, severity }));
  return new Map([
    ["run-1", [...mk("CRITICAL", crit), ...mk("WARNING", warn), ...mk("SUGGESTION", sugg)]],
  ]);
}

function renderRuns(
  runs: RunSummary[],
  findingsByRunId?: Map<string, FindingRecord[]>,
  onGoToReview?: (runId: string) => void,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory
        runs={runs}
        onOpenTrace={() => {}}
        {...(findingsByRunId ? { findingsByRunId } : {})}
        {...(onGoToReview ? { onGoToReview } : {})}
      />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — cost badge", () => {
  it("a settled run shows its token total and cost", () => {
    renderRuns([
      run({ status: "done", cost_usd: 0.0013, tokens_in: 8200, tokens_out: 919, blockers: 0 }),
    ]);
    expect(screen.getByText("9,119 tok")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it('a settled run with no cost data shows "—", not "$0.00"', () => {
    renderRuns([
      run({ status: "done", cost_usd: null, tokens_in: 8200, tokens_out: 919, blockers: 0 }),
    ]);
    expect(screen.getByText("9,119 tok")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("an unsettled run shows no cost badge at all", () => {
    // failed/running rows carry zeroed tokens and no cost — a badge there would
    // read "— · —" beside the error text.
    renderRuns([run({ status: "failed", error: "429 quota exceeded", cost_usd: null })]);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — severity counters replace the findings text", () => {
  it("renders the per-severity counters, and NO 'N findings' text", () => {
    // The counters ARE the breakdown; a total beside them was redundant and is
    // absent from the design.
    renderRuns(
      [run({ status: "done", findings_count: 6, blockers: 2, score: 41 })],
      findingsFor(2, 3, 1),
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/finding/)).not.toBeInTheDocument();
    expect(screen.getByText("2 blockers")).toBeInTheDocument();
  });

  it("separates counters from blockers with a '·'", () => {
    renderRuns(
      [run({ status: "done", findings_count: 6, blockers: 2, score: 41 })],
      findingsFor(2, 3, 1),
    );
    // Scoped to the counter line — the cost badge renders its own "tok · $" dot.
    expect(screen.getByText("2 blockers").parentElement!.textContent).toContain("·");
  });

  it("omits the leading '·' when a run has blockers but no severity split", () => {
    // Reachable: a review row with run_id = null, or a deleted review, leaves
    // agent_runs.blockers set with nothing to join a breakdown from.
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("5 blockers").parentElement!.textContent).toBe("5 blockers");
  });

  it("renders no counter line at all for a clean run", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/finding/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — findings hover panel on the counters", () => {
  const hoverCounters = (container: HTMLElement) => {
    // The trigger is the `cursor: help` wrapper the hover card puts around the
    // counters.
    const trigger = [...container.querySelectorAll("span")].find(
      (el) => el.style.cursor === "help",
    );
    expect(trigger).toBeDefined();
    fireEvent.mouseEnter(trigger!);
    act(() => void vi.advanceTimersByTime(200));
  };

  it("opens a panel with THIS run's findings on hover", () => {
    vi.useFakeTimers();
    const { container } = renderRuns(
      [run({ status: "done", findings_count: 6, blockers: 2, score: 41 })],
      findingsFor(2, 3, 1),
    );
    expect(screen.queryByText(/findings/)).not.toBeInTheDocument();

    hoverCounters(container);
    // 6 = this run's own total, not the PR-wide one.
    expect(screen.getByText("6 findings")).toBeInTheDocument();
    expect(screen.getAllByText("Hardcoded Stripe secret key in commit").length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("jumps to this run's accordion when a finding is clicked", () => {
    vi.useFakeTimers();
    const onGoToReview = vi.fn();
    const { container } = renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 1, score: 53 })],
      findingsFor(1, 1, 0),
      onGoToReview,
    );
    hoverCounters(container);
    fireEvent.click(screen.getAllByText("Hardcoded Stripe secret key in commit")[0]!);
    expect(onGoToReview).toHaveBeenCalledWith("run-1");
    vi.useRealTimers();
  });

  it("attaches no hover target when the run has no findings", () => {
    const { container } = renderRuns([
      run({ status: "done", findings_count: 0, blockers: 0, score: 95 }),
    ]);
    const trigger = [...container.querySelectorAll("span")].find(
      (el) => el.style.cursor === "help",
    );
    expect(trigger).toBeUndefined();
  });
});
