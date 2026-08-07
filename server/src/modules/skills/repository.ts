import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION, STATS_WINDOW_DAYS } from './constants.js';

/**
 * Skills data-access. Owns `skills`, `skill_versions` and `run_skills`.
 *
 * It does NOT own `agent_skills`: that link table belongs to `AgentsRepository`
 * (link/reorder/list for one agent). This repository only ever READS it, to
 * answer "which agents use this skill" — writes stay on the agent side so there
 * is one owner of link ordering.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** Raw counts behind `SkillUsage`, before the rates are computed. */
export interface UsageCounts {
  usedBy: number;
  runsCarrying: number;
  runsByLinkedAgents: number;
  accepted: number;
  dismissed: number;
  findingsInWindow: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  // ---- skills -------------------------------------------------------------

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND record version 1 (the body snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. A changed BODY bumps `version` and snapshots the new text
   * into `skill_versions`; renames, retypes and enable-toggles do not.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    bodyChanged: boolean,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;
    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- run_skills (what a run actually carried) ---------------------------

  /** Record the skills a run carried. No-op for a run that carried none. */
  async recordRunSkills(
    runId: string,
    entries: Array<{ skillId: string; version: number; order: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(t.runSkills)
      .values(entries.map((e) => ({ runId, skillId: e.skillId, version: e.version, order: e.order })))
      .onConflictDoNothing();
  }

  // ---- stats --------------------------------------------------------------

  /** Agents currently linking this skill, in name order. */
  async agentsUsing(
    workspaceId: string,
    skillId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));
  }

  /**
   * The raw counts behind a skill's usage figures.
   *
   * Everything except `usedBy` is anchored on `run_skills`, never on the current
   * `agent_skills` links: joining runs to today's link set would retroactively
   * credit a skill with findings from runs made before it was attached.
   *
   * Findings are reached the only way the schema allows — `run_skills.run_id` →
   * `reviews.run_id` → `findings.review_id`; `findings` carries neither a run nor
   * a PR id.
   */
  async usageCounts(workspaceId: string, skillId: string): Promise<UsageCounts> {
    // Bound as an ISO string with an explicit cast, NOT as a Date: postgres-js
    // rejects a Date interpolated into a raw `sql` template ("The 'string'
    // argument must be of type string ... Received an instance of Date"), and the
    // failure surfaces as a 500 from the route, not as a type error.
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [[usedBy], [carrying], agentIds] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(t.agentSkills)
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId))),
      this.db
        .select({ n: count() })
        .from(t.runSkills)
        .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
        .where(
          and(
            eq(t.runSkills.skillId, skillId),
            eq(t.agentRuns.workspaceId, workspaceId),
            // Must match the denominator below, which counts completed runs only.
            // Counting a failed run here would report a pull rate above 100%.
            eq(t.agentRuns.status, 'done'),
          ),
        ),
      this.db
        .select({ id: t.agentSkills.agentId })
        .from(t.agentSkills)
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId))),
    ]);

    // Denominator for pull rate: every completed run by an agent that links this
    // skill today. A run by an agent that has since been deleted keeps its
    // run_skills row (agent_runs.agent_id is ON DELETE SET NULL) and so can push
    // the numerator above the denominator; clamp when computing the rate.
    const ids = agentIds.map((a) => a.id);
    const [byLinked] = ids.length
      ? await this.db
          .select({ n: count() })
          .from(t.agentRuns)
          .where(
            and(
              eq(t.agentRuns.workspaceId, workspaceId),
              inArray(t.agentRuns.agentId, ids),
              eq(t.agentRuns.status, 'done'),
            ),
          )
      : [{ n: 0 }];

    const [triage] = await this.db
      .select({
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`.mapWith(
          Number,
        ),
        dismissed:
          sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`.mapWith(
            Number,
          ),
        inWindow: sql<number>`count(*) filter (where ${t.agentRuns.ranAt} >= ${since}::timestamptz)`.mapWith(
          Number,
        ),
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.runSkills.skillId, skillId), eq(t.agentRuns.workspaceId, workspaceId)));

    return {
      usedBy: usedBy?.n ?? 0,
      runsCarrying: carrying?.n ?? 0,
      runsByLinkedAgents: byLinked?.n ?? 0,
      accepted: triage?.accepted ?? 0,
      dismissed: triage?.dismissed ?? 0,
      findingsInWindow: triage?.inWindow ?? 0,
    };
  }

  /** Findings by category across runs that carried this skill. */
  async findingsByCategory(
    workspaceId: string,
    skillId: string,
  ): Promise<Array<{ category: string; count: number }>> {
    const rows = await this.db
      .select({ category: t.findings.category, n: count() })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          isNotNull(t.findings.category),
        ),
      )
      .groupBy(t.findings.category)
      .orderBy(desc(count()));
    return rows.map((r) => ({ category: r.category, count: r.n }));
  }

  /**
   * Usage counts for EVERY skill in the workspace, for the list screen.
   *
   * Deliberately not `list().map(usageCounts)`: that is one round trip per card
   * and the list is the first screen a user lands on. These are three grouped
   * aggregates instead, keyed by skill id and stitched in the service.
   */
  async usageCountsForAll(workspaceId: string): Promise<Map<string, UsageCounts>> {
    // Bound as an ISO string with an explicit cast, NOT as a Date: postgres-js
    // rejects a Date interpolated into a raw `sql` template ("The 'string'
    // argument must be of type string ... Received an instance of Date"), and the
    // failure surfaces as a 500 from the route, not as a type error.
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [linkRows, carryRows, triageRows] = await Promise.all([
      this.db
        .select({ skillId: t.agentSkills.skillId, n: count() })
        .from(t.agentSkills)
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .where(eq(t.agents.workspaceId, workspaceId))
        .groupBy(t.agentSkills.skillId),
      this.db
        .select({ skillId: t.runSkills.skillId, n: count() })
        .from(t.runSkills)
        .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
        // Same 'done' filter as `usageCounts` — the two must agree or the list
        // card and the Stats tab show different pull rates for one skill.
        .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')))
        .groupBy(t.runSkills.skillId),
      this.db
        .select({
          skillId: t.runSkills.skillId,
          accepted:
            sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`.mapWith(
              Number,
            ),
          dismissed:
            sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`.mapWith(
              Number,
            ),
          inWindow: sql<number>`count(*) filter (where ${t.agentRuns.ranAt} >= ${since}::timestamptz)`.mapWith(
            Number,
          ),
        })
        .from(t.runSkills)
        .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
        .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
        .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
        .where(eq(t.agentRuns.workspaceId, workspaceId))
        .groupBy(t.runSkills.skillId),
    ]);

    // Pull-rate denominators: completed runs per agent, folded onto each skill
    // that agent links. One skill linked by two agents sums both.
    const [linkPairs, runsPerAgent] = await Promise.all([
      this.db
        .select({ skillId: t.agentSkills.skillId, agentId: t.agentSkills.agentId })
        .from(t.agentSkills)
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .where(eq(t.agents.workspaceId, workspaceId)),
      this.db
        .select({ agentId: t.agentRuns.agentId, n: count() })
        .from(t.agentRuns)
        .where(
          and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')),
        )
        .groupBy(t.agentRuns.agentId),
    ]);

    const runsByAgent = new Map<string, number>();
    for (const r of runsPerAgent) if (r.agentId) runsByAgent.set(r.agentId, r.n);

    const denominators = new Map<string, number>();
    for (const p of linkPairs) {
      denominators.set(p.skillId, (denominators.get(p.skillId) ?? 0) + (runsByAgent.get(p.agentId) ?? 0));
    }

    const out = new Map<string, UsageCounts>();
    const blank = (): UsageCounts => ({
      usedBy: 0,
      runsCarrying: 0,
      runsByLinkedAgents: 0,
      accepted: 0,
      dismissed: 0,
      findingsInWindow: 0,
    });
    const at = (id: string): UsageCounts => {
      let v = out.get(id);
      if (!v) {
        v = blank();
        out.set(id, v);
      }
      return v;
    };

    for (const r of linkRows) at(r.skillId).usedBy = r.n;
    for (const r of carryRows) at(r.skillId).runsCarrying = r.n;
    for (const r of triageRows) {
      const v = at(r.skillId);
      v.accepted = r.accepted;
      v.dismissed = r.dismissed;
      v.findingsInWindow = r.inWindow;
    }
    for (const [skillId, n] of denominators) at(skillId).runsByLinkedAgents = n;

    return out;
  }
}
