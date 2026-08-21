import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { VerdictBanner } from "./VerdictBanner";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VerdictBanner (smoke)", () => {
  it("shows verdict label + score + finding/blocker counts", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/1 findings · 1 blockers/)).toBeInTheDocument();
  });

  it("shows the run's cost + token flow when usage is supplied", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
      />,
    );
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8.2K→1.3K")).toBeInTheDocument();
  });

  it("omits the cost row entirely when there is no cost", () => {
    // The banner is also rendered for reviews whose run row is gone (deleted or
    // pre-dating cost), and an empty "— · —" line there is just noise.
    renderWithIntl(
      <VerdictBanner
        verdict="approve"
        summary={null}
        score={95}
        findingsCount={0}
        blockers={0}
        costUsd={null}
      />,
    );
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("does not name the agent — the surfaces around it already do", () => {
    // The badge was removed rather than restyled: `Agent runs` is the tab about
    // agents, and inside ReviewRunAccordion the header above this banner opens
    // with the same name. The prop is gone too, so a call site cannot pass one.
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
      />,
    );
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
  });
});
