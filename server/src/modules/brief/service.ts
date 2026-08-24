import { z } from 'zod';
import {
  BriefReason,
  type BriefStatus,
  type PrRiskBrief,
  type StructuredResult,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { assembleBriefInput, type AssembledInput, type BriefIssueSource } from './assemble.js';
import { computeCacheKey } from './cache-key.js';
import {
  BRIEF_CALL_DEADLINE_MS,
  BRIEF_FEATURE_MODEL,
  BRIEF_JOB_KIND,
  BRIEF_MAX_RETRIES,
  BRIEF_SCHEMA_NAME,
  BRIEF_STALE_AFTER_MS,
} from './constants.js';
import {
  cacheKeyDocs,
  collectEffectiveDocSet,
  readEffectiveDocs,
  sizeEffectiveDocs,
  type LoadedDoc,
  type SizedDoc,
} from './documents.js';
import { blastReferences, groundBriefDraft, type GroundedBrief } from './grounding.js';
import { buildBriefMessages, loadTemplate } from './prompt.js';
import { PrBriefDraft } from './schemas.js';
import type {
  BriefBlastFacts,
  BriefDeps,
  BriefIntentFacts,
  BriefLogger,
  BriefPrFile,
  BriefPriorPrsFacts,
  BriefPull,
  BriefRepoRef,
  PrBriefs,
  StoredBrief,
  StoredBriefWrite,
} from './types.js';

/**
 * PR Brief — what a change does, why, and where it is most likely to hurt,
 * assembled deterministically and written by exactly one structured model call.
 *
 * Five properties this file is arranged to make provable rather than merely
 * stated, each of which is an acceptance criterion that fails on its own:
 *
 *  1. **Reading is free.** {@link BriefService.getBrief} makes no model call and
 *     performs no database write — no upsert, no touch, no enqueue (AC-1, AC-7).
 *     A hundred reads leave the provider's call list empty and `generated_at`
 *     where it was. It computes the current cache key and reports `stale`
 *     (AC-3); computing is not writing.
 *  2. **A second generation is refused by the CLAIM, never by a read.**
 *     {@link BriefService.requestGeneration} does not read the row, decide it is
 *     free, and then write: it calls `claimRunning`, which decides and writes in
 *     one statement, and enqueues only when that returns `true` (AC-8). The
 *     racing pair here is the NORMAL case — the automatic trigger on the
 *     pull-request detail read against a manual regenerate (EC-19) — and the
 *     abandoned-generation window lives inside the same `WHERE`, so a dead
 *     worker cannot brick the card (AC-9).
 *  3. **Nothing is charged for an answer that could not be grounded.**
 *     {@link BriefService.runGeneration} returns BEFORE a provider is ever
 *     constructed when there is no changed file (AC-28) or when the core input
 *     alone overruns the budget (AC-16), and stores a degraded brief naming
 *     which precondition failed (AC-57).
 *  4. **One call, twice bounded.** `maxRetries` caps the provider's round-trips
 *     and a `Promise.race` caps wall-clock. Both are required and neither alone
 *     bounds anything: `StructuredRequest.timeoutMs` is silently ignored and
 *     `maxRetries` defaults to 2 — three attempts of up to 90 s
 *     (`server/INSIGHTS.md`, 2026-08-06) — which is more than the job runner's
 *     whole budget (AC-18, AC-19, AC-20).
 *  5. **A generation never throws for anything the brief can describe.** The
 *     three failure modes get three DISTINGUISHABLE reasons — `model_failed`,
 *     `model_timeout`, `model_invalid` — and each stores a brief carrying the
 *     deterministic figures the assembly already held, with no risk level, no
 *     risks and no review focus (AC-29, AC-30). Nobody is holding a request open
 *     by then, so an HTTP error would reach nobody and lose the record.
 *
 * The model choice arrives as an injected `FeatureModelResolver` and the role
 * classifier as an injected `FileRoleClassifier`, never by importing a sibling
 * module: that is the cross-module edge the intent module was refactored to
 * remove, and the composition root already exposes properties of exactly those
 * shapes (`server/INSIGHTS.md`, 2026-08-10 and 2026-08-14). Nothing in this
 * module names a sibling module or touches the disk — both are greps rather than
 * conventions, which is why neither is spelled out even in a comment.
 */

/**
 * Payload of a background generation job.
 *
 * VALIDATED rather than cast: what arrives is `unknown` off `JobRunner`, and a
 * job kind is addressable by string from anywhere in the process. `safeParse`
 * plus an explicit throw, never `.parse` — the raw `ZodError` would travel
 * through the runner and land in `jobs.error` as an issue array, which says less
 * than the one line below.
 *
 * There is no `force` here on purpose. Whether this pull request needs a
 * generation was decided by {@link BriefService.requestGeneration} before the job
 * was enqueued; a flag repeated in the payload would be a second copy of that
 * rule, free to disagree with the first.
 */
const BriefJobPayload = z.object({
  workspaceId: z.string().uuid(),
  prId: z.string().uuid(),
});

/**
 * The blast map when the map itself could not be read.
 *
 * A value rather than a rethrow, because every entry point needs the map's
 * `status` and `indexed_sha` for the cache key: a read of the brief must not 500
 * because the index misbehaved, and a generation must not fail the job over it.
 * `index_failed` is the map's own vocabulary for "the index exists and its last
 * build failed", which is the closest true statement available here — the caveat
 * being that a transient database error on that read reports the same way.
 */
const BLAST_UNAVAILABLE: BriefBlastFacts = {
  status: 'degraded',
  reason: 'index_failed',
  indexed_sha: null,
  changed_files: [],
  changed_symbols: [],
  downstream: [],
  impacted: [],
  counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
};

/** Everything the cache key is computed from, and the key itself. */
interface KeyState {
  files: readonly BriefPrFile[];
  intent: BriefIntentFacts | undefined;
  blast: BriefBlastFacts;
  /** The effective document set with its byte sizes — metadata, no text. */
  docs: SizedDoc[];
  cacheKey: string;
}

/**
 * The outcome of the one model call — a value in every case, never a throw.
 *
 * `usage` is the whole `StructuredResult`, which already carries the model, the
 * round-trip count, both token counts and the cost, so AC-34 needs no new field
 * on the port.
 */
interface CallOutcome {
  provider: string | null;
  draft: PrBriefDraft | null;
  usage: StructuredResult<PrBriefDraft> | null;
  reason: BriefReason | null;
  error: string | null;
}

/** What a generation that never reached a provider records. */
const EMPTY_CALL: CallOutcome = {
  provider: null,
  draft: null,
  usage: null,
  reason: null,
  error: null,
};

/**
 * The `jobId` of a request that was accepted and had nothing to do.
 *
 * `PrBriefs.requestGeneration` answers one shape, so a request whose stored
 * brief is already fresh — AC-5, which asks for the stored brief and NO model
 * call — has to report the absence of a job rather than a job that does not
 * exist. The client treats the field as optional and no screen renders it
 * (`client/src/lib/hooks/brief.ts`, `BriefGenerateAccepted`).
 */
const NO_JOB = '';

export class BriefService implements PrBriefs {
  constructor(private readonly deps: BriefDeps) {}

  /**
   * Register the generation job handler. Called once from `routes.ts` at boot,
   * the shape `conventions`, `onboarding` and `repo-intel` all use — the runner
   * keeps the handler closure, so where the service was constructed does not
   * matter.
   */
  registerJobHandler(log?: BriefLogger): void {
    this.deps.jobs.register(BRIEF_JOB_KIND, async (payload) => {
      const parsed = BriefJobPayload.safeParse(payload);
      if (!parsed.success) {
        throw new Error(`invalid ${BRIEF_JOB_KIND} payload: expected { workspaceId, prId }`);
      }
      await this.runGeneration(parsed.data.workspaceId, parsed.data.prId, log);
    });
  }

  // --- read ------------------------------------------------------------------

  /**
   * The pull request's stored brief, or the honest absence of one.
   *
   * The workspace lookup is the FIRST await (AC-35): before any intent row,
   * blast fact, document or stored brief is read, and before any clone path is
   * resolved, so a pull request belonging to another workspace answers not-found
   * rather than leaking whether it exists.
   *
   * Nothing on this path writes, and nothing on it calls a model. The one
   * non-trivial cost is the cache key, which is computed so the response can say
   * whether the stored brief still describes the pull request (AC-3) — and it is
   * computed only when there IS a stored key to compare it against, which is
   * what keeps a never-generated brief off the clone walk entirely.
   */
  async getBrief(workspaceId: string, prId: string): Promise<PrRiskBrief> {
    const pull = await this.loadPull(workspaceId, prId);
    const stored = await this.deps.store.get(prId);

    // No row at all is `never_generated`, answered as 200 with an empty document
    // rather than 404: in a local-first tool, nothing generated yet is an
    // ordinary state, and the state is the ABSENCE of a row rather than a stored
    // value.
    if (!stored) return emptyBrief(prId);

    const running = stored.state === 'running' && !isAbandoned(stored.startedAt);
    return {
      pr_id: prId,
      what: stored.what,
      why: stored.why,
      risk_level: stored.riskLevel,
      risks: stored.risks,
      review_focus: stored.reviewFocus,
      diff_stats: stored.diffStats,
      // A body that failed its parse is not a brief, whatever the columns claim:
      // the repository already answers with an empty body in that case, and this
      // is the pair of fields that says why — `model_invalid` is exactly "it
      // answered and the answer did not survive validation".
      status: stored.bodyValid ? stored.status : 'degraded',
      reason: stored.bodyValid ? stored.reason : 'model_invalid',
      sources: stored.sources,
      head_sha: stored.headSha,
      cache_key: stored.cacheKey,
      stale: await this.isStale(workspaceId, pull, stored),
      generation_state: running ? 'running' : 'done',
      // `cache_key` is null exactly when no generation has ever completed for
      // this row — a claim writes the row without one — so the row's own
      // `generated_at` default is not a moment any brief was written at.
      generated_at: stored.cacheKey === null ? null : stored.generatedAt.toISOString(),
      provider: stored.provider,
      model: stored.model,
      attempts: stored.attempts,
      tokens_in: stored.tokensIn,
      tokens_out: stored.tokensOut,
      cost_usd: stored.costUsd,
      error: stored.error,
    };
  }

  // --- generation ------------------------------------------------------------

  /**
   * Queue a generation and return at once with the job id.
   *
   * Three rules, in this order, and the order is the point.
   *
   *  - **Freshness first, and only when `force` was not asked for** (AC-4, AC-5,
   *    AC-6). A stored brief whose key still equals the key computed from the
   *    pull request's current state needs no generation, and this is where the
   *    automatic trigger on the pull-request detail read stops: it must enqueue
   *    nothing for a pull request whose brief already describes it (AC-58).
   *    `force` skips the comparison entirely rather than computing a key it will
   *    ignore — the comparison costs a clone walk.
   *  - **The claim decides and writes together** (AC-8). There is deliberately no
   *    `get()`-then-branch here: that pair is a check-then-write race under READ
   *    COMMITTED, and the two racers in this feature are the ordinary case rather
   *    than an exotic one. A refusal travels as a `ValidationError` → 422, the
   *    class the one existing "already running" refusal in this server uses;
   *    there is no `ConflictError` here.
   *  - **A claim that cannot be enqueued is released.** Otherwise the row stays
   *    `running` and refuses every later generation until the staleness window
   *    expires.
   */
  async requestGeneration(
    workspaceId: string,
    prId: string,
    options: { force?: boolean } = {},
    log?: BriefLogger,
  ): Promise<{ status: 'accepted'; jobId: string }> {
    const pull = await this.loadPull(workspaceId, prId);

    if (!options.force) {
      const stored = await this.deps.store.get(prId);
      const repo = await this.deps.store.getRepo(pull.repoId);
      if (stored && repo) {
        const state = await this.collectKeyState(workspaceId, pull, repo);
        if (!needsGeneration(stored, state.cacheKey)) {
          return { status: 'accepted', jobId: NO_JOB };
        }
      }
    }

    const startedAt = new Date();
    const staleBefore = new Date(startedAt.getTime() - BRIEF_STALE_AFTER_MS);
    if (!(await this.deps.store.claimRunning(prId, startedAt, staleBefore))) {
      throw new ValidationError('A brief is already being generated for this pull request');
    }

    try {
      const job = await this.deps.jobs.enqueue(workspaceId, BRIEF_JOB_KIND, {
        workspaceId,
        prId,
      });

      // `JobRunner.enqueue` attaches a central catch, so a discarded rejection
      // can no longer kill the process (`server/INSIGHTS.md`, 2026-08-07). This
      // per-caller one is the BOOKKEEPING half and is still required: without it
      // a generation that dies inside the job leaves the row on `running` until
      // the staleness window expires. `clearRunning` is `WHERE pr_id = …` and
      // nothing else, so a pull request deleted meanwhile updates no row rather
      // than erroring.
      void job.done.catch(async (error: Error) => {
        log?.warn({ err: error, prId }, 'pr brief generation job failed');
        await this.deps.store
          .clearRunning(prId, `The generation job failed: ${error.message}`, 'model_failed')
          .catch(() => undefined);
      });

      return { status: 'accepted', jobId: job.id };
    } catch (error) {
      // No handler registered, or a transient enqueue failure. `reason` is null
      // because no model was involved and this vocabulary has no member for "the
      // queue would not take it"; the message carries the detail.
      await this.deps.store.clearRunning(
        prId,
        `Could not enqueue the generation: ${(error as Error).message}`,
        null,
      );
      throw error;
    }
  }

  /**
   * The whole generation. Runs inside the job worker and never throws for
   * anything the brief can describe.
   *
   * Reads its OWN inputs and computes its OWN key rather than taking them from
   * the request that queued it: the key stored on a brief has to be the key the
   * brief was generated against, and a pull request can be refreshed between the
   * enqueue and the run.
   */
  async runGeneration(workspaceId: string, prId: string, log?: BriefLogger): Promise<void> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    // A pull request deleted mid-generation ends this SILENTLY: `pr_brief.pr_id`
    // is `ON DELETE cascade`, so the claim went with it and there is no row left
    // to record anything on. Not a defect to report, and not a job to fail.
    if (!pull) return;

    const repo = await this.deps.store.getRepo(pull.repoId);
    if (!repo) {
      await this.deps.store.clearRunning(prId, 'The repository record is missing', null);
      return;
    }

    const state = await this.collectKeyState(workspaceId, pull, repo);

    // AC-28, and the reason it returns HERE: a pull request with no changed file
    // recorded has nothing to reason about, so no provider is constructed, no key
    // is read and nothing is charged. Not a rare case — `pr_files` is written
    // only by `GET /pulls/:id`, measured at 10 of 14 in a live workspace
    // (`server/INSIGHTS.md`, 2026-08-11 and 2026-08-15).
    if (state.files.length === 0) {
      const empty = this.assemble(pull, state, undefined, undefined, []);
      await this.persist(pull, state, empty, EMPTY_CALL, null, 'no_changed_files', log);
      return;
    }

    const [priorPrs, docs, issue] = await Promise.all([
      this.readPriorPrs(workspaceId, prId),
      this.readDocTexts(repo, state.docs),
      this.readIssue(repo, pull),
    ]);
    const assembled = this.assemble(pull, state, priorPrs, issue, docs);

    // AC-16, and it is a separate criterion from AC-15 for the same reason AC-28
    // is separate from AC-29: a correct status with a wasted call satisfies one
    // and is exactly what the other exists to prevent. Grounding is DEFINED
    // against the changed-file list, so a call made without the core cannot
    // produce a checkable answer.
    if (assembled.coreOverBudget) {
      await this.persist(pull, state, assembled, EMPTY_CALL, null, 'inputs_too_large', log);
      return;
    }

    const call = await this.callModel(workspaceId, assembled, log);
    const grounded = call.draft === null ? null : this.ground(pull, state, assembled, call.draft);
    await this.persist(pull, state, assembled, call, grounded, null, log);
  }

  /**
   * The one model call, bounded twice, its failure modes distinguished.
   *
   * Everything that can go wrong is a VALUE: a throw, a lost race and a payload
   * the schema rejects each come back as a reason with no draft, so the caller
   * stores a labelled, deterministic brief either way (AC-29).
   *
   * The final size check is `prompt.ts`'s and is made HERE, before a provider is
   * touched, because it measures the messages exactly as they will be sent —
   * after the untrusted delimiters and the rendered template, which is what
   * AC-12 defines the budget over. Its two refusals mean different things: only
   * core blocks left is AC-16's honest "the core alone overruns", while an
   * optional block still present means the shed loop was handed a stale figure,
   * which is a DEFECT in this server's arithmetic and not a size fact about the
   * pull request — so it is logged as one and never stored as
   * `inputs_too_large`.
   */
  private async callModel(
    workspaceId: string,
    assembled: AssembledInput,
    log?: BriefLogger,
  ): Promise<CallOutcome> {
    let provider: string | null = null;
    try {
      const template = await loadTemplate();
      const built = buildBriefMessages(template, assembled.blocks);
      if (!built.ok) {
        if (built.kind === 'core_over_budget') {
          return { ...EMPTY_CALL, reason: 'inputs_too_large' };
        }
        log?.warn(
          {
            tokens: built.tokens,
            budget: built.budget,
            present: built.present,
            preWrapTokens: assembled.tokens,
            dropped: assembled.dropped,
          },
          'pr brief input is over budget with an optional source still present',
        );
        return {
          ...EMPTY_CALL,
          error: `The assembled input was ${built.tokens} tokens against a ${built.budget}-token budget with an optional source still present`,
        };
      }

      const choice = await this.deps.featureModel(workspaceId, BRIEF_FEATURE_MODEL);
      provider = choice.provider;
      const llm = await this.deps.llm(choice.provider);

      // The call is bounded HERE and only here. `maxRetries` caps the PROVIDER's
      // round-trips (AC-19) and the race caps WALL-CLOCK (AC-20); they bound
      // different quantities and neither alone bounds anything. The rejection is
      // folded into the resolved value so the loser of the race can never become
      // an unhandled rejection.
      const pending = llm
        .completeStructured({
          model: choice.model,
          schema: PrBriefDraft,
          schemaName: BRIEF_SCHEMA_NAME,
          messages: built.messages,
          temperature: 0,
          maxRetries: BRIEF_MAX_RETRIES,
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: Error) => ({ ok: false as const, error }),
        );

      const raced = await Promise.race([pending, deadline(BRIEF_CALL_DEADLINE_MS)]);
      if (raced === null) {
        return {
          ...EMPTY_CALL,
          provider,
          reason: 'model_timeout',
          error: `The model did not answer within ${BRIEF_CALL_DEADLINE_MS}ms`,
        };
      }
      if (!raced.ok) {
        // `parseWithRepair` throws when the answer still does not validate, so a
        // schema rejection arrives here rather than as a separate outcome —
        // which is why the message is what decides between the two reasons.
        const invalid = /schema|validat|parse/i.test(raced.error.message);
        return {
          ...EMPTY_CALL,
          provider,
          reason: invalid ? 'model_invalid' : 'model_failed',
          error: raced.error.message,
        };
      }

      return {
        provider,
        draft: raced.value.data,
        usage: raced.value,
        reason: null,
        error: null,
      };
    } catch (error) {
      // A missing API key (`ConfigError`), an unreadable template, an unknown
      // provider id. None of them is a reason to fail the job: the brief is
      // stored with its deterministic figures and the card explains itself.
      return {
        ...EMPTY_CALL,
        provider,
        reason: 'model_failed',
        error: `${provider ?? 'model'}: ${(error as Error).message}`,
      };
    }
  }

  /** The eight sources of AC-10, from material this service has already read. */
  private assemble(
    pull: BriefPull,
    state: KeyState,
    priorPrs: BriefPriorPrsFacts | undefined,
    issue: BriefIssueSource | undefined,
    docs: readonly LoadedDoc[],
  ): AssembledInput {
    return assembleBriefInput({
      pull,
      files: state.files,
      intent: state.intent,
      blast: state.blast,
      priorPrs,
      issue,
      docs,
      fileRole: this.deps.fileRole,
    });
  }

  /**
   * The model's own output, checked before anything is stored.
   *
   * `groundingPaths` and not `changedPaths`: grounding asks whether the model
   * could have known about a path, and a path the 200-path cap left out was never
   * in front of it — so grounding against the full changed set would accept a
   * citation the model could not have made honestly.
   */
  private ground(
    pull: BriefPull,
    state: KeyState,
    assembled: AssembledInput,
    draft: PrBriefDraft,
  ): GroundedBrief {
    const refs = blastReferences(state.blast);
    return groundBriefDraft(draft, {
      title: pull.title,
      listedPaths: assembled.groundingPaths,
      blastFiles: refs.files,
      blastEndpoints: refs.endpoints,
    });
  }

  /**
   * Store the brief and log the price — one line carrying every figure (AC-34).
   *
   * One line and not one per figure: "how many calls did that cost, and what did
   * it cost" has to be answerable by reading a single record.
   */
  private async persist(
    pull: BriefPull,
    state: KeyState,
    assembled: AssembledInput,
    call: CallOutcome,
    grounded: GroundedBrief | null,
    precondition: BriefReason | null,
    log?: BriefLogger,
  ): Promise<void> {
    const { status, reason } = resolveOutcome(state, call, grounded, precondition);

    const write: StoredBriefWrite = {
      what: grounded?.what ?? null,
      why: grounded?.why ?? null,
      // A brief the model did not produce carries the deterministic figures and
      // nothing else: no risk level, no risks and NO review focus (AC-30). A
      // review-focus row is advice plus a reason, and the reason is the only part
      // a model produces — so a deterministic list would be a list of files with
      // invented justifications (OQ-9).
      risks: grounded?.risks ?? [],
      reviewFocus: grounded?.reviewFocus ?? [],
      diffStats: assembled.diffStats,
      sources: assembled.sources,
      riskLevel: grounded?.riskLevel ?? null,
      status,
      reason,
      cacheKey: state.cacheKey,
      headSha: pull.headSha,
      provider: call.provider,
      // `usage.model` rather than the requested id: a router may answer with a
      // different revision, and the figure worth recording is what ran.
      model: call.usage?.model ?? null,
      attempts: call.usage?.attempts ?? null,
      tokensIn: call.usage?.tokensIn ?? null,
      tokensOut: call.usage?.tokensOut ?? null,
      costUsd: call.usage?.costUsd ?? null,
      error: call.error,
    };
    await this.deps.store.save(pull.id, write, new Date());

    log?.info(
      {
        prId: pull.id,
        number: pull.number,
        status,
        reason,
        provider: write.provider,
        model: write.model,
        attempts: write.attempts,
        tokensIn: write.tokensIn,
        tokensOut: write.tokensOut,
        costUsd: write.costUsd,
        inputTokens: assembled.tokens,
        droppedSources: assembled.dropped,
        filesChanged: write.diffStats.files_changed,
        filesListed: write.diffStats.files_listed,
        omittedPaths: assembled.omittedPaths,
        risks: write.risks.length,
        reviewFocus: write.reviewFocus.length,
        blastStatus: state.blast.status,
        blastCounts: state.blast.counts,
        cacheKey: write.cacheKey,
      },
      'pr brief generated',
    );
  }

  // --- inputs ----------------------------------------------------------------

  /**
   * Everything the cache key is computed from, and the key.
   *
   * The four reads that can fail are each tolerated separately, because a brief
   * is a summary of what could be read rather than a transaction: a failed
   * intent read makes the brief partial, an unreachable index reports itself, and
   * neither turns a read of the brief into a 500.
   */
  private async collectKeyState(
    workspaceId: string,
    pull: BriefPull,
    repo: BriefRepoRef,
  ): Promise<KeyState> {
    const [files, intent, blast, docs] = await Promise.all([
      this.deps.store.getPrFiles(pull.id),
      this.readIntent(workspaceId, pull.id),
      this.readBlast(workspaceId, pull.id),
      this.readDocSet(workspaceId, pull.repoId, repo),
    ]);

    return {
      files,
      intent,
      blast,
      docs,
      cacheKey: computeCacheKey({
        headSha: pull.headSha,
        title: pull.title,
        body: pull.body,
        files,
        // The intent's contribution is its status and its derived-at time, and
        // null when nothing has ever been derived — the key must move when a
        // re-derivation happens even if the text it produced is identical.
        intent: intent ? { status: intent.status, derived_at: intent.derived_at } : null,
        blast: { status: blast.status, indexed_sha: blast.indexed_sha },
        docs: cacheKeyDocs(docs),
      }),
    };
  }

  /**
   * Does the stored brief still describe this pull request?
   *
   * Read-only, and only when there is a stored key to compare against: a row
   * with none has never completed a generation, and "stale" is not the honest
   * word for a brief that does not exist.
   */
  private async isStale(
    workspaceId: string,
    pull: BriefPull,
    stored: StoredBrief,
  ): Promise<boolean> {
    if (stored.cacheKey === null) return false;
    const repo = await this.deps.store.getRepo(pull.repoId);
    if (!repo) return false;
    const state = await this.collectKeyState(workspaceId, pull, repo);
    return stored.cacheKey !== state.cacheKey;
  }

  private async readIntent(
    workspaceId: string,
    prId: string,
  ): Promise<BriefIntentFacts | undefined> {
    try {
      return await this.deps.intent.get(workspaceId, prId);
    } catch {
      // Indistinguishable from "none was derived" for this feature's purposes:
      // either way the brief is written without it and marked partial (AC-31).
      return undefined;
    }
  }

  private async readBlast(workspaceId: string, prId: string): Promise<BriefBlastFacts> {
    try {
      return await this.deps.blast.build(workspaceId, prId);
    } catch {
      return BLAST_UNAVAILABLE;
    }
  }

  private async readPriorPrs(
    workspaceId: string,
    prId: string,
  ): Promise<BriefPriorPrsFacts | undefined> {
    try {
      return await this.deps.priorPrs.build(workspaceId, prId);
    } catch {
      // An optional source, and the assembly records the absence itself.
      return undefined;
    }
  }

  /**
   * The effective document set with its byte sizes — metadata only.
   *
   * A failure to list the agents leaves the set empty, which is the same value a
   * workspace with no enabled agent produces; a failure to size a set that WAS
   * listed keeps every path with a size of `0`, so the key still moves when a
   * document is added or removed rather than collapsing to "no documents".
   */
  private async readDocSet(
    workspaceId: string,
    repoId: string,
    repo: BriefRepoRef,
  ): Promise<SizedDoc[]> {
    let set;
    try {
      set = await collectEffectiveDocSet(this.deps, workspaceId, repoId);
    } catch {
      return [];
    }
    try {
      return await sizeEffectiveDocs(this.deps.repoDocs, repo, set);
    } catch (error) {
      return set.map((doc) => ({
        ...doc,
        size: 0,
        sized: false,
        note: `the document set could not be sized: ${(error as Error).message}`,
      }));
    }
  }

  /**
   * The documents' texts — the generation path only, never the read path.
   *
   * `readEffectiveDocs` checks each document's size against the read cap BEFORE
   * opening a byte, which is what the walk having reported sizes buys.
   */
  private async readDocTexts(
    repo: BriefRepoRef,
    docs: readonly SizedDoc[],
  ): Promise<LoadedDoc[]> {
    try {
      return await readEffectiveDocs(this.deps.repoDocs, repo, docs);
    } catch (error) {
      const note = `the documents could not be read: ${(error as Error).message}`;
      return docs.map((doc) => ({ path: doc.path, ok: false, note }));
    }
  }

  /**
   * The one issue the description links, from THIS pull request's repository.
   *
   * One issue and one repository: there is no URL to dereference and no second
   * host to reach, which removes the SSRF surface rather than filtering it. A
   * refusal is a value the assembly records as `unfetched`, never a throw — a
   * missing GitHub token must not fail a generation.
   */
  private async readIssue(
    repo: BriefRepoRef,
    pull: BriefPull,
  ): Promise<BriefIssueSource | undefined> {
    const n = linkedIssueNumber(pull.body, pull.number, repo);
    if (n === null) return undefined;

    const ref = `${repo.owner}/${repo.name}#${n}`;
    try {
      const github = await this.deps.github();
      const issue = await github.getIssue(repo, n);
      return {
        ref,
        ok: true,
        title: `#${issue.number} ${issue.title}`,
        body: issue.body ?? null,
      };
    } catch (error) {
      return { ref, ok: false, note: (error as Error).message };
    }
  }

  /**
   * Resolve the pull request inside the caller's workspace, or 404.
   *
   * Both request-facing methods open with this, which is what makes the workspace
   * lookup the first thing a request does and the authorization check for every
   * read below it: `pr_files`, `pr_intent` and `pr_brief` carry no `workspace_id`
   * of their own (AC-35).
   */
  private async loadPull(workspaceId: string, prId: string): Promise<BriefPull> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

/* ─── the rules, as pure functions ────────────────────────────────────────── */

/**
 * Whether this pull request's brief is worth (re-)generating.
 *
 * Pure, and `now` is a parameter, so the staleness rule is testable without
 * waiting five minutes — the shape `needsDerivation` and
 * `ConventionsRepository.activeScan` both set. Exported because it is the
 * predicate the automatic trigger on the pull-request detail read is asking
 * about, and a caller that wants to know the answer must not re-derive it
 * (`DDG-ARCH-001`).
 *
 *  - No row, or a body that did not survive its parse, means there is no brief
 *    to keep — the parse failure is offered for regeneration rather than served
 *    as a 500 nobody can clear without a database.
 *  - A row with no stored key has never completed a generation; a claim writes
 *    the row without one.
 *  - A key that differs is the whole freshness rule (AC-4, AC-5).
 *  - A LIVE generation is the answer to "does this need one" — one is already
 *    happening. An abandoned one is not: a claim with no start time, or one older
 *    than the window, has to be replaceable or a dead worker bricks the card
 *    forever (AC-9).
 */
export function needsGeneration(
  stored: StoredBrief | undefined,
  cacheKey: string,
  now: Date = new Date(),
): boolean {
  if (!stored) return true;
  if (!stored.bodyValid) return true;
  if (stored.cacheKey === null) return true;
  if (stored.cacheKey !== cacheKey) return true;
  if (stored.state === 'running') return isAbandoned(stored.startedAt, now);
  return false;
}

/**
 * The brief's status and reason, once everything is known.
 *
 * Three tiers, and the order inside the middle one is the only judgement call
 * here.
 *
 *  - A failed PRECONDITION is `degraded`: no call was made and the reason names
 *    which precondition failed (AC-57).
 *  - No draft is `degraded` with the call's own reason, which distinguishes
 *    `model_failed`, `model_timeout` and `model_invalid` (AC-29). A null reason
 *    with no draft is this server's own arithmetic defect — see
 *    {@link BriefService.callModel} — and is deliberately NOT dressed up as a
 *    size limit.
 *  - Otherwise `partial` for the three qualifications, then `ok`.
 *
 * `restates_title` is checked FIRST among the three because it is the only one
 * whose evidence is nowhere else on the card: a null `what` has no other
 * explanation, while a partial index and a missing intent are both already
 * visible in the `sources` audit trail and on the cards beside this one. A blast
 * map that is not ok then carries the map's OWN reason value rather than a
 * re-derived one (AC-32) — validated through `BriefReason` because the map's
 * vocabulary has one member (`flag_off`) this one does not, and inventing a
 * translation for it would be a third story about the same index.
 */
function resolveOutcome(
  state: KeyState,
  call: CallOutcome,
  grounded: GroundedBrief | null,
  precondition: BriefReason | null,
): { status: BriefStatus; reason: BriefReason | null } {
  if (precondition !== null) return { status: 'degraded', reason: precondition };
  if (grounded === null) return { status: 'degraded', reason: call.reason };

  if (grounded.restatedTitle) return { status: 'partial', reason: 'restates_title' };
  if (state.blast.status !== 'ok') {
    return { status: 'partial', reason: BriefReason.safeParse(state.blast.reason).data ?? null };
  }
  if (!state.intent || state.intent.status === 'failed' || state.intent.intent === null) {
    return { status: 'partial', reason: 'no_intent' };
  }
  return { status: 'ok', reason: null };
}

/** A pull request nobody has generated a brief for: an empty document, not a 404. */
function emptyBrief(prId: string): PrRiskBrief {
  return {
    pr_id: prId,
    what: null,
    why: null,
    risk_level: null,
    risks: [],
    review_focus: [],
    diff_stats: {
      files_changed: 0,
      files_listed: 0,
      additions: 0,
      deletions: 0,
      symbols: 0,
      endpoints: 0,
    },
    status: 'degraded',
    reason: null,
    sources: [],
    head_sha: null,
    cache_key: null,
    // Nothing to be stale against, and an unknowable answer is false.
    stale: false,
    generation_state: 'never_generated',
    generated_at: null,
    provider: null,
    model: null,
    attempts: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    error: null,
  };
}

/**
 * Has a `running` claim outlived its worker?
 *
 * A claim with no start time counts as abandoned: it has no moment to be young
 * relative to, and a row that can never age out refuses every future generation
 * forever — which is what happened to a conventions scan before it had a window
 * (`server/INSIGHTS.md`, 2026-08-06). The same two terms are inside
 * `claimRunning`'s `WHERE`; this is the read-side half, for the predicate above.
 */
function isAbandoned(startedAt: Date | null, now: Date = new Date()): boolean {
  if (startedAt === null) return true;
  return now.getTime() - startedAt.getTime() >= BRIEF_STALE_AFTER_MS;
}

/* ─── the linked issue reference ──────────────────────────────────────────── */

/** `#123` anywhere in the description — an issue or pull request of this repository. */
const ISSUE_REF = /#(\d+)/g;

/** Any absolute URL. Everything that is not a same-repository link is ignored. */
const URL_REF = /https?:\/\/[^\s<>()[\]"'`]+/g;

/** `/<owner>/<repo>/issues|pull/<n>` */
const GITHUB_ISSUE_PATH = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/;

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * The first issue of this repository the description references, or null.
 *
 * The intent layer's parse, narrowed to one result: this feature's input carries
 * ONE linked issue, so there is nothing to fan out over and no per-link budget to
 * spend. A `#n` reference wins over a URL because it is the form this product's
 * own users write, and the pull request's own number is not context about itself.
 *
 * Deliberately re-derived rather than imported from the intent module: a
 * cross-module import is a `no-cross-module-internals` violation that
 * `import type` does not exempt, and the parse is nine lines.
 */
function linkedIssueNumber(
  body: string | null,
  ownNumber: number,
  repo: BriefRepoRef,
): number | null {
  const text = body ?? '';

  for (const match of text.matchAll(ISSUE_REF)) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > 0 && n !== ownNumber) return n;
  }

  for (const match of text.matchAll(URL_REF)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (!GITHUB_HOSTS.has(url.hostname)) continue;
    const issue = GITHUB_ISSUE_PATH.exec(url.pathname);
    if (!issue) continue;
    if (issue[1]?.toLowerCase() !== repo.owner.toLowerCase()) continue;
    if (issue[2]?.toLowerCase() !== repo.name.toLowerCase()) continue;
    const n = Number(issue[3]);
    if (Number.isSafeInteger(n) && n > 0 && n !== ownNumber) return n;
  }

  return null;
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
