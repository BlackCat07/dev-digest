/* Unit-private constants for the eval case editor.

   Labels are KEYS into `messages/en/eval.json`; no user-visible string is here. */

/** Wide enough for a diff and the expected output side by side at 1280. */
export const MODAL_WIDTH = 880;

/** One tab of the `Input` strip: what the case stores as its input. */
export interface CaseInputTab {
  key: "diff" | "files" | "prMeta";
  /** Resolves under the `eval` namespace. */
  labelKey: string;
}

/**
 * The `Input` strip: Diff, Files, PR meta — in that order.
 *
 * `Diff` first because it is the only editable one and the only one a saved case
 * sends back: `EvalCaseSave` carries `input_diff` and neither `input_files` nor
 * `input_meta`, so those two are presented read-only. They arrive from the
 * contract as `unknown` (a jsonb column), and rendering them as formatted JSON
 * is the one presentation that needs no cast and no second schema to be honest
 * about what is stored.
 */
export const INPUT_TABS: readonly CaseInputTab[] = [
  { key: "diff", labelKey: "caseEditor.tabs.diff" },
  { key: "files", labelKey: "caseEditor.tabs.files" },
  { key: "prMeta", labelKey: "caseEditor.tabs.prMeta" },
];

/** Rows the diff textarea shows before it scrolls. */
export const DIFF_ROWS = 14;

/** Rows the expected-output textarea shows before it scrolls. */
export const EXPECTED_ROWS = 14;
