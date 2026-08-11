import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. Tokens only — `var(--bg)` does not exist;
    the background tokens are `--bg-primary`, `--bg-surface`, `--bg-elevated` and
    `--bg-hover`, and an unknown custom property silently drops the declaration. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  /** INTENT (left) and CONFIDENCE + the re-derive control (right), on one line
      INSIDE the card — the label belongs to the card, not above it. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  headerLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    // 12 / 700 / 0.07em uppercase is the vendored `SectionLabel`'s own scale, and
    // RISK AREAS below is rendered BY that primitive — so matching it here is what
    // makes the two labels the same size. `vendor/ui` is do-not-touch, so this is
    // the side that has to agree.
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    // A pinned line box: with mixed font sizes on one row, differing line heights
    // are what pushes items a pixel off the shared centre line.
    lineHeight: 1,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Pushed to the far right of the header row. */
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginLeft: "auto",
  } satisfies CSSProperties,
  loadingColumn: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  /** Row of skeletons / short status text sharing the card's own padding. */
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** A note that qualifies the whole card: stale head SHA, or a live re-derive. */
  note: (tone: "warn" | "muted"): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tone === "warn" ? "var(--warn)" : "var(--text-secondary)",
    background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
  }),
  errorBox: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
  } satisfies CSSProperties,
  errorDetail: { color: "var(--text-secondary)", fontSize: 12.5 } satisfies CSSProperties,
  /** The intent sentence: white ITALIC in typographic quotes, no left rule.
      It reads as a quotation of the classifier's own words, which is what the
      quote marks are for — a coloured bar made it look like a callout. */
  quote: {
    margin: 0,
    padding: 0,
    fontSize: 14.5,
    fontStyle: "italic",
    lineHeight: 1.6,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  /** IN SCOPE / OUT OF SCOPE side by side, stacking on a narrow viewport. */
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 18,
  } satisfies CSSProperties,
  columnHead: (tone: "ok" | "muted"): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: tone === "ok" ? "var(--ok)" : "var(--text-muted)",
  }),
  /** No native marker: the mock uses a small tinted dot, and the browser bullet
      is both too large and always the text colour. */
  bullets: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bullet: {
    display: "flex",
    alignItems: "baseline",
    gap: 9,
  } satisfies CSSProperties,
  /** The `·` marker. Green in the in-scope column, muted in out-of-scope, so the
      two lists read as different at a glance even without their headers. */
  bulletDot: (tone: "ok" | "muted"): CSSProperties => ({
    flexShrink: 0,
    color: tone === "ok" ? "var(--ok)" : "var(--text-muted)",
    fontSize: 15,
    lineHeight: 1.35,
  }),
  emptyBullets: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  divider: { height: 1, background: "var(--border)" } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  metaLabel: {
    // Same 12 as INTENT and RISK AREAS — it was 11.5, which read as a third size.
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Same thresholds as the design-system `ConfidenceNum`, but this figure is
      DERIVED from source availability, not a model self-report — so it carries
      its own label rather than that primitive's "Model confidence" tooltip. */
  confidence: (value: number): CSSProperties => ({
    // The figure matches the labels around it at 12 rather than standing out at
    // 14: it shares the header line with them, and one row with three type sizes
    // reads as a mistake. Weight still separates it from its own label.
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 600,
    color: value >= 0.85 ? "var(--ok)" : value >= 0.65 ? "var(--warn)" : "var(--text-muted)",
  }),
} as const;
