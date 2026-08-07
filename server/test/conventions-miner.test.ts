import { describe, it, expect } from 'vitest';
import {
  dominance,
  factsFor,
  formatFacts,
  mineFacts,
} from '../src/modules/conventions/miner.js';
import type { SampledFile } from '../src/modules/conventions/sampler.js';

/**
 * The deterministic counters that go into the prompt as facts. Pure — these take
 * file text and return numbers.
 */

function file(path: string, source: string): SampledFile {
  return { path, source, tokens: Math.ceil(source.length / 4) };
}

const AWAIT_HEAVY = [
  file(
    'src/modules/tasks/repo.ts',
    `import type { Task } from '@app/contracts/tasks.js';
import { db } from './client.js';

export async function listTasks(id: string) {
  const rows = await db.select().from(tasks);
  return rows;
}

export async function getTask(id: string) {
  const row = await db.select().from(tasks);
  return row;
}`,
  ),
  file(
    'src/modules/tasks/legacy.ts',
    `export function fetchTasks() {
  return client.get('/tasks').then((r) => r.data);
}`,
  ),
];

function factById(files: SampledFile[], id: string) {
  return mineFacts(files).find((f) => f.id === id);
}

describe('mineFacts', () => {
  it('returns nothing for an empty sample', () => {
    expect(mineFacts([])).toEqual([]);
  });

  it('counts await against .then() and orders the majority first', () => {
    // Two `await` expressions; `async` on the function heads is not one of them.
    const fact = factById(AWAIT_HEAVY, 'async.await-vs-then');
    expect(fact?.options[0]).toEqual({ label: 'await', count: 2 });
    expect(fact?.options[1]).toEqual({ label: '.then() chain', count: 1 });
  });

  it('counts named exports against default exports', () => {
    const files = [
      file('src/a.ts', 'export const a = 1;\nexport function b() {}\nexport class C {}'),
      file('src/b.ts', 'export default function d() {}'),
    ];
    const fact = factById(files, 'structure.named-vs-default-export');
    expect(fact?.options).toEqual([
      { label: 'named export', count: 3 },
      { label: 'default export', count: 1 },
    ]);
  });

  it('separates type-only imports from value imports using the real parser', () => {
    const files = [
      file(
        'src/a.ts',
        `import type { Task } from '@app/contracts/tasks.js';
import { db } from './client.js';
import { type Row, helper } from './helpers.js';`,
      ),
    ];
    const fact = factById(files, 'imports.type-only');
    expect(fact?.options).toEqual([
      { label: 'import type', count: 2 },
      { label: 'plain import', count: 2 },
    ]);
  });

  it('counts extensioned relative imports, which is an ESM house rule', () => {
    const files = [
      file(
        'src/a.ts',
        `import { a } from './a.js';
import { b } from './b.js';
import { c } from './c';`,
      ),
    ];
    const fact = factById(files, 'imports.relative-extension');
    expect(fact?.options).toEqual([
      { label: 'explicit .js/.ts extension', count: 2 },
      { label: 'no extension', count: 1 },
    ]);
  });

  it('prefers an injected logger over console when both appear', () => {
    const files = [
      file('src/a.ts', 'req.log.info("a");\nlogger.warn("b");\nconsole.log("c");'),
    ];
    const fact = factById(files, 'logging.console-vs-logger');
    expect(fact?.options).toEqual([
      { label: 'injected logger', count: 2 },
      { label: 'console.*', count: 1 },
    ]);
  });

  it('classifies file names by case', () => {
    const files = [
      file('src/a/simple-git.ts', 'export const a = 1;'),
      file('src/a/diff-parser.ts', 'export const b = 1;'),
      file('src/a/SkillCard.tsx', 'export const c = 1;'),
    ];
    const fact = factById(files, 'naming.file-case');
    expect(fact?.options).toEqual([
      { label: 'kebab-case', count: 2 },
      { label: 'camelCase or PascalCase', count: 1 },
    ]);
  });

  it('drops a comparison where nothing at all was observed', () => {
    // No logging call of either kind — the fact would say nothing, so it is not
    // offered to the model as if it were evidence of a preference.
    const files = [file('src/a.ts', 'export const a = 1;')];
    expect(factById(files, 'logging.console-vs-logger')).toBeUndefined();
  });
});

describe('dominance', () => {
  it('is the majority option’s share', () => {
    const fact = factById(AWAIT_HEAVY, 'async.await-vs-then')!;
    expect(dominance(fact)).toBeCloseTo(2 / 3);
  });
});

describe('factsFor', () => {
  it('narrows to one category, which is what each extraction call gets', () => {
    const facts = mineFacts(AWAIT_HEAVY);
    const asyncFacts = factsFor(facts, 'async');
    expect(asyncFacts.length).toBeGreaterThan(0);
    expect(asyncFacts.every((f) => f.category === 'async')).toBe(true);
  });
});

describe('formatFacts', () => {
  it('is empty when there is nothing measured, so the prompt gains no section', () => {
    expect(formatFacts([])).toBe('');
  });

  it('states raw counts rather than percentages', () => {
    const rendered = formatFacts(factsFor(mineFacts(AWAIT_HEAVY), 'async'));
    expect(rendered).toContain('await 2');
    expect(rendered).toContain('.then() chain 1');
    expect(rendered).not.toContain('%');
  });
});
