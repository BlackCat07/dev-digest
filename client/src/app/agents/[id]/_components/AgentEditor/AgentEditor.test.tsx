import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("carries CI last in the tab strip, after Evals, and still no Stats", () => {
    // AC-46: the editor offers a CI tab ALONGSIDE Config, Skills, Context and
    // Evals — so the strip is five tabs long and CI is the fifth. `Stats` is out
    // of scope and its panel does not exist, so its label stays in the catalogue
    // and out of the strip.
    //
    // Queried BY ROLE and not by text — a tab label can collide with body text
    // and a text query then matches two nodes. `Tabs` renders plain <button>s,
    // so "button" is the role, not "tab". `tab="config"` keeps the CI PANEL
    // unmounted: the strip is what this test is about, and the panel has its own
    // file (and its own QueryClient and fetch stub).
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);

    const ci = screen.getByRole("button", { name: messages.editor.tabs.ci });
    expect(ci).toBeInTheDocument();

    // Order matters and `getByRole` alone cannot see it, so the strip's own
    // container is read: `Tabs` renders one button per tab as direct children.
    const strip = ci.parentElement;
    expect(Array.from(strip?.children ?? []).map((el) => el.textContent)).toEqual([
      messages.editor.tabs.config,
      messages.editor.tabs.skills,
      messages.editor.tabs.context,
      messages.editor.tabs.evals,
      messages.editor.tabs.ci,
    ]);

    // The catalogue carries the Stats label already; it is not a control yet.
    expect(
      screen.queryByRole("button", { name: messages.editor.tabs.stats }),
    ).not.toBeInTheDocument();
  });
});
