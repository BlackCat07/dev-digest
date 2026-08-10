import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComposedConventionSkill, ExtractedConvention } from "@devdigest/shared";
import conventions from "../../../../../../../messages/en/conventions.json";
import skills from "../../../../../../../messages/en/skills.json";

// Hoisted: the mock factory runs while the component module is imported, which
// is before any plain `const` in this file has been initialised.
const h = vi.hoisted(() => ({
  preview: [] as unknown[],
  error: null as Error | null,
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillPreview: () => ({ data: h.preview, error: h.error }),
  useCreateConventionSkill: () => ({ mutate: h.mutate, isPending: false }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

const COMPOSED: ComposedConventionSkill = {
  name: "payments-api-conventions",
  description: "2 house conventions extracted from payments-api",
  body: [
    "# payments-api-conventions",
    "",
    "House conventions for `acme/payments-api`.",
    "",
    "## async-await-then-chains",
  ].join("\n"),
  evidence_files: ["src/api/users.ts"],
  candidate_ids: ["c1", "c2"],
};

const ACCEPTED = [
  { id: "c1" } as ExtractedConvention,
  { id: "c2" } as ExtractedConvention,
];

beforeEach(() => {
  h.preview = [COMPOSED];
  h.error = null;
  h.mutate.mockReset();
});

afterEach(cleanup);

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions, skills }}>
      <CreateSkillModal
        repoId="r1"
        repoFullName="acme/payments-api"
        accepted={ACCEPTED}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("CreateSkillModal", () => {
  it("offers no shape control — one call always writes one skill", () => {
    // The per-category shape was removed from the UI, the contract and the
    // server. Nothing here may offer it back.
    renderModal();
    expect(screen.queryByText("Shape")).not.toBeInTheDocument();
    expect(screen.queryByText(/per category/i)).not.toBeInTheDocument();
  });

  it("puts the name and description above the type and enabled row", () => {
    const { container } = renderModal();
    const text = container.textContent ?? "";
    expect(text.indexOf("Name")).toBeGreaterThan(-1);
    expect(text.indexOf("Name")).toBeLessThan(text.indexOf("Description"));
    expect(text.indexOf("Description")).toBeLessThan(text.indexOf("Type"));
    expect(text.indexOf("Type")).toBeLessThan(text.indexOf("Skill body"));
  });

  it("names the repo in the banner by its slug, not its full name", () => {
    // The sentence is rich text, so it spans several elements — assert the whole
    // reading of it, then that each emphasised span is its own element.
    const { container } = renderModal();
    expect(container.textContent).toContain(
      "Merged from 2 accepted conventions in payments-api. Everything below is editable",
    );
    expect(screen.getByText("2 accepted conventions").tagName).toBe("STRONG");
    expect(screen.getByText("payments-api")).toHaveStyle({ color: "var(--accent)" });
  });

  it("shows the composed body as a numbered, unsaved file", () => {
    renderModal();
    expect(screen.getByText("payments-api-conventions.md")).toBeInTheDocument();
    // Nothing has been written yet — the chip says so.
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    // One number per line of the body, including the blank ones.
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("# payments-api-conventions")).toBeInTheDocument();
  });

  it("creates a convention-typed, enabled skill by default", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(h.mutate).toHaveBeenCalledTimes(1);
    const [payload] = h.mutate.mock.calls[0]!;
    expect(payload).toMatchObject({
      candidate_ids: ["c1", "c2"],
      type: "convention",
      enabled: true,
    });
    expect(payload).not.toHaveProperty("mode");
  });

  it("sends the type the user picked", () => {
    renderModal();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "security" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(h.mutate.mock.calls[0]![0]).toMatchObject({ type: "security" });
  });

  it("cannot be submitted while there is nothing composed to save", () => {
    h.preview = [];
    renderModal();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("surfaces a preview failure instead of an empty body field", () => {
    h.preview = [];
    h.error = new Error("Composition failed");
    renderModal();
    expect(screen.getByText("Composition failed")).toBeInTheDocument();
  });
});
