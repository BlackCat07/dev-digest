import type { CSSProperties } from "react";

/**
 * Co-located styles for the agent editor's Evals tab.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`. An
 * undefined one does not error — the declaration silently drops and the element
 * inherits — which is why none is invented locally (`INSIGHTS.md`, 2026-08-06).
 *
 * `vendor/ui` is extend-by-props here as everywhere: the two `Badge` overrides
 * below are passed as that primitive's own `style` prop, which it spreads LAST
 * over its defaults. Note the escape hatch is per-component — `style` is a prop
 * on `Badge` and on nothing else in that file — so nothing here reaches for
 * `SeverityBadge` or `CategoryTag`.
 */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 22, maxWidth: 900 } satisfies CSSProperties,

  /** The four tiles, on one row, each taking an equal share (`MetricCard` is `flex: 1`). */
  tiles: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,

  /**
   * A tile's signed change, rendered BESIDE the tile rather than through
   * `MetricCard`'s own `delta` prop.
   *
   * The primitive draws `delta` as `Math.abs(delta).toFixed(2)` with an arrow and
   * no unit — the `↓ 0.02` convention this feature must not ship, because a
   * change in a metric displayed as `82%` reads as "0.02 of what?". Giving the
   * primitive a unit prop is not an option (it is vendored), so the tile's
   * `delta` stays unset and the change is rendered here from the one formatter in
   * `src/lib/eval.ts`. The arrow direction is carried by the word's own sign.
   */
  tileChange: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),

  tileChangeMuted: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** One tile plus the change line under it. */
  tile: { flex: 1, minWidth: 190, display: "flex", flexDirection: "column" } satisfies CSSProperties,

  /** The section's one-line subtitle, on the SectionLabel's right. */
  subtitle: {
    fontSize: 11.5,
    fontWeight: 500,
    color: "var(--text-muted)",
    textTransform: "none",
    letterSpacing: 0,
  } satisfies CSSProperties,

  /** The mechanical-scoring statement and the dashboard link. */
  note: {
    marginTop: 14,
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexWrap: "wrap",
  } satisfies CSSProperties,

  noteText: {
    flex: 1,
    minWidth: 240,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  link: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
    whiteSpace: "nowrap",
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

  row: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  name: {
    fontSize: 12.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /**
   * A row's outcome: the icon and, beside it, the WORD.
   *
   * Colour is the third channel and never the only one — with colour removed a
   * passing row still reads `passed` and a failing one `failed`.
   */
  status: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    fontSize: 11.5,
    fontWeight: 600,
    color,
  }),

  counts: {
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** Where a severity and category tag would sit on a findings row. */
  assertEmpty: {
    fontSize: 11,
    color: "var(--warn)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  rowActions: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,

  /** Trims the vendored Badge one step, for a list row and the header chip.
      Passed as `style` — `Badge` spreads it LAST over its own defaults, and
      `vendor/ui` is extend-by-props, never restyled. Note the escape hatch is
      per-component: `style` is a prop on `Badge` and on neither
      `SeverityBadge` nor `CategoryTag` in the same file. */
  rowBadge: { fontSize: 10.5, padding: "1px 7px" } satisfies CSSProperties,

  skeletonRows: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
} as const;
