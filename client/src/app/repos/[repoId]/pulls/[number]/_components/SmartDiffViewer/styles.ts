/** Co-located styles for the Smart Diff viewer. Tokens only — `var(--bg)` does not
    exist; the background tokens are `--bg-primary`, `--bg-surface`, `--bg-elevated`
    and `--bg-hover`, and an unknown custom property silently drops the whole
    declaration (`client/INSIGHTS.md`, 2026-08-06). */
import type { CSSProperties } from "react";
import { STICKY_SCROLL_MARGIN } from "@/lib/sticky-offset";

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
   * An `inset` box-shadow, NOT a `borderLeft`: a border adds 3px to the box and
   * would shift every decorated line's text relative to its undecorated neighbours,
   * which reads as the diff being misaligned.
   */
  lineEdge: (token: string): CSSProperties => ({
    boxShadow: `inset 3px 0 0 ${token}`,
  }),

  /**
   * Clearance for the ONE row a target lands on, merged into that row's style.
   *
   * The value has to stay `STICKY_SCROLL_MARGIN`, not a number: `PrDetailHeader` is
   * `position: sticky` over the `<main>` that actually scrolls, and its height
   * varies per pull request — ~128px, ~156px on a merged or closed one, taller
   * again when its meta row wraps — so any single figure parks some pull requests'
   * targeted line underneath it (`client/INSIGHTS.md`, 2026-08-11). Applied only to
   * the target, because a `scrollMarginTop` on every code row would change where
   * every other scroll in the diff comes to rest.
   */
  targetRow: { scrollMarginTop: STICKY_SCROLL_MARGIN } satisfies CSSProperties,

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
