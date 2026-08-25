import type { CSSProperties } from "react";

/* Co-located styles for ConfigureRunView. Every value is a token declared in
   `vendor/ui/styles.css` — note that `var(--bg)` is NOT one of them: the base
   background is `--bg-primary`, and an unknown custom property drops silently,
   so the only symptom is "it doesn't look like the mock"
   (`client/INSIGHTS.md`, 2026-08-06). */
export const s = {
  /** A centred reading column: this screen is a short form, not a data surface. */
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "28px 24px 64px",
  } satisfies CSSProperties,

  header: { marginBottom: 28 } satisfies CSSProperties,

  title: {
    fontSize: 22,
    fontWeight: 600,
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
   * The step-1 heading doubles as the `<label>` for the select.
   *
   * `SelectInput` takes neither `aria-label` nor `...rest`, and it lives in the
   * vendored design system, which is extended with new files and never
   * restyled for one screen — so the accessible name has to come from outside
   * the primitive. A wrapping `<label>` supplies it, because a `<select>` is a
   * labelable element and the label's text content becomes its name.
   */
  stepLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 8,
  } satisfies CSSProperties,

  stepHint: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    marginTop: 8,
  } satisfies CSSProperties,

  stepHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  } satisfies CSSProperties,

  stepHeadSpacer: { marginLeft: "auto" } satisfies CSSProperties,

  /**
   * The disabled agent step (AC-54). Dimmed AND worded: the explanation of what
   * to do first is the carrier, and the opacity is only its echo — colour on
   * its own never states a state on this screen (AC-88).
   */
  disabledStep: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    padding: "22px 18px",
    background: "var(--bg-surface)",
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  /** Agent cards. A fixed minimum keeps a long agent name from collapsing the
      column count to one on a narrow viewport. */
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 10,
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
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,

  cardEstimate: {
    fontSize: 12,
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
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
} as const;
