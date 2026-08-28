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
  inlineDefinitions(json);
  return { schema: json, name };
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
 * Google rejects `$ref`, so every reference is inlined and the `definitions`
 * block is dropped.
 *
 * `zodResponseFormat` hoists a schema reused in two places into `definitions`
 * and points at it with `{"$ref": "#/definitions/..."}`. OpenAI and DeepSeek
 * resolve that; Google AI Studio does not, and answers the whole request with
 *
 *   400 INVALID_ARGUMENT — reference to undefined schema at
 *   properties.findings.items.properties.evidence.anyOf.0.items.properties.component
 *
 * which OpenRouter passes through as a bare "400 Provider returned error". The
 * effect was total: EVERY review by an agent on a Gemini model failed, in under
 * a second, with no tokens spent — while the same schema on DeepSeek answered
 * 200. Measured 2026-08-28 against the shared `Review` schema, whose
 * `finding.evidence[].component` and `trifecta.components[]` share one enum.
 *
 * Inlining loses nothing: `definitions` is a de-duplication device, not a
 * constraint, and `parseWithRepair` still re-checks every response against the
 * original zod schema. The same reasoning as `stripNumericRangeKeywords` above —
 * the wire schema is trimmed to the dumbest validator, and the real validation
 * happens here on the way back.
 *
 * A cyclic or unresolvable reference is left exactly as it was, and then the
 * `definitions` block is KEPT, because removing it would turn a schema this
 * function merely failed to simplify into a schema that is definitively broken.
 */
function inlineDefinitions(root: Record<string, unknown>): void {
  const defsKey = '$defs' in root ? '$defs' : 'definitions' in root ? 'definitions' : null;
  if (defsKey === null) return;
  const defs = root[defsKey];
  if (defs === null || typeof defs !== 'object' || Array.isArray(defs)) return;
  const table = defs as Record<string, unknown>;
  const prefix = `#/${defsKey}/`;
  let unresolved = false;

  const resolve = (node: unknown, seen: readonly string[]): unknown => {
    if (Array.isArray(node)) return node.map((item) => resolve(item, seen));
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;

    const ref = obj.$ref;
    if (typeof ref === 'string') {
      const target = ref.startsWith(prefix) ? table[ref.slice(prefix.length)] : undefined;
      // Points outside this table, or points at something already being
      // expanded further up this branch — inlining it would not terminate.
      if (target === undefined || seen.includes(ref)) {
        unresolved = true;
        return obj;
      }
      // A `$ref` node may carry siblings (`description`, `title`). They are the
      // caller's words about THIS use of the shared shape, so they win over the
      // target's own.
      const { $ref: _ref, ...siblings } = obj;
      const expanded = resolve(target, [...seen, ref]);
      if (expanded === null || typeof expanded !== 'object' || Array.isArray(expanded)) {
        return expanded;
      }
      return { ...(expanded as Record<string, unknown>), ...siblings };
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) out[key] = resolve(value, seen);
    return out;
  };

  for (const key of Object.keys(root)) {
    if (key === defsKey) continue;
    root[key] = resolve(root[key], []);
  }
  if (!unresolved) delete root[defsKey];
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
