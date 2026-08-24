import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { AgentsRepository, type UpdateAgent } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}


/**
 * The reads and the writes promotion makes, as ports.
 *
 * Narrow on purpose: promotion is the one operation here worth pinning without a
 * database, and a port of six methods is one a test can satisfy where the whole
 * repository is not. `AgentsRepository` satisfies it structurally — the method
 * names are its own, because structural satisfaction is by name and renaming them
 * would force an adapter that exists only to rename.
 *
 * Generic in the row type so the port carries no Drizzle Row of its own
 * (`OA-DEEP-002`): the service instantiates it as `AgentRow` and maps the result,
 * a test instantiates it as whatever shape it wants to assert on.
 */
export interface AgentPromotionStore<TRow> {
  getById(workspaceId: string, id: string): Promise<{ id: string } | undefined>;
  getVersion(agentId: string, version: number): Promise<{ configJson: unknown } | undefined>;
  /** Of `skillIds`, those that are skills in this workspace. */
  skillIdsInWorkspace(workspaceId: string, skillIds: string[]): Promise<Set<string>>;
  /** The agent's current linked skill ids, in link order. */
  skillIdsForAgent(agentId: string): Promise<string[]>;
  /** Replace the agent's whole linked-skill set, order = index. */
  setSkills(agentId: string, skillIds: string[]): Promise<void>;
  update(workspaceId: string, id: string, patch: UpdateAgent): Promise<TRow | undefined>;
}

/** Order-sensitive: `[a, b]` and `[b, a]` are different skill blocks in a prompt. */
function sameOrderedIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Promote a stored config version: write that version's config back onto the
 * agent, producing a NEW version higher than every existing one.
 *
 * **It writes no `agent_versions` row itself, and that is the whole design.**
 * `AgentsRepository.update` already bumps the version and snapshots the resulting
 * config, so promotion is "read version N's `config_json`, feed it back through
 * the existing update path". A second bump-and-snapshot here would be the kind of
 * copy that drifts — and it would have to reproduce, exactly, the rule that
 * decides when a version bumps at all.
 *
 * The version therefore always rises: `isConfigChange` treats any defined
 * `outputSchema` in a patch as a config change, and this patch always carries one
 * (`null` included). Promoting a version whose config is byte-identical to the
 * current one still produces a new snapshot, which is the honest record — the
 * promotion happened.
 *
 * The stored config is jsonb written by a possibly older shape of the config, so
 * it is PARSED rather than cast: a snapshot that no longer matches the contract is
 * a `422` naming the version, not an unvalidated blob written onto a live agent.
 *
 * **The snapshot's ordered skill ids are part of the config it restores** — the
 * spec defines `agent_versions` as a snapshot of the config *and ordered skill
 * ids*, so a promotion that left the links alone produced a new version recording
 * the CURRENT set, i.e. a version matching no config anyone ever had. They are
 * therefore re-linked, and re-linked BEFORE `update` runs, because `update` is
 * what takes the snapshot: after it, the new version has already recorded the old
 * set and the restore is invisible.
 *
 * A snapshot naming a skill since deleted is **refused** (`422`, naming the ids)
 * rather than promoted without it: quietly dropping a skill is precisely the lie
 * AC-43 exists to prevent, and it would leave the agent on a config matching no
 * version at all. The check runs before either write, so a refusal touches
 * nothing.
 *
 * Two writes with no transaction available at this ring, so the second's failure
 * is compensated explicitly: if `update` throws or finds no agent, the previous
 * links are put back and the caller sees the original outcome. Restoring may
 * itself fail (the agent was deleted mid-promotion, links cascaded with it) —
 * that is swallowed, because the original error is the one worth reporting.
 *
 * `undefined` means either the agent is not in this workspace or that version was
 * never recorded — the route maps both to `404`, and the two are deliberately
 * indistinguishable to a caller.
 */
export async function promoteAgentVersion<TRow>(
  store: AgentPromotionStore<TRow>,
  workspaceId: string,
  agentId: string,
  version: number,
): Promise<TRow | undefined> {
  const agent = await store.getById(workspaceId, agentId);
  if (!agent) return undefined;
  const snapshot = await store.getVersion(agentId, version);
  if (!snapshot) return undefined;

  const parsed = AgentVersionConfig.safeParse(snapshot.configJson);
  if (!parsed.success) {
    throw new ValidationError('Stored agent version config is not readable', {
      version,
      issues: parsed.error.issues,
    });
  }
  const config = parsed.data;

  // Refuse before writing anything: `setSkills` bypasses the service's own
  // workspace check, and linking another tenant's skill would inject its body
  // into this workspace's prompts.
  const known = await store.skillIdsInWorkspace(workspaceId, config.skills);
  const missing = config.skills.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError('Promoted version names a skill that no longer exists', {
      version,
      skill_ids: missing,
    });
  }

  const previousSkillIds = await store.skillIdsForAgent(agentId);
  const relinked = !sameOrderedIds(previousSkillIds, config.skills);
  if (relinked) await store.setSkills(agentId, config.skills);

  const restore = async (): Promise<void> => {
    if (!relinked) return;
    try {
      await store.setSkills(agentId, previousSkillIds);
    } catch {
      // The agent is gone and its links cascaded with it; nothing to put back.
    }
  };

  let row: TRow | undefined;
  try {
    row = await store.update(workspaceId, agentId, {
      provider: config.provider,
      model: config.model,
      systemPrompt: config.system_prompt,
      outputSchema: config.output_schema ?? null,
      strategy: config.strategy,
      ciFailOn: config.ci_fail_on,
      repoIntel: config.repo_intel,
    });
  } catch (err) {
    await restore();
    throw err;
  }
  if (!row) await restore();
  return row;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /**
   * Promote a stored version — the config of version N becomes the agent's
   * current config, recorded as a new version higher than every existing one.
   *
   * A thin delegation to {@link promoteAgentVersion}, which holds the rule and
   * the parse; this method exists to hand it the repository and map the row.
   */
  async promoteVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<Agent | undefined> {
    const row = await promoteAgentVersion(this.repo, workspaceId, agentId, version);
    return row ? toAgentDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   *
   * Every id is checked against the caller's workspace first: the ids arrive
   * straight from a request body, and `agent_skills` carries no workspace of its
   * own, so an unchecked write would link — and later inject the body of —
   * another tenant's skill.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, skillIds);
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, [skillId]);
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Throw unless every id is a skill in this workspace.
   *
   * A 422 rather than a 404: the agent in the path exists and is the caller's,
   * so the request is not "not found" — the body is invalid. It also does not
   * disclose whether the id names a real skill in some other workspace.
   */
  private async assertSkillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<void> {
    const known = await this.repo.skillIdsInWorkspace(workspaceId, skillIds);
    const unknown = skillIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new ValidationError('Unknown skill id', { skill_ids: unknown });
    }
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
