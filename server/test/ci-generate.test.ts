import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import {
  AgentManifest,
  CI_AGENTS_DIR,
  CI_RESULT_ARTIFACT_NAME,
  CI_RESULT_FILE_NAME,
  CI_RUNNER_PATH,
  CI_SKILLS_DIR,
  CI_WORKFLOW_PATH,
  type CiExportInput,
} from '@devdigest/shared';
import { generateBundle } from '../src/modules/ci/generate.js';
import { CiService } from '../src/modules/ci/service.js';
import type {
  CiAgentFacts,
  CiLinkedSkill,
  CiStore,
} from '../src/modules/ci/types.js';

/**
 * What the export WRITES — the densest file in this feature and the one that has
 * to be read as a security review, not as a snapshot test.
 *
 * Everything below drives `generateBundle`, which is a total function of an
 * agent, its skills and a runner string: no container, no database, no network.
 * The two exceptions go through `CiService.preview` and exist to assert
 * NEGATIVES that a pure call cannot — that a preview reaches no GitHub method
 * (AC-2) and that no secret value reaches a generated file (AC-7). Both use fakes
 * whose every method throws with its own name, because an assertion over the
 * RESULT can only say the answer looked right, where a throwing fake names the
 * call that should never have happened.
 */

const SKILL_A_SENTENCE = 'Refuse any diff that hardcodes a bearer token in a fixture.';
const SKILL_B_SENTENCE = 'Prefer a named constant over a repeated magic number.';

const agent = (over: Partial<CiAgentFacts> = {}): CiAgentFacts => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-chat',
  systemPrompt: 'Review the diff.\nBe specific: cite file and line.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  ...over,
});

const skill = (name: string, body: string, enabled = true): CiLinkedSkill => ({
  skill: { id: `skill-${name}`, name, body, enabled },
  order: 0,
});

const twoSkills = [
  skill('Secret Gate', `# Secret Gate\n\n${SKILL_A_SENTENCE}\n`),
  skill('Naming Rules', `# Naming Rules\n\n${SKILL_B_SENTENCE}\n`),
];

const RUNNER = '#!/usr/bin/env node\nconsole.log("devdigest runner");\n';

const bundle = (over: Partial<Parameters<typeof generateBundle>[0]> = {}) =>
  generateBundle({
    agent: agent(),
    skills: twoSkills,
    runnerBundle: RUNNER,
    triggers: ['opened', 'synchronize', 'reopened'],
    postAs: 'github_review',
    ...over,
  });

/** The generated workflow, parsed. Every workflow assertion reads this. */
const workflowOf = (files: ReturnType<typeof generateBundle>) => {
  const file = files.find((f) => f.path === CI_WORKFLOW_PATH);
  if (!file) throw new Error('no workflow in the generated set');
  return { text: file.contents, yaml: parse(file.contents) as Record<string, unknown> };
};

describe('the generated file set', () => {
  it('is exactly workflow + manifest + one file per skill + runner, all non-empty', () => {
    // AC-1, AC-3. The SET, not the count: a count of five passes when the
    // manifest is generated twice and the runner is dropped.
    const files = bundle();
    expect(files.map((f) => f.path)).toEqual([
      CI_WORKFLOW_PATH,
      `${CI_AGENTS_DIR}/security-reviewer.yaml`,
      `${CI_SKILLS_DIR}/naming-rules.md`,
      `${CI_SKILLS_DIR}/secret-gate.md`,
      CI_RUNNER_PATH,
    ]);
    for (const file of files) {
      expect(file.contents.length, `${file.path} is empty`).toBeGreaterThan(0);
    }
  });

  it('marks every file non-editable', () => {
    // AC-54. The preview shows what WILL be committed; an editable flag is an
    // invitation to hand-edit a permissions block on its way into a repository
    // DevDigest does not maintain.
    expect(bundle().every((f) => f.editable === false)).toBe(true);
  });

  it('puts each skill body in that slug’s file and in no other file', () => {
    // AC-6. The manifest is included in "no other file" on purpose: it carries
    // skill SLUGS, and a generator that inlined the bodies there would ship the
    // same text twice and quietly double the bundle.
    const files = bundle();
    const carrying = (sentence: string) =>
      files.filter((f) => f.contents.includes(sentence)).map((f) => f.path);

    expect(carrying(SKILL_A_SENTENCE)).toEqual([`${CI_SKILLS_DIR}/secret-gate.md`]);
    expect(carrying(SKILL_B_SENTENCE)).toEqual([`${CI_SKILLS_DIR}/naming-rules.md`]);
  });

  it('omits a disabled skill entirely', () => {
    const files = bundle({
      skills: [skill('Secret Gate', SKILL_A_SENTENCE, false), ...twoSkills.slice(1)],
    });
    expect(files.map((f) => f.path)).not.toContain(`${CI_SKILLS_DIR}/secret-gate.md`);
    expect(files.some((f) => f.contents.includes(SKILL_A_SENTENCE))).toBe(false);
  });

  it('refuses an agent whose name reduces to no slug', () => {
    // A file called ".yaml" committed into someone else's repository is not
    // recoverable from there; the refusal names the agent instead.
    expect(() => bundle({ agent: agent({ name: '＊＊＊' }) })).toThrow(/file name/i);
  });
});

describe('the generated manifest', () => {
  const manifestText = (files: ReturnType<typeof generateBundle>) => {
    const file = files.find((f) => f.path.startsWith(CI_AGENTS_DIR));
    if (!file) throw new Error('no manifest in the generated set');
    return file.contents;
  };

  it('parses against AgentManifest for an agent with skills', () => {
    // AC-4. The same schema the runner validates with — one contract, both ends.
    const parsed = AgentManifest.safeParse(parse(manifestText(bundle())));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.skills).toEqual(['naming-rules', 'secret-gate']);
      expect(parsed.data.name).toBe('Security Reviewer');
      expect(parsed.data.model).toBe('deepseek/deepseek-chat');
    }
  });

  it('parses for an agent with no skills, whose key has no value and reads back null', () => {
    // AC-4's second half. `skills:` with nothing after it parses to `null`, which
    // `.default([])` does NOT catch — only the contract's `.nullish().transform()`
    // does. Asserting the raw YAML first is what makes this test about the file
    // rather than about zod.
    const text = manifestText(bundle({ skills: [] }));
    expect(text).toMatch(/^skills:\s*$/m);
    expect((parse(text) as { skills: unknown }).skills).toBeNull();

    const parsed = AgentManifest.safeParse(parse(text));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.skills).toEqual([]);
  });

  it('writes ci_fail_on from the agent record, never leaving it to the default', () => {
    // AC-5. An omitted key would default to `critical`, silently inverting the
    // setting for every agent stored as anything else.
    const text = manifestText(bundle({ agent: agent({ ciFailOn: 'warning' }) }));
    expect(text).toMatch(/^ci_fail_on: warning$/m);
    expect((parse(text) as { ci_fail_on: string }).ci_fail_on).toBe('warning');
  });

  it('survives a system prompt full of YAML metacharacters', () => {
    // The reason the manifest is SERIALISED and the workflow is templated: a
    // hand-rolled template breaks on the first prompt like this one.
    const systemPrompt = 'rules:\n  - "quote: here"\n---\n\tand a tab\n';
    const text = manifestText(bundle({ agent: agent({ systemPrompt }) }));
    expect((parse(text) as { system_prompt: string }).system_prompt).toBe(systemPrompt);
  });
});

describe('the generated workflow', () => {
  it('declares exactly two permissions', () => {
    // AC-8. Everything unlisted is `none` by GitHub's own rule, so this map IS
    // the complete statement of what the workflow token can do.
    const { yaml } = workflowOf(bundle());
    expect(yaml.permissions).toEqual({ 'contents': 'read', 'pull-requests': 'write' });
  });

  it('names the model key exactly twice — the env key and the secret reference', () => {
    // AC-9. Two occurrences: `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`.
    // A third would mean the name reached a comment, a path or a log line.
    const { text } = workflowOf(bundle());
    expect(text.match(/OPENROUTER_API_KEY/g)).toHaveLength(2);
    expect(text).toContain('OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
  });

  it('intersects the requested triggers with the supported set', () => {
    // AC-10, both worked examples from the criterion.
    const types = (triggers: string[]) => {
      const on = workflowOf(bundle({ triggers })).yaml.on as {
        pull_request: { types: string[] };
      };
      return on.pull_request.types;
    };
    expect(types(['opened', 'labeled'])).toEqual(['opened']);
    expect(types(['labeled'])).toEqual(['opened', 'synchronize', 'reopened']);
    expect(types([])).toEqual(['opened', 'synchronize', 'reopened']);
    // Order is ours, not the caller's, so two requests differing only in argument
    // order generate byte-identical files.
    expect(types(['reopened', 'opened'])).toEqual(['opened', 'reopened']);
  });

  it('has pull_request as its only trigger, for every reachable input', () => {
    for (const triggers of powerSet(['opened', 'synchronize', 'reopened', 'labeled'])) {
      const { yaml } = workflowOf(bundle({ triggers }));
      expect(Object.keys(yaml.on as object)).toEqual(['pull_request']);
    }
  });

  it('contains none of the three forbidden event names, for every reachable input', () => {
    // AC-11 — the base-repo-privileged event and the two classic
    // comment-triggered exfiltration vectors. A substring search over the WHOLE
    // file, comments included, because a comment mentioning one would be
    // indistinguishable from a trigger to this check and to a reader in a hurry.
    const forbidden = ['pull_request_target', 'issue_comment', 'pull_request_review_comment'];
    for (const triggers of powerSet(['opened', 'synchronize', 'reopened', 'labeled'])) {
      const { text } = workflowOf(bundle({ triggers }));
      for (const needle of forbidden) {
        expect(text.includes(needle), `${needle} for [${triggers.join(',')}]`).toBe(false);
      }
    }
  });

  it('gates the job on the head repository being this repository', () => {
    // AC-12. On the JOB, so a fork pull request runs no step at all — and in the
    // YAML, where a reviewer of the export pull request can see it, rather than
    // inside the runner where the previous implementation's identical promise
    // lived only in a comment and nothing implemented it.
    const { yaml } = workflowOf(bundle());
    const jobs = yaml.jobs as { review: { if: string } };
    expect(jobs.review.if).toBe(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('uses only first-party actions, each at a major-version tag', () => {
    // AC-13, AC-14. EVERY `uses:` value is extracted and matched, not the two the
    // test happens to know about — a test that checks the ones it knows is a test
    // that passes on the day somebody adds a third. The SET is asserted too: a
    // count of three passes when one action is swapped for another.
    const { text } = workflowOf(bundle());
    const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)$/gm)].map((m) => m[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const value of uses) {
      expect(value, `${value} is not a tagged first-party action`).toMatch(
        /^actions\/[a-z-]+@v[0-9]+$/,
      );
    }
    expect(new Set(uses)).toEqual(
      new Set(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4']),
    );
  });

  it('pins the Node version rather than inheriting the runner image’s', () => {
    // `setup-node` is load-bearing: the review step runs `node` directly rather
    // than a node20 action carrying its own runtime, so without it the version is
    // whatever ubuntu-latest ships this month.
    const steps = stepsOf(bundle());
    const setupNode = steps.find((s) => s['uses'] === 'actions/setup-node@v4');
    expect(setupNode?.['with']).toEqual({ 'node-version': 20 });
  });

  it('runs the exported runner as a `run:` step, with the agent’s own slug', () => {
    // AC-13's second half. The reviewer is a `run:` of a file this export
    // committed, not a `uses:` of anything — which is what makes tags rather than
    // commit pins the right choice for the three steps above.
    const review = reviewStep(bundle({ agent: agent({ name: 'Security Reviewer' }) }));
    expect(review['run']).toBe(
      `node ${CI_RUNNER_PATH} review --agent security-reviewer --post-as github_review`,
    );
    expect(review['uses']).toBeUndefined();
  });

  it('passes post_as as a flag whose VALUE follows the request', () => {
    // The runner takes the mode on the command line and defaults it to
    // `github_review` when the flag is absent — so a generator that hard-coded
    // the flag, or emitted the mode as an env var instead, would leave every unit
    // test on both sides green while `post_as: none` posted a review in somebody
    // else's repository. Asserting the value CHANGES is what catches that; a test
    // that only checks the flag is present does not.
    for (const postAs of ['github_review', 'pr_comment', 'none'] as const) {
      expect(reviewStep(bundle({ postAs }))['run']).toBe(
        `node ${CI_RUNNER_PATH} review --agent security-reviewer --post-as ${postAs}`,
      );
    }
  });

  it('maps all three environment variables the runner checks for', () => {
    // The runner exits naming what is missing before it does any work.
    // `GITHUB_TOKEN` is NOT an environment variable in Actions by default, and a
    // job that omits it fails on its very first run.
    expect(reviewStep(bundle())['env']).toEqual({
      OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      GITHUB_REPOSITORY: '${{ github.repository }}',
    });
  });

  it('uploads the result under the shared artifact name, always', () => {
    // AC-20. The name is IMPORTED from the contract rather than written as a
    // literal here: that import is what makes AC-20 and AC-37 one check instead
    // of two, so moving the constant on either side alone fails a test.
    const steps = stepsOf(bundle());
    const upload = steps.find((s) => s['uses'] === 'actions/upload-artifact@v4');
    expect(upload?.['if']).toBe('always()');
    expect(upload?.['with']).toMatchObject({
      name: CI_RESULT_ARTIFACT_NAME,
      path: CI_RESULT_FILE_NAME,
    });
  });
});

describe('a preview', () => {
  const hostileStore = (): CiStore =>
    new Proxy({} as CiStore, {
      get: (_target, prop) => () => {
        throw new Error(`CiStore.${String(prop)} must not be reached by a preview`);
      },
    });

  const input: CiExportInput = {
    repo: 'acme/payments-api',
    target: 'gha',
    action: 'files',
    post_as: 'github_review',
    triggers: ['opened', 'synchronize', 'reopened'],
    base: 'main',
  };

  const SENTINEL = 'sk-sentinel-must-never-be-written-9f3c';

  const service = () =>
    new CiService({
      store: hostileStore(),
      agents: {
        getById: async () => agent(),
        linkedSkills: async () => twoSkills,
      },
      // Resolving the client at all would throw — which is stronger than "it
      // calls no write method": with no token configured `container.github()`
      // throws, and a preview still has to work (AC-2).
      github: async () => {
        throw new Error('container.github() must not be resolved by a preview');
      },
      runnerBundle: async () => RUNNER,
      secrets: { get: async () => SENTINEL },
    });

  it('returns the file set without touching GitHub or the database', async () => {
    // AC-1, AC-2.
    const result = await service().preview('ws-1', '22222222-2222-4222-8222-222222222222', input);
    expect(result.files.map((f) => f.path)).toContain(CI_WORKFLOW_PATH);
    expect(result.files).toHaveLength(5);
  });

  it('writes no value obtained from the secrets provider into any file', async () => {
    // AC-7. The provider is IN REACH and returns a sentinel for every key; the
    // assertion is that none of it lands. A generator that could not reach a
    // secret at all would make this vacuous.
    const result = await service().preview('ws-1', '22222222-2222-4222-8222-222222222222', input);
    for (const file of result.files) {
      expect(file.contents.includes(SENTINEL), `${file.path} leaks a secret`).toBe(false);
    }
  });
});

/** The one step that runs the exported runner. */
function reviewStep(files: ReturnType<typeof generateBundle>): Record<string, unknown> {
  const step = stepsOf(files).find((s) => typeof s['run'] === 'string');
  if (!step) throw new Error('no `run:` step in the generated workflow');
  return step;
}

/** The review job's steps, parsed. */
function stepsOf(files: ReturnType<typeof generateBundle>): Record<string, unknown>[] {
  const jobs = workflowOf(files).yaml.jobs as {
    review: { steps: Record<string, unknown>[] };
  };
  return jobs.review.steps;
}

/** Every subset of `values`, so "for every reachable input" is literally that. */
function powerSet(values: string[]): string[][] {
  return values.reduce<string[][]>((acc, v) => [...acc, ...acc.map((s) => [...s, v])], [[]]);
}
