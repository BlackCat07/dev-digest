import type { PrIntent } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { deriveConfidence, intentStatusFor } from './confidence.js';
import { buildClassifyMessages, loadTemplate } from './prompt.js';
import { groundRiskAreas } from './risks.js';
import { IntentClassification } from './schemas.js';
import {
  collectSources,
  deterministicMissingContext,
  type IntentDeps,
  type IntentPull,
} from './sources.js';
import {
  INTENT_CALL_DEADLINE_MS,
  INTENT_FEATURE_MODEL,
  INTENT_IMPORT_SCAN_LIMIT,
  INTENT_JOB_KIND,
  INTENT_MAX_RETRIES,
  INTENT_SCHEMA_NAME,
  INTENT_STALE_AFTER_MS,
  MAX_INTENT_CHARS,
  MAX_MISSING_CONTEXT_CHARS,
  MAX_MISSING_CONTEXT_ENTRIES,
  MAX_SCOPE_ITEMS,
} from './constants.js';

/**
 * The parts of a listed pull request the import trigger needs.
 *
 * Structural, like {@link IntentPull}: a Drizzle row satisfies it and so does a
 * fixture, and no caller has to import a type from this module to hand one over.
 */
export interface IntentCandidate {
  id: string;
  number: number;
  headSha: string;
  updatedAt: Date | null;
}

/**
 * The one level this service logs at, when a caller offers a logger.
 *
 * `app.log` and pino satisfy it. Nothing is logged when no logger is passed —
 * the service has none of its own, and inventing one here would put a second
 * sink next to the caller's.
 */
export interface IntentWarnLogger {
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * The Intent Layer — one cheap classification pass in front of a review.
 *
 * A flash-class model reads what the PR CLAIMS to do (title, description, any
 * same-repo issue or document it links, the changed-file list and the `@@` hunk
 * headers — never a diff body) and the result is persisted per PR, shown on the
 * PR page, and injected into the reviewer's prompt as untrusted data.
 *
 * Three properties this service exists to guarantee:
 *
 *  1. **It always produces an intent, or a row saying why it could not.** A PR
 *     with no description, no ticket and no spec is the NORMAL case: the
 *     classifier still runs, from the title and the file list, at a visibly
 *     lower confidence. It never refuses and it never blocks a review.
 *  2. **{@link IntentService.derive} does not throw** for anything but a PR that
 *     is not in this workspace. A provider error, a missing API key, a losing
 *     race, a failed freshness read, a failed row claim — every one of them
 *     becomes a RECORDED FAILURE on the row and a normal return. That is what
 *     stops `JobRunner` retrying three times per PR on a workspace with no LLM
 *     key configured. The one residual escape is a database that cannot even
 *     accept the failure row: recording is attempted, and if that write fails
 *     too the original error propagates rather than being masked by the
 *     bookkeeping one.
 *  3. **Nothing is invented.** What could not be read is recorded as such, and
 *     the model's own confidence may only LOWER the derived figure.
 *
 * Every port is injected — GitHub, git, the LLM, the job queue, the review
 * repository — as {@link IntentDeps}, the ports this service actually uses
 * rather than the whole DI container. There is no `octokit`, `openai` or
 * `simple-git` import in this module, and no repository of its own: `pr_intent`
 * belongs to the review domain's data layer and is reached through
 * `deps.reviewRepo`.
 */
export class IntentService {
  /**
   * @param deps the ports this service uses; a `Container` satisfies them
   *   structurally. There is no second "composition root" parameter any more:
   *   the settings read that needed it is now the `featureModel` port, which is
   *   what took this module out of its import cycle with `platform/container.ts`.
   */
  constructor(private deps: IntentDeps) {}

  /**
   * Read the stored intent for a PR, resolving the PR in the workspace first.
   *
   * That lookup IS the authorization check: `pr_intent` carries no
   * `workspace_id` of its own (its PK FKs to the already-scoped
   * `pull_requests`), so a PR id belonging to another workspace must 404 here
   * rather than fall through to an unscoped read of the intent row.
   */
  async get(workspaceId: string, prId: string): Promise<PrIntent | undefined> {
    await this.loadPull(workspaceId, prId);
    return this.deps.reviewRepo.getIntent(prId);
  }

  /**
   * Derive (or re-derive) the intent for one PR and persist it.
   *
   * Throws only `NotFoundError`, and only when the PR is not in this workspace.
   * Every other failure is written to the row and returned as a `failed`
   * derivation — see property 2 in the class doc-comment.
   */
  async derive(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean } = {},
  ): Promise<PrIntent> {
    const repo = this.deps.reviewRepo;
    // OUTSIDE the try, and the only thing that is: a PR in another workspace
    // must reach the caller as a `NotFoundError`, not be recorded on a row that
    // the caller was never entitled to see.
    const pull = await this.loadPull(workspaceId, prId);

    try {
      const stored = await repo.getIntent(prId);
      if (!opts.force && stored && !needsDerivation(pull, stored)) return stored;

      // Claim the row before any slow work, so a second caller can see that a
      // derivation is in flight rather than starting a duplicate call.
      await repo.markIntentRunning(prId, pull.headSha);

      const repoRow = await repo.getRepo(pull.repoId);
      if (!repoRow) return await this.fail(prId, 'the repository record is missing');

      const { blocks, sources, changedPaths } = await collectSources(this.deps, workspaceId, pull, {
        owner: repoRow.owner,
        name: repoRow.name,
      });

      const template = await loadTemplate();
      const { provider, model } = await this.deps.featureModel(
        workspaceId,
        INTENT_FEATURE_MODEL,
      );
      const llm = await this.deps.llm(provider);

      // The call is bounded HERE and only here. `timeoutMs` on the request is
      // silently ignored by the provider, and `maxRetries` defaults to 2 — so
      // `INTENT_MAX_RETRIES` and this race are BOTH required, and neither alone
      // bounds anything. The rejection is folded into the resolved value so the
      // loser of the race can never become an unhandled rejection.
      const call = llm
        .completeStructured({
          model,
          schema: IntentClassification,
          schemaName: INTENT_SCHEMA_NAME,
          messages: buildClassifyMessages(template, blocks),
          temperature: 0,
          maxRetries: INTENT_MAX_RETRIES,
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: Error) => ({ ok: false as const, error }),
        );

      const raced = await Promise.race([call, deadline(INTENT_CALL_DEADLINE_MS)]);
      if (raced === null) {
        return await this.fail(
          prId,
          `the classifier did not answer within ${INTENT_CALL_DEADLINE_MS}ms`,
        );
      }
      if (!raced.ok) {
        return await this.fail(prId, `the classifier call failed: ${raced.error.message}`);
      }

      const { data, ...usage } = raced.value;
      await repo.upsertIntent(prId, {
        intent: data.intent.trim().slice(0, MAX_INTENT_CHARS),
        inScope: data.in_scope.slice(0, MAX_SCOPE_ITEMS),
        outOfScope: data.out_of_scope.slice(0, MAX_SCOPE_ITEMS),
        headSha: pull.headSha,
        // Derived from what was available; the model's self-report may only
        // lower it, never raise it.
        confidence: deriveConfidence(sources, data.confidence),
        sources,
        missingContext: mergeMissingContext(
          deterministicMissingContext(sources),
          data.missing_context,
        ),
        // GROUNDED before it is stored: a `file_refs` entry naming a file this PR
        // never touched is dropped, and a risk whose every reference was invented
        // goes with it. The classifier sees paths but no diff bodies, so "where
        // might this hurt" is exactly the question it is most tempted to answer
        // with a plausible-looking citation.
        riskAreas: groundRiskAreas(data.risk_areas, changedPaths),
        status: intentStatusFor(sources),
        provider,
        model: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costUsd: usage.costUsd,
        derivedAt: new Date(),
        error: null,
      });
      return await this.reload(prId);
    } catch (error) {
      // A missing API key (`ConfigError`), a repository read that failed, a
      // clone that vanished — all of it lands on the row. Nothing propagates.
      //
      // Recording the failure needs the same database that may be the thing
      // that just broke, so the record is itself attempted defensively: when it
      // works, the caller gets a normal `failed` derivation; when even that
      // write cannot land, the ORIGINAL error is what propagates, not the
      // bookkeeping error that replaced it. Rethrowing the original is what
      // keeps a genuinely unusable database diagnosable — swallowing it here
      // would report "could not record a failure" for every cause.
      try {
        return await this.fail(prId, (error as Error).message);
      } catch {
        throw error;
      }
    }
  }

  /**
   * Queue background derivations for a freshly listed batch of pull requests.
   *
   * The WHOLE decision lives here — which PRs are candidates, how many rows one
   * list read may examine, what a job payload looks like, and what happens when
   * a job fails. A route calling this wires and nothing else: whether a stored
   * intent is stale is this module's rule, and the outermost ring must not hold
   * a copy of it (that is what `INTENT_JOB_KIND` and `needsDerivation` leaking
   * into `pulls/routes.ts` amounted to).
   *
   * Two bounds, both required:
   *
   *  - **Rows examined** are capped at `INTENT_IMPORT_SCAN_LIMIT`, so the cost
   *    is a constant handful of primary-key lookups on the success path as well
   *    as on the failure path — see that constant for why the enqueue count is
   *    not the thing to bound.
   *  - **Nothing propagates.** Every failure is caught per row and logged, so a
   *    caller's status code, body and latency are unaffected by this trigger.
   *    The method never throws.
   *
   * Returns how many derivations were queued, for the caller to log or ignore.
   */
  async enqueueDerivations(
    workspaceId: string,
    pulls: readonly IntentCandidate[],
    log?: IntentWarnLogger,
  ): Promise<number> {
    // Most recently updated first: a stable, meaningful window rather than
    // whatever physical order the table scan happened to return.
    const window = [...pulls]
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
      .slice(0, INTENT_IMPORT_SCAN_LIMIT);

    let queued = 0;
    for (const pull of window) {
      try {
        const stored = await this.deps.reviewRepo.getIntent(pull.id);
        if (!needsDerivation(pull, stored)) continue;

        const job = await this.deps.jobs.enqueue(workspaceId, INTENT_JOB_KIND, {
          workspaceId,
          prId: pull.id,
        });
        queued += 1;

        // `JobRunner.enqueue` attaches a central catch, so a discarded rejection
        // can no longer kill the process (server/INSIGHTS.md, 2026-08-07). This
        // per-caller one is the BOOKKEEPING half and is still required: without
        // it a derivation that dies inside the job leaves `pr_intent` on
        // `running` until the staleness window expires.
        void job.done.catch(async (err: unknown) => {
          log?.warn({ err, prId: pull.id, number: pull.number }, 'PR intent derivation job failed');
          await this.deps.reviewRepo
            .failIntent(pull.id, `the derivation job failed: ${(err as Error).message}`)
            .catch(() => undefined);
        });
      } catch (err) {
        // Per ROW, not around the loop: one unreadable intent row must not stop
        // the nine PRs behind it from being queued.
        log?.warn(
          { err, prId: pull.id, number: pull.number },
          'PR intent derivation enqueue skipped',
        );
      }
    }
    return queued;
  }

  private async loadPull(workspaceId: string, prId: string): Promise<IntentPull> {
    const pull = await this.deps.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async fail(prId: string, message: string): Promise<PrIntent> {
    await this.deps.reviewRepo.failIntent(prId, message);
    return this.reload(prId);
  }

  /** Read back what was just written, so callers see the persisted truth. */
  private async reload(prId: string): Promise<PrIntent> {
    const stored = await this.deps.reviewRepo.getIntent(prId);
    // Only reachable if the PR was deleted mid-derivation, in which case a
    // "not found" is the honest answer.
    if (!stored) throw new NotFoundError('Pull request not found');
    return stored;
  }
}

/**
 * Whether this PR's intent is worth (re-)deriving.
 *
 * Pure, and `now` is a parameter, so the staleness rule is testable without
 * waiting five minutes — the shape `ConventionsRepository.activeScan` set.
 *
 * A `running` row with no start time counts as stale: it has no moment to be
 * young relative to, and a row that can never age out bricks the PR's intent
 * forever (`server/INSIGHTS.md`, 2026-08-06).
 */
export function needsDerivation(
  pull: Pick<IntentPull, 'headSha'>,
  stored: PrIntent | undefined,
  now: Date = new Date(),
): boolean {
  if (!stored) return true;
  if (stored.status === 'failed') return true;
  if (stored.head_sha !== pull.headSha) return true;
  if (stored.status === 'running') {
    const startedAt = stored.derived_at ? Date.parse(stored.derived_at) : Number.NaN;
    if (!Number.isFinite(startedAt)) return true;
    return now.getTime() - startedAt >= INTENT_STALE_AFTER_MS;
  }
  return false;
}

/**
 * Our own findings first, the model's after, deduplicated and bounded.
 *
 * Ours come first because they are the ones that cannot be hallucinated: they
 * are read off the audit trail of what was actually fetched.
 */
function mergeMissingContext(ours: string[], theirs: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of [...ours, ...theirs]) {
    const trimmed = line.trim().slice(0, MAX_MISSING_CONTEXT_CHARS);
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
    if (merged.length >= MAX_MISSING_CONTEXT_ENTRIES) break;
  }
  return merged;
}

/**
 * Resolves to `null` after `ms`, to be raced against work that must not overrun.
 *
 * The timer is `unref`'d so a pending deadline can never hold the process open
 * after the derivation has moved on — the loser of the race is abandoned, not
 * cancelled, and Node would otherwise wait for it at shutdown.
 */
function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
}
