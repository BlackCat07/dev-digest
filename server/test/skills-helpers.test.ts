import { describe, it, expect } from 'vitest';
import {
  deriveSkillName,
  isBodyChange,
  isTrustedSource,
  rate,
} from '../src/modules/skills/helpers.js';
import { FALLBACK_IMPORTED_SKILL_NAME } from '../src/modules/skills/constants.js';

/** Pure helpers behind the skills module — no DB, no app. */

describe('isBodyChange', () => {
  it('is true only when the body differs', () => {
    expect(isBodyChange({ body: 'a' }, { body: 'b' })).toBe(true);
    expect(isBodyChange({ body: 'a' }, { body: 'a' })).toBe(false);
    expect(isBodyChange({ body: 'a' }, {})).toBe(false);
  });

  it('treats whitespace as a real change', () => {
    // A trailing newline changes the text the model receives, so the version
    // that an eval replays against must change with it.
    expect(isBodyChange({ body: '# R\n' }, { body: '# R' })).toBe(true);
  });
});

describe('deriveSkillName', () => {
  it('slugifies the first ATX heading', () => {
    expect(deriveSkillName('# PR Quality Rubric\n\ntext')).toBe('pr-quality-rubric');
    expect(deriveSkillName('#### Deep Heading')).toBe('deep-heading');
  });

  it('skips leading prose and blank lines to find the heading', () => {
    expect(deriveSkillName('\n\nsome intro\n\n## The Real Title\n')).toBe('the-real-title');
  });

  it('strips punctuation and collapses separators', () => {
    expect(deriveSkillName('# No `.then()` chains — house rule!')).toBe('no-then-chains-house-rule');
  });

  it('falls back when there is no usable heading', () => {
    expect(deriveSkillName('just prose, no heading')).toBe(FALLBACK_IMPORTED_SKILL_NAME);
    // `#` with no text, and a Setext heading, are both deliberately unsupported.
    expect(deriveSkillName('#\n#####\n')).toBe(FALLBACK_IMPORTED_SKILL_NAME);
    expect(deriveSkillName('Title\n=====\n')).toBe(FALLBACK_IMPORTED_SKILL_NAME);
    // A heading of pure punctuation slugifies to empty — must not return ''.
    expect(deriveSkillName('# ***')).toBe(FALLBACK_IMPORTED_SKILL_NAME);
  });

  it('does not treat a hash inside a fenced block as a heading', () => {
    // Not handled — documents the known limitation rather than pretending
    // otherwise. A body starting with a code fence yields the fenced comment.
    expect(deriveSkillName('```\n# not a title\n```')).toBe('not-a-title');
  });
});

describe('isTrustedSource', () => {
  it('trusts only a hand-written skill', () => {
    expect(isTrustedSource('manual')).toBe(true);
    for (const s of ['imported_url', 'community', 'extracted']) {
      expect(isTrustedSource(s)).toBe(false);
    }
  });
});

describe('rate', () => {
  it('returns null for a zero denominator rather than 0', () => {
    // "never ran" and "ran and scored zero" must not render the same.
    expect(rate(0, 0)).toBeNull();
    expect(rate(0, 4)).toBe(0);
  });

  it('divides otherwise', () => {
    expect(rate(3, 4)).toBe(0.75);
  });
});
