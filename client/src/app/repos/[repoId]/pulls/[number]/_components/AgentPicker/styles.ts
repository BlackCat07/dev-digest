import type { CSSProperties } from "react";
import { PANEL_WIDTH } from "./constants";

/* Co-located styles for AgentPicker.

   The panel is this unit's own rather than a `vendor/ui` addition: `Dropdown` is
   a list of one-shot menu items that closes on every click, which is the wrong
   interaction for a multi-select. Nothing here restyles a shared primitive — the
   two overrides that touch one (`trigger*`, `runAction`) go through the `style`
   prop `Button` spreads last (client/INSIGHTS.md, 2026-08-20). */
export const s = {
  root: {
    position: "relative",
    display: "inline-block",
  } satisfies CSSProperties,

  /** A merged/closed pull request can still be fanned out — dimmed, not blocked.
      The words for that condition are the header's own stale banner, which sits
      directly below this control. */
  triggerMerged: {
    opacity: 0.6,
  } satisfies CSSProperties,

  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: PANEL_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 10,
    zIndex: 40,
    textAlign: "left",
  } satisfies CSSProperties,

  /** Micro-caps section label — 11/700/0.06em muted, the rhythm every other
      section heading in this app uses. Labels are uppercase; content never is. */
  title: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "2px 4px 8px",
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    listStyle: "none",
    margin: 0,
    padding: 0,
    // A workspace can hold more agents than fit beside a sticky header whose
    // height varies with the PR title — scroll the list, never the page.
    maxHeight: 260,
    overflowY: "auto",
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px",
    borderRadius: 6,
  } satisfies CSSProperties,

  checkbox: (checked: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: 4,
    border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
    background: checked ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
    cursor: "pointer",
  }),

  checkIcon: {
    color: "#fff",
  } satisfies CSSProperties,

  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  estimate: {
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  empty: {
    padding: "6px 4px 10px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  /** The server's own sentence when a fan-out is refused. */
  error: {
    margin: "8px 0 0",
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--crit)",
  } satisfies CSSProperties,

  manageRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  spacer: {
    flex: 1,
  } satisfies CSSProperties,

  /** `aria-disabled` rather than `disabled`, so the action keeps its place in the
      tab order and its accessible name — which is where the selected count is
      read (AC-47). The dimming is what `Button` does for `disabled` itself. */
  runDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  } satisfies CSSProperties,
} as const;
