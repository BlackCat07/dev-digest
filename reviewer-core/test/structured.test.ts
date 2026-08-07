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
