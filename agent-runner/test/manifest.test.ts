import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { AgentManifest } from '@devdigest/shared';
import { loadAgent, ManifestError } from '../src/manifest.js';
import { MockLLMProvider } from '../src/llm.js';
import { MockRunnerGitHub } from '../src/github.js';
import { reviewAndPost } from '../src/review-pr.js';
import { AGENTS, SKILLS, CONFIG_PATCH, cannedReview } from './helpers.js';

describe('loadAgent — the manifest is validated against the SHARED contract', () => {
  it('parses a well-formed manifest and resolves its skill bodies', async () => {
    const agent = await loadAgent(join(AGENTS, 'security-reviewer.yaml'), SKILLS);

    expect(agent.manifest.name).toBe('security-reviewer');
    expect(agent.manifest.model).toBe('deepseek/deepseek-v4-flash');
    expect(agent.missingSkills).toEqual([]);
    expect(agent.skillBodies).toHaveLength(1);
    expect(agent.skillBodies[0]).toContain('Stripe live keys');

    // Every body the runner reads is a file in a repository DevDigest does not
    // control. The studio's `source === 'manual'` exemption does not travel.
    expect(agent.skillBodies[0]).toMatch(/^<untrusted source="skill:secret-gate">/);
    expect(agent.skillBodies[0]?.trimEnd()).toMatch(/<\/untrusted>$/);

    // This fixture omits `ci_fail_on` on purpose: the value comes from the
    // contract's own default and the runner adds no second default of its own.
    expect(agent.manifest.ci_fail_on).toBe(AgentManifest.parse({
      name: 'x',
      model: 'm',
      system_prompt: '',
    }).ci_fail_on);
  });

  it('normalises a `skills:` key with no value to an empty list', async () => {
    const agent = await loadAgent(join(AGENTS, 'no-skills.yaml'), SKILLS);
    expect(agent.manifest.skills).toEqual([]);
    expect(agent.skillBodies).toEqual([]);
    expect(agent.missingSkills).toEqual([]);
    expect(agent.manifest.ci_fail_on).toBe('warning');
  });

  it('rejects a malformed manifest naming the FILE and the failing FIELD', async () => {
    const path = join(AGENTS, 'malformed.yaml');
    await expect(loadAgent(path, SKILLS)).rejects.toBeInstanceOf(ManifestError);

    const err = await loadAgent(path, SKILLS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ManifestError);
    const manifestError = err as ManifestError;
    expect(manifestError.message).toContain(path);
    expect(manifestError.message).toContain('model');
    expect(manifestError.fields).toContain('model');
  });

  it('names a manifest that does not exist rather than throwing an ENOENT', async () => {
    const path = join(AGENTS, 'no-such-agent.yaml');
    const err = await loadAgent(path, SKILLS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ManifestError);
    expect((err as ManifestError).message).toContain(path);
  });
});

describe('a manifest naming a skill with no file', () => {
  it('names the missing slug and still produces a review', async () => {
    const agent = await loadAgent(join(AGENTS, 'two-skills.yaml'), SKILLS);

    // One resolved, one missing — and the missing one is a value the caller can
    // report, not a gap in a list.
    expect(agent.manifest.skills).toEqual(['secret-gate', 'never-exported']);
    expect(agent.skillBodies).toHaveLength(1);
    expect(agent.missingSkills).toEqual(['never-exported']);

    const github = new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]);
    const logged: string[] = [];
    const result = await reviewAndPost({
      github,
      llm: new MockLLMProvider(cannedReview()),
      agent,
      owner: 'acme',
      repo: 'payments-api',
      prNumber: 482,
      onEvent: (e) => logged.push(e.msg),
    });

    expect(result.outcome?.review.findings).toHaveLength(1);
    expect(github.posted).toHaveLength(1);
  });
});
