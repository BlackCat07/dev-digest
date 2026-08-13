/**
 * The per-file summary — pure. No clock, no I/O, no `this`.
 *
 * Fills the contract's `pseudocode_summary` **by quoting, never by generating**.
 * Every character it returns was copied out of the stored patch, which is what
 * lets a field that reads like model output exist in a feature whose acceptance
 * criterion is that no model is called.
 *
 * The source is the tail of each `@@ … @@` header — the enclosing function or
 * class name git puts there. `modules/intent/hunks.ts` documents why that tail is
 * the most useful thing a diff offers when you are not allowed to read its body,
 * and why `adapters/git/diff-parser.ts` cannot supply it (it keeps the four
 * numbers and discards the tail).
 *
 * HONEST CAVEAT, and it belongs in the code rather than only in the spec: this is
 * a list of touched symbols, not pseudocode. The contract's field name
 * overpromises, and the field is `nullish` precisely so an implementation is
 * allowed to say nothing. If a reviewer decides the name must mean prose, the
 * escape hatch is one line: stop calling this from `service.ts` and every summary
 * becomes `null` with no other change.
 */
import {
  MAX_SUMMARY_CHARS,
  MAX_SUMMARY_SYMBOLS,
  SUMMARY_SEPARATOR,
} from './constants.js';

/**
 * Words that are never the name of the thing being declared.
 *
 * Needed because the tail is a prefix of a declaration, not a name:
 * `export function rateLimit` ends in the name, but
 * `export default async function` ends in a keyword. Returning "function" as a
 * touched symbol would be worse than returning nothing — it looks like real
 * output and says less than silence.
 */
const NOT_A_NAME = new Set([
  'export', 'default', 'async', 'function', 'const', 'let', 'var', 'class',
  'interface', 'type', 'enum', 'struct', 'impl', 'trait', 'namespace', 'module',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'override',
  'void', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'try',
  'def', 'fn', 'func', 'sub', 'end', 'new', 'get', 'set',
]);

/** A candidate name, or `null` if it is a keyword or too short to be one. */
function accept(name: string): string | null {
  if (name.length < 2 || NOT_A_NAME.has(name.toLowerCase())) return null;
  return name;
}

/**
 * The declared name in one `@@` header tail, or `null` if the tail names nothing.
 *
 * A declaration puts its name immediately before a `(`, a `{` or an `=`, so both
 * branches below look for an identifier followed by one of those. Each takes the
 * FIRST such identifier rather than the last, which is what makes two
 * otherwise-awkward shapes come out right: Go's method receiver
 * (`func (s *Server) Handle(` → `Handle`, because `func` is rejected as a keyword)
 * and a default argument holding a call (`function foo(bar = baz())` → `foo`).
 *
 * **The trailing punctuation is what separates a declaration from PROSE, and it is
 * the whole reason the second branch is not just "the last identifier".** Git puts
 * a tail on a hunk in a MARKDOWN file too, and there it is a heading or a sentence.
 * An earlier version fell back to the last word, which turned
 * `## Available Skills` into the touched symbol `Skills` and
 * `Reusable AI skills that provide specialized knowledge` into `knowledge` — a
 * meaningless word presented as a quoted fact, which is exactly the failure
 * {@link NOT_A_NAME} exists to prevent. It survived review because on the one real
 * PR it was measured against, GitHub had truncated the tail mid-word so the last
 * "identifier" was a single letter and got rejected by luck.
 *
 * Requiring the punctuation costs one shape: a Python `class Foo:` (no brace) now
 * summarises as `null`. That is the right trade — `null` is always safe, and a
 * Python class whose body changed almost always shows a `def` in the tail anyway.
 */
function symbolFrom(tail: string): string | null {
  for (const match of tail.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = accept(match[1]!);
    if (name) return name;
  }

  // No argument list: a class, an interface, a `const x = {`. The name is still
  // followed by code punctuation — prose is not.
  for (const match of tail.matchAll(/([A-Za-z_$][\w$]*)\s*[{=]/g)) {
    const name = accept(match[1]!);
    if (name) return name;
  }

  return null;
}

/**
 * The symbols this file's patch touched, as one short line, or `null`.
 *
 * `null` — never `''` — when there is nothing to quote: a file with no stored
 * patch (the common case before `GET /pulls/:id` has run against a repo with a
 * token), a binary file, or a patch whose headers carry no tail. An empty string
 * would render as a blank "What this does:" row, which claims the feature ran and
 * found the change meaningless.
 *
 * Symbols appear in patch order, deduplicated, capped by count and by characters
 * so one pathological header cannot wrap the card. The cap drops whole symbols
 * rather than truncating mid-identifier.
 */
export function pseudocodeSummary(patch: string | null | undefined): string | null {
  if (!patch) return null;

  const symbols: string[] = [];
  const seen = new Set<string>();

  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith('@@ ')) continue;
    // Everything after the CLOSING `@@`. Searching from index 2 skips the opener.
    const close = line.indexOf('@@', 2);
    if (close === -1) continue;

    const symbol = symbolFrom(line.slice(close + 2));
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_SUMMARY_SYMBOLS) break;
  }

  if (symbols.length === 0) return null;

  let out = '';
  for (const symbol of symbols) {
    const next = out ? out + SUMMARY_SEPARATOR + symbol : symbol;
    if (next.length > MAX_SUMMARY_CHARS) break;
    out = next;
  }
  // A single symbol longer than the whole budget is the only way `out` is still
  // empty here; truncating it beats dropping the row entirely.
  return out || symbols[0]!.slice(0, MAX_SUMMARY_CHARS);
}
