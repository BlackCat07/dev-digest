import type { CSSProperties } from "react";

/** HomeView styles. Values come from the design-token custom properties. */
export const s = {
  skeletonStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 480,
  } satisfies CSSProperties,

  redirectNote: {
    color: "var(--text-secondary)",
    marginBottom: 14,
  } satisfies CSSProperties,
};
