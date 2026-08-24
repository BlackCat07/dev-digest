import type { CSSProperties } from "react";
import { RUNS_GRID } from "./constants";

/**
 * Co-located styles for the workspace eval dashboard.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css` —
 * `--bg-primary`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, and the text /
 * border / status families. `var(--bg)` is NOT a token: an undefined custom
 * property is not a CSS error, the declaration silently drops and nothing
 * catches it (`client/INSIGHTS.md`, 2026-08-06).
 *
 * `vendor/ui` is extend-by-props here as everywhere: the one primitive override
 * below is passed as `Badge`'s own `style` prop, which that component spreads
 * LAST over its defaults. The escape hatch is per-component — `style` is a prop
 * on `Badge` and not on `SeverityBadge` or `CategoryTag` — so nothing here
 * reaches for either of those.
 */
export const s = {
  page: { padding: "22px 24px 40px" } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 22,
  } satisfies CSSProperties,

  headerText: { flex: 1, minWidth: 240 } satisfies CSSProperties,

  h1: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,

  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** The period filter and the run-all control, right-aligned on the header. */
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  periodLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  } satisfies CSSProperties,

  section: { marginBottom: 30 } satisfies CSSProperties,

  /** A skip notice from `Run all agents`, one line per agent that did not start. */
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "0 0 14px",
    padding: "10px 13px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  table: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  headRow: (grid: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: grid,
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  }),

  /** The agent cards, stacked. Not a table: see the note in this unit's view. */
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  /**
   * One agent card. A real `<button>` when the agent still exists, so the card is
   * tab-reachable and carries an accessible name; a plain container when it does
   * not, because there is no page to go to.
   */
  card: (interactive: boolean, hover: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    textAlign: "left",
    padding: "14px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: hover ? "var(--bg-hover)" : "var(--bg-elevated)",
    color: "var(--text-primary)",
    font: "inherit",
    cursor: interactive ? "pointer" : "default",
    transition: "background .1s",
  }),

  /** The product's signature "a thing of type X" mark. */
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,

  /** Name + model chip on line one, the last-run sentence on line two. */
  cardMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /** `Last run v5 · 1h · 5/7 pass` — one sentence, so it wraps as one. */
  cardMeta: {
    marginTop: 3,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /**
   * The three stat columns on the card's right.
   *
   * A fixed 62px per column rather than `auto`, so every card's numbers line up
   * vertically down the stack — ragged columns are what made the previous table
   * readable and are the one thing a card list gives up for free.
   */
  cardStats: {
    display: "flex",
    alignItems: "flex-start",
    gap: 22,
    flexShrink: 0,
  } satisfies CSSProperties,

  /**
   * One stat column: caption over figure.
   *
   * `display: "flex"` is load-bearing and was the bug. These are `<span>`s, so
   * they were inline by default — an inline box ignores `width`, and its inline
   * children flow side by side rather than stacking, which put `RECALL` and
   * `71%` on one line and let the three columns collide. A flex column stacks
   * them and makes the fixed width take effect, which is what keeps the figures
   * aligned down the stack of cards.
   */
  stat: {
    width: 66,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    flexShrink: 0,
  } satisfies CSSProperties,

  statLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  statValue: (color: string): CSSProperties => ({
    marginTop: 3,
    fontSize: 19,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color,
  }),

  /** The affordance that says the card opens something. */
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  /** One line under the cards, naming what the list is not showing. */
  hiddenNote: {
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  runRow: {
    display: "grid",
    gridTemplateColumns: RUNS_GRID,
    alignItems: "center",
    gap: 12,
    padding: "11px 16px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  name: {
    fontSize: 13.5,
    fontWeight: 550,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,

  unavailable: {
    fontSize: 13.5,
    fontWeight: 550,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  cell: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  metricCell: { fontSize: 12.5, color: "var(--text-primary)" } satisfies CSSProperties,

  /**
   * One metric in a run row: a bar, then the number.
   *
   * The bar is redundant by design — the percentage beside it is the actual
   * value, and the bar only makes a column of them comparable at a glance. It is
   * therefore `aria-hidden`, and losing it costs a reader nothing.
   */
  barCell: {
    display: "flex",
    alignItems: "center",
    gap: 9,
  } satisfies CSSProperties,

  barTrack: { flex: 1, minWidth: 40 } satisfies CSSProperties,

  barValue: {
    fontSize: 12,
    color: "var(--text-secondary)",
    width: 34,
    textAlign: "right",
    flexShrink: 0,
  } satisfies CSSProperties,

  /** The pass ratio, the one figure on a run row that is not a percentage. */
  passCell: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /** The version, rendered as the accent so it reads as the run's identity. */
  versionCell: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  mutedCell: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  /** A `Badge` override, passed through that primitive's own `style` prop. */
  modelChip: { maxWidth: "100%", overflow: "hidden" } satisfies CSSProperties,

  trendCell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  } satisfies CSSProperties,

  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
