import type { CSSProperties } from "react";

export const s = {
  group: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
  } satisfies CSSProperties,
  option: (active: boolean, disabled: boolean): CSSProperties => ({
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    border: "none",
    background: active ? "var(--bg-hover)" : "transparent",
    color: disabled
      ? "var(--text-muted)"
      : active
        ? "var(--text-primary)"
        : "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : active ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  }),
} as const;
