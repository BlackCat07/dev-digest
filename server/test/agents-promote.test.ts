import { describe, it, expect } from 'vitest';
import type { AgentVersionConfig } from '@devdigest/shared';
import {
  promoteAgentVersion,
  type AgentPromotionStore,
} from '../src/modules/agents/service.js';
import type { UpdateAgent } from '../src/modules/agents/repository.js';
import { AppError } from '../src/platform/errors.js';

/**
 * AC-43 — promoting a stored version writes that version's config onto the agent
 * as a NEW version higher than every existing one, mutating no existing
 * `agent_versions` row.
 *
 * Hermetic: `promoteAgentVersion` takes the calls it makes as a port, and
 * the fake below stands in for `AgentsRepository` — including the bump-and-
 * snapshot that `update` already performs, because the point being pinned is that
 * promotion goes THROUGH that path rather than reimplementing it. A second copy
 * of the bump inside eval, or here, is exactly what this shape rules out: the
 * fake records every write, and a promotion that wrote an `agent_versions` row
 * itself would show up as a second one.
 *
 * The version arithmetic itself (`isConfigChange` → `version + 1` → snapshot) is
 * the repository's and is covered against Postgres in
 * `test/agents-versions.it.test.ts`. What is asserted here is that promotion
 * hands that path v6's config, exactly once, and returns whatever it produced.
 *
 * The fake's snapshot reads its OWN link state at update time, exactly as
 * `AgentsRepository.snapshotVersion` re-reads `skillIdsForAgent(row.id)`. That is
 * what makes the skill-ordering assertion real: move the service's `setSkills`
 * call after `update` and the v8 snapshot records v7's ids again.
 */

const WS = 'ws-1';
const AGENT = 'agent-1';

const V6: AgentVersionConfig = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  system_prompt: 'the older, better prompt',
  output_schema: null,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: false,
  // A different ORDER as well as a different set, so restoring these ids cannot
  // pass by set membership alone — the skill block's order is part of the prompt.
  skills: ['skill-b', 'skill-a'],
};

const V7: AgentVersionConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  system_prompt: 'the newer, worse prompt',
  output_schema: null,
  strategy: 'map-reduce',
  ci_fail_on: 'any',
  repo_intel: true,
  skills: ['skill-a', 'skill-b'],
};

/** A promoted row, as narrow as the assertions need. */
interface FakeAgentRow {
  id: string;
  version: number;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: string;
  ciFailOn: string;
  repoIntel: boolean;
}

interface Recorder {
  store: AgentPromotionStore<FakeAgentRow>;
  updates: UpdateAgent[];
  versions: Map<number, AgentVersionConfig>;
  /** Every `setSkills` write, in order — a promotion that rolled back shows two. */
  skillWrites: string[][];
  /** The agent's live links, as the fake's snapshot reads them. */
  links: () => string[];
}

interface RecorderOptions {
  agentExists?: boolean;
  configJson?: unknown;
  /** Skill ids the workspace still holds. Omitting one makes it "deleted". */
  workspaceSkills?: string[];
  /** `update` throws (a mid-promotion failure), or returns undefined (agent gone). */
  updateOutcome?: 'throws' | 'missing';
}

/**
 * A repository stand-in whose `update` behaves as the real one does: any patch
 * carrying `outputSchema` is a config change, so the version rises by one and the
 * RESULTING config is snapshotted under the new number, with the agent's links as
 * they stand at that moment. Existing snapshots are frozen, so a write into one
 * throws instead of passing quietly.
 */
function recorder(opts: RecorderOptions = {}): Recorder {
  const updates: UpdateAgent[] = [];
  const skillWrites: string[][] = [];
  const versions = new Map<number, AgentVersionConfig>([
    [6, Object.freeze({ ...V6 })],
    [7, Object.freeze({ ...V7 })],
  ]);
  let current = 7;
  // v7 is the current config, so the agent is linked to v7's skills.
  let links: string[] = [...V7.skills];
  const workspaceSkills = new Set(opts.workspaceSkills ?? ['skill-a', 'skill-b']);

  const store: AgentPromotionStore<FakeAgentRow> = {
    getById: async (workspaceId, id) => {
      expect(workspaceId).toBe(WS);
      expect(id).toBe(AGENT);
      return opts.agentExists === false ? undefined : { id };
    },
    getVersion: async (agentId, version) => {
      expect(agentId).toBe(AGENT);
      if ('configJson' in opts) return { configJson: opts.configJson };
      const config = versions.get(version);
      return config ? { configJson: config } : undefined;
    },
    skillIdsInWorkspace: async (workspaceId, skillIds) => {
      expect(workspaceId).toBe(WS);
      return new Set(skillIds.filter((id) => workspaceSkills.has(id)));
    },
    skillIdsForAgent: async (agentId) => {
      expect(agentId).toBe(AGENT);
      return [...links];
    },
    setSkills: async (agentId, skillIds) => {
      expect(agentId).toBe(AGENT);
      skillWrites.push([...skillIds]);
      links = [...skillIds];
    },
    update: async (workspaceId, id, patch) => {
      expect(workspaceId).toBe(WS);
      expect(id).toBe(AGENT);
      updates.push(patch);
      if (opts.updateOutcome === 'throws') throw new Error('update failed');
      if (opts.updateOutcome === 'missing') return undefined;
      current += 1;
      versions.set(current, {
        provider: patch.provider!,
        model: patch.model!,
        system_prompt: patch.systemPrompt!,
        output_schema: patch.outputSchema ?? null,
        strategy: patch.strategy!,
        ci_fail_on: patch.ciFailOn!,
        repo_intel: patch.repoIntel!,
        // Re-read at snapshot time, exactly as `snapshotVersion` does.
        skills: [...links],
      });
      return {
        id,
        version: current,
        provider: patch.provider!,
        model: patch.model!,
        systemPrompt: patch.systemPrompt!,
        strategy: patch.strategy!,
        ciFailOn: patch.ciFailOn!,
        repoIntel: patch.repoIntel!,
      };
    },
  };
  return { store, updates, versions, skillWrites, links: () => [...links] };
}

describe('promoteAgentVersion', () => {
  it('promotes v6 while v7 is current: config becomes v6’s, the version becomes v8', async () => {
    const r = recorder();
    const row = await promoteAgentVersion(r.store, WS, AGENT, 6);

    expect(row).toBeDefined();
    expect(row!.version).toBe(8);
    expect(row!.provider).toBe(V6.provider);
    expect(row!.model).toBe(V6.model);
    expect(row!.systemPrompt).toBe(V6.system_prompt);
    expect(row!.strategy).toBe(V6.strategy);
    expect(row!.ciFailOn).toBe(V6.ci_fail_on);
    expect(row!.repoIntel).toBe(V6.repo_intel);

    // Exactly one write, and it went through the update path — not a bump and a
    // snapshot written here.
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]).toMatchObject({
      provider: V6.provider,
      model: V6.model,
      systemPrompt: V6.system_prompt,
      strategy: V6.strategy,
      ciFailOn: V6.ci_fail_on,
      repoIntel: V6.repo_intel,
    });
    // Always defined, which is what guarantees the version rises even when the
    // promoted config equals the current one.
    expect(r.updates[0]).toHaveProperty('outputSchema');

    // No existing snapshot changed, and v8 is a new row.
    expect(r.versions.get(6)).toEqual(V6);
    expect(r.versions.get(7)).toEqual(V7);
    expect(r.versions.get(8)).toMatchObject({
      provider: V6.provider,
      model: V6.model,
      system_prompt: V6.system_prompt,
    });
  });

  it('restores the promoted version’s ordered skill links, and snapshots THOSE', async () => {
    const r = recorder();
    await promoteAgentVersion(r.store, WS, AGENT, 6);

    // The links were re-linked once, to v6's ids in v6's order.
    expect(r.skillWrites).toEqual([V6.skills]);
    expect(r.links()).toEqual(V6.skills);

    // The load-bearing one: v8's snapshot carries v6's ids, not v7's. The fake
    // snapshots the links as they stand when `update` runs, so this only holds
    // while the re-link happens BEFORE the update.
    expect(r.versions.get(8)!.skills).toEqual(V6.skills);
    expect(r.versions.get(8)!.skills).not.toEqual(V7.skills);

    // And no existing snapshot was rewritten by any of it.
    expect(r.versions.get(6)).toEqual(V6);
    expect(r.versions.get(7)).toEqual(V7);
  });

  it('promoting the current version still produces a new, higher one', async () => {
    const r = recorder();
    const row = await promoteAgentVersion(r.store, WS, AGENT, 7);
    expect(row!.version).toBe(8);
    expect(row!.systemPrompt).toBe(V7.system_prompt);
    expect(r.versions.get(7)).toEqual(V7);
    // The links already are v7's, so nothing is rewritten — and v8 records them.
    expect(r.skillWrites).toEqual([]);
    expect(r.versions.get(8)!.skills).toEqual(V7.skills);
  });

  it('refuses a version naming a skill absent from the workspace, leaving the agent untouched', async () => {
    // `skill-b` has been deleted since v6 was snapshotted.
    const r = recorder({ workspaceSkills: ['skill-a'] });

    await expect(promoteAgentVersion(r.store, WS, AGENT, 6)).rejects.toMatchObject({
      statusCode: 422,
      details: { version: 6, skill_ids: ['skill-b'] },
    });

    // Nothing written: no config, no links, no new version.
    expect(r.updates).toHaveLength(0);
    expect(r.skillWrites).toEqual([]);
    expect(r.links()).toEqual(V7.skills);
    expect(r.versions.has(8)).toBe(false);
  });

  it('puts the links back when the config write fails, so no half-promotion survives', async () => {
    const r = recorder({ updateOutcome: 'throws' });

    await expect(promoteAgentVersion(r.store, WS, AGENT, 6)).rejects.toThrow('update failed');

    // Re-linked, then restored — and the agent ends on the links it started with.
    expect(r.skillWrites).toEqual([V6.skills, V7.skills]);
    expect(r.links()).toEqual(V7.skills);
    expect(r.versions.has(8)).toBe(false);
  });

  it('puts the links back when the agent vanishes mid-promotion', async () => {
    const r = recorder({ updateOutcome: 'missing' });

    expect(await promoteAgentVersion(r.store, WS, AGENT, 6)).toBeUndefined();
    expect(r.skillWrites).toEqual([V6.skills, V7.skills]);
    expect(r.links()).toEqual(V7.skills);
  });

  it('returns undefined for an agent outside the workspace, writing nothing', async () => {
    const r = recorder({ agentExists: false });
    expect(await promoteAgentVersion(r.store, WS, AGENT, 6)).toBeUndefined();
    expect(r.updates).toHaveLength(0);
    expect(r.skillWrites).toEqual([]);
  });

  it('returns undefined for a version that was never recorded', async () => {
    const r = recorder();
    expect(await promoteAgentVersion(r.store, WS, AGENT, 99)).toBeUndefined();
    expect(r.updates).toHaveLength(0);
    expect(r.skillWrites).toEqual([]);
  });

  it('refuses a stored snapshot that no longer matches the contract, rather than writing it', async () => {
    const r = recorder({ configJson: { provider: 'openai', model: 42 } });
    await expect(promoteAgentVersion(r.store, WS, AGENT, 6)).rejects.toBeInstanceOf(AppError);
    expect(r.updates).toHaveLength(0);
    expect(r.skillWrites).toEqual([]);
  });
});
