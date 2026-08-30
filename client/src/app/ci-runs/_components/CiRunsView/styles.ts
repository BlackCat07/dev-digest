import type { CSSProperties } from "react";

/**
 * Co-located styles for the CI Runs screen.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css` —
 * `--bg-primary`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, and the text /
 * border / status families. `var(--bg)` is NOT a token: an undefined custom
 * property is not a CSS error, the declaration silently drops and nothing
 * catches it (`client/INSIGHTS.md`, 2026-08-06).
 *
 * `vendor/ui` is extend-by-props here as everywhere: the one primitive override
 * below is passed as `Badge`'s own `style` prop, which that component spreads
 * LAST over its defaults. Nothing here restyles a primitive.
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

  section: { marginBottom: 30 } satisfies CSSProperties,

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

  row: (grid: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: grid,
    alignItems: "center",
    gap: 12,
    padding: "11px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
  }),

  cell: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,

  mutedCell: { color: "var(--text-muted)", fontSize: 12.5 } satisfies CSSProperties,

  /** `owner/name #12` — the run's provenance, as one string that can wrap once. */
  prCell: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  prLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,

  /**
   * The skeleton rows, inside the real table frame.
   *
   * Shaped like the rows that are coming — same height, same padding — so the
   * table does not jump when the read lands.
   */
  skeletonRows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: 1,
  } satisfies CSSProperties,
} as const;
