import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillWithUsage } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillWithUsage = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 3,
  evidence_files: null,
  usage: { used_by: 3, pull_rate: 0.71, accept_rate: 0.74, findings_30d: 96 },
};

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders the name, description, type and source", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("Rubric for evaluating overall PR quality.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("renders the usage figures as percentages", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("71% pull")).toBeInTheDocument();
    expect(screen.getByText("74% accept")).toBeInTheDocument();
  });

  it("shows a dash, not 0%, when a skill has never been carried by a run", () => {
    // The distinction the whole nullable-rate design exists for: an unused skill
    // must not read as one that always fails.
    renderCard(
      <SkillCard
        skill={{
          ...SKILL,
          usage: { used_by: 0, pull_rate: null, accept_rate: null, findings_30d: 0 },
        }}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("0% pull")).not.toBeInTheDocument();
  });

  it("marks a skill from an external source as needing vetting", () => {
    renderCard(<SkillCard skill={{ ...SKILL, source: "imported_url" }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
  });

  it("does not mark a hand-written skill as needing vetting", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("toggling does not also select the card", () => {
    // The toggle sits inside the card's click target; without stopPropagation,
    // switching a skill off would navigate to it as a side effect.
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);

    const toggle = screen.getByRole("switch");
    toggle.click();

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});
