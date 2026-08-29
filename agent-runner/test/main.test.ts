import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CI_AGENTS_DIR,
  CI_RESULT_FILE_NAME,
  CI_SKILLS_DIR,
  CiResultArtifact,
  type CiFailOn,
} from '@devdigest/shared';
import { MockLLMProvider, ThrowingLLMProvider } from '../src/llm.js';
import { MockRunnerGitHub } from '../src/github.js';
import { buildResult, missingEnv, parseArgs, run } from '../src/main.js';
import { CONFIG_PATCH, cannedReview, CLEAN_REVIEW } from './helpers.js';

/** Distinctive values that must never surface anywhere the runner writes. */
const OR_KEY = 'sk-or-v1-SENTINEL-openrouter-key-2f8c41';
const GH_TOKEN = 'ghp_SENTINEL0000githubtoken000000000000';

const SKILL_BODY = '# secret-gate\n\nFlag Stripe live keys in added lines.\n';

let workspace: string;
const created: string[] = [];

/**
 * A checked-out repository as the workflow sees it: `.devdigest/agents/<slug>.yaml`
 * and `.devdigest/skills/<slug>.md` at the repository root, plus the event payload
 * GitHub writes for a `pull_request` trigger.
 */
async function makeWorkspace(opts: {
  ciFailOn?: CiFailOn;
  skills?: string[];
  withSkillFile?: boolean;
  prBody?: string;
  manifestYaml?: string;
} = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'devdigest-runner-'));
  created.push(dir);
  await mkdir(join(dir, CI_AGENTS_DIR), { recursive: true });
  await mkdir(join(dir, CI_SKILLS_DIR), { recursive: true });

  const skills = opts.skills ?? ['secret-gate'];
  const manifest =
    opts.manifestYaml ??
    [
      'name: security-reviewer',
      'provider: openrouter',
      'model: deepseek/deepseek-v4-flash',
      'system_prompt: |',
      '  Review the diff for hardcoded secrets.',
      ...(opts.ciFailOn ? [`ci_fail_on: ${opts.ciFailOn}`] : []),
      'skills:',
      ...skills.map((s) => `  - ${s}`),
    ].join('\n');
  await writeFile(join(dir, CI_AGENTS_DIR, 'security-reviewer.yaml'), manifest, 'utf8');

  if (opts.withSkillFile !== false) {
    await writeFile(join(dir, CI_SKILLS_DIR, 'secret-gate.md'), SKILL_BODY, 'utf8');
  }

  await writeFile(
    join(dir, 'event.json'),
    JSON.stringify({ pull_request: { number: 482, body: opts.prBody ?? 'Adds a config value.' } }),
    'utf8',
  );
  return dir;
}

function envFor(dir: string, over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    OPENROUTER_API_KEY: OR_KEY,
    GITHUB_TOKEN: GH_TOKEN,
    GITHUB_REPOSITORY: 'acme/payments-api',
    GITHUB_EVENT_PATH: join(dir, 'event.json'),
    ...over,
  };
}

async function readResult(dir: string): Promise<unknown> {
  return JSON.parse(await readFile(join(dir, CI_RESULT_FILE_NAME), 'utf8'));
}

beforeEach(async () => {
  workspace = await makeWorkspace();
});

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('parseArgs — the CLI shape the generated workflow invokes', () => {
  it('accepts `review --agent <slug>`', () => {
    expect(parseArgs(['review', '--agent', 'security-reviewer'])).toEqual({
      command: 'review',
      agent: 'security-reviewer',
      postAs: 'github_review',
      prNumber: null,
    });
  });

  it('accepts the optional post mode and pull-request number', () => {
    const args = parseArgs(['review', '--agent', 'a', '--post-as', 'none', '--pr', '7']);
    expect(args.postAs).toBe('none');
    expect(args.prNumber).toBe(7);
  });

  it('rejects a missing agent, an unknown command and an unknown option', () => {
    expect(() => parseArgs(['review'])).toThrow(/--agent/);
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['lint', '--agent', 'a'])).toThrow(/Unknown command/);
    expect(() => parseArgs(['review', '--agent', 'a', '--wat'])).toThrow(/Unknown option/);
  });
});

describe('missingEnv', () => {
  it('names every absent variable, in declaration order', () => {
    expect(missingEnv({})).toEqual([
      'OPENROUTER_API_KEY',
      'GITHUB_TOKEN',
      'GITHUB_REPOSITORY',
    ]);
    expect(missingEnv({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'a/b' })).toEqual([
      'OPENROUTER_API_KEY',
    ]);
    expect(missingEnv({ OPENROUTER_API_KEY: 'k', GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'a/b' }))
      .toEqual([]);
  });
});

describe('buildResult', () => {
  it('produces a shape that parses against the shared contract', () => {
    const result = buildResult({
      agent: 'security-reviewer',
      findings: [],
      costUsd: null,
      durationMs: 12,
      blockers: 0,
      missingSkills: ['gone'],
      prNumber: 482,
      status: 'failed',
      error: 'boom',
    });
    expect(CiResultArtifact.safeParse(result).success).toBe(true);
    // `null` cost is "no cost data at all", never a free model reporting zero.
    expect(result.cost_usd).toBeNull();
  });
});

describe('run — a full review', () => {
  it('writes a parseable result and exits non-zero when the gate trips', async () => {
    const github = new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]);
    const llm = new MockLLMProvider(cannedReview());

    const outcome = await run({
      env: envFor(workspace),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github,
      llm,
      log: () => {},
      errorLog: () => {},
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.resultPath).toBe(join(workspace, CI_RESULT_FILE_NAME));

    const parsed = CiResultArtifact.safeParse(await readResult(workspace));
    expect(parsed.success).toBe(true);
    const result = parsed.data!;
    expect(result.status).toBe('succeeded');
    expect(result.findings_count).toBe(1); // the phantom was grounded away
    expect(result.critical).toBe(1);
    expect(result.blockers).toBe(1);
    expect(result.pr_number).toBe(482);
    expect(result.agent).toBe('security-reviewer');
    expect(result.error).toBeNull();

    expect(github.posted).toHaveLength(1);
    expect(github.posted[0]?.payload.event).toBe('REQUEST_CHANGES');
  });

  it('exits 0 with no findings and records no_findings', async () => {
    const outcome = await run({
      env: envFor(workspace),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
      llm: new MockLLMProvider(CLEAN_REVIEW),
      log: () => {},
      errorLog: () => {},
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.status).toBe('no_findings');
    expect(outcome.result.findings_count).toBe(0);
    expect(outcome.result.blockers).toBe(0);
  });

  it('records skipped, not no_findings, when every file was excluded', async () => {
    // The two zero-finding outcomes are opposites and must not share a word.
    // A pull request touching only DevDigest's own files — which is exactly what
    // the export PR is — leaves nothing reviewable, so `reviewPullRequest` is
    // never called and no model is billed. Reporting that as `no_findings` put a
    // green "the agent looked and was happy" on a diff nobody looked at.
    //
    // `MockLLMProvider` records every call it receives, so "no model was called"
    // is asserted rather than assumed.
    const llm = new MockLLMProvider(CLEAN_REVIEW);
    const github = new MockRunnerGitHub([
      { path: '.devdigest/agents/security-reviewer.yaml', patch: CONFIG_PATCH },
      { path: '.github/workflows/devdigest-review.yml', patch: CONFIG_PATCH },
    ]);
    const outcome = await run({
      env: envFor(workspace),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github,
      llm,
      log: () => {},
      errorLog: () => {},
    });

    expect(outcome.result.status).toBe('skipped');
    expect(outcome.result.findings_count).toBe(0);
    // Green: nothing was reviewed, so nothing can have tripped the gate.
    expect(outcome.exitCode).toBe(0);
    // The distinguishing evidence — no model call, and therefore no cost.
    expect(llm.calls).toHaveLength(0);
    expect(outcome.result.cost_usd).toBeNull();
    // …and no review was posted: an APPROVE here would be a verdict on a diff
    // nobody looked at.
    expect(github.posted).toHaveLength(0);
  });
});

describe('run — the exit code is the ci_fail_on gate and nothing else', () => {
  const cases: { failOn: CiFailOn; severity: string; exit: number }[] = [
    { failOn: 'critical', severity: 'WARNING', exit: 0 },
    { failOn: 'warning', severity: 'WARNING', exit: 1 },
    { failOn: 'critical', severity: 'CRITICAL', exit: 1 },
    { failOn: 'never', severity: 'CRITICAL', exit: 0 },
    { failOn: 'never', severity: 'WARNING', exit: 0 },
    { failOn: 'any', severity: 'SUGGESTION', exit: 1 },
  ];

  for (const c of cases) {
    it(`ci_fail_on: ${c.failOn} + one ${c.severity} → exit ${c.exit}`, async () => {
      const dir = await makeWorkspace({ ciFailOn: c.failOn });
      const outcome = await run({
        env: envFor(dir),
        argv: ['review', '--agent', 'security-reviewer'],
        cwd: dir,
        github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
        llm: new MockLLMProvider(cannedReview({ severity: c.severity })),
        log: () => {},
        errorLog: () => {},
      });
      expect(outcome.exitCode).toBe(c.exit);
      expect(outcome.result.findings_count).toBe(1);
      expect(outcome.result.blockers).toBe(c.exit === 1 ? 1 : 0);
    });
  }
});

describe('run — every terminating path still writes a result', () => {
  it('a model call that throws leaves a parseable file naming the failure', async () => {
    const outcome = await run({
      env: envFor(workspace),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
      llm: new ThrowingLLMProvider('upstream exploded'),
      log: () => {},
      errorLog: () => {},
    });

    expect(outcome.exitCode).toBe(1);
    const parsed = CiResultArtifact.safeParse(await readResult(workspace));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.status).toBe('failed');
    expect(parsed.data?.error).toContain('upstream exploded');
    expect(parsed.data?.findings_count).toBe(0);
  });

  it('a manifest that does not satisfy the contract names the file and the field', async () => {
    const dir = await makeWorkspace({
      manifestYaml: 'name: broken\nprovider: openrouter\nsystem_prompt: hi\n', // no model
    });
    const errors: string[] = [];

    const outcome = await run({
      env: envFor(dir),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: dir,
      github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
      llm: new MockLLMProvider(cannedReview()),
      log: () => {},
      errorLog: (l) => errors.push(l),
    });

    expect(outcome.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('security-reviewer.yaml');
    expect(errors.join('\n')).toContain('model');
    expect(CiResultArtifact.safeParse(await readResult(dir)).success).toBe(true);
  });

  it('an unknown command still leaves a result behind', async () => {
    const outcome = await run({
      env: envFor(workspace),
      argv: ['lint'],
      cwd: workspace,
      github: new MockRunnerGitHub([]),
      llm: new MockLLMProvider(cannedReview()),
      log: () => {},
      errorLog: () => {},
    });
    expect(outcome.exitCode).toBe(1);
    expect(CiResultArtifact.safeParse(await readResult(workspace)).success).toBe(true);
  });
});

describe('run — a missing secret costs nothing', () => {
  it('names every missing variable before any model call', async () => {
    const llm = new MockLLMProvider(cannedReview());
    const errors: string[] = [];

    const outcome = await run({
      env: envFor(workspace, { OPENROUTER_API_KEY: undefined }),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
      llm,
      log: () => {},
      errorLog: (l) => errors.push(l),
    });

    expect(outcome.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('OPENROUTER_API_KEY');
    expect(llm.calls).toHaveLength(0);
    expect(CiResultArtifact.safeParse(await readResult(workspace)).success).toBe(true);
  });

  it('names all of them at once rather than one per run', async () => {
    const errors: string[] = [];
    await run({
      env: { GITHUB_EVENT_PATH: join(workspace, 'event.json') },
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github: new MockRunnerGitHub([]),
      llm: new MockLLMProvider(cannedReview()),
      log: () => {},
      errorLog: (l) => errors.push(l),
    });
    const text = errors.join('\n');
    for (const name of ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']) {
      expect(text).toContain(name);
    }
  });
});

describe('run — a manifest skill with no file', () => {
  it('names the missing slug in the output and in the written result', async () => {
    const dir = await makeWorkspace({ skills: ['secret-gate', 'never-exported'] });
    const lines: string[] = [];

    const outcome = await run({
      env: envFor(dir),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: dir,
      github: new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]),
      llm: new MockLLMProvider(cannedReview()),
      log: (l) => lines.push(l),
      errorLog: (l) => lines.push(l),
    });

    expect(lines.join('\n')).toContain('never-exported');
    expect(outcome.result.missing_skills).toEqual(['never-exported']);
    const parsed = CiResultArtifact.safeParse(await readResult(dir));
    expect(parsed.data?.missing_skills).toEqual(['never-exported']);
    // The run continued: a review still happened.
    expect(outcome.result.findings_count).toBe(1);
  });
});

describe('run — no secret reaches any output', () => {
  it('keeps the key out of stdout, stderr, the result file and the posted review', async () => {
    const out: string[] = [];
    const errors: string[] = [];
    const github = new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]);
    // An upstream that quotes the request it failed on — the accident the
    // redaction exists for, since nothing prints a secret on purpose.
    const llm = new ThrowingLLMProvider(`401 from provider using key ${OR_KEY}`);

    const outcome = await run({
      env: envFor(workspace),
      argv: ['review', '--agent', 'security-reviewer'],
      cwd: workspace,
      github,
      llm,
      log: (l) => out.push(l),
      errorLog: (l) => errors.push(l),
    });

    const resultText = await readFile(join(workspace, CI_RESULT_FILE_NAME), 'utf8');
    const everything = [out.join('\n'), errors.join('\n'), resultText, JSON.stringify(github.posted)]
      .join('\n');

    for (const secret of [OR_KEY, GH_TOKEN]) {
      expect(everything).not.toContain(secret);
    }
    // The failure is still reported — redaction masks the value, not the event.
    expect(errors.join('\n')).toContain('401 from provider');
    expect(outcome.result.error).toContain('***');
  });
});
