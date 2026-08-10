import type { Skill, SkillSource, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { FALLBACK_IMPORTED_SKILL_NAME, TRUSTED_SKILL_SOURCES } from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping, the version-bump rule,
 * and name derivation for imports. No I/O.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill's BODY.
 *
 * Deliberately narrower than the agents rule (`isConfigChange`), which bumps on
 * any config field: a skill version exists so a past eval stays reproducible
 * against the exact text it scored, and only the body is that text. Renaming a
 * skill, retyping it, or toggling it must NOT create a version — otherwise the
 * history fills with entries whose body is byte-identical to the one before.
 */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/** Whether this skill's body may be placed in a prompt as trusted instructions. */
export function isTrustedSource(source: string): boolean {
  return TRUSTED_SKILL_SOURCES.includes(source as SkillSource);
}

/**
 * Derive a skill name from the first markdown ATX heading in `body`, falling
 * back to a constant. Slugified, because names render in a mono font next to a
 * `.md` filename and the design shows them as slugs (`pr-quality-rubric`).
 *
 * Setext headings (`Title\n=====`) are not recognised — the placeholder the UI
 * shows the user is `# Rule`, and supporting a second syntax would mean guessing
 * whether an arbitrary underlined line is a title.
 */
export function deriveSkillName(body: string): string {
  const heading = body.split('\n').find((line) => /^#{1,6}\s+\S/.test(line));
  if (!heading) return FALLBACK_IMPORTED_SKILL_NAME;
  const slug = heading
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || FALLBACK_IMPORTED_SKILL_NAME;
}

/**
 * A rate as 0..1, or null when the denominator is zero.
 *
 * Null is not 0: "no run has ever carried this skill" and "every run that
 * carried it was rejected" are different facts, and the UI renders them
 * differently ("—" vs "0%").
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}
