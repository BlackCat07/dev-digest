import type { CSSProperties } from "react";
import { STICKY_SCROLL_MARGIN } from "@/lib/sticky-offset";

/** Co-located styles for FindingCard (extracted from inline styles). */
export const s = {
  card: (focused: boolean, sevColor: string, muted: boolean): CSSProperties => ({
    borderRadius: 8,
    // A card reached from a diff badge scrolls itself to `block: "start"`, and the
    // PR header is `position: sticky` above it — at a height that varies per PR, so
    // this is measured rather than chosen (`client/INSIGHTS.md`, 2026-08-11).
    scrollMarginTop: STICKY_SCROLL_MARGIN,
    // FULLY per-side longhand. `border` is not the only shorthand here: so are
    // `borderColor` and `borderWidth`, and pairing either with a `borderLeft*`
    // longhand makes React warn "Updating a style property during rerender
    // (borderColor) when a conflicting property is set (borderLeftColor)" the
    // moment the shorthand's value changes — which `focused` does, on every
    // severity-filter change and every j/k move.
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: focused ? sevColor : "var(--border)",
    borderRightColor: focused ? sevColor : "var(--border)",
    borderBottomColor: focused ? sevColor : "var(--border)",
    borderLeftWidth: 3,
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s, border-color .12s, box-shadow .12s",
    boxShadow: focused ? "0 0 0 1px " + sevColor : "none",
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    cursor: "pointer",
  } satisfies CSSProperties,
  badgeWrap: { paddingTop: 1 } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  /** Out-of-scope marker in the title row. Neutral, not a severity colour — a
      finding outside the PR's stated scope is not a worse finding, and nothing
      is ever dropped for carrying this label. */
  outOfScopeTag: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 6px",
  } satisfies CSSProperties,
  acceptedTag: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dismissedTag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    marginTop: 2,
    flexShrink: 0,
  }),
  body: { padding: "14px 16px 16px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  trifectaWrap: { marginBottom: 14 } satisfies CSSProperties,
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  suggestionWrap: { marginTop: 14 } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 8,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /**
   * The look of an `aria-disabled` control.
   *
   * `Button` only dims itself for the native `disabled` attribute, and these
   * controls deliberately do not carry it: an `aria-disabled` button stays
   * focusable and announced, which is the whole reason `Turn into eval case` is
   * RENDERED on an undecided finding rather than hidden — the control is what
   * teaches the reader that the decision comes first. `Button` spreads `...style`
   * last over its own defaults, so this wins with no change to the primitive.
   */
  inertAction: { opacity: 0.55, cursor: "not-allowed" } satisfies CSSProperties,
  /**
   * The eval-case refusal, inline on the card that produced it.
   *
   * Warning rather than critical, and deliberately BELOW the action row: the
   * finding itself is unaffected — only the eval case was refused — so `Accept`
   * and `Dismiss` stay operable right above this text.
   */
  evalRefusal: {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  composer: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
