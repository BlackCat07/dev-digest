/**
 * Onboarding Tour — the five-part tour of one repository, written for a developer
 * who has never seen it.
 *
 * A NEW FILE rather than fields on `Onboarding` / `OnboardingSection`
 * (./knowledge.js), and the reason is that those two cannot express what the
 * screen renders: no status, no reason, no generation state, no provenance and no
 * per-kind items — and `OnboardingSection.kind` is a bare `z.string()`, so nothing
 * there fixes the five kinds or their order. They are deliberately LEFT AS IS and
 * nothing here edits or removes them; this package is extend-by-new-file, the same
 * move ./blast.js makes against `BlastRadius` and ./intent.js against
 * `PrIntentRecord`. `OnboardingLink` is IMPORTED and reused rather than
 * redeclared, exactly as ./blast.js reuses `ChangedSymbol` / `DownstreamImpact`
 * from ./brief.js: it already describes this data, and two vocabularies for one
 * concept is the drift this package exists to prevent.
 *
 * Three properties carry the feature, and each is a constraint rather than an
 * embellishment:
 *
 *  - **Order is the contract's, not the model's.** `OnboardingSectionKind` fixes
 *    the five kinds and the order they are stored and served in, so a model that
 *    answers them shuffled cannot reorder the screen and one that invents a sixth
 *    cannot extend it.
 *  - **An empty tour is never silently empty.** `status` says which of three
 *    things "no content" means, and `reason` names the cause — including the four
 *    model-side causes, which the index's own vocabulary cannot express. A
 *    consumer reading only `sections` cannot tell a thin repository from a failed
 *    generation, which is precisely the inference this feature must not invite.
 *  - **Provenance travels with the tour.** `indexed_sha`, `files_indexed`,
 *    `files_skipped`, `generated_at` and the five generation figures are recorded
 *    ON the tour, so the screen reports what THIS tour was generated from rather
 *    than what the index covers today — and `stale` is what says the two have
 *    parted.
 *
 * No numeric range keyword appears anywhere below. The caps on a stored tour
 * (sections, rows, links, body length) are enforced where it is assembled: a range
 * keyword in a shared contract has already broken a structured call on
 * Anthropic-via-OpenRouter (`reviewer-core/INSIGHTS.md`, 2026-08-07), and a bound
 * that rejects an already-stored tour on the way out helps nobody.
 */
import { z } from 'zod';
import { OnboardingLink } from './knowledge.js';

/**
 * The five sections a tour is made of, in the fixed order every tour carries them.
 *
 * The order lives in the contract rather than in a service constant because it is
 * a promise to the screen: the client renders `sections` as given and builds its
 * on-this-page rail from the same sequence, so neither the model nor a later
 * service change can shuffle it.
 *
 *  - `architecture`   — how the repository is put together, with a diagram when
 *                       one can be drawn. The index's endpoint and cron facts feed
 *                       this section; there is deliberately no separate
 *                       routes-and-APIs section.
 *  - `critical_paths` — the index's dependency chains, seeded from the
 *                       highest-ranked files.
 *  - `run_locally`    — commands taken from files that DECLARE them. Nothing here
 *                       is ever executed.
 *  - `reading_path`   — files to read first, ordered by the index's own rank.
 *  - `first_tasks`    — small pieces of work to start on.
 */
export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

/**
 * How much of the tour the repository's index and the model could actually
 * support.
 *
 * The same three values `BlastStatus` (./blast.js) and `PriorPrsStatus`
 * (./prior-prs.js) use, and that is deliberate: a user told "the index is
 * incomplete" by two features should hear it in one vocabulary.
 *
 *  - `ok`       — the index covers this repository and the generation completed.
 *  - `partial`  — the tour is real but was built over an index that covers only
 *                 part of the repository, or a section could not be filled. What
 *                 is here is true; what is missing proves nothing.
 *  - `degraded` — the tour is the deterministic skeleton. Its sections exist
 *                 because the contract fixes them, not because a tour was written.
 */
export const OnboardingStatus = z.enum(['ok', 'partial', 'degraded']);
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

/**
 * Why the status is not `ok`. Null when it is.
 *
 * The first five are `BlastReason`'s set (./blast.js) minus `no_changed_files`,
 * spelled identically on purpose: the index reports one condition and every
 * feature that surfaces it must name it the same way, or two screens tell the same
 * user two different stories about one repository.
 *
 *  - `flag_off`       — indexing is disabled for this installation.
 *  - `index_failed`   — the index exists and its last build failed.
 *  - `index_partial`  — the index covers only some of the repository's files.
 *  - `repo_too_large` — the repository exceeded the indexer's file cap.
 *  - `index_missing`  — no usable index at all. Also where any unrecognised
 *                       index-side condition lands, rather than being invented as
 *                       a new value here.
 *
 * The last four are this feature's own and have no index-side equivalent, because
 * the index knows nothing about a model call:
 *
 *  - `model_failed`         — the call threw.
 *  - `model_timeout`        — the call did not answer inside the deadline.
 *  - `model_invalid`        — it answered, and the answer did not survive
 *                             validation.
 *  - `no_commands_declared` — the repository declares no runnable command in any
 *                             file this feature reads. A true finding about the
 *                             repository, not a failure of the generation.
 */
export const OnboardingReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'index_missing',
  'model_failed',
  'model_timeout',
  'model_invalid',
  'no_commands_declared',
]);
export type OnboardingReason = z.infer<typeof OnboardingReason>;

/**
 * One command a reader can run, taken from a file that DECLARES it.
 *
 * `file` is not decoration. A command is worth showing only because the reader can
 * check it against its source before running it — nothing in this system executes
 * one — so the declaring path is as load-bearing as the command text.
 */
export const OnboardingCommand = z.object({
  /** The invocation verbatim: `npm run dev`, `make test`, `docker compose up api`. */
  command: z.string(),
  /** Repo-relative file it was read from — a `package.json`, a `Makefile`, a compose file. */
  file: z.string(),
  /** Position in the section's command list, 0-based, so the order is stable across reads. */
  order: z.number().int(),
});
export type OnboardingCommand = z.infer<typeof OnboardingCommand>;

/**
 * One repository path with a one-line reason to read it.
 *
 * The row shape BOTH `critical_paths` and `reading_path` render, so those two
 * sections cannot drift into two layouts for one idea. `reason` here is prose
 * written for this row and is unrelated to `OnboardingReason` above.
 */
export const OnboardingPathNote = z.object({
  /** Repo-relative path. Every one is confirmed against the repository's index before it is stored. */
  path: z.string(),
  /** One line saying why this path is on the list. */
  reason: z.string(),
});
export type OnboardingPathNote = z.infer<typeof OnboardingPathNote>;

/**
 * One small piece of work to start on.
 *
 * `complexity` is a word rather than a colour because the badge that renders it
 * has to be readable without colour vision; the level is the word, not the hue.
 */
export const OnboardingTask = z.object({
  title: z.string(),
  /** Repo-relative file or directory the task starts in. Confirmed against the index before storage. */
  path: z.string(),
  complexity: z.enum(['low', 'medium', 'high']),
});
export type OnboardingTask = z.infer<typeof OnboardingTask>;

/**
 * One section of a stored tour.
 *
 * Every field is present on every section, and the per-kind arrays are empty on
 * the kinds that do not use them: `commands` belongs to `run_locally`, `paths` to
 * `critical_paths` and `reading_path`, `tasks` to `first_tasks`. A fixed shape
 * rather than a discriminated union, because the screen renders the five in one
 * loop and a stored tour is read back as one document; a consumer that wants a
 * single kind narrows on `kind`.
 */
export const OnboardingTourSection = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),
  /** Markdown, rendered with headings, lists and fenced code. */
  body: z.string(),
  /**
   * Mermaid source, or `null` when this section has no diagram.
   *
   * `nullable`, not `optional`: the field is always present, so a consumer never
   * has to tell "absent" from "null" — a distinction a jsonb column read back by a
   * cast silently loses.
   */
  diagram: z.string().nullable(),
  /** Reused from ./knowledge.js. Capped where the tour is assembled, not here. */
  links: z.array(OnboardingLink),
  commands: z.array(OnboardingCommand),
  paths: z.array(OnboardingPathNote),
  tasks: z.array(OnboardingTask),
});
export type OnboardingTourSection = z.infer<typeof OnboardingTourSection>;

/**
 * Response of `GET /repos/:id/onboarding` — the single tour a repository has.
 *
 * One tour per repository, shared across the workspace and replaced whole by a
 * generation: there is no history, no per-user and no per-branch variant, so a
 * regeneration replaces what a colleague was reading.
 */
export const OnboardingTour = z.object({
  /**
   * The sections, in `OnboardingSectionKind` order.
   *
   * Empty only when no tour has ever been generated. A degraded tour still carries
   * all five, because the contract fixes them and the screen renders a labelled
   * skeleton rather than an empty page.
   */
  sections: z.array(OnboardingTourSection),
  status: OnboardingStatus,
  reason: OnboardingReason.nullable(),
  /**
   * Where this repository's tour is in its lifecycle.
   *
   *  - `never_generated` — nobody has generated one. Answered as `200` with no
   *    sections rather than `404`: in a local-first tool, nothing generated yet is
   *    an ordinary state.
   *  - `running` — a generation is in flight. The rest of this document is the
   *    previously stored tour, if there is one.
   *  - `ready` — a stored tour, whatever its `status`.
   */
  generation_state: z.enum(['never_generated', 'running', 'ready']),
  /** ISO timestamp the stored tour was written. Null when none has been. */
  generated_at: z.string().nullable(),
  /**
   * Head commit the repository's index was at when this tour was generated.
   *
   * Null when the tour was generated with no index — which is also why the screen
   * links out to files only when this is set: a link pinned to a branch would
   * point at code the tour never saw.
   */
  indexed_sha: z.string().nullable(),
  /** True when the index's SHA has advanced past `indexed_sha`. Computed on read; nothing is regenerated. */
  stale: z.boolean(),
  /**
   * What the index had covered when this tour was generated — this tour's own
   * figures, never the current index state's, so an old tour cannot claim today's
   * coverage.
   */
  files_indexed: z.number().int(),
  files_skipped: z.number().int(),
  /** Model identifier the generation used. Null when no model call was made. */
  model: z.string().nullable(),
  /** Provider round-trips the generation cost: one call plus at most one repair reprompt. */
  attempts: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** Null means no price is known for the model, which is NOT the same as a free call (`0`). */
  cost_usd: z.number().nullable(),
});
export type OnboardingTour = z.infer<typeof OnboardingTour>;
