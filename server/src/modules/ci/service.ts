import type {
  CiExport,
  CiExportInput,
  CiExportPreview,
  CiFile,
  CiInstallation,
  CiRun,
  CiWorkflowRunRef,
  GitHubClient,
  RepoRef,
} from '@devdigest/shared';
import {
  CI_EXPORT_BRANCH,
  CI_EXPORT_PR_TITLE,
  CI_RESULT_ARTIFACT_NAME,
  CI_WORKFLOW_PATH,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { readResultArtifact, reasonForMissingArtifact } from './artifact.js';
import {
  CI_COMMIT_MESSAGE,
  CI_EXPORT_PR_BODY,
  REFRESH_INSTALLATION_CAP,
  REFRESH_RUNS_PER_INSTALLATION,
  REFRESH_THROTTLE_MS,
  RUN_STATUS_COMPLETED,
} from './constants.js';
import { generateBundle } from './generate.js';
import { parseRepo, toInstallationDto, toRunDto } from './helpers.js';
import type {
  CiAgentFacts,
  CiAgentRunWrite,
  CiAgentSource,
  CiGitHubResolver,
  CiRunWrite,
  CiRunnerBundle,
  CiSecrets,
  CiStore,
  Cis,
  StoredCiInstallationWithRun,
} from './types.js';

/**
 * Export-to-CI: generate a bundle, install it as one pull request, and read the
 * runs back.
 *
 * Five ports and no more — `store`, `agents`, `github`, `runnerBundle`,
 * `secrets`. It names no adapter class, no sibling module and no Drizzle type,
 * and it imports no `node:` specifier: the runner bundle is a file on disk and it
 * arrives here as `() => Promise<string>` because a feature module may not read
 * one itself.
 *
 * Four decisions worth reading before changing anything here.
 *
 *  - **The agent lookup is the authorization check.** Every method resolves the
 *    agent (or the installations, through the agent) inside the caller's
 *    workspace FIRST; `ci_installations` carries no `workspace_id` of its own.
 *    An id from another workspace raises `NotFoundError`, which the shared error
 *    handler turns into `{"error":{"code":"not_found",…}}` — the service's
 *    envelope, which is what distinguishes "not yours" from "this module is not
 *    mounted".
 *  - **A preview touches GitHub not at all**, because it never resolves the
 *    client. That is stronger than "it calls no write method": with no token
 *    configured, `container.github()` throws, and a preview still works.
 *  - **The installation row is written LAST.** AC-18 requires that a
 *    `commitFiles` refused for want of permission leaves `ci_installations`
 *    empty; writing the row first and rolling back on failure would be the same
 *    intent with a window in it.
 *  - **The read-back is request-triggered and bounded** — at most
 *    {@link REFRESH_INSTALLATION_CAP} installations per cycle and one read per
 *    installation per {@link REFRESH_THROTTLE_MS}, held in a per-process `Map`.
 *    No background job, no new column, no SSE. Runs are invisible until somebody
 *    looks, which is accepted.
 */

export interface CiDeps {
  store: CiStore;
  agents: CiAgentSource;
  github: CiGitHubResolver;
  runnerBundle: CiRunnerBundle;
  secrets: CiSecrets;
  /** Injectable clock, so the throttle is testable without waiting a minute. */
  now?: () => number;
}

export class CiService implements Cis {
  private readonly lastReadAt = new Map<string, number>();
  private readonly now: () => number;

  constructor(private deps: CiDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  // ---- generating ---------------------------------------------------------

  async preview(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExportPreview> {
    const files = await this.generate(workspaceId, agentId, input);
    return { files };
  }

  async exportToCi(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    const repo = parseRepo(input.repo);
    const files = await this.generate(workspaceId, agentId, input);

    // `action: 'files'` returns the bundle and installs nothing. It still needs a
    // response shaped like an export, which is why the installation is written
    // even on this branch — the file set was generated FOR this repository.
    let prUrl: string | null = null;
    if (input.action === 'open_pr') {
      prUrl = await this.install(repo, input.base, files);
    }

    const installation = await this.deps.store.upsertInstallation({
      agentId,
      repo: input.repo,
      targetType: input.target,
      installedAt: new Date(),
    });

    // Re-read so the response carries this installation's latest run rather than
    // a hardcoded "never run": exporting again to a repository that has already
    // been reviewed is the ordinary second use of this screen, and the CI tab
    // renders whatever the export answered with until it refetches.
    const rows = await this.deps.store.listInstallationsForAgent(workspaceId, agentId);
    const withRun = rows.find((r) => r.id === installation.id);

    return {
      installation: toInstallationDto(
        withRun ?? { ...installation, agentName: null, lastRunStatus: null, lastRunAt: null },
      ),
      files,
      pr_url: prUrl,
    };
  }

  /**
   * Commit the bundle and open — or reuse — the pull request.
   *
   * `findOpenPr` runs BEFORE `openPullRequest`, so a second export against the
   * same repository opens no second pull request (AC-16); the reuse check is a
   * call against the existing port, not a feature to build. The commit itself is
   * one call: `commitFiles` layers a new tree on the parent's, creates one commit
   * and force-updates or creates the ref, so the branch is created from `base`
   * when absent and unrelated files are kept.
   */
  private async install(
    repo: RepoRef,
    base: string,
    files: CiFile[],
  ): Promise<string | null> {
    const github = await this.deps.github();
    await github.commitFiles(repo, {
      branch: CI_EXPORT_BRANCH,
      base,
      message: CI_COMMIT_MESSAGE,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    const existing = await github.findOpenPr(repo, CI_EXPORT_BRANCH);
    if (existing) return existing.url;

    const opened = await github.openPullRequest(repo, {
      title: CI_EXPORT_PR_TITLE,
      head: CI_EXPORT_BRANCH,
      base,
      body: CI_EXPORT_PR_BODY,
    });
    return opened.url;
  }

  /**
   * The file set, from the agent record and its linked skills.
   *
   * The target is checked before anything is generated (AC-19): the screen never
   * offers a value other than `gha`, and the route still refuses one. Only the
   * fields this feature uses are read off `input` — it is never spread into
   * anything, so a field an attacker adds to the body reaches nothing.
   */
  private async generate(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiFile[]> {
    if (input.target !== 'gha') {
      throw new ValidationError(
        `Target "${input.target}" cannot be exported; GitHub Actions ("gha") is the only supported target`,
      );
    }
    parseRepo(input.repo);

    const agent = await this.requireAgent(workspaceId, agentId);
    const skills = await this.deps.agents.linkedSkills(agent.id);
    const runnerBundle = await this.deps.runnerBundle();

    return generateBundle({
      agent,
      skills,
      runnerBundle,
      triggers: input.triggers,
      postAs: input.post_as,
    });
  }

  // ---- installations ------------------------------------------------------

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.deps.store.listInstallationsForAgent(workspaceId, agentId);
    return rows.map(toInstallationDto);
  }

  // ---- reading runs back --------------------------------------------------

  async listRuns(workspaceId: string, limit: number): Promise<CiRun[]> {
    const rows = await this.deps.store.listRuns(workspaceId, limit);
    return rows.map(toRunDto);
  }

  /**
   * Poll the workspace's installations for new workflow runs, then answer with
   * the refreshed list.
   *
   * **Only repositories this workspace holds an installation for are ever
   * polled** (AC-22) — the loop is over installation rows, so there is no code
   * path that reaches GitHub for anything else.
   *
   * A GitHub failure against one installation does not sink the cycle: the other
   * installations are still read and the list still returns. The alternative is a
   * screen that goes blank because one repository's token was revoked.
   */
  async refresh(workspaceId: string, limit: number): Promise<CiRun[]> {
    const installations = await this.deps.store.listInstallationsForWorkspace(
      workspaceId,
      REFRESH_INSTALLATION_CAP,
    );
    const due = installations.filter((i) => this.isDue(i.id));

    if (due.length > 0) {
      const github = await this.deps.github();
      for (const installation of due) {
        this.lastReadAt.set(installation.id, this.now());
        try {
          await this.readInstallation(workspaceId, github, installation);
        } catch {
          // Swallowed on purpose, and only here: one unreachable repository must
          // not empty the whole screen. The run rows already stored are still
          // returned below.
        }
      }
    }

    return this.listRuns(workspaceId, limit);
  }

  private isDue(installationId: string): boolean {
    const last = this.lastReadAt.get(installationId);
    return last === undefined || this.now() - last >= REFRESH_THROTTLE_MS;
  }

  private async readInstallation(
    workspaceId: string,
    github: GitHubClient,
    installation: StoredCiInstallationWithRun,
  ): Promise<void> {
    const repo = parseRepo(installation.repo);
    const runs = await github.listWorkflowRuns(repo, {
      workflowFile: CI_WORKFLOW_PATH,
      limit: REFRESH_RUNS_PER_INSTALLATION,
    });

    for (const run of runs) {
      await this.readRun(workspaceId, github, installation, repo, run);
    }
  }

  /**
   * One workflow run, stored.
   *
   * **Repository, pull-request number and head SHA come from the workflow run**
   * and never from the artifact (AC-23): the artifact is written by a runner in a
   * repository DevDigest does not control, so it is the payload and GitHub is the
   * authority on provenance. An artifact claiming a different `pr_number` is
   * stored under the run's.
   *
   * A run that has not finished is recorded as `running` and its artifact is not
   * fetched — there is nothing uploaded yet, and the next cycle will read it.
   */
  private async readRun(
    workspaceId: string,
    github: GitHubClient,
    installation: StoredCiInstallationWithRun,
    repo: RepoRef,
    run: CiWorkflowRunRef,
  ): Promise<void> {
    const ranAt = toDate(run.runStartedAt) ?? toDate(run.updatedAt) ?? new Date();
    const base: CiRunWrite = {
      ciInstallationId: installation.id,
      workflowRunId: run.id,
      prNumber: run.prNumber,
      ranAt,
      status: 'running',
      findingsCount: null,
      costUsd: null,
      githubUrl: run.htmlUrl,
      headSha: run.headSha,
      repo: installation.repo,
      source: installation.targetType,
      agent: installation.agentName,
      blockers: null,
      durationS: null,
      reason: null,
    };

    if (run.status !== RUN_STATUS_COMPLETED) {
      await this.deps.store.recordRun(base, null);
      return;
    }

    const bytes = await github.downloadRunArtifact(repo, run.id, CI_RESULT_ARTIFACT_NAME);
    const read = readResultArtifact(bytes);

    if (!read.ok) {
      // ONE row with a named reason, never a dropped run: a run whose artifact
      // expired is a run that HAPPENED. The reason is refined by the run's own
      // conclusion, because an expired artifact and a cancelled run that never
      // uploaded one both arrive as the same absent bytes and a reader would act
      // on them differently. `status` carries the reason too — the CI Runs screen
      // states status as a word, and none of these is a `CiRunStatus` member.
      const reason = reasonForMissingArtifact(read.reason, run.conclusion);
      await this.deps.store.recordRun({ ...base, status: reason, reason }, null);
      return;
    }

    const artifact = read.artifact;
    const durationMs = artifact.duration_ms ?? null;
    const status =
      artifact.status ?? (artifact.findings_count === 0 ? 'no_findings' : 'succeeded');

    const ciRun: CiRunWrite = {
      ...base,
      status,
      findingsCount: artifact.findings_count,
      costUsd: artifact.cost_usd,
      blockers: artifact.blockers ?? null,
      durationS: durationMs === null ? null : durationMs / 1000,
      reason: null,
    };

    const agentRun: CiAgentRunWrite = {
      workspaceId,
      agentId: installation.agentId,
      ranAt,
      provider: null,
      model: null,
      durationMs,
      costUsd: artifact.cost_usd,
      status,
      error: artifact.error ?? null,
      findingsCount: artifact.findings_count,
      blockers: artifact.blockers ?? null,
    };

    await this.deps.store.recordRun(ciRun, agentRun);
  }

  // ---- shared -------------------------------------------------------------

  private async requireAgent(workspaceId: string, agentId: string): Promise<CiAgentFacts> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError(`Agent ${agentId} not found`);
    return agent;
  }
}

/** An ISO timestamp from GitHub, or `null` when the field was absent or junk. */
function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
