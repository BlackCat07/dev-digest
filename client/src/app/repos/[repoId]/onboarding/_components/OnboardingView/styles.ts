import type { CSSProperties } from "react";

import type { OnboardingNoticeLevel } from "@/lib/onboarding";

/** Co-located styles for OnboardingView.
 *
 *  Tokens only, and only tokens `vendor/ui/styles.css` actually declares: an unknown
 *  custom property is not a CSS error — the declaration silently drops and the value
 *  falls back to inherited, so the mistake survives `tsc`, `eslint` and every test
 *  (`client/INSIGHTS.md`, 2026-08-06 and 2026-08-14). There is no `--bg` and no
 *  `--text-tertiary`; muted text is `--text-muted` and the step above it is
 *  `--text-secondary`.
 *
 *  The page gutters are the Conventions screen's, deliberately: both are repo-scoped
 *  reading screens under the same shell, and a second gutter vocabulary reads as a
 *  mistake rather than as a distinction. `clamp` rather than a bare `maxWidth`, because
 *  a centred max-width alone produces no gutter at all until the window is wider than it.
 *
 *  The tour itself is two columns — the sections, and the on-this-page rail beside them.
 *  The rail is `position: sticky` inside a column that scrolls with the page rather than
 *  a pane of its own: `AppFrame` already scrolls an inner <main>, and a second scroll
 *  container inside it costs the reader a scrollbar for a five-item list.
 */
export const s = {
  page: {
    padding: "28px clamp(32px, 6vw, 112px)",
    maxWidth: 1280,
    margin: "0 auto",
  } satisfies CSSProperties,

  /** Title, repo name, then the two controls pushed to the right edge. */
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 8,
  } satisfies CSSProperties,

  heading: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    // The `h1` default margin would reintroduce the offset `alignItems` just removed.
    margin: 0,
    minWidth: 0,
  } satisfies CSSProperties,

  repoName: {
    color: "var(--accent)",
    fontSize: 14,
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  /** Pushes `Share link` and `Regenerate` to the right of the title row. */
  spacer: { marginLeft: "auto" } satisfies CSSProperties,

  /**
   * The provenance caption (AC-40) — section count, files the tour was generated
   * from, its age, and what the index had skipped.
   *
   * `tnum` on the element that carries it, so the figures do not jitter when the
   * age ticks over from `59m` to `1h` on a poll.
   */
  caption: {
    fontSize: 12,
    lineHeight: 1.6,
    color: "var(--text-muted)",
    marginBottom: 20,
  } satisfies CSSProperties,

  /** A one-line note under the header: the generate request's own failure. */
  note: (tone: "muted" | "warn" | "crit"): CSSProperties => ({
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 16,
    color: tone === "crit" ? "var(--crit)" : tone === "warn" ? "var(--warn)" : "var(--text-muted)",
  }),

  /**
   * The notice above the sections (AC-41, AC-42).
   *
   * Above and not instead: a stale or partial tour still renders all five sections
   * below this block, because hiding data that is true-as-of-a-commit is less honest
   * than labelling it. Degraded is the loudest of the three because its sections exist
   * only because the contract fixes five.
   */
  notice: (level: OnboardingNoticeLevel): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 4,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${level === "degraded" ? "var(--crit)" : "var(--warn)"}`,
    borderRadius: 8,
    background: level === "degraded" ? "var(--crit-bg)" : "var(--warn-bg)",
    padding: "12px 14px",
    marginBottom: 20,
  }),

  noticeTitle: {
    fontSize: 13,
    fontWeight: 650,
    lineHeight: 1.4,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  noticeBody: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  /** The running state: one indicator, and the promise that the app stays usable. */
  running: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "18px 20px",
    color: "var(--accent)",
  } satisfies CSSProperties,

  runningTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 3,
  } satisfies CSSProperties,

  runningBody: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    maxWidth: 520,
  } satisfies CSSProperties,

  /** Sections column + rail. The rail drops below on a narrow viewport rather than squeezing. */
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 200px",
    alignItems: "start",
    gap: 28,
  } satisfies CSSProperties,

  sections: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    // Without this a mono path inside a card widens the whole column past its track.
    minWidth: 0,
  } satisfies CSSProperties,

  /** On this page (AC-35). Sticky, so it stays reachable while the sections scroll past. */
  rail: {
    position: "sticky",
    // Clears the sticky screen header the shell keeps above the scrolling <main>.
    top: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,

  railLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    lineHeight: 1,
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,

  railLink: {
    fontSize: 12.5,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
    textDecoration: "none",
    borderLeft: "2px solid var(--border)",
    padding: "4px 0 4px 10px",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
