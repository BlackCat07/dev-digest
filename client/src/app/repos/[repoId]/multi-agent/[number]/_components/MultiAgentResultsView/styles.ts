import type { CSSProperties } from "react";

/* The results screen's own layout. Only the page frame lives here — the two
   modes each own their styles, and the disagreement block will own its own when
   it lands, because a unit that reads a screen's `styles.ts` stops being
   movable.

   `var(--bg)` is not a token: the base background is `var(--bg-primary)`, and
   an unknown custom property drops silently (`client/INSIGHTS.md`, 2026-08-06). */
export const s = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    padding: 28,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minWidth: 0,
  } satisfies CSSProperties,
  eyebrow: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  title: {
    fontSize: 21,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  /* AC-86: what the fan-out actually is — bounded concurrency inside the review
     executor. Neither git worktrees nor the platform job queue are involved,
     and both of those words shipped here once. */
  meta: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  loadingColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 28,
  } satisfies CSSProperties,
} as const;
