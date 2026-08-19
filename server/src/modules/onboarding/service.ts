import type {
  LLMProvider,
  OnboardingCommand,
  OnboardingLink,
  OnboardingPathNote,
  OnboardingReason,
  OnboardingSectionKind,
  OnboardingStatus,
  OnboardingTask,
  OnboardingTour,
  OnboardingTourSection,
  StructuredResult,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { collectDeclaredCommands } from './commands.js';
import {
  MAX_BODY_CHARS,
  MAX_CRITICAL_ROWS,
  MAX_FIRST_TASKS,
  MAX_LINKS_PER_SECTION,
  MAX_READING_ENTRIES,
  ONBOARDING_FEATURE_MODEL,
  ONBOARDING_JOB_KIND,
  ONBOARDING_SCHEMA_NAME,
  SECTION_KINDS,
  SECTION_TITLES,
  TOUR_CALL_DEADLINE_MS,
  TOUR_MAX_RETRIES,
  TOUR_STALE_AFTER_MS,
} from './constants.js';
import { collectOnboardingFacts, mapIndexState } from './facts.js';
import { buildTourMessages, loadTemplate, type TokenCounter } from './prompt.js';
import type { OnboardingRepoRow, OnboardingStore, StoredTourWrite } from './repository.js';
import { OnboardingDraft, type DraftSection } from './schemas.js';
import type {
  FeatureModelResolver,
  OnboardingDocReader,
  OnboardingFacts,
  OnboardingIndexReader,
} from './types.js';

/**
 * Onboarding Tour — a five-part tour of one repository, built from that
 * repository's own index with exactly one structured model call.
 *
 * Four properties this file is arranged to make provable rather than merely
 * stated, each of which is an acceptance criterion that fails on its own:
 *
 *  1. **Reading is free.** {@link OnboardingService.getTour} makes no model call
 *     and performs no database write — no upsert, no touch, no enqueue (AC-27).
 *     A hundred reads leave the provider's call list empty and `generated_at`
 *     where it was.
 *  2. **One call, twice bounded.** A generation issues exactly one structured
 *     request (AC-9) — there is a single call site below, and it is the only
 *     one this file's own gate tolerates — with `maxRetries` pinned so the
 *     provider cannot spend three round-trips (AC-10) and a `Promise.race`
 *     against a deadline so it cannot spend the job runner's whole 120 s
 *     (AC-11). Both are
 *     required and neither alone bounds anything: `StructuredRequest.timeoutMs`
 *     is silently ignored and `maxRetries` defaults to 2
 *     (`server/INSIGHTS.md`, 2026-08-06).
 *  3. **An unindexed repository costs nothing.** When the index maps to
 *     `degraded` the deterministic skeleton is stored and the method RETURNS
 *     BEFORE A PROVIDER IS EVER CONSTRUCTED (AC-16 and AC-17 — separate criteria
 *     because a correct status with a wasted call satisfies the first and is
 *     exactly what the second exists to prevent).
 *  4. **Nothing invented survives.** Every repository path a stored tour names is
 *     confirmed against `file_rank` before it is written (AC-8), and everything
 *     over a cap is discarded WHOLE rather than truncated (AC-30).
 *
 * The model choice arrives as an injected {@link FeatureModelResolver}, never by
 * importing the settings module's `feature-models.ts`: that is the cross-module
 * edge the intent module was refactored to remove, and the composition root
 * already exposes a property of exactly this shape (`server/INSIGHTS.md`,
 * 2026-08-10). Nothing in this module names a sibling module or touches the
 * filesystem — and both of those are greps rather than conventions, which is why
 * neither path is spelled out even in a comment.
 */

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

/**
 * Every port this service uses, declared here and satisfied structurally.
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

/**
 * The body a section carries when nothing was written for it.
 *
 * English constants (N12), and honest ones: each says what the section WOULD
 * have held and does not pretend the repository is thin. A degraded tour renders
 * these under a notice naming the cause, so the copy must not read as a complete
 * tour.
 */
const SKELETON_BODIES: Readonly<Record<OnboardingSectionKind, string>> = {
  architecture:
    'No architecture summary was written for this repository. The sections below carry whatever the index could supply on its own.',
  critical_paths:
    'No summary was written for the dependency chains below. Each row is a path the index reaches from one of the repository’s most central files.',
  run_locally:
    'No summary was written for the commands below. Each one was read from a file in this repository that declares it, and nothing here has been run.',
  reading_path:
    'No summary was written for the reading path below. The order is the index’s own ranking, most central first.',
  first_tasks:
    'No first tasks were written for this repository. Generating the tour again is the way to fill this section.',
};

/**
 * The outcome of the one model call — a value in every case, never a throw.
 *
 * `usage` is the whole `StructuredResult`, which already carries the model, the
 * round-trip count, both token counts and the cost, so AC-12 needs no new field
 * on the port.
 */
interface CallOutcome {
  provider: string | null;
  draft: OnboardingDraft | null;
  usage: StructuredResult<OnboardingDraft> | null;
  reason: OnboardingReason | null;
  error: string | null;
}

/**
 * What a generation that never reached a provider records.
 *
 * Its `reason` is deliberately null: the reason for a skipped call is the
 * INDEX's, and {@link resolveOutcome} reads it from the facts rather than having
 * it passed in twice and risking the two disagreeing.
 */
const EMPTY_CALL: CallOutcome = {
  provider: null,
  draft: null,
  usage: null,
  reason: null,
  error: null,
};

export class OnboardingService implements OnboardingTours {
  constructor(private readonly deps: OnboardingDeps) {}

  /**
   * Register the generation job handler. Called once from `routes.ts` at boot,
   * the same shape as `ConventionsService.registerScanJobHandler` — the runner
   * keeps the handler closure, so where the service was constructed does not
   * matter.
   */
  registerJobHandler(log?: OnboardingLogger): void {
    this.deps.jobs.register(ONBOARDING_JOB_KIND, async (payload) => {
      const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
      await this.runGeneration(workspaceId, repoId, log);
    });
  }

  // --- read ----------------------------------------------------------------

  /**
   * The repository's stored tour, or the honest absence of one.
   *
   * The workspace lookup is the FIRST thing that happens (AC-29): before any
   * index row is read and before any clone path could be resolved, so a
   * repository id belonging to another workspace answers not-found rather than
   * leaking whether it exists. Nothing on this path writes.
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour> {
    await this.loadRepo(workspaceId, repoId);
    const stored = await this.deps.store.get(repoId);
    const state = await this.deps.index.getIndexState(repoId);

    // No row at all is `never_generated`, answered as 200 with no sections
    // rather than 404: in a local-first tool, nothing generated yet is an
    // ordinary state (AC-2). Its status and reason come from the index as it is
    // TODAY, which is what makes an unindexed repository read as
    // `degraded / index_missing` before anyone has pressed anything (AC-16).
    if (!stored) {
      const { status, reason } = mapIndexState(state);
      return emptyTour(status, reason);
    }

    const running = stored.state === 'running' && !isAbandoned(stored.startedAt);
    return {
      sections: stored.sections,
      status: stored.status,
      // A body that failed its parse is not a tour, whatever the columns claim.
      reason: stored.bodyValid ? stored.reason : 'model_invalid',
      generation_state: running ? 'running' : 'ready',
      generated_at: stored.generatedAt.toISOString(),
      indexed_sha: stored.indexedSha,
      // Compared against the index's CURRENT head, computed on read; nothing is
      // regenerated here (AC-26). Unknowable in either direction when one of the
      // two SHAs is missing, and an unknown answer is `false`.
      stale:
        stored.indexedSha !== null &&
        state.lastIndexedSha !== '' &&
        state.lastIndexedSha !== stored.indexedSha,
      files_indexed: stored.filesIndexed,
      files_skipped: stored.filesSkipped,
      model: stored.model,
      attempts: stored.attempts,
      tokens_in: stored.tokensIn,
      tokens_out: stored.tokensOut,
      cost_usd: stored.costUsd,
    };
  }

  // --- generation ----------------------------------------------------------

  /**
   * Queue a generation and return at once with the job id (AC-3).
   *
   * A second request while one is running is REFUSED rather than started
   * (AC-4), as a `ValidationError` → 422: there is no `ConflictError` in this
   * server, and the one existing "already running" refusal
   * (`ConventionsService.requestScan`) is the same class. The refusal reads the
   * `running` row through a staleness window, so a process that died
   * mid-generation cannot block every future generation of that repository
   * forever (EC-18).
   */
  async requestGeneration(
    workspaceId: string,
    repoId: string,
    log?: OnboardingLogger,
  ): Promise<{ status: 'accepted'; jobId: string }> {
    await this.loadRepo(workspaceId, repoId);

    const stored = await this.deps.store.get(repoId);
    if (stored?.state === 'running' && !isAbandoned(stored.startedAt)) {
      throw new ValidationError('A generation is already running for this repository');
    }

    // Claimed before the slow work, so the screen has something to show the
    // moment the button is pressed and a second press has a row to be refused
    // against.
    await this.deps.store.markRunning(repoId, new Date());

    try {
      const job = await this.deps.jobs.enqueue(workspaceId, ONBOARDING_JOB_KIND, {
        workspaceId,
        repoId,
      });

      // `JobRunner.enqueue` attaches a central catch, so a discarded rejection
      // can no longer kill the process (`server/INSIGHTS.md`, 2026-08-07). This
      // per-caller one is the BOOKKEEPING half and is still required: without it
      // a generation that dies inside the job leaves the row on `running` until
      // the staleness window expires. It checks the repository still exists
      // first, because a deleted one took this row with it (EC-21) and writing
      // a failure onto nothing is not a failure worth reporting.
      void job.done.catch(async (error: Error) => {
        log?.warn({ err: error, repoId }, 'onboarding generation job failed');
        if (!(await this.deps.store.repoExists(repoId).catch(() => false))) return;
        await this.deps.store
          .clearRunning(repoId, `The generation job failed: ${error.message}`, 'model_failed')
          .catch(() => undefined);
      });

      return { status: 'accepted', jobId: job.id };
    } catch (error) {
      // No handler registered, or a transient enqueue failure. Clear the claim
      // rather than leaving it `running`, which would refuse every later
      // generation until the staleness window expired. `reason` is null because
      // no model was involved and this vocabulary has no member for "the queue
      // would not take it"; the message carries the detail.
      await this.deps.store.clearRunning(
        repoId,
        `Could not enqueue the generation: ${(error as Error).message}`,
        null,
      );
      throw error;
    }
  }

  /**
   * The whole generation. Runs inside the job worker and never throws for
   * anything the tour can describe.
   *
   * A failed, timed-out or schema-rejected call stores the deterministic
   * skeleton with a reason distinguishing which of the three occurred (AC-15) —
   * never an HTTP error, because nobody is holding the request open by then.
   */
  async runGeneration(workspaceId: string, repoId: string, log?: OnboardingLogger): Promise<void> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const facts = await collectOnboardingFacts(this.deps.index, repoId);
    const commands = await collectDeclaredCommands(this.deps.repoDocs, {
      owner: repo.owner,
      name: repo.name,
    });

    // AC-17, and the reason it is a separate criterion from AC-16: an index that
    // can say nothing means the model has nothing to be told, so the skeleton is
    // stored and this returns BEFORE `featureModel` or `llm` is touched. No
    // provider is constructed, no key is read, nothing is charged.
    if (facts.status === 'degraded') {
      await this.persist(repo, facts, commands, EMPTY_CALL, log);
      return;
    }

    await this.persist(repo, facts, commands, await this.callModel(workspaceId, facts, commands), log);
  }

  /**
   * The one model call, bounded twice, its three failure modes distinguished.
   *
   * Everything that can go wrong here is a VALUE: a throw, a lost race and a
   * payload the schema rejects each come back as a reason with no draft, so the
   * caller stores a labelled skeleton either way (AC-15).
   */
  private async callModel(
    workspaceId: string,
    facts: OnboardingFacts,
    commands: readonly OnboardingCommand[],
  ): Promise<CallOutcome> {
    let provider: string | null = null;
    try {
      const template = await loadTemplate();
      const choice = await this.deps.featureModel(workspaceId, ONBOARDING_FEATURE_MODEL);
      provider = choice.provider;
      const llm = await this.deps.llm(choice.provider);

      // The call is bounded HERE and only here. `maxRetries` caps the PROVIDER
      // round-trips at AC-10's ceiling of two — the request plus at most one
      // `parseWithRepair` reprompt — and the race caps WALL-CLOCK (AC-11). They
      // bound different quantities and neither alone bounds anything. The
      // rejection is folded into the resolved value so the loser of the race can
      // never become an unhandled rejection.
      const pending = llm
        .completeStructured({
          model: choice.model,
          schema: OnboardingDraft,
          schemaName: ONBOARDING_SCHEMA_NAME,
          messages: buildTourMessages(template, facts, commands, this.deps.tokenizer),
          temperature: 0,
          maxRetries: TOUR_MAX_RETRIES,
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: Error) => ({ ok: false as const, error }),
        );

      const raced = await Promise.race([pending, deadline(TOUR_CALL_DEADLINE_MS)]);
      if (raced === null) {
        return {
          provider,
          draft: null,
          usage: null,
          reason: 'model_timeout',
          error: `The model did not answer within ${TOUR_CALL_DEADLINE_MS}ms`,
        };
      }
      if (!raced.ok) {
        // `parseWithRepair` throws when the repaired answer still does not
        // validate, so a schema rejection arrives here rather than as a separate
        // outcome — which is why the message decides between the two reasons.
        const invalid = /schema|validat|parse/i.test(raced.error.message);
        return {
          provider,
          draft: null,
          usage: null,
          reason: invalid ? 'model_invalid' : 'model_failed',
          error: raced.error.message,
        };
      }

      return { provider, draft: raced.value.data, usage: raced.value, reason: null, error: null };
    } catch (error) {
      // A missing API key (`ConfigError`), an unreadable template, an unknown
      // provider id. None of them is a reason to fail the job: the tour is
      // stored as a labelled skeleton and the screen explains itself.
      return {
        provider,
        draft: null,
        usage: null,
        reason: 'model_failed',
        error: `${provider ?? 'model'}: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Ground the draft, assemble the five sections, store them, and log the price.
   *
   * The repository is re-read immediately before the write, and a repository
   * that is gone ends this SILENTLY (EC-21): `onboarding.repo_id` is
   * `ON DELETE cascade`, so a user who deleted the repository mid-generation
   * took the `running` row with it, and that is not a defect to report. A blanket
   * `try/catch` around the upsert would not be equivalent — it would swallow a
   * genuine constraint violation with the same shrug — so the absence is checked
   * and every other database error propagates to the job's own failure path.
   */
  private async persist(
    repo: OnboardingRepoRow,
    facts: OnboardingFacts,
    commands: readonly OnboardingCommand[],
    call: CallOutcome,
    log?: OnboardingLogger,
  ): Promise<void> {
    const sections = await this.assemble(repo.id, facts, commands, call.draft);
    const { status, finalReason } = resolveOutcome(facts, commands, call.draft, call.reason);

    if (!(await this.deps.store.repoExists(repo.id))) return;

    const write: StoredTourWrite = {
      sections,
      status,
      reason: finalReason,
      indexedSha: facts.indexedSha,
      filesIndexed: facts.filesIndexed,
      filesSkipped: facts.filesSkipped,
      provider: call.provider,
      // `usage.model` rather than the requested id: a router may answer with a
      // different revision, and the figure worth recording is what ran (AC-12).
      model: call.usage?.model ?? null,
      attempts: call.usage?.attempts ?? null,
      tokensIn: call.usage?.tokensIn ?? null,
      tokensOut: call.usage?.tokensOut ?? null,
      costUsd: call.usage?.costUsd ?? null,
      error: call.error,
    };
    await this.deps.store.save(repo.id, write, new Date());

    // ONE line carrying all five figures (AC-13), not five lines and not one per
    // figure: "how many calls did that cost, and what did it cost" has to be
    // answerable by reading a single record.
    log?.info(
      {
        repoId: repo.id,
        repo: repo.fullName,
        model: write.model,
        attempts: write.attempts,
        tokensIn: write.tokensIn,
        tokensOut: write.tokensOut,
        costUsd: write.costUsd,
        status: write.status,
        reason: write.reason,
      },
      'onboarding tour generated',
    );
  }

  /**
   * The five sections, in the contract's fixed order, from grounded material.
   *
   * The order is this function's, never the model's: a kind the model omitted
   * gets its deterministic skeleton section and a kind it invented is discarded,
   * so the screen renders five sections in one order whatever came back (AC-1).
   */
  private async assemble(
    repoId: string,
    facts: OnboardingFacts,
    commands: readonly OnboardingCommand[],
    draft: OnboardingDraft | null,
  ): Promise<OnboardingTourSection[]> {
    const byKind = new Map<OnboardingSectionKind, DraftSection>();
    for (const section of draft?.sections ?? []) {
      if (!byKind.has(section.kind)) byKind.set(section.kind, section);
    }

    // Every path anyone claims — the model's links, its notes and its tasks, plus
    // the ones this server derived — confirmed in ONE read against `file_rank`,
    // which holds a row for every indexed file. That is AC-8's whole mechanism,
    // and it disposes of two edge cases for free: an absolute or outside path is
    // simply not in the index (EC-14), and a test file IS, even though the
    // ranked sample filters it out (EC-27).
    const claimed = new Set<string>([
      ...facts.rankedPaths,
      ...facts.criticalChains.flat(),
      ...[...byKind.values()].flatMap((section) => [
        ...section.links.map((link) => link.path),
        ...section.paths.map((note) => note.path),
        ...section.tasks.map((task) => task.path),
      ]),
    ]);
    const rows = await this.deps.index.getFileRank(repoId, [...claimed]);
    const indexed = new Set(rows.map((row) => row.path));

    // Directories are confirmed by PREFIX against the paths the tour was built
    // from, because `file_rank` holds files and not directories (Assumption 7).
    const knownPaths = [
      ...facts.rankedPaths,
      ...facts.criticalChains.flat(),
      ...facts.endpointFacts.map((row) => row.filePath),
      ...commands.map((row) => row.file),
    ];

    const reading = readingRows(facts, byKind.get('reading_path'), indexed);
    const critical = criticalRows(facts, byKind.get('critical_paths'), indexed);

    return SECTION_KINDS.map((kind) => {
      const section = byKind.get(kind);
      const body = (section?.body ?? '').trim();
      return {
        kind,
        title: SECTION_TITLES[kind],
        body: body.length > 0 ? body.slice(0, MAX_BODY_CHARS) : SKELETON_BODIES[kind],
        // Only `architecture` may carry one, whatever the model returned, and an
        // empty string is an absent diagram rather than a broken one (EC-13).
        diagram: kind === 'architecture' ? nonEmpty(section?.diagram ?? null) : null,
        links: groundedLinks(section?.links ?? [], indexed),
        commands: kind === 'run_locally' ? [...commands] : [],
        paths: kind === 'critical_paths' ? critical : kind === 'reading_path' ? reading : [],
        tasks: kind === 'first_tasks' ? groundedTasks(section?.tasks ?? [], indexed, knownPaths) : [],
      };
    });
  }

  /**
   * Resolve a repository inside the caller's workspace, or 404.
   *
   * Both request-facing methods open with this, which is what makes the
   * workspace lookup the first thing a request does (AC-29).
   */
  private async loadRepo(workspaceId: string, repoId: string): Promise<OnboardingRepoRow> {
    const repo = await this.deps.store.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }
}

/* ─── assembly helpers ────────────────────────────────────────────────────── */

/**
 * The tour's status and reason, once everything is known.
 *
 * The index's own verdict is the floor: a model failure over a `partial` index
 * is still `degraded`, because a skeleton is a skeleton however complete the
 * index was. `no_commands_declared` is the one reason that is a true finding
 * about the repository rather than a failure — a Go or Python repository
 * declares none of the three sources this feature reads (EC-8) — so it only
 * downgrades an otherwise `ok` tour to `partial`.
 */
function resolveOutcome(
  facts: OnboardingFacts,
  commands: readonly OnboardingCommand[],
  draft: OnboardingDraft | null,
  callReason: OnboardingReason | null,
): { status: OnboardingStatus; finalReason: OnboardingReason | null } {
  if (facts.status === 'degraded') return { status: 'degraded', finalReason: facts.reason };
  if (draft === null || callReason !== null) {
    return { status: 'degraded', finalReason: callReason ?? facts.reason };
  }
  if (facts.status === 'partial') return { status: 'partial', finalReason: facts.reason };
  if (commands.length === 0) return { status: 'partial', finalReason: 'no_commands_declared' };
  return { status: 'ok', finalReason: null };
}

/**
 * The reading path: the index's ranking, with the model's prose attached.
 *
 * The ORDER is the index's and never the model's (AC-5), and the membership is
 * the index's too — `getTopFilesByRank` has already dropped tests, specs,
 * declarations, migrations and tool configs, so AC-6 is satisfied by using it
 * and adding no second filter. A note the model wrote for a path in that list
 * supplies its `reason`; a path it named that is not in the list goes unused,
 * and a path with no note gets a deterministic sentence. Entries are
 * deduplicated by path (EC-16) and the excess is discarded whole (AC-30).
 */
function readingRows(
  facts: OnboardingFacts,
  section: DraftSection | undefined,
  indexed: ReadonlySet<string>,
): OnboardingPathNote[] {
  const reasons = new Map(
    (section?.paths ?? []).map((note) => [note.path, note.reason.trim()] as const),
  );
  const seen = new Set<string>();
  const rows: OnboardingPathNote[] = [];
  for (const path of facts.rankedPaths) {
    if (rows.length >= MAX_READING_ENTRIES) break;
    if (seen.has(path) || !indexed.has(path)) continue;
    seen.add(path);
    const reason = reasons.get(path);
    rows.push({
      path,
      reason:
        reason && reason.length > 0
          ? reason
          : `Ranked ${rows.length + 1} of this repository's most central files.`,
    });
  }
  return rows;
}

/**
 * The critical paths: one row per dependency chain the index found.
 *
 * The chains are the index's — five seeds, at most two hops, each path distinct
 * within its chain (AC-7) — and this adds no logic to them. The row's `path` is
 * the chain's seed, so the row is openable; its `reason` is the model's note for
 * that seed when there is one, and the chain itself rendered when there is not,
 * which is the more useful sentence of the two anyway.
 */
function criticalRows(
  facts: OnboardingFacts,
  section: DraftSection | undefined,
  indexed: ReadonlySet<string>,
): OnboardingPathNote[] {
  const reasons = new Map(
    (section?.paths ?? []).map((note) => [note.path, note.reason.trim()] as const),
  );
  const seen = new Set<string>();
  const rows: OnboardingPathNote[] = [];
  for (const chain of facts.criticalChains) {
    if (rows.length >= MAX_CRITICAL_ROWS) break;
    const seed = chain[0];
    if (seed === undefined || seen.has(seed) || !indexed.has(seed)) continue;
    seen.add(seed);
    const reason = reasons.get(seed);
    const rest = chain.slice(1).filter((path) => indexed.has(path));
    rows.push({
      path: seed,
      reason:
        reason && reason.length > 0
          ? reason
          : rest.length > 0
            ? `Reaches ${rest.join(' → ')}.`
            : 'One of the repository’s most central files.',
    });
  }
  return rows;
}

/** Links whose path the index confirms, deduplicated and capped (AC-8, AC-30). */
function groundedLinks(
  links: readonly OnboardingLink[],
  indexed: ReadonlySet<string>,
): OnboardingLink[] {
  const seen = new Set<string>();
  const out: OnboardingLink[] = [];
  for (const link of links) {
    if (out.length >= MAX_LINKS_PER_SECTION) break;
    if (seen.has(link.path) || !indexed.has(link.path)) continue;
    seen.add(link.path);
    out.push({ label: link.label.trim() || link.path, path: link.path });
  }
  return out;
}

/**
 * First tasks whose path the tour can actually open, deduplicated by title.
 *
 * A file-shaped path is confirmed exactly, through the index. A path naming a
 * DIRECTORY is confirmed by prefix against the paths the tour was built from,
 * because `file_rank` holds files and not directories (Assumption 7). The
 * limitation is deliberate and stated: a directory outside that set is dropped
 * even though it exists in the repository, and widening it would cost a second
 * full-ranking read per generation.
 */
function groundedTasks(
  tasks: readonly OnboardingTask[],
  indexed: ReadonlySet<string>,
  knownPaths: readonly string[],
): OnboardingTask[] {
  const seen = new Set<string>();
  const out: OnboardingTask[] = [];
  for (const task of tasks) {
    if (out.length >= MAX_FIRST_TASKS) break;
    const title = task.title.trim();
    const key = title.toLowerCase();
    if (title.length === 0 || seen.has(key)) continue;
    const prefix = `${task.path.replace(/\/+$/, '')}/`;
    if (!indexed.has(task.path) && !knownPaths.some((path) => path.startsWith(prefix))) continue;
    seen.add(key);
    out.push({ title, path: task.path, complexity: task.complexity });
  }
  return out;
}

/** A tour nobody has generated yet: five absent sections, honestly labelled. */
function emptyTour(status: OnboardingStatus, reason: OnboardingReason | null): OnboardingTour {
  return {
    sections: [],
    status,
    reason,
    generation_state: 'never_generated',
    generated_at: null,
    indexed_sha: null,
    stale: false,
    files_indexed: 0,
    files_skipped: 0,
    model: null,
    attempts: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
  };
}

/**
 * Has a `running` claim outlived its worker?
 *
 * A claim with no start time counts as abandoned: it has no moment to be young
 * relative to, and a row that can never age out bricks the repository's tour
 * forever with no cure a user of the screen has (EC-18, and the shape that
 * bricked a conventions scan — `server/INSIGHTS.md`, 2026-08-06).
 */
function isAbandoned(startedAt: Date | null, now: Date = new Date()): boolean {
  if (startedAt === null) return true;
  return now.getTime() - startedAt.getTime() >= TOUR_STALE_AFTER_MS;
}

/** An empty diagram string is an absent diagram, never a broken one (EC-13). */
function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Resolves to `null` after `ms`, to be raced against work that must not overrun.
 *
 * The timer is `unref`'d so a pending deadline can never hold the process open
 * after the generation has moved on — the loser of the race is abandoned, not
 * cancelled, and Node would otherwise wait for it at shutdown.
 */
function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
}
