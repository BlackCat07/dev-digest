import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillDrawer. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,

  fileRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,

  /** The native input is the accessible control; the Button just triggers it. */
  fileInput: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  error: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,

  previewHead: {
    display: "flex",
    alignItems: "center",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,

  tokens: { marginLeft: "auto", fontWeight: 400, letterSpacing: 0 } satisfies CSSProperties,

  previewCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 20,
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
