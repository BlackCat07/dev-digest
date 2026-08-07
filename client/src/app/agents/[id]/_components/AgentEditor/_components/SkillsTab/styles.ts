import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's Skills tab. */
export const s = {
  wrap: { maxWidth: 680 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,

  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,

  filter: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
  } satisfies CSSProperties,

  filterIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  filterInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  hint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,

  row: (linked: boolean, dragOver: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid " + (dragOver ? "var(--accent)" : "var(--border)"),
    background: linked ? "var(--bg-hover)" : "var(--bg-elevated)",
    // An unlinked skill is still listed — attaching is the primary action here —
    // but dimmed so the attached set reads at a glance.
    opacity: linked ? 1 : 0.7,
  }),

  handle: (linked: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    // Only a linked row has an order to change, so only it advertises a grab.
    cursor: linked ? "grab" : "not-allowed",
    flexShrink: 0,
    background: "none",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
  }),

  checkbox: (on: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: 4,
    border: "1.5px solid " + (on ? "var(--accent)" : "var(--border-strong)"),
    background: on ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    cursor: "pointer",
    padding: 0,
  }),

  checkIcon: { color: "#fff" } satisfies CSSProperties,

  name: {
    fontSize: 12.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  disabledNote: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,

  typeBadge: (color: string): CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
  }),

  none: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
