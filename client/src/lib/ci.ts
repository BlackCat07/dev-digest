import type { CiExportInput, CiFile, CiRunStatus, CiTarget } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/* ci.ts — runtime values and display rules for the Export-to-CI screens (L06):
   the agent editor's CI tab, its four-step export wizard and the CI Runs table.

   In `src/lib/` and NOT derived from the shared contract, for the reason
   `src/lib/eval.ts`, `src/lib/severity.ts` and `src/lib/scope.ts` exist: a client
   import of the vendored contract barrel must stay TYPE-ONLY (the single
   `import type` line above is the only one this file has). That barrel re-exports
   with ESM `.js` extensions webpack will not map back to `.ts`, so a runtime
   import from it resolves under `tsc` AND under `vitest` and then 500s every
   route that transitively reaches it (`client/INSIGHTS.md`, 2026-08-03).

   `contracts/ci-runtime.ts` holds `CI_WORKFLOW_PATH`, `CI_AGENTS_DIR`,
   `CI_SKILLS_DIR` and `CI_RUNNER_PATH` as runtime consts — those are the
   generator's and the runner's agreement, and the same rule forbids this package
   value-importing them. The path prefixes below are therefore hand-kept copies
   used for ORDERING ONLY: nothing here is written to a repository, and a drift
   costs a preview listed in a different order, not a broken export.

   No user-visible string lives in this file: every label is a KEY into
   `messages/en/ci.json`, resolved by the caller with `useTranslations("ci")`. */

// ===========================================================================
// The target repository
// ===========================================================================

/**
 * `owner/name`, as GitHub itself spells it — the Target step's Continue stays
 * disabled until the field matches.
 *
 * Deliberately tighter than "two segments separated by a slash": each segment
 * must START with an alphanumeric, which is what rules out `acme/..` and
 * `acme/.git` reaching a value the server puts in a URL path and a commit
 * message. The server validates this again with its own zod schema — this is
 * the field's enable/disable rule, not the authorization.
 */
export const CI_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `value` is a well-formed `owner/name`. */
export function isRepoSlug(value: string): boolean {
  return CI_REPO_PATTERN.test(value.trim());
}

// ===========================================================================
// The targets — one card, and only one
// ===========================================================================

/** One card on the wizard's Target step. */
export interface CiTargetOption {
  value: CiTarget;
  /** Resolves under the `ci` namespace. */
  labelKey: string;
  descKey: string;
  icon: IconName;
}

/**
 * The targets the wizard offers. ONE entry, on purpose.
 *
 * `CiTarget` keeps all four of its values — the contract is not narrowed and the
 * server rejects the other three by name — but a disabled card is a promise with
 * no date, and three of them is three promises. When CircleCI ships, its card is
 * added here and nothing else moves.
 */
export const CI_TARGETS: readonly CiTargetOption[] = [
  { value: "gha", labelKey: "exportWizard.targets.gha", descKey: "exportWizard.targets.ghaDesc", icon: "Workflow" },
];

// ===========================================================================
// The export request's defaults — the CONTRACT's, restated
// ===========================================================================

/**
 * `CiExportInput`'s own `.default()`s, hand-kept.
 *
 * They are restated rather than omitted from the request because a mutation that
 * leaves an optional field off the wire is a silently successful no-op: the
 * server applies its default, answers 200, and every signal the UI trusts says
 * the value the user chose was saved (`client/INSIGHTS.md`, 2026-08-11). Sending
 * all of them makes the outgoing body the thing a test can assert.
 *
 * The `Required<…>` annotations are what make a contract-side default change a
 * compile error here instead of a quiet disagreement.
 */
export const CI_DEFAULT_TARGET: Required<CiExportInput>["target"] = "gha";
export const CI_DEFAULT_POST_AS: Required<CiExportInput>["post_as"] = "github_review";
export const CI_DEFAULT_BASE: Required<CiExportInput>["base"] = "main";
export const CI_DEFAULT_TRIGGERS: readonly string[] = ["opened", "synchronize", "reopened"];

/**
 * The `pull_request` event types the generated workflow may be triggered by.
 *
 * These are GitHub's own event-type identifiers, not copy: they are rendered
 * verbatim (like `owner/name`) rather than translated, because the string the
 * user ticks here is the string that appears in the generated YAML. The
 * generator intersects the request with this same set.
 */
export const CI_TRIGGER_EVENTS: readonly string[] = ["opened", "synchronize", "reopened"];

/** One option of the "Post results as" control. */
export interface CiPostAsOption {
  value: Required<CiExportInput>["post_as"];
  /** Resolves under the `ci` namespace. */
  labelKey: string;
}

export const CI_POST_AS_OPTIONS: readonly CiPostAsOption[] = [
  { value: "github_review", labelKey: "exportWizard.postAs.githubReview" },
  { value: "pr_comment", labelKey: "exportWizard.postAs.prComment" },
  { value: "none", labelKey: "exportWizard.postAs.none" },
];

// ===========================================================================
// The preview's file order
// ===========================================================================

/**
 * Repository-relative prefixes, in the order the preview lists them: the
 * workflow a reviewer of the export PR reads first, then the agent's manifest,
 * then one file per linked skill, then the runner bundle.
 *
 * Hand-kept copies of `CI_WORKFLOW_PATH` / `CI_AGENTS_DIR` / `CI_SKILLS_DIR` —
 * see this file's header for why they are not imported.
 */
const CI_FILE_ORDER: readonly string[] = [
  ".github/workflows/",
  ".devdigest/agents/",
  ".devdigest/skills/",
];

/** Rank of a generated file in the preview's fixed order; unknown paths sort last. */
export function ciFileRank(path: string): number {
  const i = CI_FILE_ORDER.findIndex((prefix) => path.startsWith(prefix));
  return i === -1 ? CI_FILE_ORDER.length : i;
}

/**
 * The generated files in the order the Preview step lists them.
 *
 * A copy, never a sort in place: the array belongs to the query cache, and
 * `Array.prototype.sort` mutates. The server already returns this order; this is
 * what stops the rendered order from depending on it.
 */
export function sortCiFiles(files: readonly CiFile[]): CiFile[] {
  return [...files].sort((a, b) => ciFileRank(a.path) - ciFileRank(b.path) || a.path.localeCompare(b.path));
}

// ===========================================================================
// Status → a WORD and a colour
// ===========================================================================

/**
 * Why a run carries no result — the four reasons the read-back records when an
 * artifact is missing, unreadable, holds no result file, or holds a body that
 * does not parse.
 *
 * A hand-kept union rather than a contract symbol: `CiRun.reason` is typed as a
 * loose `string` precisely so an older runner's unknown reason still parses, so
 * there is no enum to infer from.
 */
export type CiRunReason =
  | "artifact_missing"
  | "artifact_unreadable"
  | "result_file_missing"
  | "result_unparseable";

/** Every value a run's (or an installation's latest run's) status cell can carry. */
export type CiStatusValue = CiRunStatus | CiRunReason;

/** How one status is stated: a word, and the colour beside it — never instead of it. */
export interface CiStatusDisplay {
  /** Key under the `ci` namespace. */
  labelKey: string;
  /** Token from `vendor/ui/styles.css`; carried by a DOT, never by the text alone. */
  color: string;
}

/**
 * One entry per status, keyed by the union above.
 *
 * `Record<CiStatusValue, …>` and not a lookup with a default: a fifth
 * `CiRunStatus` member added to the contract is then a COMPILE error here rather
 * than a status cell that renders a colour and no word.
 */
const CI_STATUS_DISPLAY: Record<CiStatusValue, CiStatusDisplay> = {
  succeeded: { labelKey: "runs.status.succeeded", color: "var(--ok)" },
  no_findings: { labelKey: "runs.status.noFindings", color: "var(--ok)" },
  failed: { labelKey: "runs.status.failed", color: "var(--crit)" },
  running: { labelKey: "runs.status.running", color: "var(--warn)" },
  artifact_missing: { labelKey: "runs.status.artifactMissing", color: "var(--text-muted)" },
  artifact_unreadable: { labelKey: "runs.status.artifactUnreadable", color: "var(--text-muted)" },
  result_file_missing: { labelKey: "runs.status.resultFileMissing", color: "var(--text-muted)" },
  result_unparseable: { labelKey: "runs.status.resultUnparseable", color: "var(--text-muted)" },
};

/**
 * Every status a cell may have to state, as a runtime list.
 *
 * Hand-kept, because `CiRunStatus` is a zod enum in the vendored barrel and its
 * `.options` is a runtime value this package may not import. The `Record` above
 * is what catches a drift: a member missing from it fails the build.
 */
export const CI_STATUS_VALUES: readonly CiStatusValue[] = [
  "succeeded",
  "no_findings",
  "failed",
  "running",
  "artifact_missing",
  "artifact_unreadable",
  "result_file_missing",
  "result_unparseable",
];

/**
 * The word and colour for a status, or `null` when there is no status at all.
 *
 * `null` in, `null` out is the ordinary first state of an installation —
 * installed, never run — and the caller says so in words rather than rendering a
 * blank cell. A status that is neither a `CiRunStatus` nor one of the four
 * reasons (an older runner, a value added after this build) also returns `null`;
 * the caller falls back to the raw string, which is still text.
 */
export function ciStatusDisplay(status: string | null | undefined): CiStatusDisplay | null {
  if (!status) return null;
  return CI_STATUS_DISPLAY[status as CiStatusValue] ?? null;
}

/**
 * How ONE status cell is stated, in the three cases a caller has to tell apart.
 *
 * Three and not two: a status the catalogue has no word for — an older runner, a
 * reason added after this build — still renders its RAW value, because AC-64's
 * floor is that the cell is never empty and never colour alone. `never` is the
 * absence of a status altogether; the caller supplies the words for it, because
 * "installed, never run" and "this run recorded no outcome" are different
 * sentences about the same missing value.
 *
 * Promoted here from the CI tab when the CI Runs table became its second
 * consumer. Both surfaces read `CI_STATUS_DISPLAY` through it, so a fifth
 * `CiRunStatus` member is a compile error in one place rather than a colour with
 * no word in two.
 */
export type CiStatusCell =
  | { kind: "never" }
  | { kind: "known"; labelKey: string; color: string }
  | { kind: "raw"; text: string; color: string };

/** Which of the three cases above `status` falls into. */
export function ciStatusCell(status: string | null | undefined): CiStatusCell {
  if (!status) return { kind: "never" };
  const display = ciStatusDisplay(status);
  if (display) return { kind: "known", labelKey: display.labelKey, color: display.color };
  return { kind: "raw", text: status, color: "var(--text-muted)" };
}

// ===========================================================================
// Links
// ===========================================================================

/**
 * True for an `http:`/`https:` absolute URL.
 *
 * The pull-request URL and the Actions job URL both arrive from the engine, and
 * both are rendered as an `href`. A `javascript:` URL in an `href` is script
 * execution, and React does not stop it — so the protocol is checked here before
 * the anchor is rendered at all.
 */
export function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}
