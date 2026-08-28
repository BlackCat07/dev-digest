import type { CSSProperties } from "react";

/* The disagreement block's own styles. It owns them rather than reading the
   results view's `styles.ts`: a unit that borrows a screen's style object stops
   being movable (`client/INSIGHTS.md`, 2026-08-02).

   EC-16 is a layout requirement, and two properties carry it:

   - `minmax(180px, 1fr)` on the grid tracks, never a bare `1fr`. A bare `1fr`
     is `minmax(auto, 1fr)`, whose `auto` floor is the widest unbreakable word
     in the cell — so one 300-character title or one long URL in a note stops
     the tracks being equal and pushes the neighbouring agent's cell off the
     row. With an explicit floor the tracks stay equal whatever is inside them.
   - `overflowWrap: "anywhere"` on every text member, so the overflowing word
     wraps INSIDE its cell and the full text stays reachable rather than being
     clipped away.

   `auto-fit` rather than a fixed count: a fan-out is capped at 8 agents (AC-8)
   and eight readable cells do not fit one row, so the cells wrap onto a second
   row — still all of one width, because every track is `1fr`.

   **The cell separators are the grid's own background showing through a 1px
   gap**, not borders on the cells: a border per cell doubles on every internal
   edge and leaves a 2px line between two neighbours, while one background plus
   a 1px gutter draws exactly one hairline wherever two cells meet and nothing
   at the panel's edge. It is why `panel` carries `overflow: hidden` — without
   it the grid's `--border` background squares off the panel's bottom corners.

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
  /* A section label, at the scale every other section label on this screen
     uses — small, uppercase and muted — so the block reads as a band of the
     results page rather than as a second page title. Still an `<h2>`: the
     restyle is visual and the document outline is not. */
  heading: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.77px",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  headingIcon: { flexShrink: 0 } satisfies CSSProperties,
  /* Label to the LEFT of the switch, which is the reading order the design
     puts them in: the statement first, its state second. */
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  filterLabel: {
    fontSize: 12,
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
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  /* Its own row, divided from the stances below it: the header states WHERE,
     the grid states WHAT each agent said, and the rule between them is what
     keeps the two from reading as one paragraph. */
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  panelHeadIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  location: {
    fontSize: 12,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  groupTitle: {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  cells: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 1,
    background: "var(--border)",
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  cell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    minWidth: 0,
    padding: "10px 14px",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  agentName: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /* A stance: a dot in the severity colour, then the severity WORD. The dot is
     never the only carrier — AC-88 — which is why the word sits beside it at
     every size. */
  stance: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  /* The WORD is `--text-primary`; only the dot beside it carries the severity
     colour. Measured from the reference export, where the `WARNING` and
     `SUGGESTION` spans carry no colour of their own — unlike `did not flag`,
     which is muted on both dot and word. Colouring the word too made the cell
     read as a severity badge, which is the primitive this block deliberately
     dropped. */
  verdict: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.33px",
    textTransform: "uppercase",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  /* AC-79: the words, not a grey square. The grey dot is the same shape the
     flagged cells carry, so the row of cells scans as one column of stances;
     the sentence beside it is what carries the meaning. */
  didNotFlag: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    fontSize: 11.5,
    lineHeight: 1.4,
    color: "var(--text-muted)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
