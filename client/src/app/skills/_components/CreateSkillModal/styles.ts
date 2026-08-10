import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
} as const;
