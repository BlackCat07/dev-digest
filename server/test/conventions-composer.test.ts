import { describe, it, expect } from 'vitest';
import type { ExtractedConvention } from '@devdigest/shared';
import {
  composeSkill,
  fenceFor,
  fenceLang,
  repoSlug,
  renderRule,
  ruleSlug,
} from '../src/modules/conventions/composer.js';

/** Accepted candidates → skill text. Pure string assembly, no I/O. */

function candidate(patch: Partial<ExtractedConvention> = {}): ExtractedConvention {
  return {
    id: 'c1',
    category: 'async',
    rule: 'Repository functions await the query builder rather than chaining .then()',
    rationale: 'Every repo module awaits; only src/legacy/client.ts chains.',
    evidence: [
      {
        path: 'src/modules/tasks/repo.ts',
        start_line: 5,
        end_line: 5,
        snippet: '  const rows = await db.select().from(tasks);',
        match: 'shifted',
      },
    ],
    confidence: 0.987,
    adherence: { conforming: 312, violating: 4 },
    status: 'accepted',
    edited: false,
    skill_id: null,
    created_at: '2026-08-06T10:00:00.000Z',
    ...patch,
  };
}

describe('repoSlug', () => {
  it('takes the repository name, not the owner', () => {
    expect(repoSlug('acme/payments-api')).toBe('payments-api');
    expect(repoSlug('BlackCat07/typescriptdemo')).toBe('typescriptdemo');
  });
});

describe('ruleSlug', () => {
  it('slugifies a rule into a heading id', () => {
    expect(ruleSlug('Always use async/await instead of .then() chains')).toBe(
      'always-use-async-await-instead-of-then-chains',
    );
  });

  it('cuts a long rule on a word boundary rather than mid-word', () => {
    const slug = ruleSlug(
      'Repository functions must always accept the workspace identifier as their first parameter',
      48,
    );
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).not.toMatch(/[^a-z0-9-]/);
  });

  it('never returns an empty heading id', () => {
    expect(ruleSlug('!!! ???')).toBe('rule');
  });
});

describe('fenceLang', () => {
  it('maps the extensions this scanner can sample', () => {
    expect(fenceLang('src/a.ts')).toBe('ts');
    expect(fenceLang('src/a.tsx')).toBe('tsx');
    expect(fenceLang('src/a.mjs')).toBe('js');
    expect(fenceLang('Makefile')).toBe('');
  });
});

describe('fenceFor', () => {
  it('uses three backticks for ordinary code', () => {
    expect(fenceFor('const a = 1;')).toBe('```');
  });

  it('grows past a backtick run inside the snippet', () => {
    // Real source contains template literals and markdown examples. A fixed
    // fence would be closed early and the rest of the skill body would leak out
    // of the code block, into the reviewer's prompt as prose.
    // A lone backtick needs no growth — three is already the floor.
    expect(fenceFor('const q = `select 1`;')).toBe('```');
    expect(fenceFor('```ts\nconst a = 1;\n```')).toBe('````');
    expect(fenceFor('````\nnested\n````')).toBe('`````');
  });
});

describe('renderRule', () => {
  it('states the rule, its rationale, and where the exceptions are', () => {
    const rendered = renderRule(candidate());
    expect(rendered).toContain('## repository-functions-await-the-query-builder');
    expect(rendered).toContain('rather than chaining .then()');
    expect(rendered).toContain('Followed in 312 of 316 places in this repository.');
  });

  it('cites a real file and line, and quotes the file’s own text', () => {
    const rendered = renderRule(candidate());
    expect(rendered).toContain('Detected in `src/modules/tasks/repo.ts:5`:');
    expect(rendered).toContain('  const rows = await db.select().from(tasks);');
  });

  it('renders a multi-line citation as a range', () => {
    const rendered = renderRule(
      candidate({
        evidence: [
          {
            path: 'src/a.ts',
            start_line: 4,
            end_line: 9,
            snippet: 'export function a() {\n  return 1;\n}',
            match: 'exact',
          },
        ],
      }),
    );
    expect(rendered).toContain('`src/a.ts:4-9`');
  });

  it('omits the adherence line when the rule could not be measured', () => {
    // Silence is honest here. "Followed in 0 of 0 places" would read as a
    // measurement that failed rather than one that was never possible.
    const rendered = renderRule(candidate({ adherence: null }));
    expect(rendered).not.toContain('Followed in');
  });

  it('states no severity — the agent’s own rubric owns that', () => {
    const rendered = renderRule(candidate());
    expect(rendered).not.toMatch(/CRITICAL|WARNING|SUGGESTION/);
  });
});

describe('composeSkill', () => {
  const two = [
    candidate(),
    candidate({
      id: 'c2',
      category: 'imports',
      rule: 'Relative imports carry an explicit .js extension',
      rationale: 'ESM resolution needs it.',
      adherence: { conforming: 210, violating: 1 },
      evidence: [
        {
          path: 'src/modules/users/repo.ts',
          start_line: 1,
          end_line: 1,
          snippet: "import { db } from '../../db/client.js';",
          match: 'exact',
        },
      ],
    }),
  ];

  it('writes nothing when nothing was accepted', () => {
    // The caller can then say "nothing accepted" rather than creating an empty
    // skill that an agent would carry for no reason.
    expect(composeSkill('acme/payments-api', [])).toBeNull();
  });

  it('merges every candidate into one skill named after the repo', () => {
    const skill = composeSkill('acme/payments-api', two);
    expect(skill!.name).toBe('payments-api-conventions');
    expect(skill!.description).toBe('2 house conventions extracted from payments-api');
    expect(skill!.body).toContain('# payments-api-conventions');
    expect(skill!.body).toContain('Repository functions await');
    expect(skill!.body).toContain('Relative imports carry an explicit .js extension');
    expect(skill!.candidateIds).toEqual(['c1', 'c2']);
  });

  it('collects the distinct cited files for the skill’s evidence list', () => {
    const skill = composeSkill('acme/payments-api', two);
    expect(skill!.evidenceFiles).toEqual([
      'src/modules/tasks/repo.ts',
      'src/modules/users/repo.ts',
    ]);
  });

  it('honours a caller-supplied name and description', () => {
    const skill = composeSkill('acme/payments-api', two, {
      name: 'house-rules',
      description: 'What we actually do',
    });
    expect(skill!.name).toBe('house-rules');
    expect(skill!.description).toBe('What we actually do');
    expect(skill!.body).toContain('# house-rules');
  });

  it('never splits the accepted candidates on their category', () => {
    // The per-category shape was removed: grouping is the user's decision,
    // expressed by which candidates they accept, not a machine split on the
    // taxonomy. One call writes one skill carrying everything sent to it.
    const skill = composeSkill('acme/payments-api', two);
    expect(skill!.body).toContain('await the query builder');
    expect(skill!.body).toContain('Relative imports');
    expect(skill!.name).not.toContain('async');
  });

  it('uses the singular in a one-rule description', () => {
    const skill = composeSkill('acme/payments-api', [candidate()]);
    expect(skill!.description).toBe('1 house convention extracted from payments-api');
  });

  it('tells the reviewer that a partially-followed rule has exceptions', () => {
    // Without this the model treats every rule as absolute and reports each of
    // the four known exceptions as a defect.
    const skill = composeSkill('acme/payments-api', two);
    expect(skill!.body).toContain('has exceptions here');
  });
});
