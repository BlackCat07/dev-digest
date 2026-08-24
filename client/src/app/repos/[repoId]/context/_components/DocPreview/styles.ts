import type { CSSProperties } from "react";

/** Co-located styles for DocPreview. Every token is declared in `vendor/ui/styles.css`. */
export const s = {
  /**
   * The document owns the whole right-hand pane — it is the reason the screen
   * exists, so it gets the width and the height rather than sitting in a card.
   * No radius and no border of its own: the rail's `borderRight` is already the
   * divider, and a second edge beside it reads as a seam.
   *
   * It keeps `--bg-elevated` even though it is now full-bleed, and that is
   * deliberate — `DocumentMarkdown`'s fenced blocks are `--bg-primary` so they
   * sit *recessed below* this surface. Flattening the pane to the page
   * background would leave code level with it and the distinction would vanish.
   */
  pane: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  /** Nothing selected: the same surface, with the prompt centred in it. */
  empty: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  /** A fixed header bar over a scrolling body, so the path and the agent count
   * stay visible while a long document is read. */
  head: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    flexShrink: 0,
    padding: "14px 28px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  path: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  meta: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  /**
   * The body scrolls, not the page. `maxWidth` on the inner column rather than
   * on the pane: prose past ~80 characters is measurably harder to read, but the
   * pane still has to fill the viewport so the header bar spans it.
   */
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "24px 28px 56px",
  } satisfies CSSProperties,

  bodyInner: { maxWidth: 860 } satisfies CSSProperties,
} as const;
