import { z } from 'zod';
import { OnboardingSectionKind } from '@devdigest/shared';

/**
 * `OnboardingDraft` — what the MODEL returns, before anything has been checked.
 *
 * Deliberately kept apart from `OnboardingTour` in `@devdigest/shared`, the same
 * separation `conventions/schemas.ts` keeps between `ConventionExtraction` and
 * `ExtractedConvention`, and for the same reason: one of these is what was
 * claimed and the other is what survived. Nothing here has been grounded against
 * the index, capped, ordered or deduplicated — a `path` below may not exist, a
 * `kind` may repeat, and there may be twenty tasks where six will be stored.
 *
 * Two constraints come from `zodResponseFormat`, which turns this into a strict
 * JSON Schema, and both are stated in `conventions/schemas.ts` too:
 *
 *  - **No `.optional()`.** Strict mode requires every property in `required`, so
 *    an optional field makes the REQUEST invalid. Use `.nullable()` — which is
 *    why {@link DraftSection.diagram} is nullable rather than absent.
 *  - **No array `.min()` / `.max()`.** They are not expressible in that schema,
 *    so they would not constrain the model at all: they would fail validation
 *    after the answer arrived and burn the one repair round-trip AC-10 budgets.
 *    Bounds are stated in the prompt and enforced in code, which is what AC-30
 *    requires anyway.
 *
 * No numeric range keyword appears either: Anthropic-via-OpenRouter rejects a
 * JSON schema carrying one outright (`reviewer-core/INSIGHTS.md`, 2026-08-07).
 *
 * What the model is NOT asked for is as important as what it is. It does not
 * return commands (those come from files that declare them — AC-20), it does not
 * return section titles (English constants — N12), and it does not decide the
 * order of anything: the section order is the contract's and the reading path's
 * order is the index's rank.
 */

/** One link out to a file. `path` is a claim until the index confirms it (AC-8). */
export const DraftLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type DraftLink = z.infer<typeof DraftLink>;

/**
 * One path with a line of prose saying why it is worth reading.
 *
 * The model supplies the PROSE. Which paths a tour names, and in what order, is
 * decided by the index — so a note whose path is not among the paths the tour was
 * built from simply goes unused, and a note the model omitted gets a
 * deterministic sentence instead.
 */
export const DraftPathNote = z.object({
  path: z.string(),
  reason: z.string(),
});
export type DraftPathNote = z.infer<typeof DraftPathNote>;

/** One suggested first task. `path` may name a file or a directory. */
export const DraftTask = z.object({
  title: z.string(),
  path: z.string(),
  complexity: z.enum(['low', 'medium', 'high']),
});
export type DraftTask = z.infer<typeof DraftTask>;

/**
 * One section as the model wrote it.
 *
 * `kind` is typed against the contract's own enum, so a sixth section the model
 * invents fails validation here rather than being silently carried to the
 * assembler — and a kind that IS in the enum but was not asked for is discarded
 * when the five are assembled in the contract's fixed order (AC-1).
 *
 * Every per-kind array is present on every section because strict mode requires
 * it; the assembler reads only the ones that belong to the kind.
 */
export const DraftSection = z.object({
  kind: OnboardingSectionKind,
  /** Markdown. Capped at `MAX_BODY_CHARS` when the tour is assembled, not here. */
  body: z.string(),
  /**
   * Mermaid source, or null.
   *
   * `nullable`, never optional or an empty string: the prompt says so in as many
   * words, and the assembler treats an empty string as absent anyway (EC-13).
   */
  diagram: z.string().nullable(),
  links: z.array(DraftLink),
  paths: z.array(DraftPathNote),
  tasks: z.array(DraftTask),
});
export type DraftSection = z.infer<typeof DraftSection>;

/**
 * The whole structured answer.
 *
 * A wrapper object rather than a bare array because `zodResponseFormat` requires
 * an object at the root, and because a named field leaves room for the model to
 * be asked for something beside the sections later without reshaping the call.
 */
export const OnboardingDraft = z.object({
  sections: z.array(DraftSection),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;
