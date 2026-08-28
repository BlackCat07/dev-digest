import type { CSSProperties } from "react";

/* The results screen's own layout. Only the page frame lives here — the two
   modes each own their styles, and the disagreement block will own its own when
   it lands, because a unit that reads a screen's `styles.ts` stops being
   movable.

   `var(--bg)` is not a token: the base background is `var(--bg-primary)`, and
   an unknown custom property drops silently (`client/INSIGHTS.md`, 2026-08-06). */
/**
 * The results band's own insets, exported because ONE child has to cancel them.
 *
 * Tabs mode's strip is a header bar in the reference: its rule runs the full
 * width of the page, continuing the sub-bar's rule directly above it. Inside a
 * padded band its rule would stop `RESULTS_INSET_X` short at each end and the
 * strip would read as a floating widget rather than as the bottom of the
 * header stack. `AgentTabsPane` cancels both insets with a negative margin and
 * restores the horizontal one as its own padding, so the tab labels still line
 * up with the content below them. The numbers live here so the two sides cannot
 * drift apart silently.
 */
export const RESULTS_INSET_X = 28;
export const RESULTS_INSET_TOP = 20;

export const s = {
  /* The page owns no padding of its own: the header row and the results area
     are two bands with different vertical rhythm (18px vs 20px) over one shared
     28px gutter, and a single padded `page` cannot express that. */
  page: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  /* Row 1 of the two-row header the reference draws: the way back, the screen's
     name, what the run is, and the mode toggle — all on ONE baseline. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "18px 28px 10px",
  } satisfies CSSProperties,
  /* Trims the shared `Button` to the reference's quieter back control without
     touching `vendor/ui`: `Button` spreads `style` last
     (`client/INSIGHTS.md`, 2026-08-20). */
  backButton: {
    height: 26,
    padding: "5px 10px",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--bg-surface)",
    borderColor: "var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /* Pushes the mode toggle to the right edge of row 1. */
  headerSpacer: { marginLeft: "auto" } satisfies CSSProperties,
  /* Row 2: which pull request this is, and what the fan-out cost. Its rule is
     what separates the header from the results. */
  subBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "8px 28px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  subBarNumber: {
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  subBarTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  subBarIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  /* Everything after the pull request's title sits at the RIGHT edge, as the
     reference draws it: the left of this row identifies the subject, the right
     states what the fan-out cost. */
  subBarStats: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    flexShrink: 0,
  } satisfies CSSProperties,
  /* The results band. 42px between the mode's grid and the disagreement block —
     the block is a change of subject, not the next row of the same one, and at
     the page gap it read as a fifth column. */
  results: {
    display: "flex",
    flexDirection: "column",
    gap: 42,
    padding: `${RESULTS_INSET_TOP}px ${RESULTS_INSET_X}px`,
  } satisfies CSSProperties,
  /* The back button and the mode toggle share the header's right-hand slot. */
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.4px",
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  /* AC-86: what the fan-out actually is — bounded concurrency inside the review
     executor. Neither git worktrees nor the platform job queue are involved,
     and both of those words shipped here once. */
  meta: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  loadingColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 28,
  } satisfies CSSProperties,
} as const;
