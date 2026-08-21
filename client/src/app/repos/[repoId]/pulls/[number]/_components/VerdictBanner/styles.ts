import type { CSSProperties } from "react";

/**
 * Co-located styles for VerdictBanner (extracted from inline styles).
 *
 * The type scale here runs one step below the app's default headline rhythm —
 * 16/13 rather than 18/14 — because this banner is a SUMMARY sitting above three
 * cards that each carry their own reading. It was competing with them for the
 * first glance; the verdict word still leads the block, just without shouting.
 */
export const s = {
  wrap: {
    display: "flex",
    // A COLUMN, not a row: the verdict word and the findings badge own the top
    // line, and the paragraph plus the score rail form a block under it. The
    // paragraph was previously boxed in between the icon gutter and the rail,
    // which left it the narrowest thing on a full-width card.
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  /** The top line: the icon is a MEMBER of this row rather than a full-height
      gutter beside the card, so everything below it starts at the card's own
      padding and reads as one block. */
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** The second line: the paragraph and the rail are siblings here, which is what
      puts the rail beside the TEXT instead of beside the whole card. */
  body: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  label: (color: string): CSSProperties => ({
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color,
  }),
  /** Trims the vendored Badge one step to sit under the 16px verdict word.
      Passed as `style` — `vendor/ui` is extend-by-props, never restyled. */
  countBadge: { fontSize: 11.5, padding: "2px 8px" } satisfies CSSProperties,
  summary: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    // No marginTop — `wrap`'s gap is the space between the two rows now.
  } satisfies CSSProperties,

  /**
   * The right-hand rail: the score, its label, a rule, and the run's receipt.
   *
   * The cost moved OUT of the main column and under the score on purpose — both
   * are figures about the run that produced this verdict, so they read as one
   * block, and the summary paragraph gets the full column width it needs. The
   * rule is what separates the judgement (a score out of 100) from what it cost
   * to reach; without it the two numbers run together as one unlabelled stack.
   */
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.08em",
  } satisfies CSSProperties,
  /** Spans the rail, so its width is set by the widest thing under it — the
      cost line. That is what makes it read as a rule belonging to this stack
      rather than a divider across the card. */
  scoreRule: {
    alignSelf: "stretch",
    height: 1,
    background: "var(--border)",
    margin: "7px 0 6px",
  } satisfies CSSProperties,
  costRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,
} as const;
