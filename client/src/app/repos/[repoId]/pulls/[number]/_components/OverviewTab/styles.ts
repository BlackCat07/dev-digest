import type { CSSProperties } from "react";

export const s = {
  /**
   * INTENT and BLAST RADIUS side by side — the two derived readings of one diff,
   * which is why they share a row rather than stacking.
   *
   * `auto-fit` + `minmax(min(100%, 380px), 1fr)` rather than two fixed tracks, and
   * both halves of that are load-bearing. `auto-fit` drops to ONE column once the
   * container cannot give each card 380px, so the pair reflows on a narrow window
   * with no media query, no `ResizeObserver` and no client-only branch — which
   * matters here because these screens are server-rendered first and a JS-decided
   * layout would hydrate into a different one. The inner `min(100%, 380px)` keeps
   * the track from claiming 380px inside a container narrower than that, which is
   * what would otherwise overflow the page on a phone.
   *
   * `alignItems: start` so a short Intent card does not stretch to the blast card's
   * height; each keeps its own.
   */
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
