import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ExtractedConvention } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const MEASURED: ExtractedConvention = {
  id: "c1",
  category: "async",
  rule: "Repository functions await the query builder rather than chaining .then()",
  rationale: "Every repo module awaits; only src/legacy/client.ts chains.",
  evidence: [
    {
      path: "src/modules/tasks/repo.ts",
      start_line: 5,
      end_line: 5,
      snippet: "  const rows = await db.select().from(tasks);",
      match: "shifted",
    },
  ],
  confidence: 0.987,
  adherence: { conforming: 312, violating: 4 },
  status: "pending",
  edited: false,
  skill_id: null,
  created_at: "2026-08-06T10:00:00.000Z",
};

const UNMEASURED: ExtractedConvention = {
  ...MEASURED,
  id: "c2",
  category: "structure",
  rule: "Data access lives in repo.ts, never in a route module",
  confidence: 0.6,
  adherence: null,
  evidence: [
    { ...MEASURED.evidence[0]!, match: "exact" },
    {
      path: "src/modules/users/repo.ts",
      start_line: 4,
      end_line: 6,
      snippet: "export async function listUsers(workspaceId: string) {",
      match: "exact",
    },
  ],
};

function renderCard(candidate: ExtractedConvention, props: Partial<Parameters<typeof ConventionCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={candidate}
        repoFullName="acme/payments-api"
        sha="deadbeefcafe"
        onAccept={() => {}}
        onReject={() => {}}
        onEdit={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders the rule, its rationale and the category", () => {
    renderCard(MEASURED);
    expect(screen.getByText(MEASURED.rule)).toBeInTheDocument();
    expect(screen.getByText(MEASURED.rationale)).toBeInTheDocument();
    expect(screen.getByText("Async")).toBeInTheDocument();
  });

  it("links the evidence to the exact lines on GitHub, pinned to the scan's commit", () => {
    // This is the acceptance rule: a click has to land on the real code. The
    // line numbers are the CORRECTED ones the verifier wrote, not the model's.
    renderCard(MEASURED);
    const link = screen.getByRole("link", { name: /src\/modules\/tasks\/repo\.ts/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/deadbeefcafe/src/modules/tasks/repo.ts#L5",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("spans a multi-line citation as a line range", () => {
    renderCard(UNMEASURED);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/deadbeefcafe/src/modules/tasks/repo.ts#L5",
    );
  });

  it("shows the snippet as it appears in the file, indentation included", () => {
    renderCard(MEASURED);
    expect(
      screen.getByText("const rows = await db.select().from(tasks);", { exact: false }),
    ).toBeInTheDocument();
  });

  it("renders the location as plain text when the scan has no commit", () => {
    // Without a sha there is nothing honest to link to — a link to the default
    // branch would drift off the cited lines the first time the file changed.
    renderCard(MEASURED, { sha: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/modules/tasks/repo.ts:5-5")).toBeInTheDocument();
  });

  it("says how many places follow a measured rule", () => {
    renderCard(MEASURED);
    expect(screen.getByText("99%")).toBeInTheDocument();
    expect(screen.getByText("312 of 316 places follow this")).toBeInTheDocument();
  });

  it("marks an unmeasured rule as the model's own estimate", () => {
    // The distinction is the whole product claim; without this line both render
    // as an identical bar.
    renderCard(UNMEASURED);
    expect(
      screen.getByText("Not mechanically checkable — the model's own estimate"),
    ).toBeInTheDocument();
  });

  it("notes when the cited line had to be corrected", () => {
    renderCard(MEASURED);
    expect(screen.getByText("line corrected")).toBeInTheDocument();
  });

  it("collapses extra citations behind a control until asked", () => {
    renderCard(UNMEASURED);
    expect(screen.getAllByRole("link")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /1 more citation/ }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("calls back on accept and reject", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard(MEASURED, { onAccept, onReject });

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("offers accept, reject and edit as the side-rail actions", () => {
    // Two triage decisions plus the one action on the candidate's text.
    // Save/Cancel exist only inside edit mode, so the resting card must show
    // exactly these three.
    renderCard(MEASURED);
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter(Boolean);
    expect(labels).toEqual(["Accept", "Reject", "Edit"]);
  });

  it("saves an edited rule and rationale through onEdit", () => {
    const onEdit = vi.fn();
    renderCard(MEASURED, { onEdit });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule" }), {
      target: { value: "  Repos never chain .then()  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Sharpened during triage." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Trimmed — the PATCH marks the candidate `edited`, and a whitespace-only
    // difference would claim a human rewrite that never happened.
    expect(onEdit).toHaveBeenCalledWith({
      rule: "Repos never chain .then()",
      rationale: "Sharpened during triage.",
    });
    // The card returns to its read view; the server's refetch owns the text.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("discards an edit on cancel without calling onEdit", () => {
    const onEdit = vi.fn();
    renderCard(MEASURED, { onEdit });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule" }), {
      target: { value: "Discarded draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText(MEASURED.rule)).toBeInTheDocument();
  });

  it("refuses to save a rule emptied to nothing", () => {
    renderCard(MEASURED);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule" }), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks a human-rewritten rule as edited", () => {
    // `edited` is what shields the rewrite from the next re-scan's cleanup;
    // showing it is how the user knows the shield is on.
    renderCard({ ...MEASURED, edited: true });
    expect(screen.getByText("edited")).toBeInTheDocument();
  });

  it("copies the cited code, not the location, from the citation header", () => {
    // The header already shows the path and links it; what is not otherwise
    // obtainable in one gesture is the snippet itself.
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    renderCard(MEASURED);
    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }));

    expect(writeText).toHaveBeenCalledWith(MEASURED.evidence[0]!.snippet);
    // The control confirms itself, so a click that did nothing is visible.
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("reflects the triage state back in the button labels", () => {
    renderCard({ ...MEASURED, status: "accepted" });
    expect(screen.getByRole("button", { name: "Accepted" })).toBeInTheDocument();
    cleanup();

    renderCard({ ...MEASURED, status: "rejected" });
    expect(screen.getByRole("button", { name: "Rejected" })).toBeInTheDocument();
  });

  it("disables the controls while a triage call is in flight", () => {
    renderCard(MEASURED, { busy: true });
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });
});
