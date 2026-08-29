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
import { Review } from '@devdigest/shared';

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

/* Google's structured outputs do not resolve `$ref`. `zodResponseFormat`
   deduplicates any sub-schema it sees twice into `definitions`, so a schema that
   is perfectly valid JSON Schema is rejected by Gemini with
   `400 Provider returned error` — the same opaque surface the numeric-range
   problem wears. Measured against `google/gemini-3.7-flash` via OpenRouter:
   `reference to undefined schema at properties.findings.items.properties.evidence…`,
   and a 200 with the identical schema once the refs are inlined. */
describe('toJsonSchema — no $ref reaches the wire', () => {
  const hasRef = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(hasRef);
    if (node === null || typeof node !== 'object') return false;
    const obj = node as Record<string, unknown>;
    if ('$ref' in obj) return true;
    return Object.values(obj).some(hasRef);
  };

  it('inlines a sub-schema that appears twice, and drops the definitions block', () => {
    // Two fields sharing one enum is exactly what makes `zodResponseFormat`
    // hoist — the shape `Finding` has in `trifecta_components` / `evidence`.
    const shared = z.enum(['a', 'b', 'c']);
    const schema = z.object({
      first: z.array(shared),
      second: z.object({ component: shared }),
    });

    const { schema: wire } = toJsonSchema(schema, 'shared');

    expect(hasRef(wire)).toBe(false);
    expect(wire).not.toHaveProperty('definitions');
    expect(wire).not.toHaveProperty('$schema');
    // Inlining must not change what the schema ACCEPTS — the enum is still
    // there, in both places, with all three members.
    const asAny = wire as any;
    expect(asAny.properties.first.items.enum).toEqual(['a', 'b', 'c']);
    expect(asAny.properties.second.properties.component.enum).toEqual(['a', 'b', 'c']);
  });

  it('leaves the real Review schema free of references', () => {
    // The regression itself: `Review` is what every agent sends.
    const { schema: wire } = toJsonSchema(Review, 'review');
    expect(hasRef(wire)).toBe(false);
    expect(wire).not.toHaveProperty('definitions');
  });
});
