import type { CSSProperties } from "react";

export const s = {
  metaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "0 2px 12px",
  } satisfies CSSProperties,
  summary: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /**
   * A muted inline line, not `ErrorState`: that primitive is full-screen and would
   * replace the diff the reviewer came for, when the diff is still perfectly
   * renderable — only its ORDER is missing.
   */
  notice: {
    padding: "8px 12px",
    marginBottom: 10,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
