import type { CSSProperties } from "react";
import { RESULTS_INSET_TOP, RESULTS_INSET_X } from "../../styles";

/* Tabs mode, aligned to the reference design (`Columns _results_ (1)`, which
   despite its filename is the Tabs view).

   **The pane is not a card.** The reference draws the tab strip as a bar with a
   full-width 1px rule under it and lets the summary block and the finding cards
   sit directly on the page background — there is no bordered surface around
   them, and no footer bar. Wrapping the whole pane in a card, as this file used
   to, put a second border inside the one the strip already draws and made the
   agent's own cards look recessed into a panel rather than laid on the page.

   The strip therefore only spans the width its container gives it. The
   reference bleeds it to the viewport edge, which it can because the strip is a
   sibling of the padded results area; here both live *inside* `s.results`
   (`padding: 20px 28px`), which is the parent view's file and not this unit's.

   Every colour is a token. `var(--bg)` is not one — the base background is
   `var(--bg-primary)`, and an unknown custom property drops silently
   (`client/INSIGHTS.md`, 2026-08-06). */

/** Content width the reference caps the pane at: 760px, so a rationale
    paragraph keeps a readable measure however wide the window gets. The tab
    strip above it is deliberately not capped — it is chrome, not prose. */
/**
 * The pane's reading width — deliberately the SAME number as the pull-request
 * page's tab column (`PrDetailView/styles.ts` `s.tabColumn.maxWidth`), so a
 * reader moving between `Agent runs` there and a tab here does not meet two
 * different measures for what is the same kind of content.
 */
const PANE_WIDTH = 1080;

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  /* --- the tab strip -----------------------------------------------------
     Hand-rolled rather than the vendored `Tabs`, and the reason is the number
     beside each name. `Tabs` renders its `count` at a fixed 12px in
     `--text-muted`; the reference renders the SCORE at 11px/700 in that
     score's own band colour, and paints the active underline the same colour —
     which is the whole information content of the strip. `Tabs` takes no
     `style` prop, and `vendor/ui` is extend-by-new-file, so the choice was a
     local strip or a restyled primitive. This is the local strip. */
  /* Bleeds out of the results band so its rule runs the full width of the page,
     continuing the sub-bar's rule directly above it — the reference draws the
     strip as the bottom of the header stack, not as a widget inside the content.
     The negative margin cancels the band's insets (imported, so the two cannot
     drift) and the padding puts the labels back in line with the cards below. */
  tabStrip: {
    display: "flex",
    gap: 2,
    borderBottom: "1px solid var(--border)",
    // WRAPS rather than scrolls. `overflowX: "auto"` put a scrollbar under the
    // tabs even when they all fitted: this strip's own 28px right padding — the
    // one that cancels the bleed below — counts toward `scrollWidth`, so the
    // container was always a hair wider than its content and the bar was drawn
    // for nobody. A fan-out is capped at 8 agents (AC-8), which wrap onto a
    // second line on a narrow viewport and read fine; a scrollbar the reference
    // never draws does not.
    flexWrap: "wrap",
    margin: `${-RESULTS_INSET_TOP}px ${-RESULTS_INSET_X}px 0`,
    padding: `0 ${RESULTS_INSET_X}px`,
  } satisfies CSSProperties,
  /** 12px/16px padding and a 2px underline, per the reference's 41px-tall tab.
      `marginBottom: -1` lands that underline ON the strip's own rule rather
      than above it. */
  tab: (on: boolean, accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    borderBottom: `2px solid ${on ? accent : "transparent"}`,
    marginBottom: -1,
    background: "transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  tabLabel: (on: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: on ? 600 : 500,
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: (accent: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: accent,
  }),

  /* --- the pane ---------------------------------------------------------- */
  pane: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 20,
    maxWidth: PANE_WIDTH,
  } satisfies CSSProperties,

  /* --- the per-agent summary block ---------------------------------------
     The reference's 94px card: a 44px score ring, the agent's name in the
     score's band colour over the run's own summary sentence, and the trace
     control with the run's figures under it on the right. The 3px left rail is
     the same band colour, which is what ties the block to its tab. */
  summary: (accent: string): CSSProperties => ({
    display: "flex",
    // Top, not centre: the third column is anchored to the card's top-right
    // corner. Centred, it slid down the card as the run's summary grew — on a
    // long one the trace control ended up floating beside the middle of a
    // paragraph with nothing to line up against.
    alignItems: "flex-start",
    gap: 16,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accent}`,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    flexWrap: "wrap",
  }),
  /* The score stays vertically centred against the text block — the top-aligned
     card above is about the third column, and a ring pinned to the top edge
     beside a two-line name reads as a mistake. */
  scoreCell: {
    alignSelf: "center",
    display: "flex",
    flexShrink: 0,
  } satisfies CSSProperties,
  summaryText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  summaryHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  agentName: (accent: string): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: accent,
  }),
  summaryBody: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /* AC-68's sentence, in place of a score rather than beside one. */
  reason: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--crit)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  noScore: {
    fontSize: 13,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  summaryAside: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    marginLeft: "auto",
    textAlign: "right",
    flexShrink: 0,
  } satisfies CSSProperties,
  /* A bare mono control, not a `Button`: the reference gives the trace
     affordance plain text at the drawer's own weight, with no chrome — the same
     treatment columns mode already uses in its footer. */
  trace: {
    padding: 0,
    border: "none",
    background: "none",
    fontSize: 12,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  metrics: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /* --- the findings ------------------------------------------------------ */
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  /* The card carries the severity on a 3px left rail, and the collapsed row
     and the expanded panel are its two bands — so the card itself owns no
     padding, and `overflow: hidden` keeps the panel's top rule inside the
     radius. */
  finding: (accent: string): CSSProperties => ({
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accent}`,
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  }),
  /** The severity glyph's chip: the severity's own tint at 12% behind its own
      colour, exactly as the reference draws it. */
  severityChip: (color: string, bg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 6px",
    borderRadius: 5,
    background: bg,
    color,
    marginTop: 1,
    flexShrink: 0,
  }),
  findingMain: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  /* Line 1 — the title and what KIND of thing it is. */
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /* Line 2 — where it is and how sure the agent was. */
  findingMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  findingLocation: {
    fontSize: 12,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  confidence: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  confidenceDot: (color: string): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 2,
    transform: expanded ? "rotate(180deg)" : undefined,
    transition: "transform .12s ease",
  }),
  /* The count, as a plain line under the list. The reference draws no footer
     bar in tabs mode — the pane is not a card, so a bar with its own background
     and rule would be chrome around nothing. */
  foot: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
