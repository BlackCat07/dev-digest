import type { CSSProperties } from "react";
import { SELECT_BOX_HEIGHT } from "./constants";

/** Co-located styles for CreateSkillModal. */
export const s = {
  /**
   * The fields, top to bottom.
   *
   * No `gap`: `FormField` already carries `marginBottom: 20`, and adding a gap
   * on top of it spaces the fields nearly twice as far apart as the mock. The
   * banner is not a FormField, so it brings its own matching margin.
   *
   * `overflow` is deliberately absent — `Modal` already scrolls its children,
   * and a second scroller here would nest one scroll region inside another.
   */
  body: {
    display: "flex",
    flexDirection: "column",
    padding: 20,
  } satisfies CSSProperties,

  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--accent)",
    background: "color-mix(in srgb, var(--accent) 10%, transparent)",
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 20,
    // The prose recedes so the two emphasised spans below carry the line.
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  bannerIcon: { color: "var(--accent)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,

  /** The count — the fact the sentence reports. */
  bannerStrong: { fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,

  /** The repository, in the icon's blue: the colour this app gives a repo name. */
  bannerRepo: { fontWeight: 700, color: "var(--accent)" } satisfies CSSProperties,

  /** Type and Enabled share a line: both are one-glance settings. */
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,

  /**
   * A slot as tall as the select beside it, with the toggle centred in it.
   *
   * Without the height the toggle sits at the top of its column and reads as
   * detached from the field it pairs with; the two labels align on their own, so
   * this is the only thing needed to line the controls up.
   */
  toggleSlot: {
    display: "flex",
    alignItems: "center",
    minHeight: SELECT_BOX_HEIGHT,
  } satisfies CSSProperties,

  error: {
    fontSize: 12,
    color: "var(--crit)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  /** What pressing Create will actually do, on the left of the buttons. */
  footerNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginRight: "auto",
  } satisfies CSSProperties,

  footerIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
