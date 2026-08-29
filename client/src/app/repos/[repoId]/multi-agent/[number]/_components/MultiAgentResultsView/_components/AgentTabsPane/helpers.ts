/** Pure helpers for the tabs pane. No React, no i18n — the two colour bands and
    the one rounding rule the pane needs, kept out of the component body. */

/**
 * 0.82 → 82 (AC-73). Rounded, because a confidence of "81.9%" claims a
 * precision the model never had.
 */
export function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

/**
 * The score's band colour — the tab's number, its underline and the agent's
 * name in the summary all take it, which is what makes the strip readable as a
 * verdict rather than as four identical labels.
 *
 * The thresholds are `CircularScore`'s own (`>= 75` ok, `>= 50` warn), not the
 * reference export's. The export draws 72 green, which puts it one band above
 * the ring the very same card renders at 44px — and a tab whose number is green
 * beside a ring that is amber is a rendering bug to every reader who notices.
 * Agreeing with the vendored gauge is worth the three points.
 *
 * `null` for a run with no score, so the caller falls back to a neutral colour
 * rather than painting "no score" as a failing one.
 */
export function scoreColor(score: number | null): string | null {
  if (score == null) return null;
  return score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--crit)";
}

/**
 * The confidence dot's colour, in the collapsed row.
 *
 * The bands are `ConfidenceNum`'s (`>= 85` ok, `>= 65` warn, muted below), so
 * the dot this pane draws and the one the vendored primitive draws elsewhere in
 * the app cannot disagree about the same number. Matches the reference, which
 * paints 98% green and 79%/81% amber.
 */
export function confidenceColor(pct: number): string {
  return pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";
}
