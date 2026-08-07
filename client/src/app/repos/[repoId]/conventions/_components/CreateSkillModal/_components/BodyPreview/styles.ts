import type { CSSProperties } from "react";
import { FONT_SIZE, GUTTER_WIDTH, LINE_HEIGHT, PAD_X, PAD_Y } from "./constants";

/** Co-located styles for BodyPreview. */
export const s = {
  /** The ONE border around bar, gutter and code together. */
  frame: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-primary)",
    overflow: "hidden",
  } satisfies CSSProperties,

  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  barIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  filename: {
    fontSize: 12.5,
    fontWeight: 600,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** Nothing has been written yet — this text exists only in the preview. */
  unsaved: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    padding: "1px 6px",
    borderRadius: 4,
    flexShrink: 0,
  } satisfies CSSProperties,

  tokens: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /**
   * The body grows to its full length — no `maxHeight`, no `overflow`.
   *
   * A capped, scrolling frame put a scroll region inside the modal's own, which
   * traps the wheel and hides how long the composed skill really is. The modal
   * keeps a fixed header and footer, so one scroll region reads the whole body
   * with the Create button always in place.
   */
  code: {
    padding: `${PAD_Y}px 0`,
  } satisfies CSSProperties,

  /**
   * One grid row per source line: number, then text.
   *
   * A row per line rather than a `<pre>` gutter beside a `<pre>` of code, because
   * this surface WRAPS. A shared-`<pre>` gutter numbers physical lines, so the
   * first wrapped line would put every following number one visual row out of
   * step with its text. Here the number is laid out with the line it belongs to,
   * and `alignItems: start` keeps it on the first visual row of a wrapped one.
   */
  row: {
    display: "grid",
    gridTemplateColumns: `${GUTTER_WIDTH}px minmax(0, 1fr)`,
    alignItems: "start",
    columnGap: PAD_X,
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
  } satisfies CSSProperties,

  num: {
    textAlign: "right",
    color: "var(--text-muted)",
    opacity: 0.7,
    userSelect: "none",
  } satisfies CSSProperties,

  /**
   * `pre-wrap`, and `anywhere` so a long path or a minified line cannot make the
   * modal scroll sideways. Indentation is preserved — it is part of the snippet.
   */
  line: (tone?: CSSProperties): CSSProperties => ({
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    tabSize: 2,
    paddingRight: PAD_X,
    ...tone,
  }),

  heading: { color: "var(--accent-text)", fontWeight: 600 } satisfies CSSProperties,

  bullet: { color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
