import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    width: "fit-content",
  } satisfies CSSProperties,
  /** A dotted underline in the severity colour marks the counter as hoverable. */
  counter: (color: string, dotted: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 11.5,
    fontWeight: 600,
    color,
    borderBottom: dotted ? `1px dotted ${color}` : "none",
    paddingBottom: dotted ? 1 : 0,
  }),
  dash: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
