/**
 * Ports and row shapes for the PR Brief module — every one of them, here.
 *
 * Types only, no runtime code, so nothing in this file can join an import cycle
 * and the whole module's dependency surface is readable in one sitting. ONE home
 * is what the two modules this one is modelled on actually do:
 * `modules/onboarding/types.ts` declares its store, its ports and its public
 * face together, and `modules/project-context/types.ts` does the same — the list
 * of what a feature needs from the outside world stops being readable the moment
 * it is split across three files.
 *
 * NOTHING HERE IMPORTS A SIBLING MODULE, and that is the point of the file. A
 * types-only import of another module's `types.ts` is a real
 * `no-cross-module-internals` violation — `import type` does not exempt it, and
 * it was measured taking `depcruise` from 22 warnings to 24 when the blast module
 * did exactly that (`server/INSIGHTS.md`, 2026-08-14). So the CONSUMER declares
 * the shape of every read it makes and the real implementations satisfy those
 * shapes STRUCTURALLY, with no `implements` clause:
 *
 *  - {@link BriefIntentReader} is satisfied by `IntentService` (`container.intent`);
 *  - {@link BriefBlastReader} by `BlastService` (`container.blast`);
 *  - {@link BriefPriorPrsReader} by `PriorPrsService` (`container.priorPrs`);
 *  - {@link BriefDocSetReader} by `ProjectContextService` (`container.projectContext`);
 *  - {@link BriefAgentLister} by the shared agents repository (`container.agentsRepo`);
 *  - {@link BriefDocReader} by `ConfinedRepoDocReader` (`container.repoDocs`);
 *  - {@link FeatureModelResolver} and {@link FileRoleClassifier} by the
 *    composition root's own `featureModel` and `fileRole` arrow properties;
 *  - {@link BriefJobQueue} by `platform/jobs.ts`'s runner, {@link BriefLogger} by
 *    Fastify's `app.log`, and {@link BriefGitHubIssueReader} by the octokit
 *    adapter.
 *
 * {@link BriefStore} and {@link PrBriefs} are the exceptions, and only to the
 * "structurally" part: this module implements both itself, so `BriefRepository`
 * and the service do name them in an `implements` clause. They belong here for
 * the other reason — a port declared beside its implementation reads as a
 * property of that implementation, while the container, the routes and every
 * test see nothing but the interface.
 *
 * Two absences are worth reading as design rather than as omission. There is no
 * `db` in reach, so nothing above `repository.ts` can issue a query; and no port
 * here returns a patch, so the model input CANNOT carry a diff hunk body on any
 * path — the token budget rests on that absence rather than on remembering to
 * trim.
 *
 * {@link FileRoleClassifier} is imported from `./file-roles.js` — the same
 * module, so no cross-module edge — and is re-exported below so a consumer takes
 * the whole port surface from one import.
 */
import type {
  BlastCounts,
  BlastEndpoint,
  BlastReason,
  BlastStatus,
  BriefDiffStats,
  BriefReason,
  BriefSource,
  BriefStatus,
  ChangedSymbol,
  EffectiveContextDoc,
  FeatureModelChoice,
  FeatureModelId,
  IntentStatus,
  LLMProvider,
  PrRiskBrief,
  PriorPrsReason,
  PriorPrsStatus,
  Risk,
  RiskLevel,
  ReviewFocusItem,
} from '@devdigest/shared';
import type { FileRoleClassifier } from './file-roles.js';

export type { FileRoleClassifier };

/* ─── the pull request and its files ──────────────────────────────────────── */

/**
 * A repository, narrowed to what a clone read and a GitHub read need to address
 * it. No Drizzle row escapes the persistence ring.
 */
export interface BriefRepoRef {
  owner: string;
  name: string;
}

/**
 * The pull request, narrowed to what a brief is built from.
 *
 * `branch` and `base` are here because the title block names them (AC-10);
 * `additions`, `deletions` and `filesCount` because a degraded brief still
 * carries the deterministic figures the assembly held (AC-30); `updatedAt`
 * because it is the one field that says the row was refreshed at all.
 */
export interface BriefPull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  branch: string;
  base: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
  updatedAt: Date | null;
}

/**
 * One changed file of the pull request: its path and its two counts.
 *
 * **There is no `patch` field, and that is the whole point.** AC-11 forbids a
 * diff hunk body anywhere in the model input, and the cheapest way to guarantee
 * it is to make the body unreachable from this module rather than to remember not
 * to send it: the repository selects three columns, and nothing above it has a
 * patch to leak. A test that wants to prove the absence can still hand in a row
 * carrying one — the extra property is structurally harmless — which is exactly
 * how `test/brief-assemble.test.ts` asserts that no substring of any patch
 * reaches the messages.
 *
 * The path is the one `pr_files` recorded, never a normalised form: the
 * classifier folds separators and lowercases internally, and a case-folded path
 * reaching the grounding set would silently widen it (EC-36).
 */
export interface BriefPrFile {
  path: string;
  additions: number;
  deletions: number;
}

/* ─── the four derivations, as this feature reads them ────────────────────── */

/**
 * The stored intent, narrowed to what the brief puts in front of the model and
 * what it needs to judge the brief's own honesty.
 *
 * A missing or failed intent makes the brief `partial` (AC-31), so `status` is
 * read as well as the content: an intent that failed still has a row, and
 * treating "there is a row" as "there is an intent" is how a consumer invents a
 * third meaning for an absent field (`server/INSIGHTS.md`, 2026-08-14).
 */
export interface BriefIntentFacts {
  status: IntentStatus;
  intent: string | null;
  readonly in_scope: readonly string[];
  readonly out_of_scope: readonly string[];
  readonly risk_areas: readonly Risk[];
  head_sha: string | null;
  /** ISO. One of the nine cache-key values (AC-2). */
  derived_at: string | null;
}

/** The intent read. `undefined` when nothing has been derived for this pull request. */
export interface BriefIntentReader {
  get(workspaceId: string, prId: string): Promise<BriefIntentFacts | undefined>;
}

/**
 * One changed symbol's callers, narrowed to the files they live in.
 *
 * The brief reads no line numbers and no caller names for the prompt; it needs
 * these files because a risk's `file_refs` may name a path from the blast map's
 * referenced files as well as one from the changed-file list (AC-22).
 */
export interface BriefBlastDownstream {
  symbol: string;
  /** The changed symbol's own declaring file. */
  file: string;
  readonly callers: readonly { name: string; file: string; line: number }[];
}

/**
 * The blast map, narrowed to the facts this feature states and grounds against.
 *
 * `status` and `reason` travel together and the brief carries the map's OWN
 * reason value rather than re-deriving one (AC-32): a status re-derived from an
 * absent optional field is a third story about one pull request
 * (`server/INSIGHTS.md`, 2026-08-14).
 */
export interface BriefBlastFacts {
  status: BlastStatus;
  reason: BlastReason | null;
  /** Head commit the index was built at. One of the nine cache-key values. */
  indexed_sha: string | null;
  /** Repo-relative paths the map was computed over, as `pr_files` recorded them. */
  readonly changed_files: readonly string[];
  readonly changed_symbols: readonly ChangedSymbol[];
  readonly downstream: readonly BriefBlastDownstream[];
  /** Every endpoint and cron in the radius — the set AC-25 checks a citation against. */
  readonly impacted: readonly BlastEndpoint[];
  counts: BlastCounts;
}

/** Derived fresh on every read; there is no row and no freshness rule behind it. */
export interface BriefBlastReader {
  build(workspaceId: string, prId: string): Promise<BriefBlastFacts>;
}

/** One prior pull request that touched these files, narrowed to what the input names. */
export interface BriefPriorPr {
  number: number;
  title: string;
  /** ISO. Null when the import never recorded one. */
  updated_at: string | null;
  readonly shared_files: readonly string[];
  /** The overlap's size BEFORE the cap, so a short list is never read as the whole. */
  shared_file_count: number;
}

/**
 * The history half, narrowed.
 *
 * `status` is read and recorded rather than inferred from an empty list: an empty
 * overlap and an unsearchable repository are the same empty array, and `pr_files`
 * is sparse on every real workspace — so this feature's partial state is the
 * default rather than the exception (`server/INSIGHTS.md`, 2026-08-15).
 */
export interface BriefPriorPrsFacts {
  readonly prs: readonly BriefPriorPr[];
  total: number;
  truncated: boolean;
  status: PriorPrsStatus;
  reason: PriorPrsReason | null;
}

export interface BriefPriorPrsReader {
  build(workspaceId: string, prId: string): Promise<BriefPriorPrsFacts>;
}

/**
 * The effective document set of one agent, as METADATA — paths and their
 * effective order, with no text and no clone read.
 *
 * That is what makes the cache-key path cheap enough to sit on the pull-request
 * detail read: `resolveForRun` opens every document it keeps, which is the right
 * cost inside a review and the wrong one for fingerprinting a set. The method is
 * additive and read-only, and it exists so this module never accumulates a second
 * definition of "the effective set" by reading the attachment tables itself.
 *
 * It takes no `workspaceId` for the same reason `resolveForRun` takes none: the
 * caller has already resolved the pull request within its own workspace scope,
 * and its repository is the scope here.
 */
export interface BriefDocSetReader {
  listEffectiveDocs(agentId: string, repoId: string): Promise<readonly EffectiveContextDoc[]>;
}

/**
 * The enabled agents of a workspace, narrowed to their ids.
 *
 * The union of THEIR effective document sets is the brief's document set
 * (AC-59), deduplicated by path with the first occurrence winning, ordered by
 * agent and then by attachment order. Only the id is read, which is why this port
 * is one method and one field wide — a `Row` type in an application signature is
 * a `depcruise` warning of its own.
 */
export interface BriefAgentLister {
  listEnabled(workspaceId: string): Promise<readonly { id: string }[]>;
}

/* ─── the clone reads ─────────────────────────────────────────────────────── */

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
  /** Which files count, replacing the adapter's default rule. Cannot widen confinement. */
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
 * Declared here and implemented in the adapters ring, satisfied structurally,
 * because the confinement — `realpath` at both ends, a prefix check, regular
 * files only — is filesystem work, and a feature module importing Node's own
 * filesystem module is INVISIBLE to `.dependency-cruiser.cjs`: its
 * `modules-no-raw-sdk` rule enumerates SDKs and not that one, so a module reading
 * the disk passes the very gate that guards this ring (`server/INSIGHTS.md`,
 * 2026-08-10). No file under this module imports it, and the grep for it is a
 * gate of its own — which is why the name is not spelled out anywhere in this
 * directory, not even in a comment.
 *
 * `GitClient.readFile` is deliberately not used instead: it joins and reads in
 * one step, which cannot express the post-`realpath` re-check that is the only
 * defence against a checked-in symlink pointing out of the clone.
 */
export interface BriefDocReader {
  read(repo: BriefRepoRef, candidate: string): Promise<RepoDocRead>;
  list(repo: BriefRepoRef, options: RepoDocWalkOptions): Promise<RepoDocWalk>;
}

/* ─── the linked issue ────────────────────────────────────────────────────── */

/** One issue of THIS pull request's own repository. Nothing else is ever fetched. */
export interface BriefIssue {
  number: number;
  title: string;
  body?: string | null;
}

/**
 * The one GitHub read a generation makes, as a call surface this module declares.
 *
 * Deliberately one method wide: the linked issue's title and body, from the pull
 * request's own repository. There is no URL to dereference and no second host to
 * reach, which removes the SSRF surface rather than filtering it — the same
 * choice `modules/intent/sources.ts` made and states.
 */
export interface BriefGitHubIssueReader {
  getIssue(repo: BriefRepoRef, n: number): Promise<BriefIssue>;
}

/* ─── the model choice ────────────────────────────────────────────────────── */

/**
 * Resolving the workspace's chosen provider+model for one feature (AC-21).
 *
 * A call signature declared by its consumer rather than a call into the settings
 * module: importing that sibling both crosses a module boundary
 * (`no-cross-module-internals`) and — when the helper took the container — closed
 * a cycle through the DI root. The composition root already exposes an arrow
 * property of exactly this shape, and the intent and onboarding modules consume
 * it the same way (`server/INSIGHTS.md`, 2026-08-10, which records the
 * arrangement as the fix that REMOVED the edge).
 */
export interface FeatureModelResolver {
  (workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice>;
}

/* ─── the persistence ─────────────────────────────────────────────────────── */

/**
 * The brief body as it is stored, in this module's own column vocabulary.
 *
 * Field-by-field references to `PrRiskBrief` rather than a second spelling of the
 * six-field body: the jsonb column's `$type` already carries `StoredBriefBody`
 * (`db/schema/reviews.ts`), and a hand-written copy of that shape here would be
 * the exact drift the `Pick` was chosen to prevent. `types.ts` cannot import it
 * — the database layer is `repository.ts`'s alone — so it names the contract the
 * `Pick` is taken from instead, which is the same authority one step up.
 *
 * camelCase because these are the columns a write sets, the way
 * `StoredTourWrite` is spelled next door; the repository maps them onto the
 * snake_case body the contract serves.
 */
export interface StoredBriefWrite {
  what: PrRiskBrief['what'];
  why: PrRiskBrief['why'];
  readonly risks: readonly Risk[];
  readonly reviewFocus: readonly ReviewFocusItem[];
  diffStats: BriefDiffStats;
  readonly sources: readonly BriefSource[];
  /** DERIVED from the surviving risks, never taken from the model (AC-26). */
  riskLevel: RiskLevel | null;
  status: BriefStatus;
  reason: BriefReason | null;
  /** The nine-value digest this brief was generated against (AC-2). */
  cacheKey: string | null;
  headSha: string | null;
  provider: string | null;
  model: string | null;
  attempts: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  error: string | null;
}

/**
 * The stored row, with its body already parsed.
 *
 * `state` has TWO members where the contract's `BriefGenerationState` has three,
 * and the asymmetry is deliberate: `never_generated` is the ABSENCE of a row, so
 * there is no value to store for it and no row for this type to describe.
 */
export interface StoredBrief {
  what: PrRiskBrief['what'];
  why: PrRiskBrief['why'];
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  diffStats: BriefDiffStats;
  sources: BriefSource[];
  /**
   * False when the stored body did not survive its parse.
   *
   * A flag rather than a throw, and the read path treats a false here as NO
   * BRIEF and offers regeneration: a jsonb written under an earlier shape arrives
   * with keys ABSENT rather than null, and a cast there has already shipped
   * `$NaN` to a client from this codebase (`server/INSIGHTS.md`, 2026-08-02 and
   * 2026-08-19). Turning that into a 500 nobody can clear without a database
   * would be the worse failure.
   */
  bodyValid: boolean;
  state: 'running' | 'done';
  status: BriefStatus;
  reason: BriefReason | null;
  riskLevel: RiskLevel | null;
  cacheKey: string | null;
  headSha: string | null;
  provider: string | null;
  model: string | null;
  attempts: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  generatedAt: Date;
  /** When the current generation started; the staleness window reads it. */
  startedAt: Date | null;
  error: string | null;
}

/**
 * The data this module needs, as a call surface it declares for itself.
 *
 * The service is constructed with this rather than with the concrete class, so a
 * test injects an in-memory fake and needs no Postgres — the arrangement
 * `OnboardingStore` and `ProjectContextStore` both use.
 */
export interface BriefStore {
  /**
   * Resolve the pull request inside the caller's workspace — **this is the
   * authorization check** (AC-35), and it is the first await of every entry
   * point.
   *
   * It has to be, because `pr_files`, `pr_intent` and `pr_brief` carry no
   * `workspace_id` of their own: their keys FK to the already-scoped
   * `pull_requests`, so every read below is by `pr_id` alone and that is safe
   * ONLY because nothing reaches it without this lookup having succeeded. No
   * clone path is resolved before it either.
   *
   * `undefined` rather than a throw: whether a missing pull request is a 404 or a
   * silent completion depends on which path is asking, and that is the service's
   * decision — a generation whose pull request was deleted mid-flight ends
   * quietly while a read of one answers not-found.
   */
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  /**
   * The pull request's repository, for a clone read and an issue read.
   *
   * Unscoped by workspace on purpose, exactly as `IntentStore.getRepo` is: the
   * workspace was already checked by {@link getPull}, and this asks a narrower
   * question than that one did.
   */
  getRepo(repoId: string): Promise<BriefRepoRef | undefined>;
  /** Every changed file recorded for the pull request. No patch — see {@link BriefPrFile}. */
  getPrFiles(prId: string): Promise<readonly BriefPrFile[]>;
  get(prId: string): Promise<StoredBrief | undefined>;
  /**
   * Claim the pull request for a generation, deciding and writing in ONE
   * statement (AC-8, AC-9). `true` when the claim was won, and the caller
   * enqueues only then.
   *
   * Deliberately NOT the read-then-write pair the onboarding store exposes.
   * There, `get()` is a plain `SELECT`, the service branches on
   * `state === 'running'`, and an unconditional upsert follows: two un-transacted
   * statements with no lock between them, so under READ COMMITTED two
   * near-simultaneous requests can both read a non-running state and both
   * enqueue. That is this feature's NORMAL case rather than an exotic one — the
   * automatic trigger on the detail read racing a manual regenerate (EC-19) — and
   * a hermetic test with sequential awaits will never show it.
   *
   * So the claim is a conditional `UPDATE … RETURNING` whose `WHERE` carries both
   * rules at once (not running, or running since before `staleBefore`), with an
   * `INSERT … ON CONFLICT DO NOTHING RETURNING` as the no-row fallback. The
   * abandoned-generation window lives in that same `WHERE`, so a process that
   * died mid-generation cannot brick the card forever.
   */
  claimRunning(prId: string, startedAt: Date, staleBefore: Date): Promise<boolean>;
  /** Replace the pull request's single stored brief. */
  save(prId: string, write: StoredBriefWrite, generatedAt: Date): Promise<void>;
  /**
   * Take a row out of `running` and record why, without touching the stored
   * brief: a failed regeneration must not destroy the brief it failed to
   * replace.
   */
  clearRunning(prId: string, message: string, reason: BriefReason | null): Promise<void>;
}

/* ─── what the composition root supplies ──────────────────────────────────── */

/**
 * The two levels this module logs at, when a caller offers a logger.
 *
 * `app.log` and pino satisfy it, and it arrives as a PARAMETER rather than a
 * field — the shape `OnboardingLogger` and `IntentWarnLogger` set. The service
 * invents no sink of its own, because that would put a second one next to the
 * caller's.
 */
export interface BriefLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** The job queue, as the call surface this module uses and no more. */
export interface BriefJobQueue {
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

/**
 * Every port this module uses, declared here and satisfied structurally.
 *
 * A `Container` satisfies it with no `implements` clause, which is what lets the
 * composition root pass itself straight in while this module names neither the
 * root nor any sibling — naming `Container` here would close an import cycle
 * through the DI root (`no-circular`), because the root names this module.
 *
 * The absences are the point, as they are in `onboarding/types.ts`: there is no
 * `db`, no `git`, no embedder and no code index in reach. A brief is built from
 * rows this server already has, four derivations it already computes, the
 * documents an agent already carries, one issue read and ONE model call — and
 * that is readable from this one interface.
 */
export interface BriefDeps {
  readonly store: BriefStore;
  readonly intent: BriefIntentReader;
  readonly blast: BriefBlastReader;
  readonly priorPrs: BriefPriorPrsReader;
  readonly projectContext: BriefDocSetReader;
  readonly agents: BriefAgentLister;
  readonly repoDocs: BriefDocReader;
  /** The Smart Diff role of one path — the composition root's arrow property. */
  readonly fileRole: FileRoleClassifier;
  readonly featureModel: FeatureModelResolver;
  llm(id: LLMProvider['id']): Promise<LLMProvider>;
  github(): Promise<BriefGitHubIssueReader>;
  readonly jobs: BriefJobQueue;
}

/* ─── the module's public face ────────────────────────────────────────────── */

/**
 * What the transport ring and the container see.
 *
 * Modelled on `OnboardingTours` down to the method names, including how a
 * refusal travels: a second generation for a pull request already generating
 * raises a `ValidationError` rather than returning a variant, which the shared
 * error handler maps for the route (AC-8). `getBrief` performs no write and makes
 * no model call — a hundred reads leave the provider's call list empty (AC-1,
 * AC-7).
 */
export interface PrBriefs {
  registerJobHandler(log?: BriefLogger): void;
  getBrief(workspaceId: string, prId: string): Promise<PrRiskBrief>;
  requestGeneration(
    workspaceId: string,
    prId: string,
    options?: { force?: boolean },
    log?: BriefLogger,
  ): Promise<{ status: 'accepted'; jobId: string }>;
  runGeneration(workspaceId: string, prId: string, log?: BriefLogger): Promise<void>;
}
