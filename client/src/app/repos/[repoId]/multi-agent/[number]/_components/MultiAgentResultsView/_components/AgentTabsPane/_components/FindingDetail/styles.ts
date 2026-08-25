import type { CSSProperties } from "react";

/* The expanded half of a finding row in tabs mode, plus the one member the
   COLLAPSED row needs to become a disclosure. */

/** The expanded panel. */
export const s = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 10,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  prose: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /**
   * The server's refusal, below the actions and disabling none of them: only
   * the eval case was refused, so `Accept` and `Dismiss` stay operable — and on
   * an undecided finding they are exactly what clears the refusal.
   */
  refusal: {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;

/**
 * What the collapsed row above the panel needs.
 *
 * One member, and it exists because the disclosure is introduced BY the
 * expansion: a button wrapper has no meaning on a row that cannot open. The
 * unit that owns the expansion therefore owns its styling, and `AgentTabsPane`
 * reads it through this unit's barrel. The decided tags beside it need nothing
 * here at all — they are the vendored `Badge`, used as it is meant to be.
 */
export const row = {
  /**
   * The whole collapsed row, as one button.
   *
   * A real `<button>`, not a `<div onClick>`: the row is the only way to reach
   * the rationale and the three actions, and a click handler on a div is
   * unreachable by keyboard. It resets the native chrome and re-declares the
   * column layout the row had while it was the `<article>`'s direct content, so
   * the collapsed row looks identical before and after this change.
   */
  disclosure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    width: "100%",
    padding: 0,
    border: 0,
    background: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
