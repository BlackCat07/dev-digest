import type { CSSProperties } from "react";
import { AGENT_GRID, RUNS_GRID } from "./constants";

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

  /**
   * One agent row. A real `<button>` when the agent still exists, so the row is
   * tab-reachable and carries an accessible name; a plain cell when it does not,
   * because there is no page to go to.
   */
  row: (interactive: boolean, hover: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: AGENT_GRID,
    alignItems: "center",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    border: "none",
    borderBottom: "1px solid var(--border)",
    background: hover ? "var(--bg-hover)" : "transparent",
    color: "var(--text-primary)",
    font: "inherit",
    cursor: interactive ? "pointer" : "default",
    transition: "background .1s",
  }),

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
