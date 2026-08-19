import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { CONTEXT_ROOTS_SETTING_KEY } from './constants.js';
import type {
  AttachmentRepoName,
  AttachmentRow,
  ContextRepoRow,
  InheritedAttachmentRow,
  ProjectContextStore,
} from './types.js';

/**
 * L05 — project-context data-access. The ONLY file in this module that touches
 * `db/schema` and `drizzle-orm`; everything above it sees `ProjectContextStore`.
 *
 * It owns queries against FIVE tables and reaches into no sibling module to get
 * them. `repos`, `agents`, `skills` and `agent_skills` already have repositories
 * elsewhere (`modules/repos/`, `modules/agents/`), and importing one of those
 * would be a `no-cross-module-internals` violation that `import type` does not
 * exempt (`server/INSIGHTS.md`, 2026-08-14). The queries here are deliberately
 * narrower than those repositories' — an existence check rather than a row, the
 * four columns the clone path needs rather than `select()` — so no Drizzle row
 * type leaves this ring either.
 *
 * WORKSPACE SCOPING IS THE AUTHORIZATION CHECK. Neither attachment table carries
 * a `workspace_id`: an agent is scoped through `agents`, a skill through
 * `skills`, and a document path through `repos`. Every method that can be
 * reached from a request therefore takes a `workspaceId` and joins for it, and
 * the service calls one of those FIRST (AC-12).
 */
export class ProjectContextRepository implements ProjectContextStore {
  constructor(private readonly db: Db) {}

  /**
   * The workspace's `context_roots` preference, exactly as stored.
   *
   * Returned as `unknown` on purpose. The key rides the `passthrough()` on the
   * `Settings` contract rather than being a `SettingsKnown` field, so nothing
   * has ever validated its shape; the service `safeParse`s it and falls back to
   * the defaults rather than trusting a jsonb column to hold `string[]`.
   *
   * `settings` is keyed `(workspace_id, user_id, key)` and `user_id` is
   * nullable, so a workspace can legitimately hold more than one row for a key.
   * The first non-null value wins, which matches how `SettingsRepository` reads
   * the whole workspace's rows without distinguishing the owner.
   */
  async getContextRootsSetting(workspaceId: string): Promise<unknown> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(
        and(
          eq(t.settings.workspaceId, workspaceId),
          eq(t.settings.key, CONTEXT_ROOTS_SETTING_KEY),
        ),
      );
    return rows.find((r) => r.value !== null)?.value ?? null;
  }

  async getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The same row without a workspace filter, for the run path only.
   *
   * The caller there is the review executor, which already resolved the pull
   * request through its own workspace scope; the repository id it passes is the
   * PR's own. No route reaches this method.
   */
  async getRepoById(repoId: string): Promise<ContextRepoRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  async agentExists(workspaceId: string, agentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .limit(1);
    return rows.length > 0;
  }

  async skillExists(workspaceId: string, skillId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Every document attached to this agent, across every repository.
   *
   * Ordered `(repo_id, order, path)`, and the trailing `path` is not decoration:
   * `order` is writer-assigned and nothing stops two rows sharing one, so
   * ordering by it alone would leave the rest of the sequence up to Postgres —
   * which for this feature means the DOCUMENT ORDER IN THE PROMPT could differ
   * between two runs of the same agent with nothing changed. `agent_skills`
   * carries the same tiebreaker for the same reason.
   */
  listAgentAttachments(agentId: string): Promise<AttachmentRow[]> {
    return this.db
      .select({
        repoId: t.agentContextDocs.repoId,
        path: t.agentContextDocs.path,
        order: t.agentContextDocs.order,
      })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(
        asc(t.agentContextDocs.repoId),
        asc(t.agentContextDocs.order),
        asc(t.agentContextDocs.path),
      );
  }

  /** As {@link listAgentAttachments}, for a skill. */
  listSkillAttachments(skillId: string): Promise<AttachmentRow[]> {
    return this.db
      .select({
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(
        asc(t.skillContextDocs.repoId),
        asc(t.skillContextDocs.order),
        asc(t.skillContextDocs.path),
      );
  }

  /**
   * The documents this agent inherits from the skills linked to it (AC-19).
   *
   * `enabled` is SELECTED, not filtered on. A disabled skill contributes nothing
   * to a run, but that is a rule of the effective set rather than of the
   * storage, so it lives in `mergeEffectiveAttachments` — a pure function that
   * can be proved without a database, which on this run is the only kind of test
   * there is. The cost is a handful of extra rows on an agent with disabled
   * skills. `used_by_agents` deliberately ignores the flag altogether — see
   * {@link countAgentsByPath}.
   *
   * Ordering mirrors `AgentsRepository.linkedSkills`: link order, then the
   * skill's name as the tiebreaker `order` alone cannot provide, then the
   * document's own order within that skill and its path.
   */
  listInheritedAttachments(agentId: string): Promise<InheritedAttachmentRow[]> {
    return this.db
      .select({
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
        skillId: t.skills.id,
        skillName: t.skills.name,
        linkOrder: t.agentSkills.order,
        enabled: t.skills.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .innerJoin(t.skillContextDocs, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(
        asc(t.agentSkills.order),
        asc(t.skills.name),
        asc(t.skillContextDocs.order),
        asc(t.skillContextDocs.path),
      );
  }

  /**
   * Replace this agent's documents FOR ONE REPOSITORY with `paths`, in order.
   *
   * Transactional for the reason `AgentsRepository.setSkills` states in its own
   * comment: without it a failing insert leaves the owner with NO documents at
   * all rather than its previous set, because the delete has already committed —
   * and a reorder is the most frequent call here, so a silent wipe is the worst
   * plausible outcome.
   *
   * Scoped to `repoId`, which is the whole reason the write takes one: rows this
   * agent holds against its OTHER repositories are untouched. The tab that sends
   * this is open on one repository and can neither show nor intend the set a
   * global replace would erase.
   */
  async setAgentAttachments(agentId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentContextDocs)
        .where(
          and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, i) => ({ agentId, repoId, path, order: i })));
    });
  }

  /** As {@link setAgentAttachments}, for a skill (AC-15). */
  async setSkillAttachments(skillId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextDocs)
        .where(
          and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, i) => ({ skillId, repoId, path, order: i })));
    });
  }

  /**
   * AC-26 — per path, the number of DISTINCT agents whose effective set contains
   * it, counting an agent that reaches it through a disabled skill (EC-25).
   *
   * One statement, and the `UNION` is load-bearing rather than stylistic: an
   * agent may hold a document directly AND inherit the same path through a
   * skill, and two grouped counts added together would report it twice. `UNION`
   * (not `UNION ALL`) deduplicates the (path, agent) pairs before the count, so
   * the figure is "how many agents would notice this document's removal" —
   * exactly the question the column answers.
   *
   * Written as raw SQL rather than the query builder because that dedup needs a
   * set operation as a subquery, which is the same reason
   * `repo-intel/repository.ts` reaches for `db.execute`. Fully parameterised:
   * both bindings are uuids, and no `Date` is interpolated (postgres-js rejects
   * one inside a raw template — `server/INSIGHTS.md`, 2026-08-05).
   *
   * `::int` is required: `count()` is `bigint`, which postgres-js hands back as
   * a string.
   *
   * NO `skills.enabled` filter here, deliberately, and it is the one place this
   * module leaves it out: the count answers "would removing this document affect
   * anyone", not "is it in flight right now", so it can legitimately disagree
   * with what a given run carries.
   */
  async countAgentsByPath(workspaceId: string, repoId: string): Promise<Map<string, number>> {
    const rows = await this.db.execute<{ path: string; n: number }>(sql`
      SELECT pairs.path AS path, count(DISTINCT pairs.agent_id)::int AS n
      FROM (
        SELECT d.path AS path, d.agent_id AS agent_id
        FROM agent_context_docs d
        JOIN agents a ON a.id = d.agent_id
        WHERE d.repo_id = ${repoId} AND a.workspace_id = ${workspaceId}
        UNION
        SELECT sd.path AS path, link.agent_id AS agent_id
        FROM skill_context_docs sd
        JOIN agent_skills link ON link.skill_id = sd.skill_id
        JOIN agents a ON a.id = link.agent_id
        WHERE sd.repo_id = ${repoId} AND a.workspace_id = ${workspaceId}
      ) pairs
      GROUP BY pairs.path
    `);

    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.path, Number(row.n));
    return counts;
  }

  /**
   * The full names of the repositories `repoIds` addresses.
   *
   * Only AC-22 needs this: a document skipped because it belongs to another
   * repository has to be logged with that repository named, so a document
   * silently absent from a review is never indistinguishable from one that was
   * never attached.
   */
  async repoNames(repoIds: string[]): Promise<AttachmentRepoName[]> {
    if (repoIds.length === 0) return [];
    return this.db
      .select({ repoId: t.repos.id, fullName: t.repos.fullName })
      .from(t.repos)
      .where(inArray(t.repos.id, repoIds));
  }
}
