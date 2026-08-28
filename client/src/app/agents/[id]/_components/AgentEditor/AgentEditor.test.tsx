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

  it("carries Evals last in the tab strip, and neither Stats nor CI", () => {
    // AC-54, read as "Evals sits after Context": `Stats` and `CI` are out of
    // scope and their panels do not exist, so the strip is four tabs long.
    //
    // Queried BY ROLE and not by text — a tab label can collide with body text
    // and a text query then matches two nodes. `Tabs` renders plain <button>s,
    // so "button" is the role, not "tab". `tab="config"` keeps the Evals PANEL
    // unmounted: the strip is what this test is about, and the panel has its own
    // file (and its own QueryClient).
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);

    const evals = screen.getByRole("button", { name: messages.editor.tabs.evals });
    expect(evals).toBeInTheDocument();

    // Order matters and `getByRole` alone cannot see it, so the strip's own
    // container is read: `Tabs` renders one button per tab as direct children.
    const strip = evals.parentElement;
    expect(Array.from(strip?.children ?? []).map((el) => el.textContent)).toEqual([
      messages.editor.tabs.config,
      messages.editor.tabs.skills,
      messages.editor.tabs.context,
      messages.editor.tabs.evals,
    ]);

    // The catalogue carries both labels already; neither is a control yet.
    expect(
      screen.queryByRole("button", { name: messages.editor.tabs.stats }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.editor.tabs.ci })).not.toBeInTheDocument();
  });
});
