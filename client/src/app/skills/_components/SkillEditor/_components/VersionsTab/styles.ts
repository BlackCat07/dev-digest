import type { CSSProperties } from "react";

/** Co-located styles for the skill Versions tab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,

  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  } satisfies CSSProperties,

  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,

  subtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 16,
  } satisfies CSSProperties,

  row: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    background: current ? "var(--bg-hover)" : "var(--bg-elevated)",
    marginBottom: 10,
  }),

  versionChip: {
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 9px",
    borderRadius: 6,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    flexShrink: 0,
  } satisfies CSSProperties,

  meta: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  excerpt: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  date: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,

  actions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
} as const;
