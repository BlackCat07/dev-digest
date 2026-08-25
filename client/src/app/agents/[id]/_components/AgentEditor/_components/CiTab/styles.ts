import type { CSSProperties } from "react";

/**
 * Co-located styles for the CI tab AND the export wizard inside it.
 *
 * One styles module for both, on purpose: the wizard is this tab's modal and
 * nothing else opens it, so promoting a second module would be structure with
 * one consumer. Its step components import from here.
 *
 * Every custom property named below is declared in `vendor/ui/styles.css`. An
 * undefined one is not a CSS error — the declaration silently drops and the
 * element inherits, and nothing catches it (`client/INSIGHTS.md`, 2026-08-06);
 * `var(--bg)` in particular is not a token, `--bg-surface` / `--bg-elevated`
 * are.
 *
 * `--text-primary` IS declared in both schemes — `#ededed` under
 * `:root, [data-theme="dark"]` and `#18181b` under `[data-theme="light"]` — and
 * `stepLabel`, `targetTitle` and `installHeading` below name it because AC-65
 * requires exactly those three to. Both values clear 4.5:1 against the surface
 * behind them (`--bg-elevated`, `#1c1c1c` / `#ffffff`).
 */
export const s = {
  // -- the tab ------------------------------------------------------------
  wrap: { display: "flex", flexDirection: "column", gap: 22, maxWidth: 860 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowRepo: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  rowAge: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  rowSep: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  /** The dashed "add a repository" row at the foot of the list. */
  addRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px dashed var(--border-strong)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  } satisfies CSSProperties,

  gate: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  gateValue: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  gateBody: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,

  // -- the wizard ---------------------------------------------------------
  wizardBody: { padding: "18px 24px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  wizardFooter: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  wizardFooterRight: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,

  steps: { display: "flex", alignItems: "center", gap: 0 } satisfies CSSProperties,
  step: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 99,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  } satisfies CSSProperties,
  /**
   * AC-65. The colour is CONSTANT across all four labels — a step the user has
   * not reached yet is dimmed by its bullet, never by muting its label, which is
   * the vendored `ExportWizardSteps`' one decision this screen cannot take (it
   * paints every label after the current one `var(--text-muted)`).
   */
  stepLabel: { fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap" } satisfies CSSProperties,
  stepRule: { flex: 1, height: 1, minWidth: 20, margin: "0 12px" } satisfies CSSProperties,

  /** AC-65 — the target card's title. */
  targetTitle: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  targetDesc: { display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,
  targetGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 } satisfies CSSProperties,
  targetCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
    cursor: "default",
    width: "100%",
  } satisfies CSSProperties,

  fileList: { display: "flex", flexDirection: "column", gap: 6, listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  fileSize: { marginLeft: "auto", color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  /**
   * The contents, read-only. A `<pre>` and never an input or an editor: N10 and
   * AC-54 make Preview a read-only step, and `CiFile.editable` arrives `false`
   * for every generated file.
   */
  filePre: {
    margin: "6px 0 0",
    padding: 12,
    maxHeight: 220,
    overflow: "auto",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  } satisfies CSSProperties,

  note: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noteTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  noteBody: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 } satisfies CSSProperties,

  /** AC-65 — the Install step's heading. */
  installHeading: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  installBody: { fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.55 } satisfies CSSProperties,
  installRepo: { fontSize: 13, color: "var(--text-primary)", marginTop: 10 } satisfies CSSProperties,

  /** An inline failure — beside the step it belongs to, never a full-screen state. */
  inlineError: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,
  inlineErrorTitle: { fontSize: 13, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  inlineErrorBody: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,

  okRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  okTitle: { fontSize: 14, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
} as const;
