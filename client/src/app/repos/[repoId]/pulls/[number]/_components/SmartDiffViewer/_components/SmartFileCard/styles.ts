import type { CSSProperties } from "react";

export const s = {
  /** The "✨ summary" marker in the file header: this file has a quoted summary. */
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 7px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
