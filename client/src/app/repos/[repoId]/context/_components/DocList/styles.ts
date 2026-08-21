import type { CSSProperties } from "react";

/** Co-located styles for DocList. Every token is declared in `vendor/ui/styles.css`. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,

  group: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,

  /**
   * The group label is the ROOT the documents were found under, and it carries
   * the count. AC-33 is about a reader being able to tell "these came from
   * specs/" from "these came from docs/" at a glance, so the label is a real
   * heading rather than a styled div — a screen-reader user navigating by
   * heading gets the same grouping a sighted one gets from the rule below it.
   */
  groupLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "0 2px 6px",
    margin: 0,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid",
    borderColor: selected ? "var(--accent)" : "transparent",
    background: selected ? "var(--accent-bg)" : "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    font: "inherit",
    fontSize: 13,
  }),

  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  meta: {
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /**
   * One file mark per row. It takes the accent only on the selected row, which
   * is the same signal the row's border and background already carry — colour
   * is never the only carrier here, because the row also has `aria-current` and
   * the icon itself is `aria-hidden`.
   */
  icon: (selected: boolean): CSSProperties => ({
    flexShrink: 0,
    color: selected ? "var(--accent)" : "var(--text-muted)",
  }),
} as const;
