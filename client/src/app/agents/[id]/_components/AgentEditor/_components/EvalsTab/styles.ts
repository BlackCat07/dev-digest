import type { CSSProperties } from "react";

/**
 * Co-located styles for the agent editor's Evals tab.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`. An
 * undefined one does not error — the declaration silently drops and the element
 * inherits — which is why none is invented locally (`INSIGHTS.md`, 2026-08-06).
 *
 * `vendor/ui` is extend-by-props here as everywhere: the `Badge` overrides below
 * are passed as that primitive's own `style` prop, which it spreads LAST over its
 * defaults. The escape hatch is per-component — `style` is a prop on `Badge` and
 * on nothing else in that file — so `SeverityBadge` and `CategoryTag`, which a
 * case row now renders, are scaled by the `chips` WRAPPER around them rather
 * than by a prop they do not have. Neither primitive is edited.
 */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 22, maxWidth: 900 } satisfies CSSProperties,

  /**
   * The four tiles, as a GRID and not a wrapping flex row.
   *
   * A grid row equalises the height of its items for free, which a
   * `flexWrap: "wrap"` row does not: the moment one tile's change text wrapped
   * to a second line, that tile grew and its neighbours did not. `auto-fit` plus
   * `minmax` is the same recipe the skills editor's stats tiles and the compare
   * modal's cards already use, so a fourth tile reflows the same way there.
   */
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,

  /**
   * One tile, drawn locally rather than with the vendored `MetricCard`.
   *
   * Three of that primitive's decisions are wrong for this screen and none is
   * reachable by a prop: it draws a `Sparkline` in the top-right whenever a
   * trend is passed, it exposes no height hook at all (only `padding: 18` and
   * `flex: 1`), and the only way to put a change beside the value is to smuggle
   * it into `value` as a node, inheriting the 32px/700 type. `vendor/ui` is not
   * ours to give a prop to, so the tile is composed here from the same three
   * bands the primitive uses — caption, value, change — at this screen's sizes.
   *
   * `minHeight` and not `height`: `CASES PASSED` carries no change line, and
   * without a floor it would sit one line shorter than the three beside it. The
   * floor is set just above what the two bands actually occupy (caption 10.5 +
   * value 28 + the gap), so it equalises the row without padding it out — the
   * vendored `MetricCard`'s own `padding: 18` left a visible band of empty
   * elevated surface above and below the number.
   */
  tile: {
    minHeight: 78,
    padding: "10px 14px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,

  /** The tile's ALL-CAPS caption. */
  tileLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Value and change on one baseline, so the change reads as an annotation. */
  tileValueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /**
   * The number itself, in its metric's colour.
   *
   * Colour is decoration only: the caption above names the metric and the change
   * beside it carries a sign and a unit, so nothing here is the sole channel for
   * anything. `--text-primary` is the fallback for the pass ratio, which is a
   * count rather than a metric and takes no hue.
   */
  tileValue: (color?: string): CSSProperties => ({
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: color ?? "var(--text-primary)",
  }),

  /**
   * A tile's signed change, INLINE beside the value.
   *
   * Rendered here rather than through a `MetricCard`-style `delta`, and that is
   * the load-bearing part: the vendored primitive draws a delta as
   * `Math.abs(delta).toFixed(2)` with an arrow and no unit — the `↓ 0.02`
   * convention this feature must not ship, because a change in a metric
   * displayed as `82%` reads as "0.02 of what?". The text comes from the one
   * formatter in `src/lib/eval.ts` and reads `+4pt`; its own sign is the
   * direction, and this colour is the second channel behind it.
   */
  tileChange: (color: string): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    color,
  }),

  /**
   * The mechanical-scoring statement — a line of text, not a panel.
   *
   * It states how the number above was arrived at, which is a caption for the
   * tiles rather than a callout competing with them, so it carries no border and
   * no fill. The dashboard link that used to sit on its right now lives in the
   * section label's own right slot; there must be exactly ONE link with that
   * name on the screen.
   */
  note: {
    marginTop: 12,
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,

  noteIcon: {
    flexShrink: 0,
    marginTop: 2,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  noteText: {
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** The dashboard link, in the section label's right slot. */
  link: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
    whiteSpace: "nowrap",
    textTransform: "none",
    letterSpacing: 0,
  } satisfies CSSProperties,

  /** The case-list header: heading, the set-size chip, then the run-all control. */
  listHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    // No marginBottom — `SectionLabel` carries its own 14 and this row replaces it.
    marginBottom: 12,
  } satisfies CSSProperties,

  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,

  /** Pushes the run-all control (or the live progress) to the right edge. */
  headerRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,

  /** Live progress replaces the run-all control while a batch of this agent runs. */
  progress: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 220,
  } satisfies CSSProperties,

  progressLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** A refusal from the run-all control, inline and named. */
  refusal: {
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,

  /**
   * One case row: a leading outcome mark, two stacked lines, then the right-hand
   * chips and controls.
   *
   * `alignItems: "center"` — the mark reads as the row's verdict, not as a
   * bullet for its first line, so it sits on the block's vertical centre with the
   * two lines balanced either side of it. (The finding card aligns its severity
   * badge to the first line instead, because there the badge labels a title that
   * can run to several lines; here both lines are single and short.)
   */
  row: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  /** The leading outcome mark, centred with the row. */
  rowMark: (color: string): CSSProperties => ({
    flexShrink: 0,
    display: "inline-flex",
    color,
  }),

  /** The two lines, between the mark and the right-hand group. */
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  /** Line one: the case name and its expectation badge. */
  rowTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /**
   * The case name. A single text node, and it must stay one: the name of a case
   * derived from a finding is `path:low-high`, and the row is found in tests by
   * that whole string.
   */
  name: {
    fontSize: 12.5,
    fontWeight: 600,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** Line two: the counts, and the negative case's `assert empty` note. */
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 4,
  } satisfies CSSProperties,

  /** The right-hand group: chips, then the three controls. */
  rowRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,

  /**
   * The severity and category chips, sized from OUTSIDE.
   *
   * `SeverityBadge` and `CategoryTag` take no `style` and no `className` — the
   * escape hatch is per-component and exists on `Badge` alone — so the only way
   * to bring them down to a list row's scale without restyling the primitives is
   * a wrapper that scales them. Both carry their own label text, so the chip is
   * never colour alone.
   */
  chips: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    fontSize: 11,
  } satisfies CSSProperties,

  /**
   * A row's outcome as a WORD, rendered only where the word says something the
   * leading mark cannot.
   *
   * `passed` and `failed` beside a green tick and a red cross were the same
   * statement twice, so they are no longer drawn — the mark carries them, and it
   * carries them accessibly, with the word as its `aria-label` rather than as
   * dropped information. `never run` and `not run — timed out` DO still render
   * here: an icon cannot say which of the two it is, nor name the reason, and
   * "nothing was measured" must never be mistaken for a failure.
   */
  status: (color: string): CSSProperties => ({
    flexShrink: 0,
    fontSize: 11.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    color,
  }),

  counts: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** The negative case's note, on line two beside the counts. */
  assertEmpty: {
    fontSize: 11,
    color: "var(--warn)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  rowActions: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,

  /** Trims the vendored Badge one step, for a list row and the header chip.
      Passed as `style` — `Badge` spreads it LAST over its own defaults, and
      `vendor/ui` is extend-by-props, never restyled. Note the escape hatch is
      per-component: `style` is a prop on `Badge` and on neither
      `SeverityBadge` nor `CategoryTag`, which is why those two are scaled from
      outside by `chips` instead. */
  rowBadge: { fontSize: 10.5, padding: "1px 7px" } satisfies CSSProperties,

  /**
   * The pass-ratio chip beside the list heading.
   *
   * `--warn` on purpose and not `--ok`: it reads `5 / 7 passing`, so it is a
   * statement that two cases do NOT pass. Green on a number that includes
   * failures would be the wrong signal, and red would over-state a set that is
   * mostly passing. It is a THIRD figure beside the tile and the set size — see
   * the note at the top of `EvalsTab.tsx` about the three denominators.
   */
  passingBadge: {
    fontSize: 10.5,
    padding: "1px 7px",
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,

  skeletonRows: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
} as const;
