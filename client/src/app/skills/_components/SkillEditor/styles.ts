import type { CSSProperties } from "react";

/** Co-located styles for the SkillEditor shell. */
export const s = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,

  icon: { color: "var(--accent)" } satisfies CSSProperties,

  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,

  typeBadge: (color: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "2px 8px",
    borderRadius: 4,
  }),

  tabsBar: { marginTop: 14, flexShrink: 0 } satisfies CSSProperties,

  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
