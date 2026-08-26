import type { CSSProperties } from "react";

/**
 * Co-located styles for the eval-case draft modal.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css` — an
 * undefined one silently drops rather than erroring, so a `var(--bg)` renders
 * transparent and nothing complains (`client/INSIGHTS.md`, 2026-08-06). The two
 * `Badge` overrides go through that primitive's own `style` prop, which it
 * spreads last; nothing under `vendor/ui` is edited.
 *
 * The two-column grid is the design's: inputs on the left behind a divider,
 * the assertion and the run result on the right. It collapses to one column
 * under 780px so the modal stays usable on a narrow window — a fixed
 * `1fr 1fr` there would give two unreadable columns rather than one readable
 * one.
 */
export const s = {
  body: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    minHeight: 460,
  } satisfies CSSProperties,

  /** Left column. The border is a column separator, so it is drawn on the left one. */
  inputs: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderRight: "1px solid var(--border)",
    padding: "14px 16px 16px",
    gap: 12,
  } satisfies CSSProperties,

  expected: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    padding: "14px 16px 16px",
    gap: 10,
  } satisfies CSSProperties,

  /**
   * What this case asserts, first thing in the modal.
   *
   * A positive case carries the accent; a negative one is drawn in the muted
   * frame `EVAL_EXPECTATION_BADGE` uses for `must_not_flag`. The asymmetry is
   * the same one that map states: the positive case is the assertion a reader
   * scans FOR, the negative one is a quiet guard rail. Neither is `--crit` — a
   * case is an assertion, not a problem.
   */
  assertion: (negative: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${negative ? "var(--border-strong)" : "var(--accent)"}`,
    background: negative ? "var(--bg-elevated)" : "var(--accent-bg)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  }),

  assertionKind: (negative: boolean): CSSProperties => ({
    color: negative ? "var(--text-primary)" : "var(--accent-text)",
    textTransform: "uppercase",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    marginRight: 7,
    whiteSpace: "nowrap",
  }),

  sectionLabel: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  columnHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  headerSpacer: { marginLeft: "auto" } satisfies CSSProperties,

  /** The read-only input pane: diff, files or PR meta. */
  pane: {
    flex: 1,
    minHeight: 200,
    maxHeight: 320,
    overflow: "auto",
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 11.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /**
   * One diff line. `--code-add` / `--code-del` are the tokens the Smart Diff
   * viewer already tints rows with, so a diff reads the same in both places.
   */
  diffLine: (kind: string): CSSProperties => ({
    background:
      kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent",
    color: kind === "hunk" ? "var(--accent-text)" : "inherit",
  }),

  /** The latest trial run, coloured by its outcome. */
  runResult: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "11px 13px",
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: "var(--bg-surface)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  }),

  runOutcome: (color: string): CSSProperties => ({ color, fontWeight: 700 }),

  /** No run yet, or the tally beneath the latest one. */
  runNote: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  /** A refusal from a run or a save: it blocks neither control, so it is not styled as fatal. */
  error: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,

  runOnSave: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginRight: "auto",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** Trims the vendored Badge to sit on a 12.5px label row. */
  labelBadge: { fontSize: 10.5, padding: "1px 7px" } satisfies CSSProperties,

  /** A control the JSON gate has closed: dimmed, and its name says why. */
  blocked: { opacity: 0.55, cursor: "not-allowed" } satisfies CSSProperties,
} as const;
