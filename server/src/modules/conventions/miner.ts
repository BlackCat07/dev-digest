import type { ConventionCategory } from '@devdigest/shared';
import { parseImports } from '../../adapters/astgrep/index.js';
import type { SampledFile } from './sampler.js';

/**
 * The deterministic pass that runs BEFORE the model sees anything.
 *
 * A model asked "what are this repo's conventions?" does not count — it reads a
 * sample and infers, so a habit that appears in two of the eighty files it was
 * given comes back stated as a rule with a confident-sounding number attached.
 * That is where most of the noise in this kind of feature comes from.
 *
 * So we count first, mechanically, and put the counts in the prompt as facts.
 * The model's job shrinks from "work out what is true here" to "phrase the rule
 * and pick the evidence" — which is the part it is actually good at. A fact of
 * `await 312 · .then( 4` is not something it can talk itself out of.
 *
 * **Known limitation, deliberate:** the counters are lexical, so an occurrence
 * inside a string literal or a comment counts. Making them exact would mean
 * parsing every file for every counter, and the ratios these produce are used to
 * tell 312-versus-4 from 2-versus-60 — a handful of miscounted comment lines
 * does not move that. Where accuracy is cheap (imports), the ast-grep parser is
 * used instead of a regex.
 *
 * **Second limitation, worth knowing:** the sample arrives from
 * `RepoIntel.getConventionSamples`, which filters tests out by design. Nothing
 * here can mine a `testing` fact — that category reaches the model without
 * measured backing, and its candidates lean entirely on the adherence count
 * afterwards.
 *
 * Pure: takes file contents, returns data. No fs, no db, no model.
 */

/** One measured comparison over the sample. */
export interface MinedFact {
  id: string;
  category: ConventionCategory;
  /** What was compared, phrased for a prompt line. */
  subject: string;
  /** Ordered by count, highest first. */
  options: Array<{ label: string; count: number }>;
}

function countMatches(source: string, pattern: RegExp): number {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

/** Sum a per-file counter over the sample. */
function total(files: SampledFile[], count: (file: SampledFile) => number): number {
  return files.reduce((sum, file) => sum + count(file), 0);
}

/** Build a fact, or null when nothing at all was observed. */
function fact(
  id: string,
  category: ConventionCategory,
  subject: string,
  options: Array<{ label: string; count: number }>,
): MinedFact | null {
  if (options.every((option) => option.count === 0)) return null;
  return {
    id,
    category,
    subject,
    options: [...options].sort((a, b) => b.count - a.count),
  };
}

/** The leading option's share of the fact, 0..1. Null when nothing counted. */
export function dominance(minedFact: MinedFact): number | null {
  const sum = minedFact.options.reduce((acc, option) => acc + option.count, 0);
  if (sum === 0) return null;
  return (minedFact.options[0]?.count ?? 0) / sum;
}

/** `src/modules/skills/service.ts` → `service`. */
function baseName(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.[^.]+$/, '');
}

function isKebab(name: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(name);
}

/**
 * Count every fact the sample can support.
 *
 * Adding a counter here is the cheapest way to improve candidate quality: each
 * one narrows what the model has to guess at. Keep them comparisons rather than
 * bare counts — "312 of these, 4 of those" states a convention, while "312 awaits"
 * states nothing.
 */
export function mineFacts(files: SampledFile[]): MinedFact[] {
  if (files.length === 0) return [];

  // --- imports, via the real parser rather than a regex ---------------------
  let typeOnlyImports = 0;
  let valueImports = 0;
  let aliasImports = 0;
  let relativeImports = 0;
  let extensionedRelativeImports = 0;
  let extensionlessRelativeImports = 0;

  for (const file of files) {
    for (const imported of parseImports(file.path, file.source)) {
      if (imported.isType) typeOnlyImports += 1;
      else valueImports += 1;

      const from = imported.source;
      if (from.startsWith('.')) {
        relativeImports += 1;
        if (/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(from)) extensionedRelativeImports += 1;
        else extensionlessRelativeImports += 1;
      } else if (from.startsWith('@') || from.startsWith('~')) {
        aliasImports += 1;
      }
    }
  }

  const kebabFiles = files.filter((file) => isKebab(baseName(file.path))).length;
  const otherCaseFiles = files.length - kebabFiles;

  const barrelFiles = files.filter((file) => /(?:^|\/)index\.[tj]sx?$/.test(file.path)).length;
  const directories = new Set(
    files.map((file) => file.path.split('/').slice(0, -1).join('/')),
  ).size;

  const candidates: Array<MinedFact | null> = [
    fact('async.await-vs-then', 'async', 'awaiting a promise', [
      { label: 'await', count: total(files, (f) => countMatches(f.source, /\bawait\s/g)) },
      { label: '.then() chain', count: total(files, (f) => countMatches(f.source, /\.then\s*\(/g)) },
    ]),

    fact('error-handling.try-vs-catch', 'error-handling', 'handling a failure', [
      { label: 'try/catch block', count: total(files, (f) => countMatches(f.source, /\btry\s*\{/g)) },
      { label: '.catch() handler', count: total(files, (f) => countMatches(f.source, /\.catch\s*\(/g)) },
    ]),

    fact('structure.named-vs-default-export', 'structure', 'exporting from a module', [
      {
        label: 'named export',
        count: total(files, (f) =>
          countMatches(
            f.source,
            /\bexport\s+(?:const|let|function|async\s+function|class|interface|type|enum)\b/g,
          ),
        ),
      },
      {
        label: 'default export',
        count: total(files, (f) => countMatches(f.source, /\bexport\s+default\b/g)),
      },
    ]),

    fact('typing.interface-vs-type', 'typing', 'declaring an object shape', [
      {
        label: 'interface',
        count: total(files, (f) => countMatches(f.source, /\binterface\s+[A-Z]\w*/g)),
      },
      {
        label: 'type alias',
        count: total(files, (f) => countMatches(f.source, /\btype\s+[A-Z]\w*\s*=/g)),
      },
    ]),

    fact('logging.console-vs-logger', 'logging', 'writing a log line', [
      {
        label: 'injected logger',
        count: total(files, (f) =>
          countMatches(
            f.source,
            /\b(?:logger|log|req\.log|app\.log|fastify\.log|this\.log)\.(?:info|warn|error|debug|trace|fatal)\s*\(/g,
          ),
        ),
      },
      {
        label: 'console.*',
        count: total(files, (f) => countMatches(f.source, /\bconsole\.\w+\s*\(/g)),
      },
    ]),

    fact('imports.type-only', 'imports', 'importing something used only as a type', [
      { label: 'import type', count: typeOnlyImports },
      { label: 'plain import', count: valueImports },
    ]),

    fact('imports.alias-vs-relative', 'imports', 'importing across the codebase', [
      { label: 'path alias (@/…)', count: aliasImports },
      { label: 'relative path', count: relativeImports },
    ]),

    fact('imports.relative-extension', 'imports', 'the extension on a relative import', [
      { label: 'explicit .js/.ts extension', count: extensionedRelativeImports },
      { label: 'no extension', count: extensionlessRelativeImports },
    ]),

    fact('naming.file-case', 'naming', 'naming a source file', [
      { label: 'kebab-case', count: kebabFiles },
      { label: 'camelCase or PascalCase', count: otherCaseFiles },
    ]),

    fact('structure.barrel-files', 'structure', 're-exporting a directory', [
      { label: 'directory with an index barrel', count: barrelFiles },
      { label: 'directory without one', count: Math.max(0, directories - barrelFiles) },
    ]),
  ];

  return candidates.filter((f): f is MinedFact => f !== null);
}

/**
 * Render facts for the extraction prompt.
 *
 * Counts are given raw rather than as percentages on purpose: "4" reads as
 * "these four are the exceptions, go look at them", while "1.3%" invites the
 * model to round it away and state the rule as absolute.
 */
export function formatFacts(facts: MinedFact[]): string {
  if (facts.length === 0) return '';
  const lines = facts.map((f) => {
    const counts = f.options.map((o) => `${o.label} ${o.count}`).join(' · ');
    return `- ${f.subject}: ${counts}`;
  });
  return [
    'Measured over the sampled files by counting, not by reading:',
    ...lines,
    '',
    'These counts are facts about this repository. A rule that contradicts one of',
    'them is wrong, however reasonable it sounds.',
  ].join('\n');
}

/** The facts relevant to one category, for that category's extraction call. */
export function factsFor(facts: MinedFact[], category: ConventionCategory): MinedFact[] {
  return facts.filter((f) => f.category === category);
}
