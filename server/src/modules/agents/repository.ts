import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

/**
 * One sampled `done` run, carrying only what a run estimate is computed from.
 *
 * Both figures stay nullable all the way to the reduction: `duration_ms` and
 * `cost_usd` are nullable columns, and `cost_usd`'s own doc-comment on the table
 * says what the two values mean — `null` = no cost data at all, `0` = a
 * genuinely free model. Defaulting either to zero here would erase that
 * distinction before anything could read it.
 */
export interface AgentRunSampleRow {
  agentId: string;
  durationMs: number | null;
  costUsd: number | null;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  /**
   * Every agent id in the workspace, ascending — a TOTAL order, so two reads of
   * an unchanged workspace return the rows in the same sequence.
   *
   * Narrower than `list()` on purpose: the estimates read needs the id and
   * nothing else, and `agents` carries a system prompt per row.
   */
  async listAgentIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.id));
    return rows.map((r) => r.id);
  }

  /**
   * The `perAgent` most recent `done` runs of every agent in the workspace,
   * newest first within each agent — the sample a run estimate is computed over.
   *
   * **Across the whole workspace and every pull request**, deliberately: the
   * estimate answers "what does this agent usually take", not "what did it take
   * here", so it is scoped by workspace and by nothing else. Failed and
   * cancelled runs are excluded, so they move no mean.
   *
   * Raw SQL rather than the query builder because there is no portable per-group
   * `LIMIT 1..N` in Drizzle's builder — the same reason `pulls/latest.ts`
   * over-fetches and collapses in JS. The window function is the cheaper half of
   * that trade: it bounds what crosses the wire to `agents × perAgent` rows
   * instead of every `done` run the workspace has ever made. The reduction that
   * turns these rows into means still applies its own `perAgent` cut — the SQL
   * bound is a transfer budget, `AGENT_ESTIMATE_SAMPLE_SIZE` in the service is
   * the rule of record, and both read that one constant.
   *
   * `agent_id IS NOT NULL` is load-bearing, not tidiness: the column is
   * `ON DELETE SET NULL`, so a run whose agent was deleted survives with a null
   * `agent_id`, and `PARTITION BY agent_id` would collapse every such row across
   * every deleted agent into one partition (`server/INSIGHTS.md`, 2026-08-03).
   * Those runs belong to no agent this read reports on, so they are dropped
   * before the partition exists.
   *
   * Fully parameterised, and no `Date` is interpolated — postgres-js rejects one
   * inside a raw template at runtime, swallowed into a generic 500
   * (`server/INSIGHTS.md`, 2026-08-05).
   */
  async recentDoneRunSamples(
    workspaceId: string,
    perAgent: number,
  ): Promise<AgentRunSampleRow[]> {
    const rows = await this.db.execute<{
      agent_id: string;
      duration_ms: number | null;
      cost_usd: number | null;
    }>(sql`
      SELECT r.agent_id AS agent_id, r.duration_ms AS duration_ms, r.cost_usd AS cost_usd
      FROM (
        SELECT
          agent_id,
          duration_ms,
          cost_usd,
          row_number() OVER (
            PARTITION BY agent_id
            ORDER BY ran_at DESC, id DESC
          ) AS rn
        FROM agent_runs
        WHERE workspace_id = ${workspaceId}
          AND status = 'done'
          AND agent_id IS NOT NULL
      ) r
      WHERE r.rn <= ${perAgent}
      ORDER BY r.agent_id ASC, r.rn ASC
    `);

    return [...rows].map((row) => ({
      agentId: row.agent_id,
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
    }));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      // Name breaks ties. `agent_skills` has a PK on (agent_id, skill_id) but
      // nothing stopping two rows sharing an `order`, and `setSkills` is not the
      // only writer — `linkSkill` takes an explicit order, and the seed inserts
      // at fixed indices. Ordering by `order` alone would then leave the sequence
      // of those rows up to Postgres, i.e. the SKILL BLOCK IN THE PROMPT could
      // differ between two runs of the same agent with no change to anything.
      .orderBy(asc(t.agentSkills.order), asc(t.skills.name));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   *
   * Transactional: without it, a failing insert leaves the agent with NO skills
   * at all rather than its previous set — the delete has already committed. A
   * reorder is the most frequent call here, so a silent wipe is the worst
   * plausible outcome.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (skillIds.length === 0) return;
      await tx
        .insert(t.agentSkills)
        .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
    });
  }

  /**
   * Of `skillIds`, those that exist in `workspaceId`.
   *
   * `agent_skills` has an FK to `skills` but no workspace column of its own, so
   * the database will happily link an agent to another tenant's skill — whose
   * body would then be injected into this workspace's prompts. The service
   * checks this before every link/reorder write.
   */
  async skillIdsInWorkspace(workspaceId: string, skillIds: string[]): Promise<Set<string>> {
    if (skillIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return new Set(rows.map((r) => r.id));
  }
}
