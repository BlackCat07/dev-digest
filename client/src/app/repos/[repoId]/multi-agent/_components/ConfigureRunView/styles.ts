import type { CSSProperties } from "react";

/* Co-located styles for ConfigureRunView. Every value is a token declared in
   `vendor/ui/styles.css` — note that `var(--bg)` is NOT one of them: the base
   background is `--bg-primary`, and an unknown custom property drops silently,
   so the only symptom is "it doesn't look like the mock"
   (`client/INSIGHTS.md`, 2026-08-06). */
export const s = {
  /** A centred reading column: this screen is a short form, not a data surface. */
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "28px 24px 64px",
  } satisfies CSSProperties,

  header: { marginBottom: 28 } satisfies CSSProperties,

  title: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  subtitle: {
    marginTop: 6,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** One numbered step. The order of the two is AC-52's, so they are siblings
      in one column and never a grid that could reflow them. */
  step: { marginBottom: 24 } satisfies CSSProperties,

  /**
   * The step-1 block is a `<label>` wrapping its head AND the select.
   *
   * `SelectInput` takes neither `aria-label` nor `...rest`, and it lives in the
   * vendored design system, which is extended with new files and never
   * restyled for one screen — so the accessible name has to come from outside
   * the primitive. A wrapping `<label>` supplies it, because a `<select>` is a
   * labelable element and the label's text content becomes its name. The
   * numbered badge sits inside that label, so it is part of the name too.
   */
  stepBlock: { display: "block" } satisfies CSSProperties,

  /** One step's head row: the badge, the label, and whatever the step puts on
      the right. */
  stepHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  } satisfies CSSProperties,

  /**
   * The step number as a round badge.
   *
   * Accent-on-accent while the step is live, and the quietest pair on the
   * palette while it is not — the badge and its label dim together, so a
   * disabled step is stated twice (here and in the panel below it) and never by
   * colour alone (AC-88).
   */
  stepBadge: (disabled: boolean): CSSProperties => ({
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 700,
    background: disabled ? "var(--bg-hover)" : "var(--accent-bg)",
    color: disabled ? "var(--text-muted)" : "var(--accent)",
  }),

  stepLabel: (disabled: boolean): CSSProperties => ({
    fontSize: 13.5,
    fontWeight: 600,
    color: disabled ? "var(--text-muted)" : "var(--text-primary)",
  }),

  stepHeadSpacer: { marginLeft: "auto" } satisfies CSSProperties,

  /**
   * The disabled agent step (AC-54). A solid panel with an icon, a heading and
   * a sentence — worded, never merely dimmed: the explanation of what to do
   * first is the carrier, and the muted palette is only its echo, because
   * colour on its own never states a state on this screen (AC-88).
   *
   * Centred with `textAlign` plus auto margins rather than `align-items`, so
   * the paragraph can hold its own 320px measure while the panel stays full
   * width.
   */
  disabledStep: {
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    padding: "34px 20px",
    background: "var(--bg-elevated)",
    textAlign: "center",
  } satisfies CSSProperties,

  disabledIcon: {
    display: "grid",
    placeItems: "center",
    width: 42,
    height: 42,
    margin: "0 auto 12px",
    borderRadius: 11,
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  disabledTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  disabledBody: {
    maxWidth: 320,
    margin: "6px auto 0",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Agent cards, one per row at the column's full width: a card carries a
      whole sentence of verdict, and a two-up grid clamps it to two lines long
      before the reader has anything to compare. */
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  card: (selected: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 14,
    borderRadius: 8,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
    transition: "background .12s, border-color .12s",
  }),

  cardName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /** The agent's last verdict on the SELECTED pull request. Clamped rather than
      truncated with an ellipsis in JS, so the full sentence stays selectable
      and reachable by a screen reader. */
  cardVerdict: {
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,

  /** Mono, and the smallest type on the card: a figure to be compared down the
      column, not read as prose. */
  cardEstimate: {
    fontSize: 10.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** The run bar: the action and, beside it, the aggregate (AC-57). */
  runBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginTop: 24,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  aggregate: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
