/**
 * ReviewRunAccordion — the COLLAPSED header. Two design rules live here:
 * the header is text-only (the coloured severity counters belong to the TIMELINE
 * rows), and it carries the run's cost between the score and the timestamp.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

const review = (o: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: "rv1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "Two problems.",
  score: 38,
  model: "deepseek/deepseek-v4-flash",
  created_at: "2026-06-13T20:52:51.000Z",
  findings: [
    {
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
    },
    {
      id: "f2",
      severity: "WARNING",
      category: "perf",
      title: "N+1 query in user list endpoint",
      file: "src/api/users.ts",
      start_line: 45,
      end_line: 52,
      rationale: "One query per user.",
      suggestion: null,
      confidence: 0.86,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rv1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
  ...o,
});

const runSummary = (o: Partial<RunSummary> = {}): RunSummary => ({
  run_id: "run-1",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  status: "done",
  error: null,
  duration_ms: 1000,
  tokens_in: 8200,
  tokens_out: 919,
  cost_usd: 0.0013,
  findings_count: 2,
  grounding: "2/2 passed",
  ran_at: "2026-06-13T20:52:51.000Z",
  score: 38,
  blockers: 1,
  ...o,
});

function renderAccordion(run: RunSummary | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={review()} run={run} prId="pr-1" />
    </NextIntlClientProvider>,
  );
}

describe("ReviewRunAccordion — collapsed header", () => {
  it("shows the run's cost", () => {
    renderAccordion(runSummary());
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it('shows "—" when the run reported no cost, never "$0.00"', () => {
    // null cost = no price known for the model; 0 would mean a genuinely free run.
    renderAccordion(runSummary({ cost_usd: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows no cost slot at all when no run row was joined in", () => {
    // A review with run_id = null (the seeded one) has no usage to report — a
    // lone "—" there would read as "this run was free".
    renderAccordion(null);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("keeps the textual finding summary that e2e flow 04 waits on", () => {
    renderAccordion(runSummary());
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blocker/)).toBeInTheDocument();
  });

  it("renders NO severity counters — those belong to the timeline rows", () => {
    const { container } = renderAccordion(runSummary());
    const bareSpanText = () =>
      [...container.querySelectorAll("span")].map((el) => el.textContent?.trim());

    // Positive control: the selector really does see bare-number spans, so the
    // negative assertion below cannot pass vacuously. 38 is the score badge.
    expect(bareSpanText()).toContain("38");

    // SeverityCounters would add `<span class="tnum">1</span>` per non-zero level
    // — here one CRITICAL and one WARNING, i.e. two bare "1"s. (Don't assert on
    // `.tnum` itself: RunCostBadge legitimately carries that class too.)
    expect(bareSpanText().filter((t) => t === "1")).toEqual([]);
  });
});
