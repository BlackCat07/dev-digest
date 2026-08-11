/** Co-located styles for the Smart Diff viewer. Tokens only — `var(--bg)` does not
    exist; the background tokens are `--bg-primary`, `--bg-surface`, `--bg-elevated`
    and `--bg-hover`, and an unknown custom property silently drops the whole
    declaration (`client/INSIGHTS.md`, 2026-08-06). */
import type { CSSProperties } from "react";
import { STICKY_CSS_VAR, STICKY_FALLBACK_PX } from "./constants";

export const s = {
  list: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  empty: {
    padding: 24,
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  /**
   * Every code row carries this, so a scrolled-to line clears the sticky PR header.
   * The variable is measured at runtime; the fallback covers SSR, the first paint
   * and jsdom (where `ResizeObserver` never fires).
   */
  scrollAnchor: {
    scrollMarginTop: `var(${STICKY_CSS_VAR}, ${STICKY_FALLBACK_PX}px)`,
  } satisfies CSSProperties,

  /**
   * An `inset` box-shadow, NOT a `borderLeft`: a border adds 3px to the box and
   * would shift every decorated line's text relative to its undecorated neighbours,
   * which reads as the diff being misaligned.
   */
  lineEdge: (token: string): CSSProperties => ({
    boxShadow: `inset 3px 0 0 ${token}`,
    scrollMarginTop: `var(${STICKY_CSS_VAR}, ${STICKY_FALLBACK_PX}px)`,
  }),

  lineBadgeWrap: {
    display: "inline-flex",
    alignItems: "center",
    paddingRight: 12,
    flexShrink: 0,
  } satisfies CSSProperties,

  summaryRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  summaryIcon: { color: "var(--accent)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  summaryLabel: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,

  offDiff: {
    padding: "8px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    scrollMarginTop: `var(${STICKY_CSS_VAR}, ${STICKY_FALLBACK_PX}px)`,
  } satisfies CSSProperties,

  /** The file header is a row, not a button — the disclosure and the badge are siblings. */
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
  } satisfies CSSProperties,
  disclosure: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  /** Redundant with the badge's icon+word, so it is `aria-hidden`. */
  blockerDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--crit)",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
