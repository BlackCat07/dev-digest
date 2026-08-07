import type { CSSProperties } from "react";

/** Co-located styles for SkillBody's markdown element map. */
export const s = {
  wrap: { fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" } satisfies CSSProperties,

  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text-primary)",
    margin: "0 0 12px",
  } satisfies CSSProperties,

  h2: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: "22px 0 8px",
  } satisfies CSSProperties,

  h3: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: "18px 0 6px",
  } satisfies CSSProperties,

  p: { margin: "0 0 10px" } satisfies CSSProperties,

  list: { margin: "0 0 12px", paddingLeft: 22, listStyle: "disc" } satisfies CSSProperties,

  orderedList: { margin: "0 0 12px", paddingLeft: 22, listStyle: "decimal" } satisfies CSSProperties,

  li: { margin: "0 0 4px" } satisfies CSSProperties,

  strong: { fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,

  code: {
    fontSize: "0.92em",
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  pre: {
    margin: "0 0 12px",
    padding: 12,
    borderRadius: 8,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    overflow: "auto",
    fontSize: 12.5,
  } satisfies CSSProperties,

  quote: {
    margin: "0 0 12px",
    padding: "2px 0 2px 14px",
    borderLeft: "3px solid var(--border-strong)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  hr: { border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" } satisfies CSSProperties,

  a: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
} as const;
