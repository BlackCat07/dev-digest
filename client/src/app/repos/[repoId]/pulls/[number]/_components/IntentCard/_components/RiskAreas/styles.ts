import type { CSSProperties } from "react";

/* Styles for the RISK AREAS chip row (L03).

   Tokens only — `var(--bg-primary)`, `var(--bg-hover)`, `var(--border)`. Note
   `var(--bg)` is NOT a token in this design system: an unknown custom property
   makes the declaration drop silently, leaving a transparent surface that looks
   almost right (`client/INSIGHTS.md`, 2026-08-06). */

export const s = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,

  /** The chip itself. `severity` tints only the icon and the active border, so an
      unopened row reads as one group rather than a traffic light. */
  chip: (active: boolean, color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
    textAlign: "left",
    cursor: "pointer",
    color: "var(--text-secondary)",
    background: active ? "var(--bg-hover)" : "transparent",
    border: `1px solid ${active ? color : "var(--border)"}`,
  }),

  /** The single open disclosure panel, below the whole row. */
  panel: {
    marginTop: 12,
    padding: "12px 14px",
    borderRadius: 6,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** File references under the explanation. Wraps — a path is long. */
  refs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 10,
  } satisfies CSSProperties,

  /** A cited path. Mono TEXT, not a link — nothing is wired to click yet. */
  ref: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
} as const;
