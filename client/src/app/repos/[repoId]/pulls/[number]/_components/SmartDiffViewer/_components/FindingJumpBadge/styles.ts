import type { CSSProperties } from "react";

export const s = {
  /**
   * Strips the button chrome without stripping the affordance: `:focus-visible` is
   * left to the app stylesheet's default outline, which is the only reason this can
   * safely be a bare-looking button.
   */
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)", fontWeight: 500 } satisfies CSSProperties,
} as const;
