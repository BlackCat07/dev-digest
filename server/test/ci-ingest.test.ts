import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  CI_RESULT_ARTIFACT_NAME,
  CI_RESULT_FILE_NAME,
  type CiResultArtifact,
  type CiWorkflowRunRef,
  type GitHubClient,
  type RepoRef,
} from '@devdigest/shared';
import { CiService } from '../src/modules/ci/service.js';
import { readResultArtifact } from '../src/modules/ci/artifact.js';
import type {
  CiAgentRunWrite,
  CiRunWrite,
  CiStore,
  StoredCiInstallationWithRun,
  StoredCiRun,
} from '../src/modules/ci/types.js';

/**
 * Reading runs back: where the provenance comes from, and what happens to a run
 * whose artifact cannot be read.
 *
 * Hermetic — the artifacts are hand-built zips, which is exactly what makes
 * AC-24's four cases cheap to cover: no network, no Docker, and each of the four
 * is a few bytes rather than a scenario.
 *
 * The fake's `listWorkflowRuns` THROWS for any repository it was not primed
 * with, so "a repository with no installation is never polled" (AC-22) is a
 * failure with a name in it rather than an assertion about a count.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const INSTALLATION = 'installation-1';
const REPO = 'acme/payments-api';

const installation: StoredCiInstallationWithRun = {
  id: INSTALLATION,
  agentId: AGENT,
  repo: REPO,
  targetType: 'gha',
  installedAt: new Date('2026-08-01T00:00:00.000Z'),
  agentName: 'Security Reviewer',
  lastRunStatus: null,
  lastRunAt: null,
};

const workflowRun = (over: Partial<CiWorkflowRunRef> = {}): CiWorkflowRunRef => ({
  id: 90001,
  prNumber: 482,
  headSha: 'a1b2c3d4e5f6',
  status: 'completed',
  conclusion: 'success',
  htmlUrl: 'https://github.com/acme/payments-api/actions/runs/90001',
  runStartedAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:04:00.000Z',
  ...over,
});

const result = (over: Partial<CiResultArtifact> = {}): CiResultArtifact => ({
  findings_count: 3,
  critical: 1,
  warning: 2,
  suggestion: 0,
  cost_usd: 0.0142,
  duration_ms: 42_000,
  agent: 'security-reviewer',
  version: '1',
  pr_number: 482,
  status: 'succeeded',
  error: null,
  blockers: 1,
  missing_skills: null,
  ...over,
});

/** A real zip carrying `devdigest-result.json`, as `upload-artifact` produces one. */
const resultZip = (body: unknown): Uint8Array =>
  zipSync({ [CI_RESULT_FILE_NAME]: strToU8(JSON.stringify(body)) });

function unreachable(name: string) {
  return (): never => {
    throw new Error(`GitHubClient.${name} must not be reached by a read-back`);
  };
}

interface Recorded {
  run: CiRunWrite;
  agentRun: CiAgentRunWrite | null;
}

function build(opts: {
  installations?: StoredCiInstallationWithRun[];
  runs?: CiWorkflowRunRef[];
  artifacts?: Record<number, Uint8Array | null>;
}) {
  const recorded: Recorded[] = [];
  const stored = new Map<string, StoredCiRun>();
  const downloads: { runId: number; name: string }[] = [];
  const polled: RepoRef[] = [];

  const store: CiStore = {
    upsertInstallation: async () => {
      throw new Error('CiStore.upsertInstallation must not be reached by a refresh');
    },
    listInstallationsForAgent: async () => opts.installations ?? [installation],
    listInstallationsForWorkspace: async () => opts.installations ?? [installation],
    listRuns: async () => [...stored.values()],
    recordRun: async (run, agentRun) => {
      recorded.push({ run, agentRun });
      const key = `${run.ciInstallationId}:${run.workflowRunId}`;
      const row: StoredCiRun = {
        id: stored.get(key)?.id ?? `run-${stored.size + 1}`,
        ciInstallationId: run.ciInstallationId,
        workflowRunId: run.workflowRunId,
        prNumber: run.prNumber,
        ranAt: run.ranAt,
        status: run.status,
        findingsCount: run.findingsCount,
        costUsd: run.costUsd,
        githubUrl: run.githubUrl,
        source: run.source,
        headSha: run.headSha,
        repo: run.repo,
        agent: run.agent,
        blockers: run.blockers,
        durationS: run.durationS,
        reason: run.reason,
      };
      stored.set(key, row);
      return row;
    },
  };

  // Every method a read-back may NOT call throws with its own name, so a
  // regression fails with the call in the message rather than with a count.
  const github: GitHubClient = {
    listPullRequests: unreachable('listPullRequests'),
    getPullRequest: unreachable('getPullRequest'),
    postReview: unreachable('postReview'),
    listReviewComments: unreachable('listReviewComments'),
    createReviewComment: unreachable('createReviewComment'),
    openPullRequest: unreachable('openPullRequest'),
    commitFiles: unreachable('commitFiles'),
    findOpenPr: unreachable('findOpenPr'),
    getIssue: unreachable('getIssue'),
    currentLogin: unreachable('currentLogin'),
    listWorkflowRuns: async (repo: RepoRef) => {
      if (`${repo.owner}/${repo.name}` !== REPO) {
        throw new Error(
          `listWorkflowRuns polled ${repo.owner}/${repo.name}, which holds no installation`,
        );
      }
      polled.push(repo);
      return opts.runs ?? [workflowRun()];
    },
    downloadRunArtifact: async (_repo: RepoRef, runId: number, name: string) => {
      downloads.push({ runId, name });
      return opts.artifacts?.[runId] ?? null;
    },
  };

  // A fresh clock per service, so the 60 s throttle is exercised deliberately
  // rather than by accident of how fast the suite runs.
  let clock = 1_000_000;
  const service = new CiService({
    store,
    agents: {
      getById: async () => ({
        id: AGENT,
        name: 'Security Reviewer',
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
        systemPrompt: 'Review the diff.',
        strategy: 'single-pass',
        ciFailOn: 'critical',
      }),
      linkedSkills: async () => [],
    },
    github: async () => github,
    runnerBundle: async () => 'console.log("runner");\n',
    secrets: { get: async () => undefined },
    now: () => clock,
  });

  return {
    service,
    recorded,
    stored,
    downloads,
    polled,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('reading a run back', () => {
  it('polls only repositories that hold an installation', async () => {
    // AC-22. The fake throws by name for any other repository, so a regression
    // here fails with "polled other/repo, which holds no installation" rather
    // than with a count that is off by one.
    const { service, polled } = build({});
    await service.refresh(WS, 50);
    expect(polled.map((r) => `${r.owner}/${r.name}`)).toEqual([REPO]);
  });

  it('reports zero runs and polls nothing when the workspace has no installation', async () => {
    const { service, polled, recorded } = build({ installations: [] });
    expect(await service.refresh(WS, 50)).toEqual([]);
    expect(polled).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('takes repository, PR number and head SHA from the workflow run, not the artifact', async () => {
    // AC-23. The artifact claims PR 999; the run says 482. GitHub is the
    // authority on provenance — the artifact was written by a runner in a
    // repository DevDigest does not control and is only the payload.
    const { service, recorded } = build({
      runs: [workflowRun()],
      artifacts: { 90001: resultZip(result({ pr_number: 999 })) },
    });
    await service.refresh(WS, 50);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.run.prNumber).toBe(482);
    expect(recorded[0]?.run.headSha).toBe('a1b2c3d4e5f6');
    expect(recorded[0]?.run.repo).toBe(REPO);
  });

  it('writes one ci_runs row and one agent_runs row, the latter with pr_id left to the store', async () => {
    // AC-25. `source: 'ci'` and `prId: null` are the repository's to set and are
    // deliberately absent from `CiAgentRunWrite` — see its doc-comment. What the
    // service owes is the workspace, the agent and the figures.
    const { service, recorded } = build({
      artifacts: { 90001: resultZip(result()) },
    });
    await service.refresh(WS, 50);

    const [only] = recorded;
    expect(only?.agentRun).toMatchObject({
      workspaceId: WS,
      agentId: AGENT,
      findingsCount: 3,
      blockers: 1,
      costUsd: 0.0142,
      durationMs: 42_000,
      status: 'succeeded',
    });
    expect(only?.run.findingsCount).toBe(3);
    expect(only?.run.durationS).toBe(42);
    expect(only?.run.reason).toBeNull();
  });

  it('records no agent_runs row for a run whose result could not be read', async () => {
    const { service, recorded } = build({ artifacts: { 90001: null } });
    await service.refresh(WS, 50);
    expect(recorded[0]?.agentRun).toBeNull();
  });

  it('reads the same workflow run twice into one row', async () => {
    // AC-26. The store fake upserts on `(installation, workflow_run_id)` exactly
    // as the real UNIQUE index does, so the second read converges rather than
    // accumulating — which is what makes a refresh loop and a force-push safe.
    const h = build({ artifacts: { 90001: resultZip(result()) } });
    await h.service.refresh(WS, 50);
    h.advance(120_000); // past the per-installation throttle
    await h.service.refresh(WS, 50);

    expect(h.recorded).toHaveLength(2);
    expect(h.stored.size).toBe(1);
  });

  it('does not re-poll the same installation inside the throttle window', async () => {
    const h = build({ artifacts: { 90001: resultZip(result()) } });
    await h.service.refresh(WS, 50);
    h.advance(10_000);
    await h.service.refresh(WS, 50);

    expect(h.polled).toHaveLength(1);
  });

  it('records an unfinished run as running, and downloads no artifact for it', async () => {
    const { service, recorded, downloads } = build({
      runs: [workflowRun({ status: 'in_progress', conclusion: null })],
    });
    await service.refresh(WS, 50);

    expect(recorded[0]?.run.status).toBe('running');
    expect(recorded[0]?.run.reason).toBeNull();
    expect(downloads).toEqual([]);
  });

  it('asks GitHub for the artifact by the shared name', async () => {
    const { service, downloads } = build({ artifacts: { 90001: resultZip(result()) } });
    await service.refresh(WS, 50);
    expect(downloads).toEqual([{ runId: 90001, name: CI_RESULT_ARTIFACT_NAME }]);
  });

  it('carries a skipped result through as skipped, distinct from no_findings', async () => {
    // Both shapes report zero findings, and they mean opposite things: `skipped`
    // is a run where every file was excluded so no model was called, while
    // `no_findings` is the model having read the diff and reported nothing.
    // Collapsing them put a green "No findings" on a pull request nobody looked
    // at — which is what the export PR itself did, since it touches only
    // `.devdigest/`.
    const { service, recorded } = build({
      artifacts: {
        90001: resultZip(result({ findings_count: 0, blockers: 0, status: 'skipped' })),
      },
    });
    await service.refresh(WS, 50);
    expect(recorded[0]?.run.status).toBe('skipped');
  });

  it('derives no_findings from a clean result that names no status', async () => {
    const { service, recorded } = build({
      artifacts: {
        90001: resultZip(result({ findings_count: 0, blockers: 0, status: null })),
      },
    });
    await service.refresh(WS, 50);
    expect(recorded[0]?.run.status).toBe('no_findings');
  });
});

describe('an artifact that cannot be read', () => {
  /** The four cases of AC-24, each as the bytes GitHub would actually hand back. */
  const cases: { name: string; runId: number; bytes: Uint8Array | null; conclusion: string }[] = [
    { name: 'an expired artifact', runId: 90001, bytes: null, conclusion: 'success' },
    {
      name: 'a cancelled run that uploaded nothing',
      runId: 90002,
      bytes: null,
      conclusion: 'cancelled',
    },
    {
      name: 'a zip holding no result file',
      runId: 90003,
      bytes: zipSync({ 'some-other-file.txt': strToU8('nothing to see') }),
      conclusion: 'failure',
    },
    {
      name: 'a body of {}',
      runId: 90004,
      bytes: resultZip({}),
      conclusion: 'success',
    },
  ];

  it('yields one row per case, each with its OWN distinct reason', async () => {
    // AC-24. The four reasons are asserted PAIRWISE DIFFERENT, not merely
    // non-empty: a single catch-all `artifact_unreadable` would satisfy "record a
    // reason" and tell the person reading the CI Runs screen nothing about which
    // of four quite different things happened. Two of the four arrive as the
    // SAME absent bytes — an expired artifact and a cancelled run — so the run's
    // own `conclusion` is what separates them.
    const { service, recorded } = build({
      runs: cases.map((c) => workflowRun({ id: c.runId, conclusion: c.conclusion })),
      artifacts: Object.fromEntries(cases.map((c) => [c.runId, c.bytes])),
    });
    await service.refresh(WS, 50);

    expect(recorded).toHaveLength(4);
    const reasons = recorded.map((r) => r.run.reason);
    expect(new Set(reasons).size).toBe(4);
    expect(reasons).toEqual([
      'artifact_missing',
      'run_cancelled',
      'result_file_missing',
      'result_unparseable',
    ]);
  });

  it('states a status word for each of them, never leaving the cell blank', async () => {
    // AC-64 reaches back to here: the screen states status as a WORD, and none of
    // these four is a `CiRunStatus` member — so the reason is what `status`
    // carries, and both columns agree.
    const { service, recorded } = build({
      runs: cases.map((c) => workflowRun({ id: c.runId, conclusion: c.conclusion })),
      artifacts: Object.fromEntries(cases.map((c) => [c.runId, c.bytes])),
    });
    await service.refresh(WS, 50);

    for (const row of recorded) {
      expect(row.run.status.length).toBeGreaterThan(0);
      expect(row.run.status).toBe(row.run.reason);
    }
  });

  it('never drops a run, and never reports zero runs for four that happened', async () => {
    const { service } = build({
      runs: cases.map((c) => workflowRun({ id: c.runId, conclusion: c.conclusion })),
      artifacts: Object.fromEntries(cases.map((c) => [c.runId, c.bytes])),
    });
    expect(await service.refresh(WS, 50)).toHaveLength(4);
  });
});

describe('the artifact decoder, directly', () => {
  it('maps each shape to its own reason', () => {
    expect(readResultArtifact(null)).toEqual({ ok: false, reason: 'artifact_missing' });
    expect(readResultArtifact(new Uint8Array())).toEqual({
      ok: false,
      reason: 'artifact_missing',
    });
    expect(readResultArtifact(strToU8('not a zip at all'))).toEqual({
      ok: false,
      reason: 'artifact_unreadable',
    });
    expect(readResultArtifact(zipSync({ 'other.txt': strToU8('x') }))).toEqual({
      ok: false,
      reason: 'result_file_missing',
    });
    expect(readResultArtifact(zipSync({ [CI_RESULT_FILE_NAME]: strToU8('{not json') }))).toEqual({
      ok: false,
      reason: 'result_unparseable',
    });
    expect(readResultArtifact(resultZip({}))).toEqual({
      ok: false,
      reason: 'result_unparseable',
    });
  });

  it('accepts a result nested under a directory, as upload-artifact may store it', () => {
    const zipped = zipSync({
      [`nested/dir/${CI_RESULT_FILE_NAME}`]: strToU8(JSON.stringify(result())),
    });
    const read = readResultArtifact(zipped);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.artifact.findings_count).toBe(3);
  });

  it('accepts a result written by an OLDER runner that carries none of the new fields', () => {
    // The reason every added field is optional or nullable: the runner is a
    // deployed copy in someone else's repository that the studio cannot upgrade.
    const read = readResultArtifact(
      resultZip({ findings_count: 2, cost_usd: null, agent: 'security-reviewer' }),
    );
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.artifact.status).toBeUndefined();
      expect(read.artifact.blockers).toBeUndefined();
    }
  });
});
