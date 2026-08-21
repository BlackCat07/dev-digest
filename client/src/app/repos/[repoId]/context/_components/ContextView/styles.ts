import type { CSSProperties } from "react";

/** Co-located styles for ContextView. Every token is declared in `vendor/ui/styles.css`. */
export const s = {
  /**
   * Full-bleed two-pane shell, NOT the centred `maxWidth: 1280` gutter the
   * sibling Conventions screen uses. This screen is a reader: the document is
   * the content, and a centred column wastes the width it needs while squeezing
   * the list into a card beside it.
   *
   * `height: 100%` works because `AppFrame` renders
   * `<main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>` — so the panes
   * below can own their own scrolling instead of scrolling the whole page.
   * `minHeight: 0` on this row is what lets a flex child actually shrink; without
   * it the rail's content sets a floor and the inner `overflow: auto` never
   * engages.
   */
  shell: {
    display: "flex",
    height: "100%",
    minHeight: 0,
  } satisfies CSSProperties,

  /**
   * The document rail, flush against the app sidebar. Fixed width on purpose:
   * a path list is scanned, not read, and a proportional track would grow with
   * the viewport and steal it from the document.
   */
  rail: {
    width: 340,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,

  railHead: {
    padding: "18px 18px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  railLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,

  railRepo: {
    fontSize: 13,
    color: "var(--accent)",
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /**
   * The roots are shown ALWAYS, not only in the empty state. "Nothing here" and
   * "you are looking in the wrong place" read identically otherwise, and this is
   * the one line that separates them — the same information AC-30 puts in the
   * empty state, kept visible while the list is full.
   */
  railRoots: {
    marginTop: 6,
    fontSize: 11.5,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /**
   * The filter's height, imposed from OUTSIDE the primitive.
   *
   * `TextInput` hard-codes `padding: "10px 12px"` at `fontSize: 14` (~42px) and
   * spreads `...rest` onto the inner `<input>`, not onto its box — so it takes
   * neither `style` nor `className` for its own size, and restyling it in
   * `vendor/ui` would reach every other screen to shorten one rail.
   *
   * Two details below are load-bearing and are the documented pattern, not
   * preference:
   *  - `display: grid`, NOT flex — a lone grid item stretches on *both* axes, so
   *    the control also fills the rail's width. A flex wrapper stretches it
   *    vertically and leaves it at content width, collapsing it to the width of
   *    its placeholder.
   *  - `gridTemplateRows`, NOT `height` — a track is what the child's border and
   *    padding are absorbed into (`box-sizing: border-box` is global). `height`
   *    would size the wrapper and let the taller child overflow it.
   *
   * 34 rather than the toolbar convention of ~40: this control is alone in a
   * 340px rail with no other control to line up against, and the rail is a
   * scanning surface where every pixel spent on chrome is a row not shown.
   */
  railTools: {
    display: "grid",
    gridTemplateRows: "34px",
    padding: "12px 18px",
  } satisfies CSSProperties,

  notes: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "0 18px 12px",
  } satisfies CSSProperties,

  note: (tone: "muted" | "warn"): CSSProperties => ({
    fontSize: 12,
    lineHeight: 1.5,
    color: tone === "warn" ? "var(--warn)" : "var(--text-muted)",
    background: tone === "warn" ? "var(--warn-bg)" : "transparent",
    borderRadius: 6,
    padding: tone === "warn" ? "6px 10px" : 0,
  }),

  /** The rail scrolls independently of the document beside it. */
  railScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "0 12px 24px",
  } satisfies CSSProperties,

  /**
   * The load error sits HERE, inside the rail, rather than replacing the screen:
   * AC-31 requires the navigation and the breadcrumb to stay usable while it
   * shows, and a full-screen error state takes the whole page away.
   */
  listError: { padding: "4px 6px" } satisfies CSSProperties,

  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,

  /** `minWidth: 0` is load-bearing: without it an unbroken line in the rendered
   * document sets this track's minimum to its own content and pushes the rail
   * off-screen, because a flex item's default minimum is `auto`. */
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
} as const;
