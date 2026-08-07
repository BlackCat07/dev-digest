import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';
import {
  isTrivialNeedle,
  locateSnippet,
  normalizeLine,
  resolveInRoot,
  toNeedle,
  verifyClaim,
  verifyClaims,
  type ReadSource,
} from '../src/modules/conventions/verifier.js';
import {
  EVIDENCE_LINE_WINDOW,
  MAX_VERIFY_FILE_BYTES,
} from '../src/modules/conventions/constants.js';

/**
 * The evidence gate. Hermetic: the reader is injected, so no clone is needed and
 * nothing here touches the filesystem.
 */

const ROOT = `${sep}clones${sep}acme`;

const FILE = [
  "import { db } from './db.js';", // 1
  '', // 2
  'export async function listTasks(projectId: string) {', // 3
  '  const rows = await db.select().from(tasks);', // 4
  '  return rows;', // 5
  '}', // 6
  '', // 7
  'export async function getTask(id: string) {', // 8
  '  const rows = await db.select().from(tasks);', // 9
  '  return rows[0];', // 10
  '}', // 11
].join('\n');

/** A reader that serves one file and fails for anything else. */
function readerFor(contents: Record<string, string>): ReadSource {
  return async (absolutePath: string) => contents[absolutePath] ?? null;
}

describe('normalizeLine / toNeedle', () => {
  it('collapses indentation so a re-indented snippet still matches', () => {
    expect(normalizeLine('    const  x   =  1;  ')).toBe('const x = 1;');
  });

  it('drops blank lines, which models add and remove freely', () => {
    expect(toNeedle('const a = 1;\n\n\nconst b = 2;')).toEqual(['const a = 1;', 'const b = 2;']);
  });

  it('strips the line numbers the extraction prompt hands the model', () => {
    // The prompt numbers lines as `12\tcode`; models copy the number back.
    expect(toNeedle('4\tconst rows = await db.select();')).toEqual([
      'const rows = await db.select();',
    ]);
    expect(toNeedle('4: const rows = await db.select();')).toEqual([
      'const rows = await db.select();',
    ]);
  });

  it('leaves a real line of source that begins with a digit alone', () => {
    expect(toNeedle('42 + offset,')).toEqual(['42 + offset,']);
  });
});

describe('isTrivialNeedle', () => {
  it('rejects a snippet too short to prove anything', () => {
    expect(isTrivialNeedle(toNeedle('}'))).toBe(true);
    expect(isTrivialNeedle(toNeedle('return;'))).toBe(true);
  });

  it('rejects punctuation-only snippets however long', () => {
    expect(isTrivialNeedle(toNeedle('});  });  });'))).toBe(true);
  });

  it('accepts a snippet with real content', () => {
    expect(isTrivialNeedle(toNeedle('const rows = await db.select();'))).toBe(false);
  });
});

describe('locateSnippet', () => {
  const lines = FILE.split('\n');

  it('reports exact when the claimed line is right', () => {
    const found = locateSnippet(lines, '  return rows;', 5);
    expect(found).toEqual({ startLine: 5, endLine: 5, match: 'exact' });
  });

  it('corrects the line and reports shifted when the claim is close', () => {
    const found = locateSnippet(lines, 'return rows;', 7);
    expect(found?.startLine).toBe(5);
    expect(found?.match).toBe('shifted');
  });

  it('corrects the line and reports moved when the claim is far off', () => {
    const claimed = 5 + EVIDENCE_LINE_WINDOW + 40;
    const found = locateSnippet(lines, 'return rows;', claimed);
    expect(found?.startLine).toBe(5);
    expect(found?.match).toBe('moved');
  });

  it('matches across blank lines the model dropped, spanning the real range', () => {
    const snippet = 'export async function listTasks(projectId: string) {\nconst rows = await db.select().from(tasks);';
    const found = locateSnippet(lines, snippet, 3);
    expect(found).toEqual({ startLine: 3, endLine: 4, match: 'exact' });
  });

  it('returns null for a snippet that is not in the file', () => {
    expect(locateSnippet(lines, 'const nothing = "here at all";', 3)).toBeNull();
  });

  it('returns null when the lines exist but not contiguously', () => {
    // Both lines are real, and in this order — but 40 lines apart, so a snippet
    // stitched from two corners of the file must not pass.
    const stitched = "import { db } from './db.js';\nreturn rows[0];";
    expect(locateSnippet(lines, stitched, 1)).toBeNull();
  });

  it('picks the occurrence nearest the claimed line when a snippet repeats', () => {
    const repeated = 'const rows = await db.select().from(tasks);';
    expect(locateSnippet(lines, repeated, 4)?.startLine).toBe(4);
    expect(locateSnippet(lines, repeated, 9)?.startLine).toBe(9);
  });

  it('returns null on an empty snippet', () => {
    expect(locateSnippet(lines, '   \n  \n', 1)).toBeNull();
  });
});

describe('resolveInRoot', () => {
  it('resolves a repo-relative path inside the clone', () => {
    expect(resolveInRoot(ROOT, 'src/app.ts')).toBe(`${ROOT}${sep}src${sep}app.ts`);
  });

  it('refuses to escape the clone root', () => {
    expect(resolveInRoot(ROOT, '../../etc/passwd')).toBeNull();
    expect(resolveInRoot(ROOT, 'src/../../../secrets.json')).toBeNull();
  });

  it('refuses absolute paths, the root itself, and NUL bytes', () => {
    expect(resolveInRoot(ROOT, `${sep}etc${sep}passwd`)).toBeNull();
    expect(resolveInRoot(ROOT, '.')).toBeNull();
    expect(resolveInRoot(ROOT, 'src/app\0.ts')).toBeNull();
    expect(resolveInRoot(ROOT, '')).toBeNull();
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    // `${ROOT}-backup` starts with ROOT as a string but is a different directory.
    expect(resolveInRoot(ROOT, '../acme-backup/secrets.ts')).toBeNull();
  });
});

describe('verifyClaim', () => {
  const path = 'src/tasks.ts';
  const absolute = `${ROOT}${sep}src${sep}tasks.ts`;
  const read = readerFor({ [absolute]: FILE });

  it('returns the file’s own text, not the text the model re-typed', async () => {
    const verified = await verifyClaim(
      ROOT,
      // Model re-indented it and lost the two leading spaces.
      { path, start_line: 5, snippet: 'return rows;' },
      read,
    );
    expect(verified?.snippet).toBe('  return rows;');
    expect(verified?.start_line).toBe(5);
    expect(verified?.end_line).toBe(5);
  });

  it('drops a claim whose file is missing from the clone', async () => {
    const verified = await verifyClaim(
      ROOT,
      { path: 'src/deleted.ts', start_line: 1, snippet: 'const rows = await db.select();' },
      read,
    );
    expect(verified).toBeNull();
  });

  it('drops a claim that tries to escape the clone', async () => {
    const verified = await verifyClaim(
      ROOT,
      { path: '../../../etc/passwd', start_line: 1, snippet: 'root:x:0:0:root:/root:/bin/bash' },
      readerFor({ '/etc/passwd': 'root:x:0:0:root:/root:/bin/bash' }),
    );
    expect(verified).toBeNull();
  });

  it('drops a binary file however plausible the snippet', async () => {
    const binary = `PK\0const rows = await db.select().from(tasks);`;
    const verified = await verifyClaim(
      ROOT,
      { path, start_line: 1, snippet: 'const rows = await db.select().from(tasks);' },
      readerFor({ [absolute]: binary }),
    );
    expect(verified).toBeNull();
  });

  it('drops a file past the size ceiling without searching it', async () => {
    const huge = `${'x'.repeat(MAX_VERIFY_FILE_BYTES + 1)}\nconst rows = await db.select();`;
    const verified = await verifyClaim(
      ROOT,
      { path, start_line: 2, snippet: 'const rows = await db.select();' },
      readerFor({ [absolute]: huge }),
    );
    expect(verified).toBeNull();
  });

  it('drops a trivial snippet even though it is genuinely in the file', async () => {
    // `}` is on line 6. Accepting it would make verification meaningless.
    const verified = await verifyClaim(ROOT, { path, start_line: 6, snippet: '}' }, read);
    expect(verified).toBeNull();
  });
});

describe('verifyClaims', () => {
  const path = 'src/tasks.ts';
  const absolute = `${ROOT}${sep}src${sep}tasks.ts`;
  const read = readerFor({ [absolute]: FILE });

  it('counts every claim that pointed at nothing', async () => {
    const result = await verifyClaims(
      ROOT,
      [
        { path, start_line: 5, snippet: 'return rows;' },
        { path, start_line: 1, snippet: 'const invented = true;' },
        { path: 'src/gone.ts', start_line: 1, snippet: 'export function gone() {}' },
      ],
      read,
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.dropped).toBe(2);
  });

  it('collapses two citations of the same place into one proof', async () => {
    const result = await verifyClaims(
      ROOT,
      [
        { path, start_line: 5, snippet: 'return rows;' },
        { path, start_line: 6, snippet: '  return rows;  ' },
      ],
      read,
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('leaves a candidate with nothing when no claim survives', async () => {
    const result = await verifyClaims(
      ROOT,
      [{ path, start_line: 3, snippet: 'const fabricated = "rule";' }],
      read,
    );
    expect(result.evidence).toEqual([]);
    expect(result.dropped).toBe(1);
  });
});
