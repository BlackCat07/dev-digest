/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## Skills / rules', () => {
  it('renders the section between the PR description and the diff', () => {
    const user = userOf({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'PRBODY',
      skills: ['SKILL ONE'],
    });
    expect(user).toContain('## Skills / rules');
    expect(user).toContain('SKILL ONE');
    // Order is the contract: rules land before the material they judge, so the
    // model reads the rubric first and the diff second.
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Skills / rules'));
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Diff to review'));
  });

  it('joins several skills with a blank line, in the order given', () => {
    const user = userOf({ system: 'sys', diff: 'DIFF', skills: ['FIRST', 'SECOND', 'THIRD'] });
    expect(user).toContain('FIRST\n\nSECOND\n\nTHIRD');
    // Link order is the whole point of the reorder UI — it must survive here.
    expect(user.indexOf('FIRST')).toBeLessThan(user.indexOf('SECOND'));
    expect(user.indexOf('SECOND')).toBeLessThan(user.indexOf('THIRD'));
  });

  it('omits the section entirely when there are no skills', () => {
    for (const parts of [
      { system: 'sys', diff: 'DIFF' },
      { system: 'sys', diff: 'DIFF', skills: [] },
    ]) {
      const { messages, assembly } = assemblePrompt(parts);
      // An agent with no enabled skills must get a byte-identical prompt to the
      // pre-L02 one — not an empty heading.
      expect(messages[1]!.content).not.toContain('## Skills / rules');
      expect(assembly.skills).toBeNull();
    }
    expect(userOf({ system: 'sys', diff: 'DIFF' })).toBe(
      userOf({ system: 'sys', diff: 'DIFF', skills: [] }),
    );
  });

  it('does NOT wrap skill bodies — the caller decides what is trusted', () => {
    // A skill body arrives already wrapped when its source is untrusted (the
    // server does that in the skills service). Wrapping again here would
    // double-wrap a manual skill and make trusted rules read as data.
    const user = userOf({ system: 'sys', diff: 'DIFF', skills: ['PLAIN RULE'] });
    expect(user).toContain('## Skills / rules\nPLAIN RULE');
    expect(user).not.toContain('<untrusted source="skill');
  });

  it('records the assembled block in the trace for per-slot attribution', () => {
    const { assembly } = assemblePrompt({ system: 'sys', diff: 'DIFF', skills: ['A', 'B'] });
    expect(assembly.skills).toBe('A\n\nB');
  });
});
