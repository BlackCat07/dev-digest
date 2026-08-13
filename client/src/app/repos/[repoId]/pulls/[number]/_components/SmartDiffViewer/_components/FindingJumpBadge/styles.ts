import type { CSSProperties } from "react";
import { STICKY_SCROLL_MARGIN } from "@/lib/sticky-offset";

export const s = {
  /**
   * Strips the button chrome without stripping the affordance: `:focus-visible` is
   * left to the app stylesheet's default outline, which is the only reason this can
   * safely be a bare-looking button.
   *
   * `scrollMarginTop` is not decoration. Anything that scrolls this button into view
   * — Tab-focusing it from further down the diff, an automated click, a future
   * deep-link — lands it under `PrDetailHeader`, which is `position: sticky` over
   * the scrolling `<main>`: measured at `top: 52` with the header ~128px tall, so
   * `elementFromPoint` at the button's centre returns the HEADER. A keyboard user
   * then focuses a control they cannot see, and a click at that point is eaten
   * silently. The margin is the header's measured height for the same reason
   * `FindingCard` uses it — the height varies per PR, so a constant is wrong for
   * some of them.
   */
  button: {
    scrollMarginTop: STICKY_SCROLL_MARGIN,
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
