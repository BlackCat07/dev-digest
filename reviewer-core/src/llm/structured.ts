import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * structured-output helpers shared by both LLM providers.
 *
 * - `toJsonSchema` converts a Zod schema to a JSON Schema (draft-07, strict
 *   object) by reusing OpenAI's bundled converter — used for OpenAI's
 *   `response_format: json_schema` AND Anthropic forced tool-use `input_schema`.
 * - `parseWithRepair` validates raw model text against the Zod schema and, on
 *   failure, returns a reprompt instruction so the caller can retry-on-error.
 */

export interface JsonSchema {
  schema: Record<string, unknown>;
  name: string;
}

export function toJsonSchema<T>(schema: z.ZodType<T>, name: string): JsonSchema {
  const rf = zodResponseFormat(schema as z.ZodTypeAny, name);
  const json = rf.json_schema.schema as Record<string, unknown>;
  stripNumericRangeKeywords(json);
  return { schema: inlineDefinitions(json), name };
}

/**
 * Anthropic's structured outputs (direct, Bedrock and Azure alike) reject
 * `minimum`/`maximum` and friends on numeric types with a 400, while DeepSeek
 * and OpenAI accept them — so a zod `.min()/.max()` breaks the whole request on
 * some providers only. Dropping the keywords from the wire schema loses no
 * validation: `parseWithRepair` re-checks every response against the original
 * zod schema and reprompts on violation. The bound is folded into the
 * property's `description` so the model still sees it.
 */
const NUMERIC_RANGE_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
] as const;

function stripNumericRangeKeywords(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripNumericRangeKeywords(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const bounds: string[] = [];
  for (const key of NUMERIC_RANGE_KEYWORDS) {
    if (key in obj) {
      bounds.push(`${key} ${String(obj[key])}`);
      delete obj[key];
    }
  }
  if (bounds.length > 0) {
    const hint = `Constraint: ${bounds.join(', ')}.`;
    obj.description = typeof obj.description === 'string' ? `${obj.description} ${hint}` : hint;
  }
  for (const value of Object.values(obj)) stripNumericRangeKeywords(value);
}

/**
 * Google's structured outputs do not resolve `$ref`, so a schema that hoists a
 * repeated sub-schema into `definitions` is rejected outright with
 * `400 Provider returned error` — the same opaque surface the numeric-range
 * problem above wears, and for a different reason.
 *
 * `zodResponseFormat` deduplicates any sub-schema it sees twice. `Finding`
 * reuses one enum in two places (`trifecta_components[]` and
 * `evidence[].component`), so the wire schema carries exactly one `$ref` and one
 * `definitions` entry, and Gemini answers
 * `reference to undefined schema at properties.findings.items.properties.evidence…`.
 * OpenAI and DeepSeek resolve it, which is why this surfaced only when an agent
 * was pointed at a Google model.
 *
 * Inlining is safe because the reference graph a zod schema produces is a TREE:
 * `definitions` here is deduplication, never recursion, so expanding every
 * reference terminates and changes nothing about what the schema accepts. A
 * self-referential zod type would not survive this — it also would not survive
 * being sent to any structured-output provider, and `parseWithRepair` still
 * validates every response against the original zod schema either way.
 *
 * `$schema` goes with it: it is metadata no provider reads, and Google rejects
 * unknown top-level keys on some routes.
 */
function inlineDefinitions(root: Record<string, unknown>): Record<string, unknown> {
  const defs = (root.definitions ?? {}) as Record<string, unknown>;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;

    const ref = obj.$ref;
    if (typeof ref === 'string') {
      const target = defs[ref.replace(/^#\/definitions\//, '')];
      // An unresolvable reference is left exactly as it is rather than dropped:
      // the provider's own error then names it, which is more useful than a
      // schema that silently lost a constraint.
      return target === undefined ? obj : walk(target);
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'definitions' || key === '$schema') continue;
      out[key] = walk(value);
    }
    return out;
  };

  return walk(root) as Record<string, unknown>;
}

/** Best-effort extraction of a JSON object/array from a model's text output. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  // strip ```json fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  // find first balanced { … } or [ … ]
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return trimmed;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start);
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; repromptMessage: string };

export function parseWithRepair<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let parsedJson: unknown;
  try {
    // Strict json_schema mode returns pure JSON — parse it directly. Only fall
    // back to fence/brace extraction if that fails, because extractJson can be
    // fooled by ``` fences or `{` braces that appear INSIDE JSON string values
    // (e.g. markdown code blocks in an onboarding `body`).
    try {
      parsedJson = JSON.parse(raw.trim());
    } catch {
      parsedJson = JSON.parse(extractJson(raw));
    }
  } catch (e) {
    const msg = `Output was not valid JSON: ${(e as Error).message}`;
    return {
      ok: false,
      error: msg,
      repromptMessage: `${msg}\nReturn ONLY a single valid JSON object matching the schema, no prose.`,
    };
  }
  const result = schema.safeParse(parsedJson);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return {
    ok: false,
    error: issues,
    repromptMessage: `Your JSON did not match the required schema. Fix these and return ONLY valid JSON:\n${issues}`,
  };
}
