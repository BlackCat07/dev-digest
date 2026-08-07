import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillWithUsage } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const mutate = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Imported AFTER the mocks so the component picks them up.
const { ConfigTab } = await import("./ConfigTab");

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const SKILL: SkillWithUsage = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "A rubric.",
  type: "rubric",
  // 40 chars → 10 tokens at the ceil(chars/4) heuristic.
  body: "0123456789012345678901234567890123456789",
  source: "manual",
  enabled: true,
  version: 3,
  evidence_files: null,
  usage: { used_by: 1, pull_rate: 0.5, accept_rate: 0.5, findings_30d: 2 },
};

function renderTab(skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ConfigTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("skill ConfigTab", () => {
  it("renders the form seeded from the skill", () => {
    renderTab();
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A rubric.")).toBeInTheDocument();
    expect(screen.getByText("pr-quality-rubric.md")).toBeInTheDocument();
  });

  it("shows the body's token cost, and updates it as you type", () => {
    renderTab();
    expect(screen.getByText("10 tokens")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "12345678" } });
    expect(screen.getByText("2 tokens")).toBeInTheDocument();
  });

  it("marks the body unsaved only once it differs from the stored one", () => {
    renderTab();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "changed" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("saves name, description, type and body together", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "new body" } });
    screen.getByRole("button", { name: /Save skill/ }).click();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      id: "s1",
      patch: {
        name: "pr-quality-rubric",
        description: "A rubric.",
        type: "rubric",
        body: "new body",
      },
    });
  });

  it("toggling enabled is its own immediate write, not part of the save", () => {
    // Enabling is the vetting gate for an imported skill — it must not ride
    // along with unsaved body text the user is still editing.
    renderTab();
    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "half-written" } });

    screen.getByRole("switch").click();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ id: "s1", patch: { enabled: false } });
  });
});

describe("skill ConfigTab — footer", () => {
  it("disables Save and Cancel until something actually changed", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "edited" } });
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeEnabled();
  });

  it("names the version a save would create, once the body differs", () => {
    renderTab();
    expect(screen.queryByText(/Saving snapshots/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "edited" } });
    // v3 is current, so the pending save becomes v4.
    expect(screen.getByText("Saving snapshots the body as v4")).toBeInTheDocument();
  });

  it("Cancel restores every field to the saved skill", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), {
      target: { value: "renamed" },
    });
    fireEvent.change(screen.getByDisplayValue(SKILL.body), { target: { value: "edited" } });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));

    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue(SKILL.body)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps the destructive action in its own section, not beside Save", () => {
    renderTab();
    expect(screen.getByText("Delete skill")).toBeInTheDocument();
    expect(screen.getByText("Removes it from all agents. This can\u2019t be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeInTheDocument();
  });

  it("numbers every line of the body", () => {
    // The gutter is aria-hidden, so assert on the rendered text rather than a role.
    const { container } = renderTab();
    const gutter = container.querySelector("pre[aria-hidden]");
    expect(gutter?.textContent?.split("\n").slice(0, 3)).toEqual(["1", "2", "3"]);
  });
});
