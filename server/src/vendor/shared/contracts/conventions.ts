/**
 * Conventions extractor — the contracts L02 adds on top of `ConventionCandidate`
 * in ./knowledge.ts.
 *
 * `ConventionCandidate` is the earlier, narrower shape (a rule, one evidence
 * string, and a confidence the model reported about itself). It is deliberately
 * LEFT AS IS and nothing here edits it: this package is extend-by-new-file.
 *
 * The two differences that matter, and they are the whole point of the feature:
 *
 *  - **Evidence is verified, not claimed.** Every entry in `evidence` has been
 *    read back off the clone — the file exists, and the snippet really sits at
 *    that line. A candidate whose evidence could not be found never reaches the
 *    client; it is counted in `ConventionScan.dropped_unverified` instead.
 *  - **Confidence is measured, not self-reported.** It is derived from
 *    `adherence` — how many places in the repo follow the rule versus break it —
 *    so a rule that "felt" strong to the model but holds in 2 files out of 80
 *    scores low and is dropped before anyone sees it.
 */
import { z } from 'zod';
import { SkillType } from './knowledge.js';

/**
 * The fixed taxonomy a candidate is filed under.
 *
 * Fixed rather than free-text because it is what lets the extractor ask the
 * model once PER CATEGORY (one broad call collapses into three generic rules and
 * misses the rest), and it is what the screen filters and colours the cards by.
 */
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'api-contract',
  'testing',
  'imports',
  'async',
  'logging',
  'typing',
  'security',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * How the evidence gate matched the snippet the model cited.
 *
 * `shifted`/`moved` are NOT degraded results — in both cases the snippet was
 * found and `start_line`/`end_line` were rewritten to where it actually is.
 * That rewrite is what keeps the "open on GitHub" deep-link honest. A snippet
 * that matched nowhere has no verification value at all: the candidate is
 * dropped rather than shown with a broken citation.
 */
export const ConventionEvidenceMatch = z.enum(['exact', 'shifted', 'moved']);
export type ConventionEvidenceMatch = z.infer<typeof ConventionEvidenceMatch>;

/** One verified citation: a real range of a real file in the scanned clone. */
export const ConventionEvidence = z.object({
  /** Repo-relative, forward-slash separated. Always inside the clone root. */
  path: z.string(),
  /** 1-based, and CORRECTED to where the snippet was actually found. */
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  /** The lines as they appear in the file, not as the model re-typed them. */
  snippet: z.string(),
  match: ConventionEvidenceMatch,
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

/**
 * Counted occurrences of the rule across the repo, from replaying the matcher
 * the model supplied alongside the rule.
 *
 * Nullable because a rule can be real and still not be mechanically matchable
 * ("modules are registered statically" has no regex). Such a candidate keeps the
 * model's own confidence and is flagged in the UI as unmeasured, rather than
 * silently scoring as if it had been checked.
 */
export const ConventionAdherence = z.object({
  conforming: z.number().int().nonnegative(),
  violating: z.number().int().nonnegative(),
});
export type ConventionAdherence = z.infer<typeof ConventionAdherence>;

/** Triage state. `pending` is the state every candidate is born in. */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/** One extracted house rule, after the evidence gate and the adherence count. */
export const ExtractedConvention = z.object({
  id: z.string(),
  category: ConventionCategory,
  /** The rule as a checkable statement, e.g. "Route handlers never call fetch directly". */
  rule: z.string(),
  /** Why this is a rule here — one or two sentences, shown under the rule. */
  rationale: z.string(),
  /** At least one: a candidate with no surviving evidence is never persisted. */
  evidence: z.array(ConventionEvidence).min(1),
  /** 0..1. Derived from `adherence` when it is present. */
  confidence: z.number().min(0).max(1),
  adherence: ConventionAdherence.nullable(),
  status: ConventionStatus,
  /** True once a human has edited the rule text, so a re-scan leaves it alone. */
  edited: z.boolean(),
  /** The skill this candidate was folded into, if one has been generated. */
  skill_id: z.string().nullable(),
  created_at: z.string(),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

/**
 * `partial` means the scan finished but the sample was capped by the budget —
 * the same distinction `repo_index_state.status` draws. It is a successful
 * scan over less than the whole repo, not a failure.
 */
export const ConventionScanStatus = z.enum([
  'queued',
  'running',
  'done',
  'partial',
  'failed',
]);
export type ConventionScanStatus = z.infer<typeof ConventionScanStatus>;

/**
 * One extraction run over one repo.
 *
 * The four `dropped_*` / `proposed` counters are deliberately public: they are
 * what lets the screen say "12 proposed, 4 dropped without evidence, 3 dropped
 * below the adherence floor, 5 shown" instead of silently presenting 5 and
 * implying that was everything the model found.
 */
export const ConventionScan = z.object({
  id: z.string(),
  status: ConventionScanStatus,
  /** The commit the clone sat at. Evidence line numbers and GitHub links pin to it. */
  commit_sha: z.string().nullable(),
  /** Files in the repo that were eligible before the budget capped anything. */
  eligible_files: z.number().int().nonnegative(),
  /** Files actually read into the prompt. Equals `eligible_files` unless capped. */
  sampled_files: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
  dropped_unverified: z.number().int().nonnegative(),
  dropped_low_adherence: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  /** null until the run finishes, and when the provider reports no usage. */
  cost_usd: z.number().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** Why a repo cannot be scanned right now. `null` in `blocked_reason` = it can. */
export const ConventionScanBlocker = z.enum([
  'not_cloned',
  'not_indexed',
  'scan_running',
]);
export type ConventionScanBlocker = z.infer<typeof ConventionScanBlocker>;

/** Which ceiling capped the sample, if any. */
export const ConventionBudgetCap = z.enum(['files', 'tokens']);
export type ConventionBudgetCap = z.infer<typeof ConventionBudgetCap>;

/**
 * What a scan would cost, answered BEFORE running one.
 *
 * The counts come from `file_rank`, which the indexer already wrote, and the
 * size from `stat`-ing the planned sample — paths whose names are already known.
 * No directory is walked and no file is read, which is what makes this cheap
 * enough to show on page load for a two-file repo and a four-thousand-file one
 * alike.
 *
 * It over-estimates on purpose: it assumes every planned file is read in full,
 * while a real scan drops oversized files and stops at the token ceiling. An
 * estimate a scan could come in ABOVE would be worse than none.
 */
export const ConventionScanBudget = z.object({
  /** Files the indexer indexed for this repo. */
  indexed_files: z.number().int().nonnegative(),
  /** Of those, the ones this extractor would consider. */
  eligible_files: z.number().int().nonnegative(),
  planned_sample: z.number().int().nonnegative(),
  planned_tokens: z.number().int().nonnegative(),
  /** One model call per selected category. */
  planned_calls: z.number().int().nonnegative(),
  /** null when no price is known for the resolved model. */
  estimated_cost_usd: z.number().nullable(),
  capped_by: ConventionBudgetCap.nullable(),
  can_scan: z.boolean(),
  blocked_reason: ConventionScanBlocker.nullable(),
});
export type ConventionScanBudget = z.infer<typeof ConventionScanBudget>;

/** Everything the Conventions screen renders, in one payload. */
export const ConventionsPayload = z.object({
  /** null before the first scan of this repo. */
  scan: ConventionScan.nullable(),
  budget: ConventionScanBudget,
  candidates: z.array(ExtractedConvention),
  /** For the "open on GitHub" links; `sha` mirrors `scan.commit_sha`. */
  repo: z.object({
    full_name: z.string(),
    sha: z.string().nullable(),
  }),
});
export type ConventionsPayload = z.infer<typeof ConventionsPayload>;

/**
 * Body of `POST /repos/:repoId/conventions/scan`. Every field is optional: the
 * defaults are the ones the extractor's own constants define, so a plain
 * body-less scan is the normal case and the panel only sends what was changed.
 */
export const ConventionScanOptions = z.object({
  /** Omitted = every category. */
  categories: z.array(ConventionCategory).min(1).optional(),
  /** Repo-relative subtree prefixes, e.g. ["src/modules"]. Omitted = whole repo. */
  paths: z.array(z.string()).min(1).optional(),
  /** Floor a candidate's measured adherence must clear, 0..1. */
  min_adherence: z.number().min(0).max(1).optional(),
  /** Fewest occurrences a rule needs before it counts as a convention. */
  min_occurrences: z.number().int().positive().optional(),
  /** Lower the file ceiling for a cheaper run; can never raise it past the cap. */
  max_files: z.number().int().positive().optional(),
});
export type ConventionScanOptions = z.infer<typeof ConventionScanOptions>;

/**
 * Body of `PATCH /conventions/:id` — accept, reject, and edit are the same call.
 *
 * `confidence` is absent on purpose: it is measured, and letting a client post
 * one would turn the one number we can defend into another opinion.
 */
export const UpdateConventionPayload = z.object({
  status: ConventionStatus.optional(),
  rule: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
});
export type UpdateConventionPayload = z.infer<typeof UpdateConventionPayload>;

/**
 * One skill as it WOULD be written, from
 * `POST /repos/:repoId/conventions/skill/preview`.
 *
 * A preview endpoint rather than a client-side renderer: the body is assembled
 * by the server's composer, and a second implementation in the browser would
 * drift from it the first time either changed — leaving a modal that shows text
 * the user never actually saves. This way what is previewed is byte-for-byte
 * what the create call writes.
 */
export const ComposedConventionSkill = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  evidence_files: z.array(z.string()),
  /** Which accepted candidates went into this one. */
  candidate_ids: z.array(z.string()),
});
export type ComposedConventionSkill = z.infer<typeof ComposedConventionSkill>;

/**
 * Body of `POST /repos/:repoId/conventions/skill`.
 *
 * Every accepted candidate is folded into ONE skill. Rejected and pending
 * candidates are excluded by the server — the client cannot opt them in.
 *
 * `candidate_ids` is the explicit list the user ticked rather than "everything
 * accepted", so the modal's preview and what gets written can never disagree.
 * The server still re-checks each id's status before folding it in.
 */
export const CreateConventionSkillPayload = z.object({
  candidate_ids: z.array(z.string()).min(1),
  /** Defaults to `<repo-slug>-conventions`. */
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Defaults to `convention`, which is what an extracted skill is. */
  type: SkillType.optional(),
  enabled: z.boolean().optional(),
});
export type CreateConventionSkillPayload = z.infer<typeof CreateConventionSkillPayload>;
