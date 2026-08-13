import type { CSSProperties } from "react";

export const s = {
  // No margin of its own: this sits inside FindingsPanel's `s.toolbar`, next to
  // SeverityFilter, and that toolbar owns the spacing.
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /**
   * `Chip` has no `disabled` prop and `vendor/ui/**` is do-not-touch, so a label
   * with nothing to isolate is dimmed by its wrapper instead. Never applied to
   * the ACTIVE chip — that would make the filter impossible to clear.
   */
  empty: {
    display: "inline-flex",
    opacity: 0.45,
    pointerEvents: "none",
  } satisfies CSSProperties,
} as const;
