import type { CSSProperties } from "react";

/* Co-located styles for the brief card (L05).

   Tokens only, and every one of them checked against
   `src/vendor/ui/styles.css`: `var(--bg)` is NOT a token in this design system —
   the backgrounds are `--bg-primary`, `--bg-surface`, `--bg-elevated` and
   `--bg-hover` — and an unknown custom property does not error, it drops the
   whole declaration and leaves a surface that looks almost right
   (`client/INSIGHTS.md`, 2026-08-06). There is no `--text-tertiary` either.

   The card deliberately reuses the intent card's frame (1px border, radius 8,
   `--bg-elevated`, 18px padding, 16px column gap) rather than inventing a
   heavier one for the screen's new headline: it sits directly above that card,
   and a second frame vocabulary two cards apart reads as an error. */
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

  /** BRIEF at the left; the risk level and the regenerate control at the right. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /** 12 / 700 / 0.07em uppercase — the vendored `SectionLabel`'s own scale, which
      the sections inside the card are rendered BY, so this label matches them. */
  headerLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    lineHeight: 1,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginLeft: "auto",
  } satisfies CSSProperties,

  /** "RISK LEVEL" beside the badge, at the label scale of everything else on the
      row — one row carrying three type sizes reads as a mistake. */
  metaLabel: {
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,

  /** The loading placeholder's column.

      Shaped like the loaded card rather than as one grey block, which is the
      whole of AC-47: the two statements, the figures row and a risk row each get
      a skeleton of roughly their own height, so the intent and blast cards below
      do not jump when the brief lands. */
  loadingColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  /** A notice that qualifies the whole card: stale, partial, degraded, running.
      `muted` for a statement about the inputs, `warn` where the reader is being
      told what is on screen no longer describes the pull request. */
  notice: (tone: "warn" | "muted"): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tone === "warn" ? "var(--warn)" : "var(--text-secondary)",
    background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "9px 11px",
  }),
  noticeIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  noticeTitle: {
    display: "block",
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  noticeHint: {
    display: "block",
    marginTop: 3,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

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

  /** WHAT and WHY, stacked. Two separately labelled statements (AC-38) rather
      than one paragraph, because they answer two different questions and a
      reviewer skims for one of them. */
  statements: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  statementLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  /** Plain text, not `<Markdown>`: that primitive is inline-only and maps `a`,
      so a link in model output — text derived from an author-controlled pull
      request description — would become a live anchor pointing anywhere. `why`
      is a sentence, not a document. */
  statementText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,

  /** The deterministic figures. Wraps, and stays visible in every state
      including degraded — four true numbers next to the reason there is nothing
      else is more honest than an empty card. */
  statRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  statIcon: { color: "var(--text-muted)", display: "inline-flex" } satisfies CSSProperties,

  divider: { height: 1, background: "var(--border)" } satisfies CSSProperties,

  /** One risk per row, in a column. Rows rather than the intent card's
      disclosure chips, because AC-39 asks for all four parts of every risk at
      once — a row that hides its explanation until clicked answers a different
      requirement. */
  riskList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  riskRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "11px 13px",
    borderRadius: 6,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  riskHead: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskExplanation: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** Referenced paths under the explanation. Wraps — a path is long. */
  riskRefs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 2,
  } satisfies CSSProperties,
  /** A cited path as mono TEXT, never `MonoLink`. Without an `href` that
      primitive renders a `<button>`, and a button that does nothing is worse
      than a label — a risk's references are not grounded to the changed-file
      list the way a review-focus row is, so there is no target to open. */
  riskRef: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  } satisfies CSSProperties,

  /** A review-focus row: a real button, because it navigates. Full width and
      left-aligned so the path reads as the row's subject rather than as a label
      on a control. */
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  focusRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    font: "inherit",
    fontSize: 13,
    cursor: "pointer",
  } satisfies CSSProperties,
  focusArrow: {
    flexShrink: 0,
    marginTop: 2,
    color: "var(--text-muted)",
    display: "inline-flex",
  } satisfies CSSProperties,
  focusPath: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    color: "var(--text-primary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  focusLine: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    marginLeft: 6,
  } satisfies CSSProperties,
  focusReason: {
    display: "block",
    marginTop: 3,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  /** "Nothing was singled out" and its risks counterpart — a muted sentence, not
      an `EmptyState`. The card gets ONE empty state (AC-46) and it is the
      never-generated one; a panel per empty list is what that criterion forbids. */
  quiet: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** The generation's own receipt, last. A footnote to the brief, not a preamble
      to it — the placement the intent card settled on for the same reason. */
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingTop: 2,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerMono: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Says a null cost means "no price known for this model", never "free". Its
      own line rather than a tooltip, because that distinction is the whole
      point: `$0` is a real value this app renders for a genuinely free model. */
  footerNote: {
    flexBasis: "100%",
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
