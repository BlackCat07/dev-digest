/* Unit-private pure helpers for the eval-case draft modal.

   No React, no fetch, no i18n. The JSON gate, the duration formatter and the
   outcome colour all live in `src/lib/eval.ts` — this unit and the saved-case
   editor must agree about what `valid JSON` means, and two copies is how they
   stop agreeing. What is here is the diff colouring and the trial tally, which
   nothing else renders. */
import type { EvalAnchor, EvalCaseOutcome, EvalTrialRunResult } from "@devdigest/shared";

/**
 * One line of a unified diff, tagged with what it is.
 *
 * `+++`/`---` are file headers and must NOT read as an addition and a deletion —
 * which is exactly what a naive `startsWith("+")` does to the two lines at the
 * top of every diff, colouring the header green and red before a single change.
 */
export type DiffLineKind = "add" | "del" | "hunk" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Split a unified diff into typed lines, header lines first and correctly. */
export function diffLines(diff: string): DiffLine[] {
  return diff.split("\n").map((text) => {
    if (text.startsWith("+++") || text.startsWith("---")) return { kind: "context", text };
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "del", text };
    return { kind: "context", text };
  });
}

/**
 * An anchor's line range as the assertion sentence spells it: `12` or `61-74`.
 *
 * One number when the range is a single line, because "at src/config.ts:12-12"
 * reads as a mistake to anyone who has read a stack trace.
 */
export function anchorLines(anchor: EvalAnchor | undefined): string {
  if (!anchor) return "—";
  return anchor.low_line === anchor.high_line
    ? String(anchor.low_line)
    : `${anchor.low_line}-${anchor.high_line}`;
}

/** How many of the recorded trial runs ended in each outcome. */
export interface TrialTally {
  runs: number;
  passed: number;
}

/**
 * The tally the strip states: how many times this draft was run, and how many
 * of those passed.
 *
 * A `not_run` counts as a run and not as a pass, which is the whole reason this
 * is a function rather than two `.length` calls: a run that never reached an
 * answer is not evidence that the finding reproduces, and folding it into either
 * side would make a flaky case look decided.
 */
export function tallyTrials(runs: readonly EvalTrialRunResult[]): TrialTally {
  return { runs: runs.length, passed: runs.filter((r) => r.outcome === "passed").length };
}

/**
 * Whether every recorded run agreed.
 *
 * Used only to phrase the hint: a reader who has pressed `Run case` three times
 * and seen three different answers has learned the most important thing this
 * modal can tell them, and it should not take reading three lines to notice.
 */
export function outcomesDisagree(runs: readonly EvalTrialRunResult[]): boolean {
  const seen = new Set<EvalCaseOutcome>(runs.map((r) => r.outcome));
  return seen.size > 1;
}
