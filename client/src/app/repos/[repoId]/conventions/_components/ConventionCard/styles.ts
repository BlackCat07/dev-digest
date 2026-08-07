import type { CSSProperties } from "react";
import type { ConventionStatus } from "@devdigest/shared";

/** Co-located styles for ConventionCard. */

/** The left rail colour that carries the triage state at a glance. */
function railFor(status: ConventionStatus, accent: string): string {
  if (status === "accepted") return "var(--ok)";
  if (status === "rejected") return "var(--border-strong)";
  return accent;
}

export const s = {
  card: (status: ConventionStatus, accent: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 168px",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${railFor(status, accent)}`,
    background: "var(--bg-elevated)",
    // A rejected candidate stays readable — it is the record of a decision, and
    // the user must be able to see what they turned down to undo it.
    opacity: status === "rejected" ? 0.55 : 1,
    marginBottom: 12,
  }),

  main: { minWidth: 0 } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  categoryBadge: (color: string): CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 7px",
    borderRadius: 4,
    whiteSpace: "nowrap",
  }),

  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    marginBottom: 6,
  } satisfies CSSProperties,

  /** Marks a rule whose text a human rewrote — the server keeps it across re-scans. */
  editedNote: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  editBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 12,
  } satisfies CSSProperties,

  editRule: {
    width: "100%",
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    fontFamily: "inherit",
    color: "var(--text)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    resize: "vertical",
  } satisfies CSSProperties,

  editRationale: {
    width: "100%",
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily: "inherit",
    color: "var(--text-muted)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    resize: "vertical",
  } satisfies CSSProperties,

  editActions: {
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,

  rationale: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 12,
  } satisfies CSSProperties,

  evidence: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
  } satisfies CSSProperties,

  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    background: "var(--bg-hover)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  evidencePath: {
    fontSize: 11.5,
    color: "var(--text)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  matchNote: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /**
   * Wide code must scroll inside its own box; the page itself never scrolls
   * sideways.
   *
   * `--bg-primary` is the app's base background, so the code sits *recessed*
   * below the card's `--bg-elevated` — the mock's separation between "the
   * card" and "the file". This used to say `var(--bg)`, which is not a token
   * in `vendor/ui/styles.css`: it resolved to nothing, the `pre` stayed
   * transparent, and the snippet rendered on the card's own colour.
   */
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 11.5,
    lineHeight: 1.6,
    overflowX: "auto",
    whiteSpace: "pre",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,

  /**
   * The copy control at the right end of the citation header. Icon-only: that
   * row is a path bar, and a worded button would compete with the path for it.
   */
  copyBtn: (copied: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 3,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: copied ? "var(--ok)" : "var(--text-muted)",
    cursor: "pointer",
  }),

  moreEvidence: {
    fontSize: 11,
    color: "var(--text-muted)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textDecoration: "underline",
  } satisfies CSSProperties,

  side: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  confidenceBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginTop: 14,
  } satisfies CSSProperties,

  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // Fixed width, not full-bleed: the bar reads as a small gauge next to its
  // label, and a bar stretched across the card would compete with the evidence
  // block above it for attention.
  track: {
    width: 140,
    height: 5,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
    flexShrink: 0,
  } satisfies CSSProperties,

  fill: (percent: number, color: string): CSSProperties => ({
    width: `${percent}%`,
    height: "100%",
    background: color,
  }),

  adherence: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
} as const;
