/**
 * Every port, every persisted view and the public face of the Export-to-CI
 * module — all of them, here, and types only.
 *
 * No runtime code, so nothing in this file can join an import cycle and the
 * module's whole dependency surface is readable in one sitting. The shape
 * `modules/eval/types.ts`, `modules/brief/types.ts` and
 * `modules/onboarding/types.ts` already use.
 *
 * **NOTHING HERE IMPORTS A SIBLING MODULE.** A types-only import of another
 * module's `types.ts` is a real `no-cross-module-internals` violation —
 * `import type` does not exempt it, and it was measured taking the gate from 22
 * warnings to 24 when another module did exactly that. So the CONSUMER declares
 * the shape of every read it makes and the real implementations satisfy those
 * shapes STRUCTURALLY, with no `implements` clause:
 *
 *  - {@link CiAgentSource} is satisfied by the shared agents repository
 *    (`container.agentsRepo`), by that repository's own method names;
 *  - {@link CiGitHubResolver} by `() => container.github()`;
 *  - {@link CiRunnerBundle} by the composition root's `ciRunnerBundle` arrow
 *    property, which wraps `platform/ci-runner.ts` — that is what keeps this
 *    module off `node:fs` entirely (a feature module may import no `node:`
 *    specifier, and the runner bundle is a file on disk);
 *  - {@link CiSecrets} by `container.secrets`;
 *  - {@link CiStore} by `./repository.ts`;
 *  - {@link Cis} by `./service.ts`, and exposed as the INTERFACE from the
 *    container so `ContainerOverrides.ci` can carry a fake with no database
 *    behind it.
 *
 * **No signature here carries a Drizzle Row type** (`OA-DEEP-002`). A port whose
 * signature names a Row has moved the schema into the contract: the shape becomes
 * whatever the table is, a fake has to build all of it, and the cast in the fake
 * is the tell. The persisted views below are declared field by field for exactly
 * that reason, and every type they are built from is either a primitive or a
 * contract type from the port ring — something a test can construct by hand.
 */
import type {
  CiExport,
  CiExportInput,
  CiExportPreview,
  CiFailOn,
  CiInstallation,
  CiRun,
  CiTarget,
  GitHubClient,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';

/* ─── the agent being exported, and its skills ────────────────────────────── */

/**
 * The agent a bundle is generated from, narrowed to what the manifest carries.
 *
 * Every field is a contract type or a primitive: `provider`, `strategy` and
 * `ciFailOn` are the same three enums `AgentManifest` declares, so the manifest
 * builder needs no widening cast and a test can build one of these in four lines.
 * The real `agents` row satisfies it structurally.
 */
export interface CiAgentFacts {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

/**
 * One skill linked to the agent, narrowed to what the export writes.
 *
 * The body is the skill's RAW body, and the nesting mirrors
 * `AgentsRepository.linkedSkills`'s `{ skill, order }` because structural
 * satisfaction is by name.
 */
export interface CiLinkedSkill {
  skill: {
    id: string;
    name: string;
    body: string;
    enabled: boolean;
  };
  order: number;
}

/**
 * What this module reads about an agent.
 *
 * Satisfied by `container.agentsRepo`; the method names match that repository's
 * because renaming them here would force an adapter that exists only to rename.
 *
 * `getById` takes the workspace id and IS the authorization check — every export
 * and every installation read goes through it first, and `ci_installations`
 * carries no `workspace_id` of its own (the scope path is
 * `ci_runs → ci_installations → agents.workspace_id`).
 *
 * **`linkedSkills` and not a skills SERVICE, deliberately.** `SkillsService`
 * wraps any body whose `source !== 'manual'` in `<untrusted>` before handing it
 * to a prompt, which is the right rule for a prompt this server assembles and the
 * wrong one for a file committed into somebody else's repository: AC-6 asks for
 * "the body of the skill its path names", and pre-wrapped text is not that. The
 * runner wraps every body it reads at ITS end, where the trust decision actually
 * belongs, because by then the file has been sitting in a repository DevDigest
 * does not control.
 */
export interface CiAgentSource {
  getById(workspaceId: string, id: string): Promise<CiAgentFacts | undefined>;
  linkedSkills(agentId: string): Promise<CiLinkedSkill[]>;
}

/* ─── the outside world, as call signatures ───────────────────────────────── */

/**
 * The workspace's GitHub client, resolved per call.
 *
 * A call signature rather than the client itself because resolution is
 * asynchronous and fails loudly: `container.github()` throws
 * `ConfigError('GITHUB_TOKEN is not configured')` when no token is stored, and a
 * preview must be able to run without ever asking (AC-2). The shape
 * `modules/brief` already binds as `github: () => this.github()`.
 */
export type CiGitHubResolver = () => Promise<GitHubClient>;

/**
 * The committed agent-runner bundle, as one string.
 *
 * A bare call signature — no port interface, no adapter, no `ContainerOverrides`
 * field — because reading a build artefact off disk is filesystem work and a
 * feature module may import no `node:` specifier at all. `platform/ci-runner.ts`
 * does the read in the one ring allowed to, and the composition root's
 * `ciRunnerBundle` arrow property satisfies this signature directly. A test
 * injects `async () => 'export {}'` and needs no file.
 */
export type CiRunnerBundle = () => Promise<string>;

/**
 * The secrets provider, in reach of the generator and never read by it.
 *
 * That is the point of declaring it. AC-7 requires that no value obtained from
 * the secrets provider reaches a generated file, and the only way to test a
 * negative is to make the thing reachable and then show it is absent: the test
 * builds the service over a provider returning a distinctive sentinel for every
 * key and asserts no file's contents contain it. A generator that could not
 * reach a secret at all would make that test vacuous — and the day someone
 * decides to "helpfully" bake the key in, the port is already here and the test
 * already fails.
 */
export interface CiSecrets {
  /** `undefined` for an unset key — the shape `SecretsProvider` already has. */
  get(key: string): Promise<string | undefined>;
}

/* ─── the persisted shapes, as the mappers read them ──────────────────────── */

/** A stored `ci_installations` row, narrowed to what this module reads. */
export interface StoredCiInstallation {
  id: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  installedAt: Date;
}

/**
 * An installation plus the status and timestamp of its own most recent run.
 *
 * Derived at read time by a LEFT join, never stored: an installation that has
 * never run is the ordinary first state, and a stored copy would be a
 * denormalisation with a staleness bug in it. `lastRunStatus` is a loose string
 * rather than `CiRunStatus` because AC-24's four reasons are recorded in that
 * column and none of them is an enum member.
 */
export interface StoredCiInstallationWithRun extends StoredCiInstallation {
  agentName: string | null;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
}

/** A stored `ci_runs` row, narrowed to the nine fields AC-28 renders plus its keys. */
export interface StoredCiRun {
  id: string;
  ciInstallationId: string | null;
  workflowRunId: number;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string | null;
  headSha: string | null;
  repo: string | null;
  agent: string | null;
  blockers: number | null;
  durationS: number | null;
  reason: string | null;
}

/** The `ci_runs` columns one read-back writes. */
export interface CiRunWrite {
  ciInstallationId: string;
  workflowRunId: number;
  prNumber: number | null;
  ranAt: Date | null;
  status: string;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  headSha: string | null;
  repo: string;
  /** Which CI system produced it — the installation's target. */
  source: string;
  agent: string | null;
  blockers: number | null;
  durationS: number | null;
  reason: string | null;
}

/**
 * The `agent_runs` columns one ACCEPTED read-back writes.
 *
 * `source` is `'ci'` and `prId` stays null — this run happened against a pull
 * request in a repository the studio may not even have imported, and a non-null
 * `pr_id` would fold a CI run into every PR-feed aggregate. Neither field is on
 * this shape, because neither is the caller's to choose.
 */
export interface CiAgentRunWrite {
  workspaceId: string;
  agentId: string;
  ranAt: Date | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  status: string;
  error: string | null;
  findingsCount: number | null;
  blockers: number | null;
}

/* ─── persistence ─────────────────────────────────────────────────────────── */

/**
 * Data access, satisfied by `./repository.ts` — the only file in this module
 * allowed to name `db/schema` or `drizzle-orm`.
 *
 * {@link CiStore.recordRun} takes both rows in ONE call on purpose. Two sequential
 * awaits from the service would be a two-statement transaction with no
 * transaction, and the failure only shows when the second write throws and the
 * first has already committed; a caller that needs both to land together has no
 * way to ask for it unless one method promises it. Its idempotency is the same
 * property from the other side: the same workflow run read twice updates one
 * `ci_runs` row and the one `agent_runs` row it already points at, rather than
 * inserting a second (AC-26).
 */
export interface CiStore {
  upsertInstallation(input: {
    agentId: string;
    repo: string;
    targetType: CiTarget;
    installedAt: Date;
  }): Promise<StoredCiInstallation>;

  /** Installations of one agent, scoped by the agent's workspace. */
  listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<StoredCiInstallationWithRun[]>;

  /** Installations of every agent in the workspace, newest first, capped. */
  listInstallationsForWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<StoredCiInstallationWithRun[]>;

  /** The workspace's CI runs, newest first, in a TOTAL order (`ran_at desc, id desc`). */
  listRuns(workspaceId: string, limit: number): Promise<StoredCiRun[]>;

  /** One read-back, atomically: the `agent_runs` row (when accepted) and the `ci_runs` row. */
  recordRun(run: CiRunWrite, agentRun: CiAgentRunWrite | null): Promise<StoredCiRun>;
}

/* ─── the module's public face ────────────────────────────────────────────── */

/**
 * What the routes may call, and the interface `ContainerOverrides.ci` carries.
 *
 * Every method takes the workspace id first, and every one of them resolves the
 * agent (or the installation, through the agent) inside that workspace before it
 * does anything else — that lookup is the authorization check this server has.
 */
export interface Cis {
  /** Every file that WOULD be committed. Performs no GitHub write (AC-1, AC-2). */
  preview(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExportPreview>;

  /** Generate, commit, open-or-reuse the pull request, then record the installation. */
  exportToCi(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport>;

  /** One agent's installations, each with the status and age of its latest run. */
  listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]>;

  /** The workspace's CI runs, newest first. */
  listRuns(workspaceId: string, limit: number): Promise<CiRun[]>;

  /** Read new workflow runs back from GitHub, then return the refreshed list. */
  refresh(workspaceId: string, limit: number): Promise<CiRun[]>;
}
