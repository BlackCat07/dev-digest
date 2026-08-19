import type { CSSProperties } from "react";

import type { OnboardingTask } from "@devdigest/shared";

/** Co-located styles for TourSection.
 *
 *  Tokens only, and only tokens `vendor/ui/styles.css` actually declares: there is no
 *  `--bg` and no `--text-tertiary` in this design system, and an unknown custom property
 *  does not error — the declaration silently drops and the value falls back to inherited,
 *  so the mistake is invisible to `tsc`, `eslint` and every test (`client/INSIGHTS.md`,
 *  2026-08-06 and 2026-08-14). Muted text here is `--text-muted`; the step above it is
 *  `--text-secondary`.
 *
 *  The card mirrors `BlastRadiusCard/styles.ts` — same border, radius, background and
 *  18px padding — because both are read as one document-shaped block inside the app
 *  shell, and a second card vocabulary reads as a mistake rather than a distinction.
 *
 *  EC-15 runs through this file: a single-line `docker compose -f infra/compose.yml up`
 *  and a deeply nested path must WRAP rather than overflow their row. Every row that can
 *  hold repository-derived text therefore carries `minWidth: 0` (a flex child does not
 *  shrink below its content without it) and `overflowWrap: "anywhere"`. Wrapping is
 *  preferred to horizontal scrolling because a command the reader is invited to copy
 *  must be readable in full before they run it.
 */
export const s = {
  /** One section, the unit the on-this-page rail targets. */
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    // Without this the card grows to its widest mono path and pushes the rail narrower.
    minWidth: 0,
    // `AppFrame` scrolls an inner <main>, and the sticky screen header sits inside it,
    // so a rail link that jumps here would otherwise land the heading under the header.
    scrollMarginTop: 96,
  } satisfies CSSProperties,

  heading: {
    fontSize: 16,
    fontWeight: 650,
    lineHeight: 1.3,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  /** The notice rendered in place of a diagram this build cannot draw (AC-38). */
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "10px 12px",
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** COMMANDS / FIRST TASKS / LINKS — the same scale as the card labels elsewhere. */
  subLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    lineHeight: 1,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** A group: its label, then its rows. */
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,

  /** Shared list reset — the rows carry their own spacing. */
  rows: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    minWidth: 0,
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    padding: "8px 10px",
    minWidth: 0,
  } satisfies CSSProperties,

  /** The 1., 2., 3. of a reading order (US-4) — a position, not a bullet. */
  ordinal: {
    flex: "0 0 auto",
    fontSize: 12,
    lineHeight: "20px",
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Everything a row says, stacked, so a long path wraps instead of pushing the action off. */
  rowBody: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    flex: "1 1 auto",
  } satisfies CSSProperties,

  /** A repo-relative path or a command: mono, and wrapping rather than overflowing (EC-15). */
  mono: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    minWidth: 0,
  } satisfies CSSProperties,

  /** The command text itself, recessed below the row the way a code block is. */
  command: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "4px 8px",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    minWidth: 0,
  } satisfies CSSProperties,

  /** One line of prose: why this path is on the list, or where a command was declared. */
  rowNote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,

  /** Standing copy the reader needs once per group, not once per row. */
  hint: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** `Open` — an anchor, because it navigates; never a button with a click handler. */
  openLink: {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,

  /** Icon-only copy control. `copied` swaps the glyph AND the accessible name. */
  copyBtn: (copied: boolean) =>
    ({
      flex: "0 0 auto",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 5,
      borderRadius: 5,
      border: "1px solid var(--border)",
      background: copied ? "var(--ok-bg)" : "var(--bg-elevated)",
      color: copied ? "var(--ok)" : "var(--text-muted)",
      cursor: "pointer",
    }) satisfies CSSProperties,

  /**
   * The first-task complexity badge.
   *
   * Colour is the SECOND signal here, never the only one: the badge's text is the word
   * and its level ("Complexity: Low"), which is what the a11y budget asks for — status
   * carried by a word, not by a hue.
   */
  complexity: (level: OnboardingTask["complexity"]) =>
    ({
      flex: "0 0 auto",
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      lineHeight: "16px",
      whiteSpace: "nowrap",
      color: level === "high" ? "var(--crit)" : level === "medium" ? "var(--warn)" : "var(--ok)",
      background:
        level === "high"
          ? "var(--crit-bg)"
          : level === "medium"
            ? "var(--warn-bg)"
            : "var(--ok-bg)",
    }) satisfies CSSProperties,
} as const;
