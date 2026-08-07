import type { CSSProperties } from "react";
import { CONTROL_HEIGHT, GRID } from "./constants";

/** Co-located styles for the PR list page (extracted from inline styles). */
export const s = {
  row: (hover: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 14,
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    background: hover ? "var(--bg-surface)" : "transparent",
    transition: "background .1s",
  }),
  rowTitleCell: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  rowIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  rowTitleWrap: { minWidth: 0 } satisfies CSSProperties,
  rowTitle: (hover: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 550,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: hover ? "var(--accent-text)" : "var(--text-primary)",
  }),
  rowNumber: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  authorCell: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  sizeBadgeBorder: (color: string): CSSProperties => ({ border: `1px solid ${color}` }),
  scoreCell: { display: "flex", alignItems: "center" } satisfies CSSProperties,
  updatedCell: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "right",
  } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  filterChips: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  filterActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,

  /**
   * Forces one control to CONTROL_HEIGHT from the outside.
   *
   * `grid`, not `flex`: a lone grid item stretches on BOTH axes by default, so
   * the control fills the wrapper's width as well as its height. A flex wrapper
   * would stretch it vertically but leave it content-width, which silently
   * collapses the 240px search box. Padding is absorbed because
   * `vendor/ui/styles.css` sets `box-sizing: border-box` globally.
   *
   * The row track is set explicitly rather than with `height`: `height` sizes the
   * container, but the implicit row stays `auto` and grows to the child, so a
   * tall control overflows the wrapper instead of being constrained by it.
   */
  control: { display: "grid", gridTemplateRows: `${CONTROL_HEIGHT}px` } satisfies CSSProperties,

  /** The search box is the one control with a fixed width. */
  searchControl: {
    display: "grid",
    gridTemplateRows: `${CONTROL_HEIGHT}px`,
    width: 240,
  } satisfies CSSProperties,
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  tableCard: {
    margin: "14px 32px 44px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 14,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  headCell: (alignRight: boolean): CSSProperties => ({
    textAlign: alignRight ? "right" : "left",
  }),
  loadingStack: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
