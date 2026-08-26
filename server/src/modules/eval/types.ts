/**
 * Every port, every persisted shape and every public face of the Eval Pipeline
 * module — all of them, here, and types only.
 *
 * No runtime code, so nothing in this file can join an import cycle and the whole
 * module's dependency surface is readable in one sitting. That is what
 * `modules/brief/types.ts`, `modules/onboarding/types.ts` and
 * `modules/project-context/types.ts` already do.
 *
 * **NOTHING HERE IMPORTS A SIBLING MODULE, and that is the point of the file.** A
 * types-only import of another module's `types.ts` is a real
 * `no-cross-module-internals` violation — `import type` does NOT exempt it
 * (`tsPreCompilationDeps` is on in `.dependency-cruiser.cjs`), and it was
 * measured taking the gate from 22 warnings to 24 when another module did exactly
 * that. So the CONSUMER declares the shape of every read it makes and the real
 * implementations satisfy those shapes STRUCTURALLY, with no `implements` clause:
 *
 *  - {@link EvalFindingSource} is satisfied by the shared review repository
 *    (`container.reviewRepo`);
 *  - {@link EvalAgentSource} by the shared agents repository
 *    (`container.agentsRepo`);
 *  - {@link EvalSkillSource} by the shared skills SERVICE (`container.skills`) —
 *    a service and not a repository on purpose, because resolving an agent's
 *    skill bodies applies rules (the enabled filter, and wrapping a body whose
 *    source is untrusted) that belong to that service and must not be
 *    re-implemented here;
 *  - {@link DiffParser} by the composition root's own `diffParser` arrow
 *    property, which wraps `src/adapters/git/diff-parser.ts` — that is what keeps
 *    this module off `src/adapters/**` entirely;
 *  - {@link EvalStore} by `./repository.ts`;
 *  - {@link Evals} by `./service.ts`, and exposed as the INTERFACE from the
 *    container so `ContainerOverrides.eval` can carry a fake with no database
 *    behind it.
 *
 * **No signature here carries a Drizzle Row type** (`OA-DEEP-002`). A port whose
 * signature names a Row has moved the schema into the contract: the shape becomes
 * whatever the table is, a fake has to build all of it, and the cast in the fake
 * is the tell. The narrow persisted views in the last section
 * ({@link StoredEvalCase} and friends) are declared field by field for exactly
 * that reason — the real rows satisfy them structurally, and `helpers.ts` maps
 * them to DTOs without ever naming `db/schema`.
 *
 * A second reason those views are spelled out rather than inferred: `helpers.ts`
 * is inside `application-no-db-schema`'s glob, so a `typeof t.evalCases.$inferSelect`
 * in it would import `src/db/schema` and add a `depcruise` warning to a baseline
 * of 22 that is supposed to stay at 22.
 */
import type {
  EvalAgentCase,
  EvalAnchor,
  EvalBatch,
  EvalBatchCaseResult,
  EvalBatchStatus,
  EvalCaseCreate,
  EvalCaseDraft,
  EvalCaseOutcome,
  EvalCaseSave,
  EvalComparison,
  EvalExpectation,
  EvalNotRunReason,
  EvalOwnerKind,
  EvalPeriod,
  EvalRunAllResult,
  EvalTrialRunRequest,
  EvalTrialRunResult,
  EvalWorkspaceDashboard,
  EvalDashboardRow,
  UnifiedDiff,
} from '@devdigest/shared';

/* ─── the parser, as a call signature ─────────────────────────────────────── */

/**
 * Parse a raw unified diff into files and hunks.
 *
 * A bare call signature rather than an interface with a method, so the
 * container's `readonly diffParser` arrow property satisfies it directly and
 * carries no `this` with it — the same arrangement `featureModel` and `fileRole`
 * already use. Pure: no clock, no I/O, nothing to cache.
 */
export type DiffParser = (raw: string) => UnifiedDiff;

/* ─── the finding a case is derived from, and the pull request behind it ───── */

/**
 * The finding a case is derived from, narrowed to what the derivation reads.
 *
 * `acceptedAt` and `dismissedAt` are the DECISION, and both being null is a
 * named refusal (`finding_has_no_decision`) rather than a default — an undecided
 * finding carries no expectation to derive. `startLine`/`endLine` arrive in
 * whatever order the model produced them: the `Finding` contract does not
 * guarantee `start_line <= end_line` and the live table holds rows where it does
 * not, which is why every consumer normalises before comparing.
 */
export interface EvalSourceFinding {
  id: string;
  reviewId: string;
  /**
   * The finding's own title, used to seed a draft's expected-output skeleton and
   * to state what the draft asserts in words.
   *
   * Read, never scored: `scoreEvalBatch` compares files and line ranges, so this
   * string is documentation of the case for the human reading it. It is on this
   * port rather than fetched separately because `findingContext` already returns
   * the whole row — asking for it costs nothing and a second read would.
   */
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
  /**
   * What the finding was, as the case's own chip will render it. Copied into the
   * case at creation because `source_finding_id` carries no foreign key, so this
   * read is the only moment the two values are reachable.
   */
  severity: string;
  category: string;
}

/**
 * The review the finding belongs to, narrowed to the one field that matters
 * here: which agent produced it.
 *
 * `agentId` is nullable and carries no foreign key, and that is not a
 * theoretical case — the seeded review has none. A review with no agent has no
 * owner to file the case under, which is the `review_has_no_agent` refusal.
 */
export interface EvalSourceReview {
  id: string;
  prId: string;
  agentId: string | null;
}

/** The pull request the review ran on, narrowed to what addresses its files. */
export interface EvalSourcePull {
  id: string;
  repoId: string;
  number: number;
  title: string;
}

/** A repository, narrowed to what names it in a case's stored metadata. */
export interface EvalSourceRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

/**
 * One changed file of the pull request.
 *
 * `patch` IS present here, unlike the equivalent view in the brief module: this
 * feature's whole input is the diff text, and the stored case is a one-file
 * fragment cut out of these patches.
 */
export interface EvalSourcePrFile {
  path: string;
  patch: string | null;
}

/**
 * Everything this module reads about a finding and its pull request.
 *
 * Satisfied by `container.reviewRepo`; the method NAMES match that repository's
 * because structural satisfaction is by name, and renaming them here would
 * force an adapter that exists only to rename.
 *
 * `getPull` takes a workspace id and the others do not, and that asymmetry is the
 * authorization boundary rather than an oversight: `findings`, `pr_files` and
 * `repos` are reached through the already-scoped pull request, so the service
 * calls `getPull(workspaceId, prId)` FIRST and every later read is by id alone.
 */
export interface EvalFindingSource {
  findingContext(findingId: string): Promise<
    | {
        finding: EvalSourceFinding;
        review: EvalSourceReview;
        pull: EvalSourcePull;
      }
    | undefined
  >;
  getPull(workspaceId: string, prId: string): Promise<EvalSourcePull | undefined>;
  getRepo(repoId: string): Promise<EvalSourceRepo | undefined>;
  getPrFiles(prId: string): Promise<EvalSourcePrFile[]>;
}

/* ─── the agent a set belongs to ──────────────────────────────────────────── */

/**
 * The agent an eval set belongs to, narrowed to what a batch snapshots and a
 * dashboard row renders.
 *
 * `systemPrompt` and `model` are read ONCE, when a batch is created, and written
 * into the batch row as text. Nothing re-reads them afterwards: an
 * `agent_versions` row is deleted with its agent, so a comparison rendering "the
 * prompt that produced this number" from a row which may be gone is a comparison
 * that can start lying.
 *
 * `enabled` is here because `Run all agents` skips a disabled agent and NAMES the
 * skip — a reader cannot otherwise tell a disabled agent from an empty one.
 */
export interface EvalAgentFacts {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  version: number;
  enabled: boolean;
}

/**
 * One stored config snapshot, narrowed to what promotion acts on.
 *
 * `configJson` stays `unknown`: it is jsonb written by an older shape of the
 * config and the only honest thing to do with it is parse it, which happens in
 * the ring that knows the contract.
 */
export interface EvalAgentConfigVersion {
  agentId: string;
  version: number;
  configJson: unknown;
}

/**
 * The agent reads this module makes. Satisfied by `container.agentsRepo` — again
 * by that repository's own method names.
 */
export interface EvalAgentSource {
  list(workspaceId: string): Promise<EvalAgentFacts[]>;
  getById(workspaceId: string, id: string): Promise<EvalAgentFacts | undefined>;
  getVersion(agentId: string, version: number): Promise<EvalAgentConfigVersion | undefined>;
}

/* ─── the agent's linked skills ───────────────────────────────────────────── */

/**
 * The agent's enabled skill bodies, ready to be attached to a prompt.
 *
 * Satisfied by `container.skills` — the skills SERVICE, by that service's own
 * method name. It is a service rather than a repository because resolution is
 * more than a read: the enabled filter and the untrusted-source wrapping
 * (`wrapUntrusted`) are rules, they live in that service, and a second
 * implementation of them here is how a body from an untrusted source would reach
 * a model unwrapped. This module therefore asks for the ANSWER and never for the
 * links.
 *
 * The return type names only `bodies`, which is the one field the eval replay
 * reads: the real implementation also returns a `used` array for run
 * observability, and a wider return still satisfies a narrower port
 * structurally. A port that named `used` too would be a port a fake has to build
 * for no reason.
 *
 * **The bodies are the agent's CURRENT links, not the batch's snapshot, and that
 * is deliberate.** `agent_versions.config_json.skills` stores skill ids with no
 * version numbers, so a strictly reproducible replay of an old batch is already
 * impossible by schema — and "the skills as linked right now" is exactly what
 * makes editing a skill move a number, which is the reason this port exists.
 */
export interface EvalSkillSource {
  resolveBodiesForAgent(agentId: string): Promise<{ bodies: string[] }>;
}

/* ─── the persisted shapes, as the mappers read them ──────────────────────── */

/**
 * A stored `eval_cases` row, narrowed to the columns this module reads.
 *
 * Two columns are NULLABLE here and NOT NULL in the contract, and resolving that
 * gap is the mapper's job rather than a cast's:
 *
 *  - **`expectation`** is nullable because the table shipped before this feature
 *    and nothing backfills history. `helpers.ts` parses it and falls back to
 *    `must_find`, the reading that can only make an agent look WORSE (a
 *    `must_find` case with no anchors fails and contributes false positives,
 *    where a `must_not_flag` fallback would pass for free and inflate the pass
 *    count).
 *  - **`inputDiff`** is nullable for the same reason. It maps to `''`, which
 *    parses to zero files and is recorded `not_run` / `diff_unparseable` — again
 *    the non-flattering reading, and never a silent zero-cost pass.
 *
 * There is NO anchors column: the expected anchors ride inside `expectedOutput`,
 * which is why that field is `unknown` and is `safeParse`d on the way out.
 */
export interface StoredEvalCase {
  id: string;
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
  expectation: string | null;
  sourceFindingId: string | null;
  edited: boolean;
  /**
   * The source finding's severity and category, snapshotted at creation. Both
   * nullable and both mapped straight through: a case created before the
   * snapshot existed has no chip to render, which is a different statement from
   * "this case is a low-severity one".
   */
  sourceSeverity: string | null;
  sourceCategory: string | null;
  createdAt: Date;
}

/**
 * The most recent execution of one case, as the set read joins it.
 *
 * `undefined` — not a row of nulls — for a case that has never run, so
 * `EvalAgentCase.last_execution` can be null and mean exactly "never executed".
 */
export interface StoredEvalCaseExecution {
  outcome: string | null;
  notRunReason: string | null;
  expectedCount: number | null;
  actualCount: number | null;
}

/**
 * A stored `eval_batches` row plus the agent name joined onto it.
 *
 * `agentName` is null both when the agent was deleted (`agent_id` is
 * `ON DELETE SET NULL`) and when the left join found nothing, and the two are the
 * same thing to a reader: the agent is unavailable and the batch is still
 * readable. Anything grouping these by agent needs a fallback key — keying a map
 * on the raw nullable `agentId` collapses every agent-deleted row into one
 * bucket, and a cost sum then drops all but one of them with no error.
 */
export interface StoredEvalBatch {
  id: string;
  workspaceId: string;
  agentId: string | null;
  agentName: string | null;
  agentVersion: number;
  systemPromptSnapshot: string;
  modelSnapshot: string;
  status: string;
  label: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  casesCovered: number | null;
  casesPassed: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  truePositives: number | null;
  falseNegatives: number | null;
  falsePositives: number | null;
  costUsd: number | null;
  error: string | null;
}

/** A stored `eval_runs` row plus its case's name, as a batch's result list reads it. */
export interface StoredEvalRunResult {
  caseId: string;
  caseName: string;
  outcome: string | null;
  notRunReason: string | null;
  expectedCount: number | null;
  actualCount: number | null;
  keptCount: number | null;
  droppedCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/* ─── the writes ──────────────────────────────────────────────────────────── */

/**
 * A new case. `expectedAnchors` is a first-class argument even though it is
 * persisted INSIDE `expectedOutput`: where the anchors live is this module's
 * secret, and a caller that had to assemble the blob itself would be free to
 * assemble it differently.
 */
export interface EvalCaseInsert {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  expectation: EvalExpectation;
  expectedAnchors: readonly EvalAnchor[];
  sourceFindingId: string | null;
  /** Snapshotted from the source finding; null for a case with no finding behind it. */
  sourceSeverity: string | null;
  sourceCategory: string | null;
}

/** A hand-edited case, saved as submitted. `edited` is set by the store, not passed. */
export interface EvalCaseUpdate {
  name: string;
  inputDiff: string;
  expectedOutput: unknown;
  expectation: EvalExpectation;
  expectedAnchors: readonly EvalAnchor[];
}

/**
 * A new batch. The prompt and model snapshots are values, not a version to look
 * up later — see {@link EvalAgentFacts}.
 */
export interface EvalBatchInsert {
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  systemPromptSnapshot: string;
  modelSnapshot: string;
  label: string | null;
}

/**
 * What a finished (or failed) batch records.
 *
 * Every field is optional because the two writers record different halves: the
 * completion path writes the counts, the metrics, the tallies, the cost and
 * `finishedAt`, while the failure path writes `status`, `error` and `finishedAt`
 * and must not invent a metric it never computed.
 */
export interface EvalBatchPatch {
  status?: EvalBatchStatus;
  finishedAt?: Date | null;
  casesCovered?: number | null;
  casesPassed?: number | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  truePositives?: number | null;
  falseNegatives?: number | null;
  falsePositives?: number | null;
  costUsd?: number | null;
  error?: string | null;
}

/** One case's execution, recorded as it resolves rather than at the end. */
export interface EvalRunInsert {
  caseId: string;
  batchId: string;
  actualOutput: unknown;
  outcome: EvalCaseOutcome;
  notRunReason: EvalNotRunReason | null;
  expectedCount: number | null;
  actualCount: number | null;
  keptCount: number | null;
  droppedCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * One existing case's anchors, as the `conflicting_anchor` check reads them.
 *
 * The check is "does the derived anchor overlap an anchor of the OTHER
 * expectation on the same file", so it needs the expectation and the name of the
 * case it would conflict with — the refusal names it. The overlap PREDICATE
 * stays in `helpers.ts`: a repository that decided what conflicts would have
 * moved a business rule into SQL, where the scorer cannot agree with it.
 */
export interface EvalCaseAnchorSet {
  caseId: string;
  caseName: string;
  expectation: EvalExpectation;
  anchors: EvalAnchor[];
}

/* ─── persistence, as the ring above it sees it ───────────────────────────── */

/**
 * Every query this module makes. Satisfied by `EvalRepository`.
 *
 * Two rules hold across all of it. **Every method returns rows-as-DTOs or domain
 * values, never a query builder** — nothing above this interface can extend a
 * query. And **no method opens a transaction**: the SERVICE owns the transaction
 * boundary, because a boundary inside this ring cannot see the use case, and a
 * caller needing two writes to land together would have no way to ask for it.
 *
 * Every read is workspace-scoped by parameter. `pruneAgentBatches` takes a
 * workspace id as well as an agent id even though an agent id is globally unique:
 * a delete that can never cross a tenant costs one extra predicate.
 */
export interface EvalStore {
  /** An owner's whole set, in a TOTAL order — name asc, then id asc. */
  listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalAgentCase[]>;
  getCase(workspaceId: string, caseId: string): Promise<EvalAgentCase | undefined>;
  /** The set's current size — the `case_limit_reached` denominator. */
  countCases(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<number>;
  /** Set sizes for every owner in one `GROUP BY`, for the dashboard's `cases_total`. */
  countCasesByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
  ): Promise<{ ownerId: string; count: number }[]>;
  /** The `duplicate_source_finding` lookup; the refusal carries this id. */
  findCaseBySourceFinding(
    workspaceId: string,
    sourceFindingId: string,
  ): Promise<{ id: string; name: string } | undefined>;
  listCaseAnchors(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseAnchorSet[]>;
  insertCase(values: EvalCaseInsert): Promise<EvalAgentCase>;
  updateCase(
    workspaceId: string,
    caseId: string,
    patch: EvalCaseUpdate,
  ): Promise<EvalAgentCase | undefined>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;

  insertBatch(values: EvalBatchInsert): Promise<EvalBatch>;
  getBatch(workspaceId: string, batchId: string): Promise<EvalBatch | undefined>;
  updateBatch(
    workspaceId: string,
    batchId: string,
    patch: EvalBatchPatch,
  ): Promise<EvalBatch | undefined>;
  /** One agent's history, in a TOTAL order — started_at desc, then id desc. */
  listAgentBatches(
    workspaceId: string,
    agentId: string,
    since: Date | null,
  ): Promise<EvalBatch[]>;
  /** The `batch_already_running` / staleness read: this agent's `running` batches. */
  listRunningBatches(workspaceId: string, agentId: string): Promise<EvalBatch[]>;
  /**
   * Every agent's batches in one read, newest first — the dashboard's per-agent
   * grouping AND its cross-agent recent list. One query rather than one per
   * agent, and bounded by the retention cap.
   */
  listWorkspaceBatches(
    workspaceId: string,
    since: Date | null,
    limit?: number,
  ): Promise<EvalBatch[]>;
  listBatchCaseResults(workspaceId: string, batchId: string): Promise<EvalBatchCaseResult[]>;
  insertRun(values: EvalRunInsert): Promise<void>;
  /** Keep the `keep` most recent batches of this agent; delete the rest. */
  pruneAgentBatches(workspaceId: string, agentId: string, keep: number): Promise<number>;
}

/* ─── the module's public face ────────────────────────────────────────────── */

/**
 * What the composition root exposes as `container.eval`, and what every route
 * calls.
 *
 * Exposed as an INTERFACE so `ContainerOverrides.eval` can carry a fake with no
 * database and no provider behind it — the arrangement `PrBriefs`,
 * `OnboardingTours` and `ProjectContext` already use.
 *
 * **Every method takes a workspace id first, and it is the authorization check.**
 * No eval read is reachable by id alone: an agent, a case or a batch outside the
 * caller's workspace answers with this module's own `not_found`, never with
 * Fastify's route-not-found and never with someone else's data.
 */
export interface Evals {
  /**
   * Derive what a case WOULD be, and store nothing.
   *
   * Every refusal `createCaseFromFinding` answers with is applied here too, so a
   * finding that cannot become a case says why before a modal opens rather than
   * after a human has edited one.
   */
  draftCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraft>;
  createCaseFromFinding(workspaceId: string, body: EvalCaseCreate): Promise<EvalAgentCase>;
  /** Run one unsaved draft against the agent's current config. Writes nothing. */
  trialRunCase(
    workspaceId: string,
    agentId: string,
    body: EvalTrialRunRequest,
  ): Promise<EvalTrialRunResult>;
  listCases(workspaceId: string, agentId: string): Promise<EvalAgentCase[]>;
  saveCase(workspaceId: string, caseId: string, body: EvalCaseSave): Promise<EvalAgentCase>;
  deleteCase(workspaceId: string, caseId: string): Promise<void>;
  /** Acknowledges with a `running` batch BEFORE the first case executes. */
  startBatch(
    workspaceId: string,
    agentId: string,
    options?: { label?: string | null; caseId?: string | null },
  ): Promise<EvalBatch>;
  getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ batch: EvalBatch; cases: EvalBatchCaseResult[] }>;
  listBatches(workspaceId: string, agentId: string, period: EvalPeriod): Promise<EvalBatch[]>;
  agentDashboard(
    workspaceId: string,
    agentId: string,
    period: EvalPeriod,
  ): Promise<EvalDashboardRow>;
  workspaceDashboard(workspaceId: string, period: EvalPeriod): Promise<EvalWorkspaceDashboard>;
  compare(
    workspaceId: string,
    earlierBatchId: string,
    laterBatchId: string,
  ): Promise<EvalComparison>;
  runAllAgents(workspaceId: string): Promise<EvalRunAllResult>;
}
