import { z } from 'zod';
import { CiFile } from './eval-ci.js';

/**
 * A5 — Export-to-CI runtime contract (L06).
 *
 * The names three components have to agree on, and one response shape.
 *
 * The studio GENERATES a file set into someone else's repository; the runner
 * that lands there READS it back weeks later. Nothing in the type system can
 * express "the workflow's upload step and the runner's output file name the
 * same artifact", so the agreement is these consts: the generator interpolates
 * them, the runner imports them, and a change on one side alone fails a test
 * instead of silently producing a run whose result nobody can find.
 *
 * New symbols only — this file EXTENDS the barrel and edits no existing
 * contract. The CI records themselves (`CiExportInput`, `CiInstallation`,
 * `CiRun`, `CiResultArtifact`, `AgentManifest`) stay in `eval-ci.ts`.
 */

// ===========================================================================
// The artifact — named by the generated workflow, written by the runner
// ===========================================================================

/**
 * `name:` of the workflow's `actions/upload-artifact` step, and therefore the
 * name the read-back asks GitHub for.
 */
export const CI_RESULT_ARTIFACT_NAME = 'devdigest-result';

/** File inside that artifact which the runner writes its result to. */
export const CI_RESULT_FILE_NAME = 'devdigest-result.json';

// ===========================================================================
// The export — the branch, the pull request, and the paths written on it
// ===========================================================================

/** Branch the export commits onto (created from the requested base when absent). */
export const CI_EXPORT_BRANCH = 'devdigest/ci';

/**
 * Title of the pull request the export opens. A contract value because the
 * Install step promises this exact string on screen before the user agrees to
 * it — the sentence and the pull request cannot be allowed to drift apart.
 */
export const CI_EXPORT_PR_TITLE = 'Add DevDigest CI review';

/** Repository-relative path of the generated workflow. */
export const CI_WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Repository-relative path of the exported runner bundle. */
export const CI_RUNNER_PATH = '.devdigest/runner.mjs';

/** Directory holding one `<agent-slug>.yaml` manifest per exported agent. */
export const CI_AGENTS_DIR = '.devdigest/agents';

/** Directory holding one `<skill-slug>.md` body per linked skill. */
export const CI_SKILLS_DIR = '.devdigest/skills';

// ===========================================================================
// Preview
// ===========================================================================

/**
 * Response of the preview call — every file that WOULD be committed, and no
 * GitHub write. Its own symbol rather than a widened `CiExport`, because
 * `CiExport.installation` is required and non-nullable and a preview installs
 * nothing.
 */
export const CiExportPreview = z.object({
  files: z.array(CiFile),
});
export type CiExportPreview = z.infer<typeof CiExportPreview>;
