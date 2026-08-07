/** Constants for the skills module. */
import type { SkillSource, SkillType } from '@devdigest/shared';

/** Version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Type assigned when a skill is created or imported without one. */
export const DEFAULT_SKILL_TYPE: SkillType = 'custom';

/** Description stored when none is supplied (the column is NOT NULL). */
export const DEFAULT_SKILL_DESCRIPTION = '';

/** Name used when an import has no `name` and no leading markdown heading. */
export const FALLBACK_IMPORTED_SKILL_NAME = 'imported-skill';

/**
 * Source recorded for a file import.
 *
 * `SkillSource` is a frozen contract enum and none of its members says "from a
 * file"; `imported_url` is the one that means "arrived from outside this
 * workspace", which is the distinction the rest of the system acts on — it is
 * what makes {@link IMPORTED_SKILLS_START_DISABLED} apply and what makes the
 * body get delimiter-wrapped before it reaches a prompt. Do not read it as
 * "a URL was fetched"; nothing in L02 fetches one.
 */
export const IMPORTED_SKILL_SOURCE: SkillSource = 'imported_url';

/**
 * An imported skill lands disabled and must be vetted before an agent can use
 * it. The client copy promises exactly this ("Disabled until you vet + enable
 * it", "needs vetting"), and it is the only thing standing between an
 * attacker-authored markdown file and the reviewing model's context.
 */
export const IMPORTED_SKILLS_START_DISABLED = true;

/**
 * Sources whose bodies are delimiter-wrapped as untrusted data before being
 * placed in a prompt. Only a skill typed out by the user in this workspace is
 * treated as trusted instruction text.
 *
 * `extracted` is deliberately absent (L02): a convention skill's text was
 * phrased by a model reading repository files, so it is repo-derived data even
 * though this server assembled it.
 */
export const TRUSTED_SKILL_SOURCES: readonly SkillSource[] = ['manual'];

/**
 * Provenance for a skill the conventions extractor composed from this
 * workspace's own code. The `skills.source` enum already carried this member
 * before anything wrote it — L02 is its first producer.
 */
export const EXTRACTED_SKILL_SOURCE: SkillSource = 'extracted';

/** Type for a composed convention skill — the enum member named for exactly this. */
export const EXTRACTED_SKILL_TYPE: SkillType = 'convention';

/** Window for the "findings" figure on the Stats tab and skill cards. */
export const STATS_WINDOW_DAYS = 30;
