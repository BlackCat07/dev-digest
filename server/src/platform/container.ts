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
