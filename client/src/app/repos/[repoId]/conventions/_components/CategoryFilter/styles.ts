import type { CSSProperties } from "react";

/**
 * Co-located styles for CategoryFilter.
 *
 * Every number here is copied from `Button`'s `md` size in
 * `vendor/ui/primitives/Button.tsx` — padding `7px 13px`, font 13, line-height
 * 1.2, radius 6, a 1px border — because the whole point of this unit is to sit
 * in a row of buttons at exactly their height. If `Button`'s metrics ever
 * change, these have to follow; there is no way to derive them, since the
 * primitive builds its style object inline.
 */

const FONT_SIZE = 13;
const LINE_HEIGHT = 1.2;
const PAD_Y = 7;
const PAD_X = 13;

export const s = {
  wrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
  } satisfies CSSProperties,

  select: {
    // `appearance: none` is what lets the box match a button at all — a native
    // select reserves its own chrome and ignores most of this otherwise.
    appearance: "none",
    WebkitAppearance: "none",
    boxSizing: "border-box",
    // Room on the right for the chevron drawn over the top.
    padding: `${PAD_Y}px ${PAD_X + 18}px ${PAD_Y}px ${PAD_X}px`,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontWeight: 500,
    letterSpacing: "-0.01em",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    cursor: "pointer",
    outline: "none",
  } satisfies CSSProperties,

  chevron: {
    position: "absolute",
    right: 9,
    color: "var(--text-muted)",
    // The click has to reach the select underneath.
    pointerEvents: "none",
  } satisfies CSSProperties,
} as const;
