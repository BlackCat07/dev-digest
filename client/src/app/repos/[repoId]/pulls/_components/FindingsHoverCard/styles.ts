import type { CSSProperties } from "react";

export const PANEL_WIDTH = 380;
/** Room the panel needs below the trigger before it flips above it. */
export const FLIP_MARGIN = 340;

export const s = {
  trigger: {
    display: "inline-flex",
    width: "fit-content",
    cursor: "help",
  } satisfies CSSProperties,
  /**
   * `fixed`, NOT `absolute`. The PR list's table card sets
   * `overflow: hidden` (see `pulls/styles.ts` `tableCard`), which clips any
   * absolutely-positioned child — so the Dropdown primitive's approach can't be
   * reused here. Coordinates come from the trigger's `getBoundingClientRect()`.
   *
   * Flipping anchors the panel's BOTTOM edge to the trigger rather than guessing
   * a top offset, so it grows upward from the row and can never overlap the app
   * header on a short viewport.
   */
  panel: (at: { left: number; top?: number; bottom?: number }): CSSProperties => ({
    position: "fixed",
    ...(at.top != null ? { top: at.top } : { bottom: at.bottom }),
    left: at.left,
    zIndex: 40,
    width: PANEL_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "var(--shadow-modal)",
    padding: 12,
    animation: "ddpop .12s ease",
    cursor: "default",
    textAlign: "left",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 9,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 9,
    maxHeight: 300,
    // Vertical only. `overflow: auto` also permitted a HORIZONTAL bar, which a
    // long `file:line` path triggered — and with both bars present the browser
    // draws an unstyled scrollbar-corner square between them. Everything below
    // is set up to wrap instead of extending the row.
    overflowY: "auto",
    overflowX: "hidden",
  } satisfies CSSProperties,
  item: (divider: boolean, clickable = false): CSSProperties => ({
    paddingBottom: divider ? 9 : 0,
    borderBottom: divider ? "1px solid var(--border)" : "none",
    // Clickable rows get NO horizontal padding and NO negative margin: a
    // negative inline margin makes the row wider than the list's content box,
    // which is what produced the horizontal scrollbar (and the unstyled white
    // scrollbar-corner square where the two bars met).
    ...(clickable ? { cursor: "pointer", borderRadius: 6 } : {}),
  }),
  itemHead: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    minWidth: 0,
  } satisfies CSSProperties,
  itemTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  itemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "5px 0 0",
    // A deep path + a line range easily exceeds 380px; wrap it rather than let
    // it widen the row (which is what produced the horizontal scrollbar).
    flexWrap: "wrap",
    minWidth: 0,
  } satisfies CSSProperties,
  itemFile: {
    fontSize: 11,
    color: "var(--accent-text)",
    minWidth: 0,
    // `anywhere` (not `break-word`) so a long slash-free segment also breaks.
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /** Two-line clamp — the full rationale lives on the finding card itself. */
  itemBody: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
    marginTop: 5,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
  status: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
