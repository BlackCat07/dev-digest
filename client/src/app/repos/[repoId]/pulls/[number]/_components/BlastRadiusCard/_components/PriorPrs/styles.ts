import type { CSSProperties } from "react";

/** Co-located styles for the PRIOR PRS footer of the Blast Radius card.
 *
 *  Tokens only, and only ones `vendor/ui/styles.css` defines — there is no
 *  `--text-tertiary` and no `--bg` in this design system, and an unknown custom
 *  property drops silently rather than erroring (`client/INSIGHTS.md`, 2026-08-06).
 *
 *  This is a FOOTER, not a second card: it shares the parent's surface and is
 *  separated by a rule rather than a border box, and its type scale sits one step
 *  below the symbol rows above it. The impact map is the card's subject; history is
 *  context for it, and the visual weight has to say so. */
export const s = {
  /** The rule that separates history from the map above it. */
  root: {
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  /** "Prior PRs touching these files" + count + chevron, the whole row a button. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-muted)",
    fontSize: 12,
  } satisfies CSSProperties,
  headerIcon: { display: "flex", flexShrink: 0 } satisfies CSSProperties,
  /** The count sits right, where the symbol rows above put their caller counts. */
  headerCount: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  /** One earlier PR. A real link — it opens that PR's page in the studio. */
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    padding: "4px 0",
    textDecoration: "none",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    minWidth: 0,
  } satisfies CSSProperties,
  number: {
    fontFamily: "var(--font-mono)",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Titles are arbitrary length; the row must never widen the card. */
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  age: {
    marginLeft: "auto",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,

  /** One muted line: the empty case, the coverage caveat, the truncation note. */
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, marginTop: 2, display: "flex" } satisfies CSSProperties,
} as const;
