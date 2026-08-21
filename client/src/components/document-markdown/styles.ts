import type { CSSProperties } from "react";

/**
 * Co-located styles for DocumentMarkdown's element map.
 *
 * Every custom property named here is declared in `src/vendor/ui/styles.css`.
 * An unknown one is not a CSS error — the declaration silently drops and the
 * element renders at whatever it inherited, which is exactly the class of bug
 * `INSIGHTS.md` records twice (2026-08-06 and 2026-08-14). The two names that
 * look obvious and do not exist are `--bg` and `--text-tertiary`; the real ones
 * are `--bg-primary` / `--bg-surface` / `--bg-elevated` / `--bg-hover` and
 * `--text-muted`.
 */
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

  orderedList: {
    margin: "0 0 12px",
    paddingLeft: 22,
    listStyle: "decimal",
  } satisfies CSSProperties,

  li: { margin: "0 0 4px" } satisfies CSSProperties,

  strong: { fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,

  em: { fontStyle: "italic" } satisfies CSSProperties,

  code: {
    fontSize: "0.92em",
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  /**
   * A fenced block is recessed BELOW the card it sits on, so it needs the base
   * background rather than the card's `--bg-elevated`.
   */
  pre: {
    margin: "0 0 12px",
    padding: 12,
    borderRadius: 8,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    overflow: "auto",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  /**
   * Tables are the element the vendored inline renderer cannot express at all,
   * and a spec's acceptance-criteria matrix is usually a table — `border-collapse`
   * plus a real header row is the whole difference between a grid and four words
   * on one line.
   */
  table: {
    width: "100%",
    borderCollapse: "collapse",
    margin: "0 0 14px",
    fontSize: 13,
  } satisfies CSSProperties,

  th: {
    textAlign: "left",
    fontWeight: 700,
    color: "var(--text-primary)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    padding: "6px 10px",
  } satisfies CSSProperties,

  td: {
    border: "1px solid var(--border)",
    padding: "6px 10px",
    verticalAlign: "top",
  } satisfies CSSProperties,

  quote: {
    margin: "0 0 12px",
    padding: "2px 0 2px 14px",
    borderLeft: "3px solid var(--border-strong)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  hr: {
    border: "none",
    borderTop: "1px solid var(--border)",
    margin: "18px 0",
  } satisfies CSSProperties,

  a: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
} as const;
