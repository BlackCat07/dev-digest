import { z } from 'zod';

/**
 * What the CLASSIFIER returns — not what the API serves.
 *
 * Kept out of `@devdigest/shared` for the same reason `conventions/schemas.ts`
 * is: this is raw material. Nothing here has been checked against the sources,
 * and its `confidence` is the model talking about itself, whereas `PrIntent`'s
 * is derived from which sources were actually available. Letting one type do
 * both jobs would produce a shape whose `confidence` sometimes means "counted"
 * and sometimes means "the model felt good about it" — the exact ambiguity the
 * shared contract exists to prevent.
 *
 * Three constraints, all of them about the strict JSON Schema this becomes:
 *
 *  - **No `.optional()`.** Strict mode requires every property in `required`;
 *    an optional field makes the REQUEST invalid. Use `.nullable()`.
 *  - **No array `.min()`/`.max()`.** Not expressible in the schema, so they
 *    would not constrain the model at all — they would only fail validation
 *    afterwards and burn a reprompt.
 *  - **No numeric `.min()`/`.max()`.** Anthropic-via-OpenRouter rejects range
 *    keywords in a `json_schema` outright.
 *
 * So the bounds live in the prompt and the enforcement lives in code:
 * `confidence` is clamped, and it can only ever LOWER the derived figure.
 */
/**
 * The five risk shapes the UI has an icon for, plus an escape hatch.
 *
 * A CLOSED enum here and an open `z.string()` on the stored contract, which is
 * deliberate rather than sloppy: the enum is expressible in JSON Schema, so it
 * constrains the model at generation time and the card's icon lookup is total —
 * while the persisted `Risk.kind` stays the shape `contracts/brief.ts` already
 * defines, so nothing in the shared contract had to be reshaped. `other` exists
 * so a real risk that fits none of the five is still reported instead of being
 * mislabelled into whichever category was nearest.
 */
export const RiskKind = z.enum([
  'security',
  'db_migration',
  'breaking_api',
  'perf',
  'deps',
  'other',
]);

/**
 * One risk area, as the classifier is asked to state it.
 *
 * `file_refs` are CLAIMS, not evidence: every entry is checked against the PR's
 * real changed-file list before anything is persisted (`groundRiskAreas`), for
 * the same reason findings are grounded — a card citing a file the PR never
 * touched is worse than a card with one fewer risk.
 */
export const RiskAreaClassification = z.object({
  kind: RiskKind,
  /** Short label for the chip — a noun phrase, not a sentence. */
  title: z.string(),
  /** One or two sentences the chip reveals when opened. */
  explanation: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  /** Changed files this risk concerns. Dropped if not in the real file list. */
  file_refs: z.array(z.string()),
});

export const IntentClassification = z.object({
  /** One or two sentences: what this PR is trying to do. Never empty. */
  intent: z.string(),
  /** What the PR is claiming to change. */
  in_scope: z.array(z.string()),
  /** Boundaries the material actually implies — not a list of everything else. */
  out_of_scope: z.array(z.string()),
  /** What the model was told it could not be given, restated in its own words. */
  missing_context: z.array(z.string()),
  /**
   * Where this change is most likely to hurt, from the material at hand only.
   *
   * Bounded by what the classifier can honestly see: paths, `+N/-M` counts, `@@`
   * headers and prose. It never receives diff bodies, so it can say "the
   * dependency manifest changed" but cannot name the package that was added.
   */
  risk_areas: z.array(RiskAreaClassification),
  /** The model's own estimate, 0..1. Clamped, and may only lower the derived value. */
  confidence: z.number(),
});
export type IntentClassification = z.infer<typeof IntentClassification>;
