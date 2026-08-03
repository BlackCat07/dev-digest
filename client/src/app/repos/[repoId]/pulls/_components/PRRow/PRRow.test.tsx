import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { COLUMN_KEYS, GRID } from "../../constants";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

afterEach(cleanup);

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc1234",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-06-01T09:14:02.000Z",
    score: 61,
    cost_usd: 0.014,
    findings_by_severity: { CRITICAL: 2, WARNING: 2, SUGGESTION: 2 },
    ...o,
  };
}

/**
 * Text of one grid cell, located by its `COLUMN_KEYS` name. The row is a CSS
 * grid of top-level cells in column order, so the key's index is the cell's.
 */
function cellText(container: HTMLElement, column: string): string {
  const i = COLUMN_KEYS.indexOf(column);
  expect(i).toBeGreaterThanOrEqual(0);
  return container.firstElementChild!.children[i]!.textContent!.trim();
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={meta} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — cost column", () => {
  it("renders the review's total cost across agents", () => {
    renderRow(pr({ cost_usd: 0.014 }));
    const cost = screen.getByText("$0.014");
    expect(cost).toBeInTheDocument();
    expect(cost).toHaveAttribute("title", messages.list.costTooltip);
  });

  it('renders "—" for a PR with no completed run', () => {
    const { container } = renderRow(
      pr({ cost_usd: null, score: null, findings_by_severity: null }),
    );
    // Asserted PER CELL rather than by counting dashes across the row: several
    // columns fall back to a dash, so a row-wide count silently re-breaks every
    // time a column is added.
    expect(cellText(container, "cost")).toBe("—");
    expect(cellText(container, "score")).toBe("—");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});

describe("PRRow — score column", () => {
  it("labels the score as the lowest across agents", () => {
    const { container } = renderRow(pr({ score: 61 }));
    expect(container.querySelector(`[title="${messages.list.scoreTooltip}"]`)).not.toBeNull();
  });

  it("carries no score tooltip on a never-reviewed PR", () => {
    const { container } = renderRow(pr({ score: null }));
    expect(container.querySelector(`[title="${messages.list.scoreTooltip}"]`)).toBeNull();
  });
});

describe("PRRow — findings column", () => {
  it("shows one counter per non-zero severity", () => {
    const { container } = renderRow(
      pr({ findings_by_severity: { CRITICAL: 2, WARNING: 0, SUGGESTION: 3 } }),
    );
    // A zero level is omitted entirely, so the cell reads "2 3", not "2 0 3".
    expect(cellText(container, "findings")).toBe("23");
  });

  it('renders "—" when every severity is zero', () => {
    const { container } = renderRow(
      pr({ findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }),
    );
    expect(cellText(container, "findings")).toBe("—");
  });

  it("renders without a QueryClientProvider — the hover fetch mounts only on hover", () => {
    // Guards the mount-based laziness: putting the query in the always-rendered
    // subtree would throw "No QueryClient set" here and in every case above.
    expect(() => renderRow(pr())).not.toThrow();
  });
});

describe("PRRow — grid invariant", () => {
  // GRID, COLUMN_KEYS and PRRow's top-level cell count are hand-synced; nothing
  // in the type system ties them together, and a mismatch silently shifts every
  // column after the offending one.
  it("emits exactly one top-level cell per grid track and per column key", () => {
    const { container } = renderRow(pr());
    const cells = container.firstElementChild!.children.length;
    expect(cells).toBe(GRID.split(/\s+/).length);
    expect(cells).toBe(COLUMN_KEYS.length);
  });
});
