import type { CSSProperties } from "react";
import { FONT_SIZE, GUTTER_WIDTH, LINE_HEIGHT, MAX_HEIGHT, PAD_X, PAD_Y } from "./constants";

/**
 * The text metrics shared by the highlight layer and the textarea.
 *
 * Spread into BOTH. If these ever diverge the caret stops sitting on the
 * character it is editing, which looks like a rendering bug and is impossible to
 * diagnose from the symptom.
 */
const textBase = {
  margin: 0,
  padding: `${PAD_Y}px ${PAD_X}px`,
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_HEIGHT}px`,
  // `pre`, not `pre-wrap`: the gutter numbers one PHYSICAL line each, so any soft
  // wrapping would silently push the numbers out of step with the text. Long
  // lines scroll sideways instead, the way an editor does.
  whiteSpace: "pre",
  tabSize: 2,
  border: "none",
  letterSpacing: "normal",
  // `satisfies`, not a `: CSSProperties` annotation — spreading an annotated
  // value makes the exported object's inferred type reference csstype's internals,
  // which tsc rejects as unportable (TS2742).
} satisfies CSSProperties;

/** Co-located styles for SkillBodyEditor. */
export const s = {
  /** The ONE border around the whole editor — bar, gutter and text together. */
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

  filename: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,

  unsaved: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    padding: "1px 6px",
    borderRadius: 4,
  } satisfies CSSProperties,

  tokens: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  /** Scrolls both axes; the gutter rides along because it is inside. */
  scroll: {
    display: "flex",
    alignItems: "stretch",
    maxHeight: MAX_HEIGHT,
    overflow: "auto",
  } satisfies CSSProperties,

  gutter: {
    ...textBase,
    flexShrink: 0,
    width: GUTTER_WIDTH,
    paddingLeft: 0,
    paddingRight: 10,
    textAlign: "right",
    color: "var(--text-muted)",
    opacity: 0.7,
    userSelect: "none",
    // Sticky so the numbers stay put when a long line scrolls the text sideways.
    // That means text slides UNDER the gutter, so it needs an opaque background
    // and a rule — without them the numbers and the code visibly collide.
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "var(--bg-primary)",
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,

  /** Sized by the highlight layer; the textarea is laid over it. */
  codeWrap: {
    position: "relative",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  highlight: {
    ...textBase,
    minWidth: "100%",
    width: "max-content",
    color: "var(--text-primary)",
    pointerEvents: "none",
  } satisfies CSSProperties,

  /**
   * Transparent glyphs over the highlight layer, with a visible caret — the way
   * an editable highlighted field is done without a rich-text editor. Selection
   * still renders, so text can be selected normally.
   */
  input: {
    ...textBase,
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    resize: "none",
    overflow: "hidden",
    background: "transparent",
    color: "transparent",
    caretColor: "var(--text-primary)",
    outline: "none",
    display: "block",
  } satisfies CSSProperties,

  heading: { color: "var(--accent-text)", fontWeight: 600 } satisfies CSSProperties,

  bullet: { color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
