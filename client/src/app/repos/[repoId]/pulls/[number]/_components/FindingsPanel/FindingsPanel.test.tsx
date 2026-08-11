import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "One query per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity isolate filter", () => {
  // The filter is OWNED by this panel (one chip row per review run), so these
  // drive the real chips rather than passing a prop.
  const chip = (level: string) => screen.getByRole("button", { name: new RegExp(level) });

  it("renders a chip per level, counting only this run's findings", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chip("Critical")).toHaveTextContent("1");
    expect(chip("Warning")).toHaveTextContent("1");
    expect(chip("Suggestion")).toHaveTextContent("0");
  });

  it("shows every finding until a level is isolated", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("isolates a level on click", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("clears the filter when the active chip is clicked again", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("switches straight from one level to another", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("shows the empty state for a level this run has none of", () => {
    // Suggestion is at 0 here, so its chip is dimmed — assert via a run that has
    // only one level, where isolating the other is reachable.
    renderWithIntl(<FindingsPanel findings={[FINDINGS[0]!]} prId="pr1" />);
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("No findings match")).not.toBeInTheDocument();
  });

  it("renders no chip row for a run with no findings", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.queryByRole("button", { name: /Critical/ })).not.toBeInTheDocument();
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — scope isolate filter", () => {
  // The scope row is a SECOND, orthogonal isolate beside the severity chips, and
  // this panel owns its state, so these drive the real chips. The third finding
  // is UNLABELLED on purpose: it stands for every finding written before the
  // Intent Layer.
  const SCOPED: FindingRecord[] = [
    { ...FINDINGS[0]!, scope: "in_scope" },
    { ...FINDINGS[1]!, scope: "out_of_scope" },
    { ...FINDINGS[1]!, id: "f3", title: "Limiter has no test", severity: "SUGGESTION" },
  ];

  it("counts only LABELLED findings, so the two chips can sum to less than the list", () => {
    renderWithIntl(<FindingsPanel findings={SCOPED} prId="pr1" />);
    expect(screen.getByRole("button", { name: /In scope\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Out of scope\s*1/ })).toBeInTheDocument();
    // 1 + 1, with three findings on screen — the unlabelled one is in neither
    // bucket, and is still shown.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Limiter has no test")).toBeInTheDocument();
  });

  it("isolating a scope hides the unlabelled findings too, until the chip is cleared", () => {
    renderWithIntl(<FindingsPanel findings={SCOPED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /In scope/ }));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    // The sharp edge: "show only in-scope" excludes anything that does not
    // actually carry the label.
    expect(screen.queryByText("Limiter has no test")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /In scope/ }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Limiter has no test")).toBeInTheDocument();
  });
});
