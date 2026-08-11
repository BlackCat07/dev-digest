import { readFile, stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type {
  ConventionCategory,
  ConventionScanOptions,
  ComposedConventionSkill,
  ConventionsPayload,
  CreateConventionSkillPayload,
  ExtractedConvention,
  RepoRef,
  Skill,
  UpdateConventionPayload,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import {
  corpusCounter,
  measure,
  deriveConfidence,
  passesFloor,
  splitForMeasurement,
} from './adherence.js';
import { blockedBudget, computeBudget } from './budget.js';
import { composeSkill, type ComposedSkill } from './composer.js';
import { ConventionsRepository, type NewCandidate } from './repository.js';
import { collectSample, type SampledFile } from './sampler.js';
import { mineFacts } from './miner.js';
import {
  buildExtractionMessages,
  buildSelectionMessages,
  loadTemplate,
} from './prompt.js';
import {
  ConventionExtraction,
  ConventionFileSelection,
  type ProposedConvention,
} from './schemas.js';
import { resolveInRoot, verifyClaims } from './verifier.js';
import { byConfidence, ruleKey, scanStatusFor, toConventionDto, toScanDto } from './helpers.js';
import {
  CONVENTIONS_FEATURE_MODEL,
  EXTRACTION_MAX_RETRIES,
  EXTRACTION_CONCURRENCY,
  EXTRACTION_SCHEMA_NAME,
  MAX_CANDIDATES_PER_CATEGORY,
  MAX_SAMPLE_FILES,
  MAX_SELECTED_PATHS,
  MIN_ADHERENCE,
  MIN_OCCURRENCES,
  SCAN_CATEGORIES,
  SCAN_JOB_KIND,
  SCAN_SOFT_BUDGET_MS,
  SELECTION_SCHEMA_NAME,
} from './constants.js';

/**
 * Conventions extractor — scan a cloned repo for its house rules, verify each
 * one against the code, and hand the survivors to a human to triage.
 *
 * The pipeline, and why it is in this order:
 *
 *   sample → mine → select → extract → VERIFY → measure → persist
 *
 * Mining before the model call is what stops it guessing at how widespread a
 * habit is. Verifying after is what stops a guessed citation reaching the
 * screen. Measuring last is what replaces the model's opinion of itself with a
 * count. Take any of the three out and this becomes a plausible-rule generator,
 * which is the thing users complain about in tools like this.
 *
 * Nothing here decides what a convention IS — that is the model's job. This
 * decides what is allowed to survive.
 */

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /**
   * Register the scan job handler. Called once from `routes.ts` at boot, the
   * same shape as `RepoService.registerCloneJobHandler`.
   */
  registerScanJobHandler(): void {
    this.container.jobs.register(SCAN_JOB_KIND, async (payload) => {
      const { workspaceId, repoId, scanId, options } = payload as {
        workspaceId: string;
        repoId: string;
        scanId: string;
        options: ConventionScanOptions;
      };
      await this.runScan(workspaceId, repoId, scanId, options ?? {});
    });
  }

  // --- reads ---------------------------------------------------------------

  /** Everything the Conventions screen renders, in one payload. */
  async payload(workspaceId: string, repoId: string): Promise<ConventionsPayload> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const [scan, rows, budget] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.listCandidates(workspaceId, repoId),
      this.budget(workspaceId, repoId),
    ]);

    return {
      scan: scan ? toScanDto(scan) : null,
      budget,
      candidates: rows.map(toConventionDto).sort(byConfidence),
      repo: { full_name: repo.fullName, sha: scan?.commitSha ?? null },
    };
  }

  /**
   * What a scan would cost, without running one.
   *
   * Three blockers are checked before anything is measured, because each one
   * means a different button state rather than an error: a repo with no clone
   * cannot be scanned at all, an unindexed one has no `file_rank` to sample
   * from, and one already scanning must not be queued twice.
   */
  async budget(workspaceId: string, repoId: string) {
    const repo = await this.loadRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const root = this.container.git.clonePathFor(ref);

    if (!(await pathExists(root))) return blockedBudget('not_cloned');
    if (await this.repo.activeScan(workspaceId, repoId)) return blockedBudget('scan_running');

    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const ranked = await this.container.repoIntel.getConventionSamples(repoId, MAX_SAMPLE_FILES);
    if (ranked.length === 0) return blockedBudget('not_indexed');

    // stat only — the names are already known, nothing is read or walked.
    let sampleBytes = 0;
    await Promise.all(
      ranked.map(async (path) => {
        const absolute = resolveInRoot(root, path);
        if (!absolute) return;
        const stats = await stat(absolute).catch(() => null);
        if (stats?.isFile()) sampleBytes += stats.size;
      }),
    );

    const { model } = await resolveFeatureModel(
      this.container.db,
      workspaceId,
      CONVENTIONS_FEATURE_MODEL,
    );
    const draft = computeBudget({
      indexedFiles: indexState.filesIndexed,
      eligibleFiles: ranked.length,
      sampleBytes,
      plannedSample: ranked.length,
      estimatedCostUsd: null,
      blockedReason: null,
    });

    // Output tokens are a rounding error next to the file bodies going in, but
    // pricing them at zero would under-quote — allow a fifth.
    const estimated = this.container.priceBook.estimate(
      model,
      draft.planned_tokens,
      Math.ceil(draft.planned_tokens / 5),
    );
    return { ...draft, estimated_cost_usd: estimated };
  }

  // --- scan ----------------------------------------------------------------

  /**
   * Queue a scan. Returns immediately with the scan row the client polls.
   *
   * The row is created here rather than in the worker so the screen has
   * something to show the moment the button is pressed, and so a second press
   * has an existing `queued` row to be refused against.
   */
  async requestScan(workspaceId: string, repoId: string, options: ConventionScanOptions) {
    await this.loadRepo(workspaceId, repoId);
    const active = await this.repo.activeScan(workspaceId, repoId);
    if (active) throw new ValidationError('A scan is already running for this repository');

    const scan = await this.repo.createScan(workspaceId, repoId, options);
    try {
      const job = await this.container.jobs.enqueue(workspaceId, SCAN_JOB_KIND, {
        workspaceId,
        repoId,
        scanId: scan.id,
        options,
      });
      // `done` REJECTS when the job ultimately fails, and nothing else is
      // holding it. An unhandled rejection takes the whole process down in
      // Node — which is exactly what a scan that overran the job timeout did
      // here, killing the API mid-run. Swallow it and leave the outcome on the
      // scan row, which is where this screen reads it from anyway.
      void job.done.catch(async (error: Error) => {
        await this.repo
          .updateScan(scan.id, {
            status: 'failed',
            error: `Scan job failed: ${error.message}`.slice(0, 500),
            finishedAt: new Date(),
          })
          .catch(() => {});
      });
    } catch (error) {
      // No handler registered, or a transient enqueue failure. Fail the row
      // rather than leaving it `queued` forever — a stuck queued row blocks
      // every later scan of this repo through `activeScan`.
      await this.repo.updateScan(scan.id, {
        status: 'failed',
        error: `Could not enqueue scan: ${(error as Error).message}`,
        finishedAt: new Date(),
      });
      throw error;
    }
    return toScanDto(scan);
  }

  /** The whole pipeline. Runs inside the job worker. */
  async runScan(
    workspaceId: string,
    repoId: string,
    scanId: string,
    options: ConventionScanOptions,
  ): Promise<void> {
    const startedAt = Date.now();
    const remainingBudget = () => SCAN_SOFT_BUDGET_MS - (Date.now() - startedAt);
    const overBudget = () => remainingBudget() <= 0;

    try {
      await this.repo.updateScan(scanId, { status: 'running' });

      const repo = await this.loadRepo(workspaceId, repoId);
      const ref: RepoRef = { owner: repo.owner, name: repo.name };
      const root = this.container.git.clonePathFor(ref);
      const commitSha = await this.container.git.currentHead(ref).catch(() => null);

      // --- sample ---------------------------------------------------------
      const ranked = await this.container.repoIntel.getConventionSamples(
        repoId,
        MAX_SAMPLE_FILES,
      );
      const sample = await collectSample(
        root,
        ranked,
        (absolute) => readFile(absolute, 'utf8').catch(() => null),
        (text) => this.container.tokenizer.count(text),
        options,
      );
      await this.repo.updateScan(scanId, {
        status: 'running',
        commitSha,
        eligibleFiles: ranked.length,
        sampledFiles: sample.files.length,
      });

      if (sample.files.length === 0) {
        await this.repo.updateScan(scanId, {
          status: 'failed',
          error: 'No readable source files in the clone to sample',
          finishedAt: new Date(),
        });
        return;
      }

      // --- mine -----------------------------------------------------------
      const facts = mineFacts(sample.files);

      // --- select ---------------------------------------------------------
      const chosen = await this.selectFiles(workspaceId, sample.files, facts);

      // --- extract --------------------------------------------------------
      const categories = options.categories ?? SCAN_CATEGORIES;
      const extractTemplate = await loadTemplate('conventions.extract.system');
      const { provider, model } = await resolveFeatureModel(
        this.container.db,
        workspaceId,
        CONVENTIONS_FEATURE_MODEL,
      );
      const llm = await this.container.llm(provider);

      let costUsd = 0;
      const proposals: Array<{ category: ConventionCategory; proposed: ProposedConvention }> = [];

      /**
       * Categories run in bounded batches, not all at once.
       *
       * `Promise.all` over every category starts ten calls before the soft
       * budget is ever consulted again, so the budget can only ever be checked
       * when it is already too late — and the run's wall-clock becomes whatever
       * the provider's slowest queued call takes. Batching makes the budget
       * enforceable between waves and keeps the scan inside the job timeout;
       * categories never reached are simply not scanned, and the scan reports
       * `partial`.
       */
      let budgetExhausted = false;
      for (let i = 0; i < categories.length; i += EXTRACTION_CONCURRENCY) {
        if (overBudget()) {
          budgetExhausted = true;
          break;
        }
        const batch = categories.slice(i, i + EXTRACTION_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (category) => {
            const messages = buildExtractionMessages(
              extractTemplate,
              category,
              facts,
              chosen,
              MAX_CANDIDATES_PER_CATEGORY,
            );
            const call = llm
              .completeStructured({
                model,
                schema: ConventionExtraction,
                schemaName: EXTRACTION_SCHEMA_NAME,
                messages,
                temperature: 0,
                // Not `timeoutMs` — the provider ignores that per request; the
                // deadline below is what actually bounds this call.
                maxRetries: EXTRACTION_MAX_RETRIES,
              })
              // One category failing must not cost the other nine.
              .catch(() => null);

            // Each call races the remaining budget INDIVIDUALLY, not as part of
            // its wave. Measured against a live provider on one repo and model,
            // a wave of five swung from ~35s to over 105s between runs — so a
            // wave-level race throws away four good answers because a fifth was
            // slow, and on the slow end returned nothing at all. Per-call, a
            // scan keeps whatever came back in time and reports `partial`.
            // Losers stay caught above, so nothing is left unhandled.
            return Promise.race([call, deadline(remainingBudget())]);
          }),
        );

        if (results.every((result) => result === null)) budgetExhausted = true;

        results.forEach((result, index) => {
          if (!result) return;
          costUsd += result.costUsd ?? 0;
          for (const proposed of result.data.candidates.slice(0, MAX_CANDIDATES_PER_CATEGORY)) {
            proposals.push({ category: batch[index]!, proposed });
          }
        });
      }

      // --- verify, measure, persist ---------------------------------------
      const kept = await this.gate(workspaceId, repoId, scanId, sample.files, root, proposals, options);

      await this.repo.updateScan(scanId, {
        // Capped by the sample budget OR cut short by the time budget: either
        // way the scan succeeded over less than it was asked for, and saying
        // `done` would claim coverage it does not have.
        status: scanStatusFor(sample.cappedBy !== null || budgetExhausted),
        proposed: proposals.length,
        droppedUnverified: kept.droppedUnverified,
        droppedLowAdherence: kept.droppedLowAdherence,
        kept: kept.inserted,
        costUsd: costUsd > 0 ? costUsd : null,
        finishedAt: new Date(),
      });
    } catch (error) {
      await this.repo.updateScan(scanId, {
        status: 'failed',
        error: (error as Error).message.slice(0, 500),
        finishedAt: new Date(),
      });
    }
  }

  /**
   * Step 1 of the dialogue: which of the sampled files are worth reading.
   *
   * The model sees paths only, so this stays cheap on any repo size. Anything it
   * returns that was not offered is discarded — a model that invents a path here
   * would otherwise aim the whole extraction at a file that does not exist. If
   * the call fails or picks nothing usable, the full sample is used: a degraded
   * selection should cost tokens, not results.
   */
  private async selectFiles(
    workspaceId: string,
    files: SampledFile[],
    facts: ReturnType<typeof mineFacts>,
  ): Promise<SampledFile[]> {
    if (files.length <= MAX_SELECTED_PATHS) return files;

    try {
      const template = await loadTemplate('conventions.select.system');
      const { provider, model } = await resolveFeatureModel(
        this.container.db,
        workspaceId,
        CONVENTIONS_FEATURE_MODEL,
      );
      const llm = await this.container.llm(provider);
      const result = await llm.completeStructured({
        model,
        schema: ConventionFileSelection,
        schemaName: SELECTION_SCHEMA_NAME,
        messages: buildSelectionMessages(
          template,
          files.map((file) => file.path),
          facts,
          MAX_SELECTED_PATHS,
        ),
        temperature: 0,
      });
      const offered = new Map(files.map((file) => [file.path, file]));
      const picked = result.data.paths
        .map((path) => offered.get(path))
        .filter((file): file is SampledFile => file !== undefined)
        .slice(0, MAX_SELECTED_PATHS);
      return picked.length > 0 ? picked : files.slice(0, MAX_SELECTED_PATHS);
    } catch {
      return files.slice(0, MAX_SELECTED_PATHS);
    }
  }

  /**
   * The gate: verify evidence, count adherence, drop what fails, write the rest.
   *
   * Dedup runs against rules already stored for this repo, INCLUDING rejected
   * ones. Re-proposing something the user rejected is the fastest way to make a
   * re-scan feel broken, and the model will do it every time — it is asked the
   * same question about the same code.
   */
  private async gate(
    workspaceId: string,
    repoId: string,
    scanId: string,
    corpus: SampledFile[],
    root: string,
    proposals: Array<{ category: ConventionCategory; proposed: ProposedConvention }>,
    options: ConventionScanOptions,
  ): Promise<{ inserted: number; droppedUnverified: number; droppedLowAdherence: number }> {
    // Untriaged candidates of the previous scan go; decisions stay.
    await this.repo.deletePending(workspaceId, repoId);
    const surviving = await this.repo.listCandidates(workspaceId, repoId);
    const seen = new Set(surviving.map((row) => ruleKey(row.rule)));

    const read = (absolute: string) => readFile(absolute, 'utf8').catch(() => null);
    const count = corpusCounter(corpus);

    // Highest self-confidence first, so the measurement budget is spent on the
    // candidates most likely to be worth keeping.
    const ordered = [...proposals].sort(
      (a, b) => (b.proposed.confidence ?? 0) - (a.proposed.confidence ?? 0),
    );
    const { measured, deferred } = splitForMeasurement(ordered);

    const rows: NewCandidate[] = [];
    let droppedUnverified = 0;
    let droppedLowAdherence = 0;

    for (const [index, entry] of [...measured, ...deferred].entries()) {
      const key = ruleKey(entry.proposed.rule);
      if (key.length === 0 || seen.has(key)) continue;

      const verified = await verifyClaims(root, entry.proposed.evidence, read);
      if (verified.evidence.length === 0) {
        droppedUnverified += 1;
        continue;
      }

      const adherence = index < measured.length ? await measure(entry.proposed, count) : null;
      if (
        !passesFloor(
          adherence,
          options.min_adherence ?? MIN_ADHERENCE,
          options.min_occurrences ?? MIN_OCCURRENCES,
        )
      ) {
        droppedLowAdherence += 1;
        continue;
      }

      seen.add(key);
      rows.push({
        workspaceId,
        repoId,
        scanId,
        category: entry.category,
        rule: entry.proposed.rule,
        rationale: entry.proposed.rationale,
        evidence: verified.evidence,
        matcher: entry.proposed.match_violating,
        adherenceConforming: adherence?.conforming ?? null,
        adherenceViolating: adherence?.violating ?? null,
        confidence: deriveConfidence(adherence, entry.proposed.confidence),
      });
    }

    const inserted = await this.repo.insertCandidates(rows);
    return { inserted: inserted.length, droppedUnverified, droppedLowAdherence };
  }

  // --- triage --------------------------------------------------------------

  /**
   * Accept, reject and edit are one call.
   *
   * Editing the rule text sets `edited`, which is what makes the next scan leave
   * it alone. Without it a user's rewrite would be deleted by the next re-scan's
   * `deletePending` and silently replaced by the model's original phrasing.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionPayload,
  ): Promise<ExtractedConvention> {
    const existing = await this.repo.getCandidate(workspaceId, id);
    if (!existing) throw new NotFoundError('Convention candidate not found');

    const textChanged =
      (patch.rule !== undefined && patch.rule !== existing.rule) ||
      (patch.rationale !== undefined && patch.rationale !== existing.rationale);

    const row = await this.repo.updateCandidate(workspaceId, id, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(textChanged ? { edited: true } : {}),
    });
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toConventionDto(row);
  }

  // --- skill generation ----------------------------------------------------

  /**
   * Turn the accepted candidates into one skill.
   *
   * The status filter is the acceptance rule of this whole feature and it is
   * enforced HERE, on ids the client sent — not by trusting the client to send
   * only accepted ones. A rejected or untriaged candidate can therefore never
   * reach a skill body, whatever the request says.
   *
   * The generated skill records which candidates went into it, so a candidate
   * can be traced to the skill that carries it (and so re-generating does not
   * silently produce two skills claiming the same rules).
   *
   * Returns an array of one. The route's response shape is a list because it was
   * once able to write several at a time (a per-category mode, since removed);
   * one skill per call is now the only shape, and the list is what the client
   * already reads.
   */
  async generateSkills(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillPayload,
  ): Promise<Skill[]> {
    const composed = await this.composeFor(workspaceId, repoId, input);

    const created: Skill[] = [];
    for (const skill of composed) {
      const row = await this.container.skills.createExtracted(workspaceId, {
        name: skill.name,
        description: skill.description,
        body: skill.body,
        evidenceFiles: skill.evidenceFiles,
        type: input.type,
        enabled: input.enabled,
      });
      await this.repo.linkSkill(workspaceId, skill.candidateIds, row.id);
      created.push(row);
    }
    return created;
  }

  /**
   * The same composition, without writing anything — what the modal previews.
   *
   * It shares {@link composeFor} with the create path rather than rendering
   * separately, so the preview is byte-for-byte what gets saved. A preview
   * assembled by a second implementation is a preview that eventually lies.
   */
  async previewSkills(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillPayload,
  ): Promise<ComposedConventionSkill[]> {
    const composed = await this.composeFor(workspaceId, repoId, input);
    return composed.map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      evidence_files: skill.evidenceFiles,
      candidate_ids: skill.candidateIds,
    }));
  }

  /**
   * Resolve the ids to ACCEPTED candidates of this repo and compose.
   *
   * The status filter lives here, on the one path both the preview and the
   * create call go through, so the two can never disagree about what is
   * included — and a client cannot opt a rejected candidate in by sending its
   * id.
   */
  private async composeFor(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillPayload,
  ): Promise<ComposedSkill[]> {
    const repo = await this.loadRepo(workspaceId, repoId);

    const rows = await this.repo.candidatesByIds(workspaceId, input.candidate_ids);
    const accepted = rows
      .filter((row) => row.repoId === repoId && row.status === 'accepted')
      .map(toConventionDto)
      .sort(byConfidence);

    if (accepted.length === 0) {
      throw new ValidationError('No accepted candidates among the ids supplied');
    }

    const composed = composeSkill(repo.fullName, accepted, {
      name: input.name,
      description: input.description,
    });
    return composed ? [composed] : [];
  }

  // --- shared --------------------------------------------------------------

  private async loadRepo(workspaceId: string, repoId: string) {
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId))
      .limit(1);
    if (!repo || repo.workspaceId !== workspaceId) throw new NotFoundError('Repository not found');
    return repo;
  }
}

/**
 * Resolves to `null` after `ms`, to be raced against work that must not overrun.
 *
 * The timer is `unref`'d so a pending deadline can never hold the process open
 * after the scan has moved on — the loser of the race is abandoned, not
 * cancelled, and Node would otherwise wait for it at shutdown.
 */
function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
