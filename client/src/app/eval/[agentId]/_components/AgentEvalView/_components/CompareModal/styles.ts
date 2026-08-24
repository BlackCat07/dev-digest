import type { CSSProperties } from "react";

/**
 * Co-located styles for the comparison modal.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`; none
 * is invented locally, because an undefined custom property is not a CSS error —
 * the declaration silently drops and nothing catches it. `var(--bg)` in
 * particular is NOT a token (`--bg-primary` / `--bg-surface` / `--bg-elevated` /
 * `--bg-hover` are).
 */
export const s = {
  body: { padding: "18px 24px 22px" } satisfies CSSProperties,

  /** The four cards — recall, precision, citation accuracy, cost. */
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,

  card: {
    padding: "14px 15px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  cardLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Earlier → later, on one line, with the arrow between them. */
  cardValues: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginTop: 10,
    fontSize: 18,
    fontWeight: 700,
  } satisfies CSSProperties,

  earlier: { color: "var(--text-secondary)", fontWeight: 600 } satisfies CSSProperties,

  arrow: { color: "var(--text-muted)" } satisfies CSSProperties,

  later: { color: "var(--text-primary)" } satisfies CSSProperties,

  /** The signed change, or the "not measured" sentence in its place. */
  change: (color: string): CSSProperties => ({
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),

  sideLabels: {
    display: "flex",
    gap: 8,
    marginTop: 6,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  section: { marginTop: 22 } satisfies CSSProperties,

  /** Gap between the region heading and the prompt panes it labels. */
  sectionBody: { marginTop: 10 } satisfies CSSProperties,

  /** The prompt-unchanged sentence, which REPLACES the diff body. */
  unchanged: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  prompts: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,

  promptPane: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,

  promptHead: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  promptBody: {
    margin: 0,
    padding: "12px",
    maxHeight: 220,
    overflow: "auto",
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  promoted: {
    fontSize: 12.5,
    color: "var(--ok)",
    marginLeft: "auto",
  } satisfies CSSProperties,

  skeletons: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "18px 24px",
  } satisfies CSSProperties,
} as const;
