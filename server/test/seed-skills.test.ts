import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEED_SKILLS, IMPORTABLE_SEMVER_SKILL } from '../src/db/seed-skills.js';

/**
 * The built-in skill set, and the one member of it that lives on disk instead.
 *
 * These are cheap assertions over data, and they exist because every one of them
 * has a failure mode that is silent: a duplicate name that shadows a seed row, a
 * skill body that quietly redefines severity, and a file on disk that drifts
 * from the text it was extracted from.
 */

describe('SEED_SKILLS', () => {
  it('has unique names — the seed keys on them', () => {
    const names = SEED_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries the four L02 API-contract skills minus the importable one', () => {
    const names = SEED_SKILLS.map((s) => s.name);
    expect(names).toContain('api-route-removal');
    expect(names).toContain('api-response-schema');
    expect(names).toContain('api-deprecation-policy');
    // Seeding it would defeat the point of the import step.
    expect(names).not.toContain('api-semver-discipline');
  });

  it('never introduces a severity scale of its own', () => {
    // A body that said "High/Medium/Low" would be mapped onto the enum
    // inconsistently by the model and inflate severities across every agent it
    // is attached to (see docs/agent-prompts/README.md).
    for (const skill of SEED_SKILLS) {
      expect(skill.body).not.toMatch(/\b(?:High|Medium|Low)\s*(?:severity|priority)\b/i);
    }
  });

  it('never sets a findings quota', () => {
    // Models treat "return at most N findings" as a target and pad to hit it.
    for (const skill of SEED_SKILLS) {
      expect(skill.body).not.toMatch(/at most \d+ findings?/i);
      expect(skill.body).not.toMatch(/return \d+ findings?/i);
    }
  });
});

describe('the importable skill file', () => {
  it('is byte-identical to the exported body', () => {
    // Two copies of the same text, one of which a human imports. Nothing else
    // keeps them in step.
    const onDisk = readFileSync(
      new URL('../../docs/skills/api-semver-discipline.md', import.meta.url),
      'utf8',
    );
    expect(onDisk.trimEnd()).toBe(IMPORTABLE_SEMVER_SKILL.trimEnd());
  });

  it('leads with a heading, which is what the import derives its name from', () => {
    // `deriveSkillName` slugifies the first ATX heading; without one the skill
    // would land as "imported-skill".
    expect(IMPORTABLE_SEMVER_SKILL.split('\n')[0]).toMatch(/^#\s+\S/);
  });
});
