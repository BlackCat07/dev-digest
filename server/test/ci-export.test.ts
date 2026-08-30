import { describe, it, expect } from 'vitest';
import {
  CI_EXPORT_BRANCH,
  CI_EXPORT_PR_TITLE,
  CI_RUNNER_PATH,
  CI_WORKFLOW_PATH,
  type CiExportInput,
  type CommitFilesPayload,
  type GitHubClient,
  type OpenPrPayload,
} from '@devdigest/shared';
import { CiService } from '../src/modules/ci/service.js';
import type {
  CiAgentFacts,
  CiAgentRunWrite,
  CiRunWrite,
  CiStore,
  StoredCiInstallation,
  StoredCiInstallationWithRun,
  StoredCiRun,
} from '../src/modules/ci/types.js';

/**
 * Installing the bundle: the commit, the pull request that is opened once and
 * reused after, the single installation row, and the two refusals.
 *
 * Hermetic. The store is an in-memory fake and GitHub is a recording fake whose
 * **every unused method throws with its own name** — which is the only way to
 * prove a negative like "this path opens no second pull request". An assertion
 * over the RESULT can say the answer looked right; a throwing fake names the call
 * that should never have happened, in the failure message.
 *
 * **AC-21 — "the export writes no file into the repository's local clone" — is
 * not tested here, and that is the spec's own instruction** (`Verify: analysis`).
 * There is nothing to fake: `CiDeps` declares five ports and none of them is a
 * `GitClient`, so no clone path is reachable from this module at all. The
 * mechanical check is the grep over `modules/ci/` for `clonePathFor` / `cloneDir`
 * in this task's Done-condition, and a test that faked a git client would be
 * asserting against a port the code cannot see.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

const agent: CiAgentFacts = {
  id: AGENT,
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-chat',
  systemPrompt: 'Review the diff.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};

const input = (over: Partial<CiExportInput> = {}): CiExportInput => ({
  repo: 'acme/payments-api',
  target: 'gha',
  action: 'open_pr',
  post_as: 'github_review',
  triggers: ['opened', 'synchronize', 'reopened'],
  base: 'main',
  ...over,
});

function unreachable(name: string) {
  return (): never => {
    throw new Error(`GitHubClient.${name} must not be reached by an export`);
  };
}

interface GitHubFake {
  client: GitHubClient;
  commits: CommitFilesPayload[];
  opened: OpenPrPayload[];
}

/**
 * A GitHub fake that records the three calls an export may make and throws on
 * every other method of the port.
 */
function githubFake(opts: { openPr?: string | null; commitFails?: Error } = {}): GitHubFake {
  const commits: CommitFilesPayload[] = [];
  const opened: OpenPrPayload[] = [];
  const client: GitHubClient = {
    listPullRequests: unreachable('listPullRequests'),
    getPullRequest: unreachable('getPullRequest'),
    postReview: unreachable('postReview'),
    listReviewComments: unreachable('listReviewComments'),
    createReviewComment: unreachable('createReviewComment'),
    listWorkflowRuns: unreachable('listWorkflowRuns'),
    downloadRunArtifact: unreachable('downloadRunArtifact'),
    getIssue: unreachable('getIssue'),
    currentLogin: unreachable('currentLogin'),
    commitFiles: async (_repo, payload) => {
      if (opts.commitFails) throw opts.commitFails;
      commits.push(payload);
      return { branch: payload.branch };
    },
    findOpenPr: async () => (opts.openPr ? { url: opts.openPr } : null),
    openPullRequest: async (_repo, payload) => {
      opened.push(payload);
      return { url: 'https://github.com/acme/payments-api/pull/7' };
    },
  };
  return { client, commits, opened };
}

/** An in-memory `ci_installations`, upserting on `(agent_id, repo)` like the real index. */
function storeFake() {
  const rows = new Map<string, StoredCiInstallation>();
  const store: CiStore = {
    upsertInstallation: async (i) => {
      const key = `${i.agentId}:${i.repo}`;
      const row: StoredCiInstallation = {
        id: rows.get(key)?.id ?? `installation-${rows.size + 1}`,
        agentId: i.agentId,
        repo: i.repo,
        targetType: i.targetType,
        installedAt: i.installedAt,
      };
      rows.set(key, row);
      return row;
    },
    listInstallationsForAgent: async (): Promise<StoredCiInstallationWithRun[]> =>
      [...rows.values()].map((r) => ({
        ...r,
        agentName: agent.name,
        lastRunStatus: null,
        lastRunAt: null,
      })),
    listInstallationsForWorkspace: async () => {
      throw new Error('CiStore.listInstallationsForWorkspace must not be reached by an export');
    },
    listRuns: async (): Promise<StoredCiRun[]> => {
      throw new Error('CiStore.listRuns must not be reached by an export');
    },
    recordRun: async (_run: CiRunWrite, _agentRun: CiAgentRunWrite | null) => {
      throw new Error('CiStore.recordRun must not be reached by an export');
    },
  };
  return { store, rows };
}

function build(opts: { github?: GitHubFake; runnerCalls?: string[] } = {}) {
  const github = opts.github ?? githubFake();
  const { store, rows } = storeFake();
  const service = new CiService({
    store,
    agents: {
      getById: async (workspaceId, id) =>
        workspaceId === WS && id === AGENT ? agent : undefined,
      linkedSkills: async () => [],
    },
    github: async () => github.client,
    runnerBundle: async () => {
      opts.runnerCalls?.push('runnerBundle');
      return 'console.log("runner");\n';
    },
    secrets: { get: async () => undefined },
  });
  return { service, github, rows };
}

describe('exporting to CI', () => {
  it('commits every generated file in ONE commit onto the export branch', async () => {
    // AC-15. `commitFiles` creates the branch from `base` when absent and layers
    // a new tree on the parent's, so "one commit" is the whole of it.
    const { service, github } = build();
    const result = await service.exportToCi(WS, AGENT, input());

    expect(github.commits).toHaveLength(1);
    const commit = github.commits[0];
    expect(commit?.branch).toBe(CI_EXPORT_BRANCH);
    expect(commit?.base).toBe('main');
    expect(commit?.files.map((f) => f.path).sort()).toEqual(
      result.files.map((f) => f.path).sort(),
    );
    expect(commit?.files.map((f) => f.path)).toContain(CI_WORKFLOW_PATH);
    expect(commit?.files.map((f) => f.path)).toContain(CI_RUNNER_PATH);
  });

  it('opens one pull request, titled with the string the Install step promises', async () => {
    // The title is IMPORTED from the contract rather than written out here: the
    // Install step tells the user "DevDigest opens a PR in {repo} titled …", and
    // the sentence they agreed to and the pull request they get cannot be allowed
    // to drift apart.
    const { service, github } = build();
    const result = await service.exportToCi(WS, AGENT, input());

    expect(github.opened).toHaveLength(1);
    expect(github.opened[0]?.title).toBe(CI_EXPORT_PR_TITLE);
    expect(github.opened[0]?.head).toBe(CI_EXPORT_BRANCH);
    expect(github.opened[0]?.base).toBe('main');
    expect(result.pr_url).toBe('https://github.com/acme/payments-api/pull/7');
  });

  it('reuses an open pull request on that branch and opens ZERO second ones', async () => {
    // AC-16. `openPullRequest` is not merely "not asserted on" here — the fake
    // records it, and the count is the assertion.
    const github = githubFake({ openPr: 'https://github.com/acme/payments-api/pull/3' });
    const { service } = build({ github });

    const result = await service.exportToCi(WS, AGENT, input());

    expect(github.opened).toHaveLength(0);
    expect(result.pr_url).toBe('https://github.com/acme/payments-api/pull/3');
  });

  it('leaves exactly one installation row after three exports, carrying the latest date', async () => {
    // AC-17. The real conflict target is the `(agent_id, repo)` UNIQUE index; the
    // fake upserts on the same key, so this asserts the service calls the upsert
    // once per export rather than inserting.
    const { service, rows } = build();
    await service.exportToCi(WS, AGENT, input());
    await service.exportToCi(WS, AGENT, input());
    const third = await service.exportToCi(WS, AGENT, input());

    expect(rows.size).toBe(1);
    const stored = [...rows.values()][0];
    expect(stored?.installedAt.toISOString()).toBe(third.installation.installed_at);
  });

  it('records NO installation when the commit is refused for want of permission', async () => {
    // AC-18. The row is written after the GitHub calls succeed, so there is no
    // window in which a failed export has left an installation behind. The error
    // reaches the caller naming the missing permission — GitHub's own words, not
    // a rewrite.
    const github = githubFake({
      commitFails: new Error('Resource not accessible by integration: contents: write'),
    });
    const { service, rows } = build({ github });

    await expect(service.exportToCi(WS, AGENT, input())).rejects.toThrow(/contents: write/);
    expect(rows.size).toBe(0);
  });

  it('refuses a target other than gha, and generates nothing', async () => {
    // AC-19, defence in depth behind the screen that never offers the value. The
    // runner bundle is the first thing generation reads, so "generated nothing"
    // is observable rather than asserted about a return value that never arrives.
    const runnerCalls: string[] = [];
    const { service, github, rows } = build({ runnerCalls });

    await expect(
      service.exportToCi(WS, AGENT, input({ target: 'circle' })),
    ).rejects.toThrow(/circle/);

    expect(runnerCalls).toEqual([]);
    expect(github.commits).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('answers not_found for an agent in another workspace, before any GitHub call', async () => {
    const { service, github } = build();
    await expect(
      service.exportToCi('99999999-9999-4999-8999-999999999999', AGENT, input()),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(github.commits).toHaveLength(0);
  });

  it('installs nothing for action "files", and still returns the file set', async () => {
    const { service, github } = build();
    const result = await service.exportToCi(WS, AGENT, input({ action: 'files' }));

    expect(github.commits).toHaveLength(0);
    expect(github.opened).toHaveLength(0);
    expect(result.pr_url).toBeNull();
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('refuses a repository that is not owner/name before it reaches a URL', async () => {
    // Both halves reach a URL path, a commit message and a pull-request body. The
    // route's schema rejects this first; the service refusing it too is what makes
    // the service safe to call from anywhere.
    const { service, github } = build();
    await expect(service.exportToCi(WS, AGENT, input({ repo: 'acme' }))).rejects.toThrow(
      /owner\/name/,
    );
    await expect(
      service.exportToCi(WS, AGENT, input({ repo: '../../etc/passwd' })),
    ).rejects.toThrow(/owner\/name/);
    expect(github.commits).toHaveLength(0);
  });
});
