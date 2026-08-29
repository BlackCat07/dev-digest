import type { CSSProperties } from "react";

/* The expanded half of a finding row in tabs mode, plus the one member the
   COLLAPSED row needs to become a disclosure. */

/** The expanded panel. */
export const s = {
  /* The card's second band. It owns its own padding because the card owns
     none — the collapsed row above is the first band, and the rule between them
     runs the full width of the card, as the reference draws it. */
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  /* `SUGGESTED FIX` — 11px/700, 0.05em, uppercase, `--text-muted`, per the
     reference. It is the ONE label in the panel: the rationale is the agent's
     prose and opens the panel directly, with nothing standing over it. */
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    lineHeight: 1.5,
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
   * unreachable by keyboard. It resets the native chrome and owns the card's
   * first band: the severity chip, the two-line body and the chevron, laid out
   * as one 12px/14px-padded row. The card itself is padding-free, so this
   * button and the panel below it are the only two boxes in it.
   */
  disclosure: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    padding: "12px 14px",
    border: 0,
    background: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
