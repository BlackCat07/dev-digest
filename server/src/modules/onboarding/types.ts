/**
 * Ports and row shapes for the Onboarding Tour module — every one of them, here.
 *
 * Types only — no runtime code — so nothing here can join an import cycle and the
 * whole module's dependency surface is readable in one file. The blast and
 * smart-diff modules' own `types.ts` state the same rationale.
 *
 * ONE home, which is what the two modules this one is modelled on actually do:
 * `modules/project-context/types.ts` declares `ProjectContextStore`, the module's
 * public face and `ProjectContextDeps` together, and `modules/intent/sources.ts`
 * declares `IntentStore`, `FeatureModelResolver` and `IntentDeps` together. The
 * list of what a feature needs from the outside world stops being readable in one
 * sitting the moment it is split across three files.
 *
 * NOTHING HERE IMPORTS A SIBLING MODULE, and that is the point of the file. A
 * types-only import of the repo-intel module's `types.ts` would be a real
 * `no-cross-module-internals` violation — `import type` does not exempt it, and it
 * was measured taking `depcruise` from 22 warnings to 24 (`server/INSIGHTS.md`,
 * 2026-08-14). So the CONSUMER declares the shape of every read it makes, and the
 * real implementations satisfy those shapes STRUCTURALLY with no `implements`
 * clause:
 *
 *  - {@link OnboardingIndexReader} is satisfied by `RepoIntelService` (reached as
 *    `container.repoIntel`);
 *  - {@link OnboardingDocReader} is satisfied by `ConfinedRepoDocReader`
 *    (`adapters/git/confined-doc.ts`, reached as `container.repoDocs`);
 *  - {@link FeatureModelResolver} is satisfied by the composition root's own
 *    `featureModel` arrow property;
 *  - {@link OnboardingJobQueue} is satisfied by `platform/jobs.ts`'s runner and
 *    {@link OnboardingLogger} by Fastify's `app.log`;
 *  - {@link TokenCounter} is satisfied by the tokenizer adapter, which no file
 *    under this module imports.
 *
 * {@link OnboardingStore} and {@link OnboardingTours} are the exceptions, and only
 * to the "structurally" part: this module implements both itself, so
 * `OnboardingRepository` and `OnboardingService` do name them in an `implements`
 * clause. They belong here for the other reason — a port declared beside its
 * implementation reads as a property of that implementation, while the container,
 * the routes and every test see nothing but the interface.
 *
 * A second benefit beyond the linter, and the reason to keep the views narrow even
 * if the rule were relaxed: what is declared here IS the list of index facts this
 * feature depends on. A reader can see the whole input surface without opening
 * `repo-intel`.
 */
import type {
  FeatureModelChoice,
  FeatureModelId,
  LLMProvider,
  OnboardingReason,
  OnboardingStatus,
  OnboardingTour,
  OnboardingTourSection,
} from '@devdigest/shared';

/* ─── the index reads ─────────────────────────────────────────────────────── */

/** How much of the repository the index actually covers. */
export type OnboardingIndexCoverage = 'full' | 'partial' | 'degraded' | 'failed';

/** Why the index could not answer fully, in the facade's own vocabulary. */
export type OnboardingIndexDegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

/**
 * The index's own account of itself — the consumer's view of `IndexState`.
 *
 * `status` is declared OPTIONAL even though the facade always sets it, matching
 * `IndexBlastFacts.indexStatus?` next door. An absent status is a third state a
 * consumer has to give a meaning to, and the meaning chosen here is `partial`:
 * refusing to claim a completeness that was never demonstrated. Asserting `full`
 * by default is how a docs-only pull request reported a fully-indexed repository
 * as `index_missing` (`server/INSIGHTS.md`, 2026-08-14).
 */
export interface OnboardingIndexState {
  status?: OnboardingIndexCoverage;
  filesIndexed: number;
  filesSkipped: number;
  /** Empty string when the repository was never indexed — never null on this port. */
  lastIndexedSha: string;
  degraded?: boolean;
  degradedReason?: OnboardingIndexDegradedReason;
}

/** The cached repository map, or its degraded form: empty text and a reason. */
export interface OnboardingRepoMap {
  text: string;
  tokens: number;
  degraded?: boolean;
  reason?: OnboardingIndexDegradedReason;
}

/**
 * One path's position in the index's ranking.
 *
 * Read by the module's membership check rather than by fact collection: a path
 * present in `file_rank` is a path the index holds, which is how a model-supplied
 * path is confirmed to exist (AC-8) and how an absolute or outside path is
 * refused for free.
 */
export interface OnboardingFileRank {
  path: string;
  percentile: number;
}

/**
 * The endpoints and crons the indexer precomputed for one file.
 *
 * The field is `filePath`, not `file` — this mirrors the facade's row verbatim, so
 * there is no mapping layer between the two to drift.
 */
export interface OnboardingFileFacts {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

/**
 * Every read this module makes against the codebase index — and the absences
 * matter as much as the members.
 *
 * There is no write, no indexing trigger and no blast-radius read here: the
 * feature cannot start an index, only describe one. Every array-returning method
 * answers `[]` when the layer is disabled, which is the facade's documented
 * degraded contract; the status stays observable through {@link getIndexState},
 * which is why that method is the first thing fact collection calls.
 */
export interface OnboardingIndexReader {
  /** ALWAYS answers, synthesising a degraded state when there is no row. */
  getIndexState(repoId: string): Promise<OnboardingIndexState>;
  /** Top-N paths by rank DESC, already filtered of tests, configs and migrations. */
  getTopFilesByRank(repoId: string, n: number, opts?: { exclude?: string[] }): Promise<string[]>;
  /** Dependency chains from the highest-ranked files. `[]` when the graph has no edges. */
  getCriticalPaths(repoId: string): Promise<string[][]>;
  /** The cached repository map. Called with NO budget — see `MAX_PROMPT_TOKENS`. */
  getRepoMap(repoId: string, tokenBudget?: number): Promise<OnboardingRepoMap>;
  /** One row per given path the index holds. The membership oracle for AC-8. */
  getFileRank(repoId: string, paths: string[]): Promise<OnboardingFileRank[]>;
  /** Precomputed endpoint/cron facts for the given paths. */
  getFileFacts(repoId: string, paths: string[]): Promise<OnboardingFileFacts[]>;
}

/* ─── the clone reads ─────────────────────────────────────────────────────── */

/** A repository, narrowed to what the confined reader needs to find its clone. */
export interface OnboardingRepoRef {
  owner: string;
  name: string;
}

/** Either a document's text, or the reason it was refused. Never a throw. */
export type RepoDocRead = { ok: true; text: string } | { ok: false; note: string };

/** One file the walk reported: metadata only, never text. */
export interface RepoDocEntry {
  /** Repo-relative, forward-slash separated. */
  path: string;
  /** Size in bytes, from `stat` — no byte of the file was read to produce it. */
  size: number;
  updatedAt: Date | null;
}

/**
 * The bounds of one walk — all of them owned by this module (see `constants.ts`).
 *
 * They travel as arguments precisely because `src/adapters/**` may import nothing
 * from `src/modules/**`: the adapter enforces the bounds, the feature chooses
 * them.
 */
export interface RepoDocWalkOptions {
  roots: readonly string[];
  excludedDirs: readonly string[];
  maxEntries: number;
  limit: number;
  /**
   * Which files count, replacing the adapter's default `*.md`-under-a-root rule.
   *
   * This feature supplies one, because a `package.json` is not a document and no
   * `roots` value could ever select it. The predicate cannot widen confinement:
   * it only proposes candidates, and every candidate still goes through the
   * adapter's `resolve` — so a symlink escaping the clone is omitted whatever the
   * predicate says.
   */
  match?: (name: string, rel: string) => boolean;
}

/** The walk's result, or the reason there is none. Never a throw. */
export type RepoDocWalk =
  | {
      ok: true;
      docs: RepoDocEntry[];
      /** Confined matches found BEFORE the cap was applied. */
      total: number;
      truncated: boolean;
      /** The entry budget ran out mid-walk, so `total` is itself a floor. */
      entryBudgetExhausted: boolean;
    }
  | { ok: false; note: string };

/**
 * Listing and reading files inside a repository's local clone, path-confined.
 *
 * Declared here and implemented in the adapters ring
 * (`adapters/git/confined-doc.ts`, satisfied structurally) because the
 * confinement — `realpath` at both ends, a prefix check, regular files only — is
 * filesystem work, and a feature module importing Node's own filesystem module is
 * INVISIBLE to `.dependency-cruiser.cjs`: its `modules-no-raw-sdk` rule enumerates
 * SDKs and not that one, so a module reading the disk passes the very gate that
 * guards this ring (`server/INSIGHTS.md`, 2026-08-10). No file under this module
 * imports it, and the grep for it is a gate of its own — which is why the name is
 * not spelled out anywhere in this directory, not even in a comment.
 *
 * `GitClient.readFile` is deliberately not used instead: it joins and reads in one
 * step, which drops the post-`realpath` re-check that is the only defence against
 * a checked-in symlink pointing out of the clone.
 */
export interface OnboardingDocReader {
  read(repo: OnboardingRepoRef, candidate: string): Promise<RepoDocRead>;
  list(repo: OnboardingRepoRef, options: RepoDocWalkOptions): Promise<RepoDocWalk>;
}

/* ─── the model choice ────────────────────────────────────────────────────── */

/**
 * Resolving the workspace's chosen provider+model for one feature (AC-14).
 *
 * A call signature declared by its consumer rather than a call to the settings
 * module's `feature-models.ts`, for the reason the dependency graph makes plain:
 * importing that sibling both crosses a module boundary
 * (`no-cross-module-internals`) and — when the helper took the container — closed
 * a cycle through the DI root. The composition root already exposes an arrow
 * property of exactly this shape, and the intent module consumes it the same way
 * through its own `FeatureModelResolver` (`server/INSIGHTS.md`, 2026-08-10, which
 * records the arrangement as the fix that REMOVED the edge). The module that still
 * imports the helper directly is the conventions one, an accepted pre-existing
 * warning and not a pattern to copy.
 */
export interface FeatureModelResolver {
  (workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice>;
}

/* ─── what the deterministic layer produces ───────────────────────────────── */

/**
 * Everything the tour is built from, collected before any model call.
 *
 * This bundle is the whole input surface of the generation: what is not here
 * cannot reach the prompt, so "the model was told only about the index and the
 * declared commands" is readable from one type. `status` and `reason` travel with
 * it because they are derived from the same index read — a caller that collected
 * facts and then asked separately how complete they were could get two answers
 * from two moments.
 */
export interface OnboardingFacts {
  /** The index's coverage, in the tour's vocabulary (AC-19). */
  status: OnboardingStatus;
  /** Why it is not `ok`, or null when it is. */
  reason: OnboardingReason | null;
  /** Head commit the index was built at; null when the repository was never indexed. */
  indexedSha: string | null;
  /** THIS generation's coverage figures, recorded on the tour so it never claims today's (AC-40). */
  filesIndexed: number;
  filesSkipped: number;
  /** Candidate reading path, rank DESC, junk already filtered by the index (AC-5, AC-6). */
  rankedPaths: string[];
  /** Dependency chains, at most five, each of two or three distinct paths (AC-7). */
  criticalChains: string[][];
  /** The cached repository map's text; empty when the map is degraded. */
  repoMap: string;
  /** Endpoint and cron facts for the highest-ranked files that declare any (N11). */
  endpointFacts: OnboardingFileFacts[];
}

/* ─── the persistence ─────────────────────────────────────────────────────── */

/** A repository, narrowed to what a generation needs. No Drizzle row escapes. */
export interface OnboardingRepoRow {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

/** Everything a generation records, in one write. */
export interface StoredTourWrite {
  sections: OnboardingTourSection[];
  status: OnboardingTour['status'];
  reason: OnboardingTour['reason'];
  indexedSha: string | null;
  filesIndexed: number;
  filesSkipped: number;
  provider: string | null;
  model: string | null;
  attempts: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  error: string | null;
}

/** The stored row, with its body already parsed. */
export interface StoredTour {
  sections: OnboardingTourSection[];
  /**
   * False when the stored body did not survive its parse.
   *
   * Kept as a flag rather than thrown, so a tour written by an older shape
   * degrades to "no sections, and a reason" instead of turning the read into a
   * 500 nobody can clear without a database.
   */
  bodyValid: boolean;
  state: 'running' | 'ready';
  status: OnboardingTour['status'];
  reason: OnboardingTour['reason'];
  indexedSha: string | null;
  filesIndexed: number;
  filesSkipped: number;
  model: string | null;
  attempts: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  generatedAt: Date;
  startedAt: Date | null;
}

/**
 * The data the service needs, as a call surface it declares for itself.
 *
 * The service is constructed with this rather than with the concrete class, so a
 * test injects an in-memory fake and needs no Postgres — the arrangement
 * `ProjectContextStore` uses, declared in its module's `types.ts` exactly as this
 * one is, and the reason both suites are hermetic.
 */
export interface OnboardingStore {
  getRepo(workspaceId: string, repoId: string): Promise<OnboardingRepoRow | undefined>;
  repoExists(repoId: string): Promise<boolean>;
  get(repoId: string): Promise<StoredTour | undefined>;
  markRunning(repoId: string, startedAt: Date): Promise<void>;
  save(repoId: string, write: StoredTourWrite, generatedAt: Date): Promise<void>;
  clearRunning(repoId: string, message: string, reason: OnboardingTour['reason']): Promise<void>;
}

/* ─── what the composition root supplies ──────────────────────────────────── */

/**
 * The two levels this service logs at, when a caller offers a logger.
 *
 * `app.log` and pino satisfy it, and it arrives as a PARAMETER rather than a
 * field — the shape `IntentWarnLogger` set. The service invents no sink of its
 * own, because that would put a second one next to the caller's.
 */
export interface OnboardingLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** The job queue, as the call surface this module uses and no more. */
export interface OnboardingJobQueue {
  register(
    kind: string,
    handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>,
  ): void;
  enqueue(
    workspaceId: string,
    kind: string,
    payload: unknown,
  ): Promise<{ id: string; done: Promise<void> }>;
}

/** Counting tokens, as a call signature, so nothing here imports the adapter. */
export interface TokenCounter {
  count(text: string): number;
}

/**
 * Every port this module uses, declared here and satisfied structurally.
 *
 * The absences are the point, as they are in `project-context/types.ts`: there
 * is no GitHub client, no embedder and no `db` in reach — the tour is built from
 * the index, the clone's declared command files and one model call, and that is
 * readable from this one interface.
 */
export interface OnboardingDeps {
  store: OnboardingStore;
  index: OnboardingIndexReader;
  repoDocs: OnboardingDocReader;
  featureModel: FeatureModelResolver;
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
  jobs: OnboardingJobQueue;
  tokenizer: TokenCounter;
}

/* ─── the module's public face ────────────────────────────────────────────── */

/** What the transport ring and the container see. */
export interface OnboardingTours {
  registerJobHandler(log?: OnboardingLogger): void;
  getTour(workspaceId: string, repoId: string): Promise<OnboardingTour>;
  requestGeneration(
    workspaceId: string,
    repoId: string,
    log?: OnboardingLogger,
  ): Promise<{ status: 'accepted'; jobId: string }>;
  runGeneration(workspaceId: string, repoId: string, log?: OnboardingLogger): Promise<void>;
}
