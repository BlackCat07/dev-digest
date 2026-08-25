import type { CiInstallation, CiRun, RepoRef } from '@devdigest/shared';
import { CI_AGENTS_DIR, CI_SKILLS_DIR } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { ALLOWED_TRIGGER_TYPES, type AllowedTriggerType } from './constants.js';
import type { StoredCiInstallationWithRun, StoredCiRun } from './types.js';

/**
 * Pure helpers: the slug rule, the `owner/name` parse, the trigger intersection
 * and the two Row → DTO mappers.
 *
 * Everything here is a total function of its arguments — no clock, no I/O, no
 * container — which is what lets `ci-generate.test.ts` drive most of this module
 * with no fakes at all.
 */

/** `owner/name`, GitHub's own charset, and no path segment that could escape it. */
const REPO_SEGMENT = '[A-Za-z0-9._-]+';
export const REPO_PATTERN = new RegExp(`^${REPO_SEGMENT}/${REPO_SEGMENT}$`);

/**
 * Split `owner/name` into a {@link RepoRef}, refusing anything else.
 *
 * The route's schema already rejects a malformed value before the handler runs;
 * this is the second gate, and it is not decoration — the two halves reach a URL
 * path, a commit message and a pull-request body, so `..` and `/` are the two
 * things that must not survive. The segment charset is an allow-list rather than
 * a deny-list for that reason, and `.` / `..` are refused explicitly because both
 * match it.
 */
export function parseRepo(repo: string): RepoRef {
  if (!REPO_PATTERN.test(repo)) {
    throw new ValidationError(`Repository must be "owner/name": got "${repo}"`);
  }
  const [owner, name] = repo.split('/');
  if (owner === undefined || name === undefined) {
    throw new ValidationError(`Repository must be "owner/name": got "${repo}"`);
  }
  for (const segment of [owner, name]) {
    if (segment === '.' || segment === '..') {
      throw new ValidationError(`Repository must be "owner/name": got "${repo}"`);
    }
  }
  return { owner, name };
}

/**
 * A name reduced to a filename-safe slug.
 *
 * There is no `slug` column on `agents` or on `skills` and no slugify anywhere in
 * this tree, so the rule lives here: lowercase, every run of non-alphanumerics to
 * a single `-`, trimmed. A name that reduces to nothing (an emoji, a CJK title)
 * is a NAMED failure rather than a file called `.md` — the export is a commit
 * into somebody else's repository and a silent empty path is not recoverable
 * from there.
 *
 * Two agents whose names slugify alike collide, and that is accepted for v1: the
 * second export overwrites the first's manifest.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw new ValidationError(
      `"${name}" contains no characters that can form a file name; rename it before exporting`,
    );
  }
  return slug;
}

/** `.devdigest/agents/<agent-slug>.yaml` */
export function manifestPath(agentSlug: string): string {
  return `${CI_AGENTS_DIR}/${agentSlug}.yaml`;
}

/** `.devdigest/skills/<skill-slug>.md` */
export function skillPath(skillSlug: string): string {
  return `${CI_SKILLS_DIR}/${skillSlug}.md`;
}

/**
 * The requested triggers, intersected with the three `pull_request` activity
 * types this feature supports, falling back to all three when the intersection
 * is empty (AC-10).
 *
 * The fallback is not laxity: an empty `types:` list subscribes a workflow to
 * every activity type GitHub has, which is strictly wider than the default. The
 * order is this module's, not the caller's, so two requests differing only in
 * argument order generate byte-identical files.
 */
export function resolveTriggerTypes(requested: readonly string[]): AllowedTriggerType[] {
  const asked = new Set(requested);
  const matched = ALLOWED_TRIGGER_TYPES.filter((t) => asked.has(t));
  return matched.length > 0 ? [...matched] : [...ALLOWED_TRIGGER_TYPES];
}

/** UTF-8 byte length of a string, for the bundle budget. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * A stored installation, plus its latest run, as the CI tab reads it.
 *
 * `last_run_status` and `last_run_at` are `null` for an installation that has
 * never run — the ordinary first state, and the one the tab exists to show.
 */
export function toInstallationDto(row: StoredCiInstallationWithRun): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    last_run_status: row.lastRunStatus,
    last_run_at: row.lastRunAt === null ? null : row.lastRunAt.toISOString(),
  };
}

/**
 * A stored run as the CI Runs list serves it.
 *
 * Every one of AC-28's nine fields is written explicitly and defaults to `null`,
 * never left off: `undefined` disappears in JSON serialization, so a field the
 * mapper forgot and a field the run genuinely lacks would be indistinguishable
 * on the wire.
 */
export function toRunDto(row: StoredCiRun): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt === null ? null : row.ranAt.toISOString(),
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agent,
    duration_s: row.durationS,
    repo: row.repo,
    head_sha: row.headSha,
    blockers: row.blockers,
    reason: row.reason,
  };
}
