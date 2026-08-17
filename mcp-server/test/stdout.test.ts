/**
 * stdout.test.ts — R2's third mechanism: a text scan of the whole `src/` tree for
 * anything that could put a byte on stdout.
 *
 * stdout is this server's JSON-RPC transport. One stray byte corrupts a frame and
 * the client drops the connection with nothing pointing back at the cause, so the
 * rule is guarded three times over and each layer covers what the others cannot:
 *
 *  1. `eslint.config.js` — `no-console: error` package-wide, `process.stdout`
 *     restricted outside `src/log.ts` and `src/index.ts`.
 *  2. **this file** — the same rule over every file in the tree, every run.
 *  3. `redirectConsoleToStderr()` in `src/log.ts` — the only layer that reaches a
 *     DEPENDENCY logging from inside itself.
 *
 * ## Why layer 2 is not redundant with layer 1
 *
 * ESLint in review runs over the files a diff CHANGED. That is the common case and
 * it is not the only one: a rule removed from the config, a file added to an
 * `ignores` entry, or a lint job that never ran leaves nothing behind. This scan
 * walks the tree from `import.meta.dirname` and re-checks all of it on every
 * `vitest run`, so its result does not depend on which files were touched.
 *
 * ## The path comes from `import.meta.dirname`, not from the cwd
 *
 * `process.cwd()` is wherever vitest was invoked. Resolving `src/` against it
 * gives a directory that may not exist — and a walk of a missing directory is an
 * empty walk, which is a PASS. Anchoring on this file's own location is what makes
 * "found nothing" mean "there is nothing", and the file count is reported and
 * floored below so that an empty walk cannot read as clean.
 *
 * ## Deliberate: comments are scanned too, in non-exempt files
 *
 * The scan is over raw text. It does not strip comments, so a doc-comment in a
 * non-exempt file that merely MENTIONS `console.log` would fail this test. That is
 * the chosen trade, and the alternative was measured rather than assumed: a
 * line-comment stripper naive enough to be trustworthy also truncates at the `//`
 * inside `http://localhost:3001`, which `src/config.ts` really contains — and
 * anything after it on the line, including a real call, would then be invisible. A
 * false positive on prose is loud, cheap and fixed by rewording; a false negative
 * in a guard whose whole job is to be total is the failure mode that matters. If a
 * future doc-comment genuinely needs the literal string, the answer is to reword
 * it (say "the console methods", drop the `.`) rather than to weaken this scan.
 *
 * `src/log.ts` and `src/index.ts` are exempt wholesale — the two files that are
 * ALLOWED to name a stream, and between them the source of roughly five prose
 * matches. Nothing here papers over those: they are exempt by name, the exemption
 * is asserted to name real files, and the matcher is checked against synthetic
 * sources so a regex that had stopped matching anything could not pass quietly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(import.meta.dirname, '..', 'src');

/**
 * The two files allowed to name a stream: the logger that owns stderr, and the
 * composition root that hands stdout to `StdioServerTransport`. Kept identical to
 * the `files:` override in `eslint.config.js` — the two lists are one rule.
 */
const EXEMPT = ['log.ts', 'index.ts'] as const;

/**
 * A floor on how much this test looked at, so a walk that found nothing cannot
 * report itself as a clean tree. The package has 16 files under `src/` today;
 * this is deliberately well below that, because the number is a sanity check and
 * not an inventory to maintain.
 */
const MIN_FILES_SCANNED = 10;

interface Forbidden {
  readonly label: string;
  readonly pattern: RegExp;
}

const FORBIDDEN: readonly Forbidden[] = [
  // Every method, not just `log`: `console.info`, `.dir`, `.table`, `.group` and
  // `.count` all write to stdout too.
  { label: 'console.', pattern: /console\./ },
  { label: 'process.stdout', pattern: /process\.stdout/ },
];

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly text: string;
}

/** Every file under a directory, recursively. Nothing is skipped by extension. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

/** Line-by-line, so an offence can name the line a reader has to open. */
function scan(file: string, source: string): Offence[] {
  const offences: Offence[] = [];
  const lines = source.split('\n');

  for (const [index, text] of lines.entries()) {
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) offences.push({ file, line: index + 1, label, text: text.trim() });
    }
  }
  return offences;
}

/** `src/`-relative, in posix form, so it reads the same on any platform. */
function relative(file: string): string {
  return path.relative(SRC_DIR, file).split(path.sep).join('/');
}

function isExempt(file: string): boolean {
  return (EXEMPT as readonly string[]).includes(relative(file));
}

function describeOffences(offences: readonly Offence[]): string {
  return offences
    .map((offence) => `src/${offence.file}:${offence.line} matches ${offence.label} — ${offence.text}`)
    .join('\n');
}

describe('stdout stays clean across the whole src/ tree', () => {
  it('matches the calls it is meant to match, and leaves stderr alone', () => {
    // Without this, a regex that had stopped matching anything at all would make
    // every other assertion in this file pass on an empty result.
    const offending = [
      'console.log("hello");',
      "  console.error('boom');",
      'process.stdout.write("frame");',
      'if (x) { console.table(rows); }',
    ];
    for (const source of offending) {
      expect(scan('fixture.ts', source), `not caught: ${source}`).not.toEqual([]);
    }

    const allowed = [
      "process.stderr.write('a log line');",
      "logger.info('configuration loaded');",
      "const url = 'http://localhost:3001';",
      'const stdout = transport.stdout;',
    ];
    for (const source of allowed) {
      expect(scan('fixture.ts', source), `false positive: ${source}`).toEqual([]);
    }
  });

  it('names two exempt files that really exist', () => {
    const present = filesUnder(SRC_DIR).map(relative);

    // A rename would otherwise leave a dead exemption behind: the entry stops
    // matching anything, the renamed file becomes silently unexempt, and the
    // failure surfaces as an unrelated offence in a file that was always allowed
    // to write to stderr.
    for (const exempt of EXEMPT) expect(present, `${exempt} is exempt but absent`).toContain(exempt);
  });

  it('finds no console call and no process.stdout outside log.ts and index.ts', () => {
    const files = filesUnder(SRC_DIR);
    const scanned = files.filter((file) => !isExempt(file));
    const offences = scanned.flatMap((file) => scan(relative(file), readFileSync(file, 'utf8')));

    process.stderr.write(
      `stdout-scan  ${files.length} files under src/, ${scanned.length} scanned, ` +
        `${EXEMPT.length} exempt, ${offences.length} offences\n`,
    );

    // Not `files.length`: the exempt pair is subtracted, so this floor is about
    // the tree really having been walked.
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES_SCANNED);
    expect(offences, describeOffences(offences)).toEqual([]);
  });
});
