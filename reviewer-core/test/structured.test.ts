/**
 * toJsonSchema — numeric range keywords must never reach the wire schema.
 * Anthropic's structured outputs (direct, Bedrock and Azure alike) 400 on
 * `minimum`/`maximum` for integer types, while DeepSeek/OpenAI accept them —
 * so a zod `.min()/.max()` in a contract broke reviews only on Claude models.
 * The bound is folded into `description` instead; zod still enforces it in
 * parseWithRepair. See INSIGHTS.md (2026-08-07).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toJsonSchema, parseWithRepair } from '../src/llm/structured.js';

const Sample = z.object({
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Overall quality from 0 to 100.'),
  findings: z.array(
    z.object({
      confidence: z.number().min(0).max(1),
      line: z.number().int(),
    }),
  ),
});

function flatten(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node !== null && typeof node === 'object') {
    out.push(node as Record<string, unknown>);
    Object.values(node).forEach((v) => flatten(v, out));
  }
  return out;
}

describe('toJsonSchema — provider-portable schemas', () => {
  const { schema } = toJsonSchema(Sample, 'Sample');
  const nodes = flatten(schema);

  it('strips numeric range keywords everywhere, including nested arrays', () => {
    for (const node of nodes) {
      for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) {
        expect(node).not.toHaveProperty(key);
      }
    }
  });

  it('folds the stripped bounds into the property description', () => {
    const score = (schema.properties as Record<string, Record<string, unknown>>).score;
    expect(score.description).toContain('Overall quality from 0 to 100.');
    expect(score.description).toContain('minimum 0');
    expect(score.description).toContain('maximum 100');
  });

  it('keeps enforcing the bounds locally via parseWithRepair', () => {
    const bad = JSON.stringify({ score: 250, findings: [] });
    const result = parseWithRepair(Sample, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.repromptMessage).toContain('score');
  });
});

/**
 * toJsonSchema — `$ref` must never reach the wire schema either.
 *
 * `zodResponseFormat` hoists a shape used in two places into `definitions` and
 * points at it with `{"$ref": "#/definitions/..."}`. Google AI Studio does not
 * resolve that and 400s the whole request with "reference to undefined schema",
 * which OpenRouter passes through as a bare "400 Provider returned error" — so
 * every review by an agent on a Gemini model failed, in under a second, while
 * the same schema on DeepSeek answered 200. Measured 2026-08-28.
 */
describe('toJsonSchema — references are inlined', () => {
  const Shared = z.enum(['private_data_access', 'untrusted_input', 'exfil_path']);
  const TwoUses = z.object({
    evidence: z.array(z.object({ component: Shared, file: z.string() })),
    trifecta: z.object({ components: z.array(Shared) }),
  });

  it('emits no $ref and no definitions block when every reference resolves', () => {
    const { schema } = toJsonSchema(TwoUses, 'TwoUses');
    const wire = JSON.stringify(schema);

    expect(wire).not.toContain('$ref');
    expect(schema).not.toHaveProperty('definitions');
    expect(schema).not.toHaveProperty('$defs');
  });

  it('expands the shared shape at BOTH use sites, not just the first', () => {
    const { schema } = toJsonSchema(TwoUses, 'TwoUses');
    const props = (schema as Record<string, never>).properties as Record<string, never>;

    const evidenceItem = (props.evidence as Record<string, never>).items as Record<string, never>;
    const component = (evidenceItem.properties as Record<string, never>).component as {
      enum?: string[];
    };
    const trifectaItems = (
      ((props.trifecta as Record<string, never>).properties as Record<string, never>)
        .components as Record<string, never>
    ).items as { enum?: string[] };

    // The point of the fix: a de-duplicated shape becomes two complete copies.
    expect(component.enum).toEqual(['private_data_access', 'untrusted_input', 'exfil_path']);
    expect(trifectaItems.enum).toEqual(['private_data_access', 'untrusted_input', 'exfil_path']);
  });

  it('still validates a response against the ORIGINAL zod schema', () => {
    // Inlining is a wire-format concern only: what comes back is checked against
    // the schema the caller passed, so nothing about validation is loosened.
    const good = parseWithRepair(
      TwoUses,
      JSON.stringify({
        evidence: [{ component: 'exfil_path', file: 'a.ts' }],
        trifecta: { components: ['untrusted_input'] },
      }),
    );
    expect(good.ok).toBe(true);

    const bad = parseWithRepair(
      TwoUses,
      JSON.stringify({
        evidence: [{ component: 'not_a_member', file: 'a.ts' }],
        trifecta: { components: [] },
      }),
    );
    expect(bad.ok).toBe(false);
  });
});
