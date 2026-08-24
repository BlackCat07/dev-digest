import type { CSSProperties } from "react";
import { RUNS_GRID } from "./constants";

/**
 * Co-located styles for one agent's eval page.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`.
 * `var(--bg)` is NOT a token — the file defines `--bg-primary`, `--bg-surface`,
 * `--bg-elevated` and `--bg-hover` — and an undefined custom property is not a
 * CSS error: the declaration silently drops and nothing catches it
 * (`client/INSIGHTS.md`, 2026-08-06).
 *
 * The one primitive override below is passed as `Badge`'s own `style` prop,
 * which that component spreads LAST over its defaults. The escape hatch is
 * per-component — `style` is a prop on `Badge` and on neither `SeverityBadge`
 * nor `CategoryTag` — so nothing here reaches for those.
 */
export const s = {
  page: { padding: "22px 24px 40px" } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  } satisfies CSSProperties,

  headerText: { flex: 1, minWidth: 240 } satisfies CSSProperties,

  h1: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,

  subtitle: {
    marginTop: 4,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

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

  section: { marginBottom: 28 } satisfies CSSProperties,

  /**
   * The regression alert strip. `--warn` and not `--crit`: a metric that fell is
   * a signal to look, not an outage, and the sentence itself names the metric and
   * the size of the fall, so colour is the second channel only.
   */
  alert: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 20,
    padding: "12px 14px",
    borderRadius: 9,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,

  alertTitle: { fontWeight: 700, marginRight: 6 } satisfies CSSProperties,

  /** The three cards, on one row, each taking an equal share (`MetricCard` is `flex: 1`). */
  cards: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,

  /** One card plus the change line under it. */
  card: {
    flex: 1,
    minWidth: 190,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  /**
   * A card's signed change, rendered BESIDE the card rather than through
   * `MetricCard`'s own `delta` prop.
   *
   * The primitive draws `delta` as `Math.abs(delta).toFixed(2)` with an arrow and
   * NO unit — the `↓ 0.02` convention this feature must not ship, because a
   * change in a metric displayed as `82%` reads as "0.02 of what?". Giving the
   * vendored primitive a unit prop is not an option, so `delta` stays unset and
   * the change is rendered here from the single formatter in `src/lib/eval.ts`.
   */
  cardChange: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),

  chart: {
    padding: "6px 4px 0",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  legend: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "10px 14px 12px",
    flexWrap: "wrap",
  } satisfies CSSProperties,

  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  legendSwatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 99,
    background: color,
  }),

  table: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  headRow: {
    display: "grid",
    gridTemplateColumns: RUNS_GRID,
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
  } satisfies CSSProperties,

  row: (selected: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: RUNS_GRID,
    alignItems: "center",
    gap: 12,
    padding: "11px 16px",
    borderBottom: "1px solid var(--border)",
    background: selected ? "var(--bg-hover)" : "transparent",
  }),

  runsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  selectionCount: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  cell: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  metricCell: { fontSize: 12.5, color: "var(--text-primary)" } satisfies CSSProperties,

  mutedCell: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  /** A `Badge` override, through that primitive's own `style` prop. */
  modelChip: { maxWidth: "100%", overflow: "hidden" } satisfies CSSProperties,

  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  /**
   * Visually hidden, still in the accessibility tree.
   *
   * The selection checkbox on a run row must carry a name — an unnamed control
   * is invisible to a screen reader — but repeating "Select this run for
   * comparison" as visible text on every row would drown the numbers the row
   * exists to show. `clip` and a 1px box rather than `display: none`, which
   * would remove it from the tree along with the pixels.
   */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,

  note: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "14px 2px",
  } satisfies CSSProperties,
} as const;
