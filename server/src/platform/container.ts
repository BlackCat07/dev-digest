import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  FeatureModelChoice,
  FeatureModelId,
  LLMProvider,
  SmartDiffRole,
  UnifiedDiff,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { ConfinedRepoDocReader } from '../adapters/git/confined-doc.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { SkillsService } from '../modules/skills/service.js';
import { IntentService } from '../modules/intent/service.js';
import { SmartDiffService } from '../modules/smart-diff/service.js';
import { classifyPath } from '../modules/smart-diff/classify.js';
import { BlastService } from '../modules/blast/service.js';
import { PriorPrsService } from '../modules/prior-prs/service.js';
import { ProjectContextService } from '../modules/project-context/service.js';
import { ProjectContextRepository } from '../modules/project-context/repository.js';
import type { ProjectContext } from '../modules/project-context/types.js';
import { OnboardingService } from '../modules/onboarding/service.js';
import { OnboardingRepository } from '../modules/onboarding/repository.js';
import type { OnboardingTours } from '../modules/onboarding/types.js';
import { BriefService } from '../modules/brief/service.js';
import { BriefRepository } from '../modules/brief/repository.js';
import type { PrBriefs } from '../modules/brief/types.js';
import { resolveFeatureModel } from '../modules/settings/feature-models.js';
import { EvalRepository } from '../modules/eval/repository.js';
import { EvalRunner } from '../modules/eval/runner.js';
import { EvalService } from '../modules/eval/service.js';
import type { Evals } from '../modules/eval/types.js';
import { CiRepository } from '../modules/ci/repository.js';
import { CiService } from '../modules/ci/service.js';
import type { Cis } from '../modules/ci/types.js';
import { loadCiRunnerBundle } from './ci-runner.js';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { MultiAgentRepository } from '../modules/multi-agent/repository.js';
import { MultiAgentService } from '../modules/multi-agent/service.js';
import { MultiAgentNotesService, type MultiAgentSynthesis } from '../modules/multi-agent/notes.js';
import type { MultiAgentRecorder, MultiAgentReview } from '../modules/multi-agent/types.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /**
   * Project Context (L05) — tests inject a fake so the review executor can be
   * exercised without a database or a clone.
   */
  projectContext?: ProjectContext;
  /**
   * Onboarding Tour (L05) — tests inject a fake service, or construct the real
   * one over fake ports, so a generation can be exercised with no Postgres, no
   * clone and no provider.
   */
  onboarding?: OnboardingTours;
  /**
   * PR Brief (L05) — tests inject a fake service, or construct the real one over
   * fake ports, so a generation can be exercised with no Postgres, no clone and
   * no provider.
   */
  brief?: PrBriefs;
  /**
   * Eval Pipeline (L06) — tests inject a fake service so a route can be
   * exercised with no Postgres, no provider and no batch actually running.
   */
  eval?: Evals;
  /**
   * Export to CI (L06) — tests inject a fake service so a route can be exercised
   * with no Postgres, no GitHub token and nothing committed anywhere.
   */
  ci?: Cis;
  /**
   * Multi-Agent Review (L07) — tests inject a fake read service so the route can
   * be exercised with no Postgres. Injecting the REAL service over a fake store
   * is the other half of the same seam, and is how the route tests prove the
   * read makes no model call.
   */
  multiAgent?: MultiAgentReview;
  /**
   * The multi-run record writer the REVIEWS module consumes when it fans a pull
   * request out. Its own field, and not part of `multiAgent`, because the two
   * are different directions: one is a read the transport calls, the other is a
   * write a sibling module makes, and a test of the create path fakes only the
   * second.
   */
  multiAgentRecorder?: MultiAgentRecorder;
  /**
   * The one model call the feature makes, triggered from the executor's
   * completion. Its own field for the same reason as the recorder above: it is a
   * third direction — a background write nothing on the read path may reach —
   * and a test of the create path fakes it to count calls.
   */
  multiAgentNotes?: MultiAgentSynthesis;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _repoDocs?: ConfinedRepoDocReader;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _skills?: SkillsService;
  private _intent?: IntentService;
  private _smartDiff?: SmartDiffService;
  private _blast?: BlastService;
  private _priorPrs?: PriorPrsService;
  private _projectContext?: ProjectContext;
  private _onboarding?: OnboardingTours;
  private _brief?: PrBriefs;
  private _eval?: Evals;
  private _ci?: Cis;
  private _multiAgentStore?: MultiAgentRepository;
  private _multiAgent?: MultiAgentReview;
  private _multiAgentNotes?: MultiAgentSynthesis;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  /**
   * L03 — path-confined reads of a document inside a repo's local clone.
   *
   * Its own getter rather than a method on `git` because `GitClient` lives in
   * `src/vendor/shared/`, which is coordination-only; the intent module declares
   * the shape it needs (`RepoDocReader`) and this adapter satisfies it
   * structurally. Built off `this.git` so a test that overrides `git` overrides
   * the clone location this reader confines to, with nothing extra to stub.
   */
  get repoDocs(): ConfinedRepoDocReader {
    return (this._repoDocs ??= new ConfinedRepoDocReader(this.git));
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  /**
   * Skills (L02). Exposed as the SERVICE, not the repository, because the one
   * cross-module need — a review run resolving an agent's skill bodies — has to
   * apply the enabled filter and the untrusted-source wrapping, and neither is a
   * query. Reviews must not re-derive those rules for itself.
   */
  get skills(): SkillsService {
    return (this._skills ??= new SkillsService(this));
  }

  /**
   * Intent (L03). Exposed as the SERVICE for the same reason `skills` is, and
   * NOT as a repository: `pr_intent` already belongs to `reviewRepo`, and the
   * one cross-module need — a review run resolving the PR's intent before the
   * per-agent loop — has to apply the staleness rule, claim the row, bound the
   * model call and record its own failure. None of that is a query, and the
   * reviews module must not re-derive any of it for itself.
   */
  get intent(): IntentService {
    // One argument: this container, as the set of ports the service declares
    // (`IntentDeps`, which a Container satisfies structurally — including
    // `featureModel` and `repoDocs` below). It used to be passed twice, the
    // second time as the composition root that `resolveFeatureModel` demanded;
    // that call is now a port, which is what removed this module's import cycle
    // with THIS file.
    return (this._intent ??= new IntentService(this));
  }

  /**
   * Smart Diff (L03b). Exposed as the SERVICE and given no repository of its own:
   * every table it reads — `pull_requests`, `pr_files`, `reviews`, `findings` —
   * already belongs to `reviewRepo`.
   *
   * Note how little it asks for. `SmartDiffDeps` declares ONE port, so this
   * getter's `this` is satisfied by `reviewRepo` alone — no LLM, no GitHub, no
   * git, no jobs. That is the feature's central claim expressed in the wiring: a
   * model call is not something this service chose not to make, it is something
   * it has no way to make.
   */
  get smartDiff(): SmartDiffService {
    return (this._smartDiff ??= new SmartDiffService(this));
  }

  /**
   * Blast Radius (L04). Like Smart Diff: the SERVICE, with no repository of its
   * own — `pull_requests` and `pr_files` already belong to `reviewRepo`, and every
   * codebase fact comes from the `repoIntel` facade below.
   *
   * `BlastDeps` declares TWO ports and no more, so this getter's `this` is
   * satisfied by `reviewRepo` and `repoIntel` alone. The second one is why the
   * feature costs nothing to serve: it reads index rows the clone/fetch pipeline
   * already wrote, so the route re-parses no AST and rebuilds no import graph.
   * And there is still no LLM port in reach — see the note on `smartDiff`.
   */
  get blast(): BlastService {
    return (this._blast ??= new BlastService(this));
  }

  /**
   * Prior PRs (L04) — the history half of the Blast Radius card.
   *
   * The narrowest service in this container: `PriorPrsDeps` declares ONE port, so
   * this getter's `this` is satisfied by `reviewRepo` alone. Not even `repoIntel`
   * is in reach, which is the wiring saying what the feature is — a query over
   * `pr_files` of other pull requests, with no codebase analysis and no model.
   */
  get priorPrs(): PriorPrsService {
    return (this._priorPrs ??= new PriorPrsService(this));
  }

  /**
   * Project Context (L05) — the repository's documents, an owner's attachments,
   * and the effective set one run carries.
   *
   * Exposed as the `ProjectContext` INTERFACE rather than the class, the shape
   * `repoIntel` already has, so `ContainerOverrides.projectContext` can carry a
   * fake with no database behind it — which is what lets the review executor be
   * tested hermetically.
   *
   * This is also the one place that names the concrete repository: the service
   * declares two ports (`ProjectContextDeps`) and knows nothing about Drizzle,
   * so the composition root is what binds the two. `repoDocs` is the confined
   * reader the intent module already uses — a third consumer of one adapter
   * rather than a third copy of clone-path confinement.
   */
  get projectContext(): ProjectContext {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    return (this._projectContext ??= new ProjectContextService({
      store: new ProjectContextRepository(this.db),
      repoDocs: this.repoDocs,
    }));
  }

  /**
   * Onboarding Tour (L05) — the repository's five-part tour, and the one
   * structured call that writes it.
   *
   * The one place that names the concrete repository, as it is for
   * `projectContext`: `OnboardingDeps` declares seven ports and knows nothing
   * about Drizzle, so the composition root is what binds them. Two of them are
   * worth reading as wiring rather than as plumbing — `featureModel` is the
   * arrow property below, which is what lets the module resolve the workspace's
   * model choice while importing nothing from `modules/settings/`; and
   * `repoDocs` is the confined reader the intent and project-context modules
   * already use, a fourth consumer of one adapter rather than a fourth copy of
   * clone-path confinement.
   *
   * Exposed as the `OnboardingTours` INTERFACE so `ContainerOverrides.onboarding`
   * can carry a fake with no database behind it.
   */
  get onboarding(): OnboardingTours {
    if (this.overrides.onboarding) return this.overrides.onboarding;
    return (this._onboarding ??= new OnboardingService({
      store: new OnboardingRepository(this.db),
      index: this.repoIntel,
      repoDocs: this.repoDocs,
      featureModel: this.featureModel,
      llm: (id) => this.llm(id),
      jobs: this.jobs,
      tokenizer: this.tokenizer,
    }));
  }

  /**
   * PR Brief (L05) — what a pull request does, why, and where it may hurt.
   *
   * The one place that names the concrete repository, as it is for
   * `projectContext` and `onboarding`: `BriefDeps` declares twelve ports and
   * knows nothing about Drizzle, so the composition root is what binds them.
   * Three of them are wiring rather than plumbing — `fileRole` is the arrow
   * property below, which is what lets the module order a changed-file list by
   * Smart Diff's role while importing nothing from `modules/smart-diff/`;
   * `featureModel` is the same arrangement for the workspace's model choice; and
   * `intent`, `blast`, `priorPrs` and `projectContext` are the four derivations
   * this feature consumes through their own facades rather than by re-querying
   * their tables.
   *
   * Exposed as the `PrBriefs` INTERFACE so `ContainerOverrides.brief` can carry a
   * fake with no database behind it.
   */
  get brief(): PrBriefs {
    if (this.overrides.brief) return this.overrides.brief;
    return (this._brief ??= new BriefService({
      store: new BriefRepository(this.db),
      intent: this.intent,
      blast: this.blast,
      priorPrs: this.priorPrs,
      projectContext: this.projectContext,
      agents: this.agentsRepo,
      repoDocs: this.repoDocs,
      fileRole: this.fileRole,
      featureModel: this.featureModel,
      llm: (id) => this.llm(id),
      github: () => this.github(),
      jobs: this.jobs,
    }));
  }

  /**
   * Eval Pipeline (L06) — an agent's eval set, one on-demand batch over it, and
   * the numbers a prompt edit moves.
   *
   * The one place that names this module's concrete classes, as it is for
   * `projectContext`, `onboarding` and `brief`: `EvalDeps` declares five ports
   * and knows nothing about Drizzle, about `src/adapters/**` or about a sibling
   * module, so the composition root is what binds them. Three of the five are
   * wiring rather than plumbing — `findings` is the shared review repository and
   * `agents` the shared agents repository, which is how this module reads
   * findings, pull requests and agent versions while importing no sibling; and
   * `parseDiff` is the `diffParser` arrow property below, which is what keeps it
   * off `src/adapters/**` entirely.
   *
   * The runner's `skills` port is bound the same way, and it is what makes the
   * THIRD lever of this feature work: a replay carries the batch's snapshotted
   * prompt and model plus the agent's currently linked skill bodies, so editing
   * a linked skill moves the numbers. Bound from `this.skills` — the service, not
   * `SkillsRepository` — because the enabled filter and `wrapUntrusted` are that
   * service's rules.
   *
   * **The service and its runner share ONE repository instance.** Two would be
   * two connection users writing the same rows for no reason, and a fake
   * injected into one of them in a test would leave the other real.
   *
   * No bound is passed to the runner: the four deadline/concurrency figures live
   * in `modules/eval/constants.ts`, and `EvalRunnerDeps` accepts overrides only
   * so a test can exercise a deadline in milliseconds rather than in minutes.
   *
   * Exposed as the `Evals` INTERFACE so `ContainerOverrides.eval` can carry a
   * fake with no database behind it.
   */
  get eval(): Evals {
    if (this.overrides.eval) return this.overrides.eval;
    if (this._eval) return this._eval;
    const store = new EvalRepository(this.db);
    return (this._eval = new EvalService({
      store,
      findings: this.reviewRepo,
      agents: this.agentsRepo,
      parseDiff: this.diffParser,
      runner: new EvalRunner({
        store,
        parseDiff: this.diffParser,
        llm: (id) => this.llm(id),
        bus: this.runBus,
        // The agent's enabled skill bodies, from the same service the real
        // review path resolves them through — `this.skills`, the SERVICE and not
        // the repository, because the enabled filter and the untrusted-source
        // wrapping are its rules and the eval module must not own a second copy
        // of them.
        skills: this.skills,
      }),
    }));
  }

  /**
   * Export to CI (L06) — the generated bundle, the pull request that installs it,
   * and the runs read back off GitHub Actions.
   *
   * The one place that names this module's concrete classes, as it is for
   * `projectContext`, `onboarding`, `brief` and `eval`: `CiDeps` declares five
   * ports and knows nothing about Drizzle, about `src/adapters/**` or about a
   * sibling module, so the composition root is what binds them. Two of the five
   * are wiring rather than plumbing — `agents` is the shared agents repository,
   * which is how this module reads an agent and its linked skills while importing
   * no sibling; and `runnerBundle` is the arrow property below, which is what
   * keeps a feature module off `node:fs` while still shipping a file from disk.
   *
   * `secrets` is bound and deliberately never read: AC-7 requires that no secret
   * value reaches a generated file, and a port in reach but unused is what makes
   * the sentinel test that proves it mean something.
   *
   * Exposed as the `Cis` INTERFACE so `ContainerOverrides.ci` can carry a fake
   * with no database behind it.
   */
  get ci(): Cis {
    if (this.overrides.ci) return this.overrides.ci;
    return (this._ci ??= new CiService({
      store: new CiRepository(this.db),
      agents: this.agentsRepo,
      github: () => this.github(),
      runnerBundle: this.ciRunnerBundle,
      secrets: this.secrets,
    }));
  }

  /**
   * L06 — the committed `agent-runner` bundle, as one string.
   *
   * Wired here for the reason `diffParser` below gives, with one addition: the
   * read is `node:fs`, and a feature module may import no `node:` specifier at
   * all. `platform/ci-runner.ts` does it in the one ring allowed to and knows
   * nothing about `modules/ci/` (`platform-not-module-aware` is a depcruise
   * **error**), and the `ci` module declares the shape it needs
   * (`CiRunnerBundle` — a bare call signature) which this property satisfies
   * structurally.
   *
   * An arrow property rather than a method, as `featureModel`, `fileRole` and
   * `diffParser` are: it satisfies the bare call signature directly and carries
   * `this` with it wherever the container is destructured. The loader caches for
   * the life of the process — the bundle is a build artefact and cannot change
   * under a running server — so there is nothing to cache here.
   */
  readonly ciRunnerBundle = (): Promise<string> => loadCiRunnerBundle();

  /**
   * Multi-Agent Review (L07) — one pull request fanned out to several agents,
   * read back as columns plus the locations they did not all agree on.
   *
   * The one place that names this module's concrete classes, as it is for
   * `projectContext`, `onboarding`, `brief` and `eval`: the service declares ONE
   * port (`{ store }`) and knows nothing about Drizzle, about `src/adapters/**`
   * or about a sibling module, so the composition root is what binds it.
   *
   * Read the port list as the feature's own claim: there is no LLM in it. AC-23
   * requires the read to make no model call, and that is expressed here as the
   * absence of a provider rather than as a rule somebody has to keep — the
   * service could not make one if it tried. The synthesis that DOES spend a call
   * runs off the executor's completion and writes to storage, which this read
   * merely reads back.
   *
   * Exposed as the `MultiAgentReview` INTERFACE so `ContainerOverrides.multiAgent`
   * can carry a fake with no database behind it.
   */
  get multiAgent(): MultiAgentReview {
    if (this.overrides.multiAgent) return this.overrides.multiAgent;
    return (this._multiAgent ??= new MultiAgentService({ store: this.multiAgentStore }));
  }

  /**
   * The multi-run parent record, as the REVIEWS module writes it.
   *
   * This is the cross-module edge, and it runs in exactly ONE direction: the
   * reviews module declares the call signature it needs and this getter
   * satisfies it structurally, so that module imports nothing from
   * `modules/multi-agent/` and this module imports nothing from
   * `modules/reviews/`. A second edge in the other direction would close a cycle
   * through this file — the arrangement `featureModel` and `fileRole` already
   * use, and the one that took the gate from 24 warnings back to 22.
   *
   * Bound to the same repository INSTANCE the read service holds: two would be
   * two connection users over one table for no reason, and a fake injected into
   * one of them would leave the other real.
   */
  get multiAgentRecorder(): MultiAgentRecorder {
    return this.overrides.multiAgentRecorder ?? this.multiAgentStore;
  }

  /**
   * The one model call the Multi-Agent feature makes: the stance sentences and
   * the group labels, produced together after every run of a fan-out is
   * terminal.
   *
   * A THIRD binding rather than a method on `multiAgent`, and the separation is
   * the criterion: the read service has no provider in its port list, which is
   * how "a read makes no model call" (AC-23) is expressed — as a call it has no
   * way to make. Folding this task into it would have replaced that property
   * with a rule somebody has to keep. The reviews module triggers it through
   * this getter's INTERFACE, so it imports nothing from `modules/multi-agent/`,
   * exactly as it does for the recorder above.
   *
   * Bound to the same repository instance as the read, so the columns the
   * synthesis groups are the columns the read will render.
   */
  get multiAgentNotes(): MultiAgentSynthesis {
    if (this.overrides.multiAgentNotes) return this.overrides.multiAgentNotes;
    return (this._multiAgentNotes ??= new MultiAgentNotesService({
      store: this.multiAgentStore,
      featureModel: this.featureModel,
      llm: (id) => this.llm(id),
    }));
  }

  /** The one `multi_agent_runs` repository instance, shared by all three getters. */
  private get multiAgentStore(): MultiAgentRepository {
    return (this._multiAgentStore ??= new MultiAgentRepository(this.db));
  }

  /**
   * L06 — a raw unified diff parsed into files and hunks.
   *
   * Wired here for the reason `fileRole` above gives: the parser is an ADAPTER,
   * and a feature module reaching into `src/adapters/**` is the blind spot
   * `depcruise` cannot express as a rule (`OA-APP-001`) — it is caught by
   * reading, or not at all. The eval module declares the shape it needs (`DiffParser` in
   * `modules/eval/types.ts` — a bare call signature) and this property satisfies
   * it structurally, so that module imports nothing under `src/adapters/`.
   *
   * An arrow property rather than a method, as `featureModel` and `fileRole` are:
   * it satisfies the bare call signature directly and carries `this` with it
   * wherever the container is destructured. Pure — no clock, no I/O, no secrets —
   * so there is nothing to cache and nothing to override.
   */
  readonly diffParser = (raw: string): UnifiedDiff => parseUnifiedDiff(raw);

  /**
   * L03 — the workspace's chosen provider+model for one feature.
   *
   * Wired here, in the one ring allowed to know every module, so the intent
   * module needs no import of `modules/settings/`. An arrow property rather than
   * a method so it satisfies the `FeatureModelResolver` call signature directly
   * and carries `this` with it wherever the container is destructured.
   */
  readonly featureModel = (
    workspaceId: string,
    id: FeatureModelId,
  ): Promise<FeatureModelChoice> => resolveFeatureModel(this.db, workspaceId, id);

  /**
   * L05 — the Smart Diff role of one changed file, from its path alone.
   *
   * Wired here because this is the ONE ring allowed to name two modules at once:
   * the classifier lives inside the smart-diff module and publishes nothing, and
   * a feature module importing it directly is a `no-cross-module-internals`
   * violation that `import type` does not exempt (measured at 22 warnings going
   * to 24 — `server/INSIGHTS.md`, 2026-08-14). The brief declares the shape it
   * needs (`FileRoleClassifier` in `modules/brief/file-roles.ts`) and this
   * property satisfies it structurally, so that module imports no sibling.
   *
   * An arrow property rather than a method, for the reason `featureModel` above
   * gives: it satisfies the bare call signature directly and carries `this` with
   * it wherever the container is destructured. Pure — no clock, no I/O, no
   * secrets — so there is nothing to cache and nothing to override.
   */
  readonly fileRole = (path: string): SmartDiffRole => classifyPath(path);

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
