import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: (id: string | null) => usePrReviews(id) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PrFindingsCell } from "./PrFindingsCell";

afterEach(() => {
  cleanup();
  usePrReviews.mockReset();
  push.mockReset();
});

const review = (o: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: "rv1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: null,
  score: 61,
  model: "seed",
  created_at: "2026-06-01T09:00:00.000Z",
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
  ],
  ...o,
});

const pr = (o: Partial<PrMeta> = {}): PrMeta =>
  ({
    id: "pr-1",
    number: 482,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rl",
    base: "main",
    head_sha: "abc1234",
    additions: 1,
    deletions: 1,
    files_count: 1,
    status: "needs_review",
    score: 61,
    cost_usd: 0.014,
    findings_by_severity: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
    ...o,
  }) as PrMeta;

function renderCell(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PrFindingsCell pr={meta} repoId="r1" title="tip" />
    </NextIntlClientProvider>,
  );
}

describe("PrFindingsCell", () => {
  it("renders counters straight from the list payload, with no fetch", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const { container } = renderCell(
      pr({ findings_by_severity: { CRITICAL: 2, WARNING: 1, SUGGESTION: 0 } }),
    );
    expect(container.textContent).toBe("21");
    // Counters come with the row; the hook only mounts on hover.
    expect(usePrReviews).not.toHaveBeenCalled();
  });

  it("fetches and shows the findings on hover", () => {
    vi.useFakeTimers();
    usePrReviews.mockReturnValue({ data: [review()], isLoading: false, isError: false });
    const { container } = renderCell(pr());

    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));

    expect(usePrReviews).toHaveBeenCalledWith("pr-1");
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("counts only kind==='review' rows, matching the server rollup", () => {
    vi.useFakeTimers();
    usePrReviews.mockReturnValue({
      data: [review({ kind: "summary" })],
      isLoading: false,
      isError: false,
    });
    const { container } = renderCell(pr());
    fireEvent.mouseEnter(container.firstElementChild!);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByText("No findings.")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("attaches no hover panel when there is nothing to show", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const { container } = renderCell(
      pr({ findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }),
    );
    expect(container.textContent).toBe("—");
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(usePrReviews).not.toHaveBeenCalled();
  });

  it("attaches no hover panel when the row carries no id to fetch with", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const { container } = renderCell(pr({ id: null }));
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(usePrReviews).not.toHaveBeenCalled();
  });

  it("routes a clicked finding to the Agent runs tab, not the row's default tab", () => {
    // The row's own click goes to the PR's default tab (Overview) — landing there
    // after clicking a finding is disorienting, so the panel handles the click
    // itself and deep-links to where the findings actually are.
    vi.useFakeTimers();
    usePrReviews.mockReturnValue({ data: [review()], isLoading: false, isError: false });
    const onRowClick = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div onClick={onRowClick}>
          <PrFindingsCell pr={pr()} repoId="r1" />
        </div>
      </NextIntlClientProvider>,
    );
    fireEvent.mouseEnter(container.querySelector("span")!);
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key in commit"));

    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/482?tab=findings");
    // ...and the row's handler must NOT also fire, or the two navigations race.
    expect(onRowClick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
