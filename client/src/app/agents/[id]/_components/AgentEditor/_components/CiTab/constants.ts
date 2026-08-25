/**
 * Constants private to the CI tab and its wizard.
 *
 * Anything a SECOND unit needs lives in `src/lib/ci.ts` instead (the repo
 * pattern, the request defaults, the status words, the preview's file order) —
 * promote on the second consumer, never in anticipation.
 */

/**
 * The model key the generated workflow reads, named on the Install step.
 *
 * DevDigest never reads, stores, forwards or displays its VALUE (N15). This is
 * the variable's NAME, which the user has to add to the target repository's
 * Actions secrets by hand, and it is written here because the generated
 * workflow writes the same string on the server side.
 */
export const CI_MODEL_KEY_ENV = "OPENROUTER_API_KEY";

/** The wizard's four steps, in order. `labelKey` resolves under the `ci` namespace. */
export const WIZARD_STEPS: readonly string[] = [
  "exportWizard.steps.target",
  "exportWizard.steps.preview",
  "exportWizard.steps.configure",
  "exportWizard.steps.install",
];

/** Index of each step, so a comparison reads as a name rather than a number. */
export const STEP_TARGET = 0;
export const STEP_PREVIEW = 1;
export const STEP_CONFIGURE = 2;
export const STEP_INSTALL = 3;

/** Skeleton rows while the installations read is in flight — keys, not indexes. */
export const INSTALL_SKELETON_KEYS: readonly string[] = ["a", "b"];
