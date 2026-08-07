import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillStats,
  SkillType,
  SkillUsage,
  SkillVersion,
  SkillWithUsage,
} from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { SkillsRepository, type UsageCounts } from './repository.js';
import {
  deriveSkillName,
  isBodyChange,
  isTrustedSource,
  rate,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';
import {
  DEFAULT_SKILL_DESCRIPTION,
  DEFAULT_SKILL_TYPE,
  EXTRACTED_SKILL_SOURCE,
  EXTRACTED_SKILL_TYPE,
  IMPORTED_SKILLS_START_DISABLED,
  IMPORTED_SKILL_SOURCE,
} from './constants.js';

/**
 * Skills service — CRUD for the reusable prompt blocks an agent can be given.
 *
 * A skill is configuration TEXT and nothing else: it is never executed, never
 * fetched, and grants no capability. The only thing that happens to a body is
 * that {@link resolveBodiesForAgent} puts it in a prompt.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ImportSkillInput {
  body: string;
  name?: string;
  type?: SkillType;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const [rows, usage] = await Promise.all([
      this.repo.list(workspaceId),
      this.repo.usageCountsForAll(workspaceId),
    ]);
    return rows.map((row) => ({
      ...toSkillDto(row),
      usage: toUsage(usage.get(row.id)),
    }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? DEFAULT_SKILL_DESCRIPTION,
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  /**
   * Create a skill the conventions extractor composed from this workspace's own
   * code (L02).
   *
   * It lives here rather than on the conventions module because this class owns
   * the `skills` invariants — the version-1 body snapshot, and above all the
   * `source` column that decides whether a body reaches a prompt as trusted
   * instructions or as delimiter-wrapped data.
   *
   * `extracted` is NOT in `TRUSTED_SKILL_SOURCES`, so this body gets wrapped like
   * any other non-manual source. That is correct even though this server
   * assembled the text: every rule in it was phrased by a model reading
   * repository files, and a comment in someone's source that addresses the
   * reviewer must not become an instruction just because it travelled through an
   * extractor.
   *
   * `enabled` defaults to true, unlike an import: this body was composed from
   * candidates a human accepted one by one on the Conventions screen, which is
   * the vetting step `IMPORTED_SKILLS_START_DISABLED` exists to force.
   *
   * `type` is caller-controlled and defaults to `EXTRACTED_SKILL_TYPE`, because
   * the create modal shows it as an editable field: what these rules are ABOUT
   * (a convention, a security rule) is a judgement about the rules, unlike
   * `source`, which is a fact about where the text came from and stays fixed.
   */
  async createExtracted(
    workspaceId: string,
    input: {
      name: string;
      description: string;
      body: string;
      evidenceFiles: string[];
      type?: SkillType;
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type ?? EXTRACTED_SKILL_TYPE,
      source: EXTRACTED_SKILL_SOURCE,
      body: input.body,
      enabled: input.enabled ?? true,
      evidenceFiles: input.evidenceFiles.length > 0 ? input.evidenceFiles : null,
    });
    return toSkillDto(row);
  }

  /**
   * Create a skill from an uploaded markdown file.
   *
   * Three things are NOT caller-controlled, by design: the source is recorded as
   * external, the skill starts disabled, and nothing in the body is interpreted.
   * The client reads the file locally and posts its text, so no fetch happens
   * here either.
   */
  async import(workspaceId: string, input: ImportSkillInput): Promise<Skill> {
    const name = input.name?.trim() || deriveSkillName(input.body);
    const row = await this.repo.insert({
      workspaceId,
      name,
      description: DEFAULT_SKILL_DESCRIPTION,
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: IMPORTED_SKILL_SOURCE,
      body: input.body,
      enabled: !IMPORTED_SKILLS_START_DISABLED,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    const row = await this.repo.update(workspaceId, id, patch, isBodyChange(existing, patch));
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history, newest first. Workspace-scoped: an id from another tenant
   * yields undefined (the route maps that to 404) rather than leaking bodies.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const [counts, agents, byCategory] = await Promise.all([
      this.repo.usageCounts(workspaceId, id),
      this.repo.agentsUsing(workspaceId, id),
      this.repo.findingsByCategory(workspaceId, id),
    ]);
    return { usage: toUsage(counts), agents, findings_by_category: byCategory };
  }

  /**
   * The ordered skill bodies to inject into one agent's prompt, plus the
   * provenance a run needs to record.
   *
   * Two filters, both load-bearing:
   *  - `enabled` is honoured here, not at link time, so toggling a skill off
   *    changes the next run without touching any agent's configuration.
   *  - a body from any source but `manual` is delimiter-wrapped as untrusted
   *    data. `assemblePrompt` treats its `skills` slot as trusted instructions
   *    and wraps nothing, so an imported file would otherwise be able to address
   *    the reviewing model directly. Wrapping here keeps `reviewer-core` pure and
   *    puts the trust decision next to the `source` column that drives it.
   */
  async resolveBodiesForAgent(agentId: string): Promise<{
    bodies: string[];
    used: Array<{ skillId: string; version: number; order: number }>;
  }> {
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const enabled = links.filter((l) => l.skill.enabled);
    return {
      bodies: enabled.map((l) =>
        isTrustedSource(l.skill.source)
          ? l.skill.body
          : wrapUntrusted(`skill:${l.skill.name}`, l.skill.body),
      ),
      used: enabled.map((l, i) => ({
        skillId: l.skill.id,
        version: l.skill.version,
        order: i,
      })),
    };
  }

  /** Persist what a run carried, for per-skill statistics. */
  async recordRunSkills(
    runId: string,
    used: Array<{ skillId: string; version: number; order: number }>,
  ): Promise<void> {
    await this.repo.recordRunSkills(runId, used);
  }
}

/** Raw counts → the public `SkillUsage` shape, with rates computed. */
function toUsage(counts: UsageCounts | undefined): SkillUsage {
  const c = counts ?? {
    usedBy: 0,
    runsCarrying: 0,
    runsByLinkedAgents: 0,
    accepted: 0,
    dismissed: 0,
    findingsInWindow: 0,
  };
  const pull = rate(c.runsCarrying, c.runsByLinkedAgents);
  return {
    used_by: c.usedBy,
    // Runs by an agent deleted since can leave the numerator above the
    // denominator; a rate over 1 would render as "137% pull".
    pull_rate: pull === null ? null : Math.min(1, pull),
    accept_rate: rate(c.accepted, c.accepted + c.dismissed),
    findings_30d: c.findingsInWindow,
  };
}
