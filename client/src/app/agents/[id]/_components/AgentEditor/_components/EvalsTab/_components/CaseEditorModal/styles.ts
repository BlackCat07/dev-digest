import type { CSSProperties } from "react";

/**
 * Co-located styles for the eval case editor.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css` — an
 * undefined one silently drops rather than erroring (`INSIGHTS.md`, 2026-08-06).
 * The one `Badge` override is passed as that primitive's own `style` prop, which
 * `Badge` spreads last over its defaults; nothing under `vendor/ui` is edited.
 */
export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,

  /**
   * The negative-case banner, first thing inside the modal.
   *
   * `--warn` and not `--crit`: a `must_not_flag` case is an assertion, not a
   * problem. It leads because every count below it means the opposite of what
   * the same count means on a positive case, and a reader who misses that reads
   * the whole screen backwards.
   */
  negativeBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
    marginBottom: 18,
  } satisfies CSSProperties,

  /** The last-run strip: outcome, counts, duration, cost. */
  lastRun: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 13px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    marginBottom: 18,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  lastRunHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  lastRunSummary: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,

  /** Diff on the left, expected output on the right; one column under 900px. */
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 20,
  } satisfies CSSProperties,

  column: { minWidth: 0 } satisfies CSSProperties,

  columnHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  columnLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** Read-only stored input — the two jsonb columns a save does not send back. */
  readonlyBlock: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 320,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,

  /** The expected anchors, read-only: a save sends them back unchanged. */
  anchors: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    listStyle: "none",
    margin: "0 0 18px",
    padding: 0,
  } satisfies CSSProperties,

  anchorRow: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** Trims the vendored Badge to sit on a 13px label row.
      Passed as `style` — `vendor/ui` is extend-by-props, never restyled. */
  labelBadge: { fontSize: 10.5, padding: "1px 7px" } satisfies CSSProperties,

  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,

  footerSpacer: { marginLeft: "auto" } satisfies CSSProperties,

  /** A control the JSON gate has closed: dimmed, and its name says why. */
  blocked: { opacity: 0.55, cursor: "not-allowed" } satisfies CSSProperties,
} as const;
