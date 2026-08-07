import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  /**
   * Gutters come from the PADDING, not from the max-width.
   *
   * A centred `maxWidth` alone only produces whitespace once the window is
   * wider than it — on a laptop the container simply fills the content area and
   * the screen sits 32px from the sidebar, which is not what the design shows.
   * `clamp` scales the gutters with the viewport instead: roughly the design's
   * proportions on a wide screen, still readable on a narrow one, and never
   * running away on an ultrawide.
   *
   * The max-width stays as the upper bound on line length — evidence blocks are
   * code, and code stretched across 2000px is unreadable.
   */
  page: {
    padding: "28px clamp(32px, 6vw, 112px)",
    maxWidth: 1280,
    margin: "0 auto",
  } satisfies CSSProperties,

  // `center`, so the scan button sits on the heading's line rather than
  // floating above it.
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 10,
  } satisfies CSSProperties,

  heading: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    flex: 1,
    minWidth: 0,
    // The `h1` default margin would reintroduce the offset `alignItems`
    // just removed.
    margin: 0,
  } satisfies CSSProperties,

  repoName: { color: "var(--accent)" } satisfies CSSProperties,

  /**
   * Scan meta + warnings, directly under the heading.
   *
   * The bottom margin is deliberately larger than the gap between the notes
   * themselves: the block below is the actions row, and at 18px the dropped-
   * candidates sentence read as a label for the buttons rather than as the last
   * line of the scan summary.
   */
  notes: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 30,
  } satisfies CSSProperties,

  note: (tone: "muted" | "warn" | "crit"): CSSProperties => ({
    fontSize: 11.5,
    lineHeight: 1.5,
    color:
      tone === "crit" ? "var(--crit)" : tone === "warn" ? "#f59e0b" : "var(--text-muted)",
  }),

  /**
   * The actions row: bulk triage on the left, the counter beside it, and skill
   * creation pushed to the far right.
   *
   * Separate from the filters below it because the two do unrelated jobs — one
   * acts on the triage, the other only changes what is on screen — and the mock
   * gives each its own line.
   */
  toolbarPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /** Pushes `Create skill` to the right edge of the actions row. */
  spacer: { marginLeft: "auto" } satisfies CSSProperties,

  triage: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** The pre-scan estimate, shown inside the confirm modal. */
  budgetBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 20,
  } satisfies CSSProperties,

  budgetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,

  budgetCell: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
  } satisfies CSSProperties,

  budgetValue: { fontSize: 16, fontWeight: 600 } satisfies CSSProperties,

  budgetLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 2,
  } satisfies CSSProperties,

  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  } satisfies CSSProperties,

  blocked: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "28px 24px",
    textAlign: "center",
  } satisfies CSSProperties,

  blockedTitle: { fontSize: 15, fontWeight: 600, marginBottom: 6 } satisfies CSSProperties,

  blockedBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.6,
    maxWidth: 520,
    margin: "0 auto",
  } satisfies CSSProperties,
} as const;
