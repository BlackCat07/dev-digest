import { z } from 'zod';

/**
 * `PrBriefDraft` — what the MODEL returns, before anything has been checked.
 *
 * Deliberately kept apart from `PrRiskBrief` in `@devdigest/shared`, the same
 * separation `modules/onboarding/schemas.ts` keeps between `OnboardingDraft` and
 * `OnboardingTour` and `modules/intent/schemas.ts` keeps between
 * `IntentClassification` and `PrIntent`: one of these is what was claimed and the
 * other is what survived. Nothing here has been grounded, capped, ordered or
 * deduplicated — a `path` below may name a file the pull request never touched, a
 * `file_refs` entry may name nothing at all, and there may be twenty risks where
 * six will be stored. `grounding.ts` is where a claim becomes a fact.
 *
 * Three constraints come from the strict JSON Schema this becomes, and all three
 * are stated in the two files above for the same reasons:
 *
 *  - **No `.optional()`.** Strict mode requires every property in `required`, so
 *    an optional field makes the REQUEST invalid. Use `.nullable()` — which is
 *    why {@link DraftReviewFocus.line} is nullable rather than absent.
 *  - **No array `.min()` / `.max()`.** They are not expressible in that schema,
 *    so they would not constrain the model at all: they would only fail
 *    validation after the answer arrived and burn a round-trip this feature does
 *    not have (AC-19 allows exactly one).
 *  - **No numeric range keyword anywhere.** Anthropic-via-OpenRouter rejects a
 *    `json_schema` carrying one outright (`reviewer-core/INSIGHTS.md`,
 *    2026-08-07). The caps are stated in the prompt and enforced in
 *    `grounding.ts`, where the value is assembled.
 *
 * **The model is not asked for a risk level, and a level it volunteers is
 * ignored** (AC-26). There is no field for one below and that is the whole point:
 * the level is DERIVED as the highest severity among the risks that survived
 * grounding, so the badge a reader sees and the list beneath it cannot disagree.
 * Asking for it would invite a second opinion about evidence the model has
 * already given — the same reason the onboarding tour's section order is the
 * contract's and not the model's.
 */

/**
 * The five risk shapes the card has an icon for, plus an escape hatch.
 *
 * A CLOSED enum here and an open `z.string()` on the stored contract
 * (`Risk.kind`), which is the arrangement `modules/intent/schemas.ts` already
 * chose and states: the enum IS expressible in JSON Schema, so it constrains the
 * model at generation time and the card's icon lookup is total — while the
 * persisted shape stays exactly as `contracts/brief.ts` defines it, so nothing in
 * the shared contract had to be reshaped. `other` exists so a real risk that fits
 * none of the five is still reported instead of being mislabelled into whichever
 * category was nearest.
 *
 * Spelled out here rather than imported from the intent module: importing a
 * sibling's schema is a `no-cross-module-internals` violation that `import type`
 * does not exempt (`server/INSIGHTS.md`, 2026-08-14).
 */
export const BriefRiskKind = z.enum([
  'security',
  'db_migration',
  'breaking_api',
  'perf',
  'deps',
  'other',
]);
export type BriefRiskKind = z.infer<typeof BriefRiskKind>;

/**
 * One risk, as the model is asked to state it.
 *
 * `file_refs` are CLAIMS, not evidence. Each entry may be a changed file's path,
 * a file the blast map named, or an endpoint or scheduled job exactly as the blast
 * block spelled it — one field for citations of both kinds, because that is the
 * one field the stored `Risk` has and because a reader clicking a citation does
 * not care which of the two it was. Two different rules then check them:
 * AC-22 compares a path against the paths the model was shown, and AC-25 compares
 * an endpoint against the map's impacted endpoints, which a path comparison
 * cannot see. Both are enforced in `grounding.ts`, and a risk whose every
 * citation was invented is dropped whole (AC-23).
 */
export const DraftRisk = z.object({
  kind: BriefRiskKind,
  /** Short label for the chip — a noun phrase, not a sentence. */
  title: z.string(),
  /** One or two sentences: why, and what to look at. */
  explanation: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  /** Paths, blast-map files, or endpoint labels. Checked before storage. */
  file_refs: z.array(z.string()),
});
export type DraftRisk = z.infer<typeof DraftRisk>;

/**
 * One place to look first, as the model is asked to state it.
 *
 * `path` is checked against the CHANGED-FILE LIST alone — stricter than a risk's
 * `file_refs`, because this row's whole contract is that it navigates into a tab
 * that renders only changed files, so the blast radius is not an allowed source
 * here (AC-24, OQ-3).
 *
 * `line` is nullable rather than absent (strict mode) and is explicitly
 * UNGROUNDED: the model never sees a hunk body, so nothing checks that the number
 * means anything. A row that scrolls to a plausible but wrong line is within
 * spec; a row that scrolls to the wrong file is not.
 */
export const DraftReviewFocus = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
  /** One line of advice. A row without one is dropped — it is all the model adds. */
  reason: z.string(),
});
export type DraftReviewFocus = z.infer<typeof DraftReviewFocus>;

/**
 * The whole structured answer: two sentences and two lists.
 *
 * An object at the root because `toJsonSchema` requires one, and `what` / `why`
 * are plain strings rather than nullable ones on purpose — the model is asked for
 * both and always has enough to answer, while "nothing worth saying" is expressed
 * by an EMPTY LIST for the two lists and never by a null sentence. A `what` that
 * only restates the title, and an empty sentence, both become null in
 * `grounding.ts`, where the pull request's own title is in reach to compare
 * against (AC-27).
 */
export const PrBriefDraft = z.object({
  what: z.string(),
  why: z.string(),
  risks: z.array(DraftRisk),
  review_focus: z.array(DraftReviewFocus),
});
export type PrBriefDraft = z.infer<typeof PrBriefDraft>;
