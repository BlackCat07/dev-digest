import type { CSSProperties } from "react";

/* The disagreement block's own styles. It owns them rather than reading the
   results view's `styles.ts`: a unit that borrows a screen's style object stops
   being movable (`client/INSIGHTS.md`, 2026-08-02).

   EC-16 is a layout requirement, and two properties carry it:

   - `minmax(180px, 1fr)` on the grid tracks, never a bare `1fr`. A bare `1fr`
     is `minmax(auto, 1fr)`, whose `auto` floor is the widest unbreakable word
     in the cell — so one 300-character title or one long URL in a note stops
     the tracks being equal and pushes the neighbouring agent's cell off the
     row. With an explicit `0`-based floor the tracks stay equal whatever is
     inside them.
   - `overflowWrap: "anywhere"` on every text member, so the overflowing word
     wraps INSIDE its cell and the full text stays reachable rather than being
     clipped away.

   `auto-fit` rather than a fixed count: a fan-out is capped at 8 agents (AC-8)
   and eight readable cells do not fit one row, so the cells wrap onto a second
   row — still all of one width, because every track is `1fr`.

   `var(--bg)` is not a token: the base background is `var(--bg-primary)`, and
   an unknown custom property drops silently (`client/INSIGHTS.md`, 2026-08-06). */
export const s = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 6,
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  heading: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  filterLabel: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /* AC-80. Muted and small, but present above the panels rather than buried
     under them: it is what stops a generated sentence being read as something
     the agent literally said. */
  synthesised: {
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  empty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: 0,
    padding: "14px 16px",
    border: "1px dashed var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  panelHead: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  } satisfies CSSProperties,
  location: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  groupTitle: {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.4,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  cells: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  cell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    minWidth: 0,
    padding: "9px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  agentName: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /* AC-79: the words, not a grey square. The colour is the quietest on the
     palette, but the sentence is what carries the meaning. */
  didNotFlag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  note: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
