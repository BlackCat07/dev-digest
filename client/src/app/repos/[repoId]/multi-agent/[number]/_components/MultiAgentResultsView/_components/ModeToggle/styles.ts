import type { CSSProperties } from "react";

export const s = {
  group: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
  } satisfies CSSProperties,
  option: (active: boolean): CSSProperties => ({
    padding: "5px 14px",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    border: "none",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: active ? "default" : "pointer",
  }),
} as const;
