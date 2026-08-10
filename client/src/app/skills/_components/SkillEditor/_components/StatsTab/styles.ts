import type { CSSProperties } from "react";

/** Co-located styles for the skill Stats tab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,

  tileRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,

  tile: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "16px 18px",
  } satisfies CSSProperties,

  tileLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  tileValue: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    marginTop: 12,
  } satisfies CSSProperties,

  tileNumber: { fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,

  tileUnit: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  panelRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,

  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 16,
  } satisfies CSSProperties,

  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,

  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    marginBottom: 8,
  } satisfies CSSProperties,

  agentName: { fontSize: 13, fontWeight: 600, flex: 1 } satisfies CSSProperties,

  /** BarRow renders its own label/value; this only spaces the rows. */
  catRow: { marginBottom: 8 } satisfies CSSProperties,

  openBtn: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent-text)",
    cursor: "pointer",
    fontSize: 12.5,
  } satisfies CSSProperties,

  agentIcon: { color: "var(--accent)" } satisfies CSSProperties,

  none: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
