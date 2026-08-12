import type { CSSProperties } from "react";

export const s = {
  /**
   * Strips the button chrome without stripping the affordance: `:focus-visible` is
   * left to the app stylesheet's default outline, which is the only reason this can
   * safely be a bare-looking button. Same reset as `FindingJumpBadge`'s, plus the
   * row padding the plain `<span>` wrapper used to carry.
   */
  button: {
    display: "inline-flex",
    alignItems: "center",
    background: "none",
    border: "none",
    padding: 0,
    paddingRight: 12,
    margin: 0,
    font: "inherit",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
