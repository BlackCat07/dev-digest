import type { CSSProperties } from "react";

/* Columns mode, aligned to the reference design.

   ONE ROW, scrolled horizontally — not a wrapping grid. Wrapping was tried and
   rejected on the screen: with five agents it laid out four columns and left the
   fifth alone on a second row beside a screen-width of nothing, and no track
   count avoids that for every case at once (1, 5 and 8 agents all want a
   different number). Worse, a column on the second row cannot be compared with
   one on the first, and comparing agents side by side is the entire point of
   this mode — the reference draws a single row for the same reason.

   So every column keeps the SAME width whatever the count, and the row scrolls
   when they no longer fit. One agent renders one 360px column; eight render
   eight, of which four or five are visible and the rest are a scroll away. The
   trade is deliberate: a column off-screen is reachable, whereas a column
   stranded on row two is mis-comparable.

   360px is wider than the reference's 281px on purpose. 281 was measured at a
   1440px viewport where four tracks plus three 12px gaps are exactly the 1160px
   content column; this screen is routinely much wider, and at that width 281px
   columns read as narrow slivers.

   `var(--bg)` is not a token — the base background is `var(--bg-primary)`, and
   an unknown custom property drops silently (`client/INSIGHTS.md`, 2026-08-06). */

/** Column width. The reference draws 281px; see the note above for why this is
    wider. Every column takes it, whatever the agent count. */
const TRACK_WIDTH = 360;
/** Gap between columns, from the reference design. */
const COLUMN_GAP = 12;

export const s = {
  row: {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: `${TRACK_WIDTH}px`,
    gap: COLUMN_GAP,
    alignItems: "stretch",
    overflowX: "auto",
    // Room for the horizontal scrollbar, so it never sits on the footer rule.
    paddingBottom: 4,
  } satisfies CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  /* No background of its own: the head inherits the column's `--bg-elevated`,
     and only the body's finding cards and the footer sit on `--bg-surface`. */
  /* Two halves: the agent and its figures stacked on the left, the score ring on
     the right spanning both of those lines. */
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  headText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  } satisfies CSSProperties,
  headTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  agentName: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /* One line for both figures — `8.2s · $0.060` — mono and tabular, so four
     columns' numbers line up vertically against each other. */
  headMetrics: {
    fontSize: 10.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  noScore: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* The failure reason takes the score's place (AC-68). It wraps rather than
     clipping: it is the only account of why the column is empty. */
  reason: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--crit)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    padding: 12,
    flex: 1,
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  /* The severity colour is carried by a 2px left rule and by nothing else —
     no surrounding border. The accent is passed in rather than read from
     `SEV` here, so this module keeps no dependency on the design system. */
  finding: (accent: string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "8px 10px",
    borderLeft: `2px solid ${accent}`,
    borderRadius: 6,
    background: "var(--bg-surface)",
  }),
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.3,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  findingLocation: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  /* A bare mono control, not a `Button`: the design gives the footer's left
     half plain text at the drawer's own weight, with no chrome around it. */
  trace: {
    padding: 0,
    border: "none",
    background: "none",
    fontSize: 12,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  count: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
