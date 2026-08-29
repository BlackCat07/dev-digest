/* Unit-private constants for the eval-case draft modal.

   Labels are KEYS into `messages/en/eval.json`; no user-visible string is
   here. */

/** Wide enough for the diff and the expected output side by side, as the design draws it. */
export const MODAL_WIDTH = 920;

/** One tab of the `Input` strip: what the draft carries as its input. */
export interface DraftInputTab {
  key: "diff" | "files" | "prMeta";
  /** Resolves under the `eval` namespace. */
  labelKey: string;
}

/**
 * The `Input` strip: Diff, Files, PR meta — the same three the saved-case editor
 * shows, and the same order.
 *
 * All three are read-only HERE, which is the one difference from that editor and
 * a deliberate one: a draft's diff is the fragment cut out of the pull request
 * the finding was reported on, so it is the evidence, not a field. The saved
 * case's editor is where a curated set is tuned by hand.
 */
export const INPUT_TABS: readonly DraftInputTab[] = [
  { key: "diff", labelKey: "caseEditor.tabs.diff" },
  { key: "files", labelKey: "caseEditor.tabs.files" },
  { key: "prMeta", labelKey: "caseEditor.tabs.prMeta" },
];

/** Rows the expected-output textarea shows before it scrolls. */
export const EXPECTED_ROWS = 16;

/**
 * Trial runs kept in the tally, newest first.
 *
 * The control exists to be pressed repeatedly — the question is whether a
 * finding REPRODUCES — so the strip states how many runs and how many passed.
 * Ten is enough to make a flake obvious and short enough to stay one line.
 */
export const TRIAL_HISTORY_LIMIT = 10;
