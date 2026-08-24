/**
 * `BriefService` — the read, the generation control, and what a generation is
 * allowed to store.
 *
 * Covers AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-16, AC-18, AC-19,
 * AC-20, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, AC-35 and AC-57 of
 * `specs/pr-brief.md`.
 *
 * Hermetic: no Postgres, no clone, no queue, no network. The service is
 * constructed with the ports it declares, which is what makes an in-memory fake
 * sufficient — the shape `test/onboarding-service.test.ts` uses. The filename
 * carries no `.it.` segment (`DDG-TEST-001`).
 *
 * Three choices carry more than their length:
 *
 *  - **`claimRunning` is modelled statement-for-statement**, including the
 *    `started_at IS NULL` term. A fake that branches on `state === 'running'`
 *    alone would pass the concurrency case for the wrong reason and would not
 *    notice a row that can never age out.
 *  - **The fake queue RUNS the handler it was given, inline**, so "two requests
 *    record one provider call" is measured end to end rather than asserted about
 *    an enqueue count. One suite (`two in flight`) defers it on purpose, because
 *    "in flight" is exactly the state an inline queue never has.
 *  - **The provider's call list is the proof.** Counting calls is the only
 *    assertion that can see a second one; a status field cannot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PrRiskBrief,
  type CompletionRequest,
  type CompletionResult,
  type FeatureModelChoice,
  type LLMProvider,
  type ModelInfo,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { NotFoundError, ValidationError } from '../src/platform/errors.js';
import { BriefService, needsGeneration } from '../src/modules/brief/service.js';
import {
  BRIEF_CALL_DEADLINE_MS,
  BRIEF_JOB_KIND,
  BRIEF_MAX_RETRIES,
  BRIEF_SCHEMA_NAME,
  BRIEF_STALE_AFTER_MS,
  MAX_PROMPT_TOKENS,
} from '../src/modules/brief/constants.js';
import type { PrBriefDraft } from '../src/modules/brief/schemas.js';
import type {
  BriefBlastFacts,
  BriefDeps,
  BriefDocReader,
  BriefIntentFacts,
  BriefPrFile,
  BriefPriorPrsFacts,
  BriefPull,
  BriefRepoRef,
  BriefStore,
  StoredBrief,
  StoredBriefWrite,
} from '../src/modules/brief/types.js';

// Real uuids, because the job payload is VALIDATED rather than cast: what
// arrives off `JobRunner` is `unknown`, and `IdParams` at the route validates the
// same shape. A `pr-1` here would exercise a path no request can reach.
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PR = '33333333-3333-4333-8333-333333333333';
const REPO = '44444444-4444-4444-8444-444444444444';
const SHA = 'abc1234';

const REPO_REF: BriefRepoRef = { owner: 'acme', name: 'payments-api' };

function pullRow(over: Partial<BriefPull> = {}): BriefPull {
  return {
    id: PR,
    repoId: REPO,
    number: 482,
    title: 'Bound the brief route',
    body: 'Adds a per-pull-request rate limit.',
    branch: 'feat/brief-rate-limit',
    base: 'main',
    headSha: SHA,
    additions: 12,
    deletions: 2,
    filesCount: 2,
    updatedAt: new Date('2026-08-19T09:00:00.000Z'),
    ...over,
  };
}

/** One `core` file and one `boilerplate` file, so the ordering is observable. */
const FILES: BriefPrFile[] = [
  { path: 'pnpm-lock.yaml', additions: 400, deletions: 20 },
  { path: 'src/api/routes.ts', additions: 12, deletions: 2 },
];

const INTENT: BriefIntentFacts = {
  status: 'ok',
  intent: 'Rate-limit the brief generation endpoint.',
  in_scope: ['src/api/routes.ts'],
  out_of_scope: [],
  risk_areas: [],
  head_sha: SHA,
  derived_at: '2026-08-19T09:00:00.000Z',
};

function blastFacts(over: Partial<BriefBlastFacts> = {}): BriefBlastFacts {
  return {
    status: 'ok',
    reason: null,
    indexed_sha: SHA,
    changed_files: FILES.map((file) => file.path),
    changed_symbols: [{ name: 'briefRoutes', kind: 'function', file: 'src/api/routes.ts' }],
    downstream: [],
    impacted: [
      {
        label: 'POST /pulls/:id/brief/generate',
        kind: 'endpoint',
        file: 'src/api/routes.ts',
        // `0` means the changed file declares it itself — the strongest form of
        // impact in the map, not a missing value.
        depth: 0,
      },
    ],
    counts: { symbols: 1, callers: 0, endpoints: 1, crons: 0 },
    ...over,
  };
}

const PRIOR_PRS: BriefPriorPrsFacts = {
  prs: [
    {
      number: 470,
      title: 'Add the intent route',
      updated_at: '2026-08-10T09:00:00.000Z',
      shared_files: ['src/api/routes.ts'],
      shared_file_count: 1,
    },
  ],
  total: 1,
  truncated: false,
  status: 'ok',
  reason: null,
};

/** A draft whose every citation is a path the model was actually shown. */
const DRAFT: PrBriefDraft = {
  what: 'Adds a per-pull-request rate limit to the brief generation route.',
  why: 'A generation spends a model call, so the cap has to be per pull request.',
  risks: [
    {
      kind: 'perf',
      title: 'Shared limiter key',
      explanation: 'The limiter keys on the pull request, so one reader can spend the budget.',
      severity: 'medium',
      file_refs: ['src/api/routes.ts'],
    },
  ],
  review_focus: [
    { path: 'src/api/routes.ts', line: 42, reason: 'The new limiter configuration.' },
  ],
};

/* ─── the store ───────────────────────────────────────────────────────────── */

interface FakeStore extends BriefStore {
  rows: Map<string, StoredBrief>;
  /** Names of the write methods that were called, in order (AC-7). */
  writes: string[];
  pull: BriefPull;
  files: BriefPrFile[];
}

function store(
  opts: { existing?: StoredBrief; pull?: BriefPull; files?: BriefPrFile[]; repo?: boolean } = {},
): FakeStore {
  const rows = new Map<string, StoredBrief>();
  const writes: string[] = [];
  if (opts.existing) rows.set(PR, opts.existing);

  const fake: FakeStore = {
    rows,
    writes,
    pull: opts.pull ?? pullRow(),
    files: opts.files ?? [...FILES],
    async getPull(workspaceId, prId) {
      return workspaceId === WORKSPACE && prId === PR ? fake.pull : undefined;
    },
    async getRepo(repoId) {
      return (opts.repo ?? true) && repoId === REPO ? REPO_REF : undefined;
    },
    async getPrFiles() {
      return fake.files;
    },
    async get(prId) {
      return rows.get(prId);
    },
    /**
     * The conditional `UPDATE … RETURNING` and its `INSERT … ON CONFLICT DO
     * NOTHING` fallback, modelled term for term: not running, OR no start time at
     * all, OR started before the window. Anything looser would accept a claim the
     * real statement refuses; anything tighter would brick a row with a null
     * start time forever.
     */
    async claimRunning(prId, startedAt, staleBefore) {
      writes.push('claimRunning');
      const row = rows.get(prId);
      if (!row) {
        rows.set(prId, storedBrief({ state: 'running', startedAt, cacheKey: null }));
        return true;
      }
      const claimable =
        row.state !== 'running' || row.startedAt === null || row.startedAt < staleBefore;
      if (!claimable) return false;
      rows.set(prId, { ...row, state: 'running', startedAt, error: null });
      return true;
    },
    async save(prId, write: StoredBriefWrite, generatedAt) {
      writes.push('save');
      rows.set(
        prId,
        storedBrief({
          what: write.what,
          why: write.why,
          risks: [...write.risks],
          reviewFocus: [...write.reviewFocus],
          diffStats: write.diffStats,
          sources: [...write.sources],
          riskLevel: write.riskLevel,
          status: write.status,
          reason: write.reason,
          cacheKey: write.cacheKey,
          headSha: write.headSha,
          provider: write.provider,
          model: write.model,
          attempts: write.attempts,
          tokensIn: write.tokensIn,
          tokensOut: write.tokensOut,
          costUsd: write.costUsd,
          error: write.error,
          state: 'done',
          startedAt: null,
          generatedAt,
        }),
      );
    },
    async clearRunning(prId, message, reason) {
      writes.push('clearRunning');
      const row = rows.get(prId);
      if (!row) return;
      rows.set(prId, {
        ...row,
        state: 'done',
        status: 'degraded',
        reason,
        startedAt: null,
        error: message,
      });
    },
  };
  return fake;
}

function storedBrief(over: Partial<StoredBrief> = {}): StoredBrief {
  return {
    what: null,
    why: null,
    risks: [],
    reviewFocus: [],
    diffStats: {
      files_changed: 0,
      files_listed: 0,
      additions: 0,
      deletions: 0,
      symbols: 0,
      endpoints: 0,
    },
    sources: [],
    bodyValid: true,
    state: 'done',
    status: 'degraded',
    reason: null,
    riskLevel: null,
    cacheKey: null,
    headSha: null,
    provider: null,
    model: null,
    attempts: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    generatedAt: new Date('2026-08-19T09:00:00.000Z'),
    startedAt: null,
    error: null,
    ...over,
  };
}

/* ─── the clone, the queue, the model ─────────────────────────────────────── */

/** A clone with no documents in it — the effective set is empty by default. */
function repoDocs(docs: Record<string, string> = {}): BriefDocReader {
  const paths = Object.keys(docs);
  return {
    async list() {
      return {
        ok: true,
        docs: paths.map((path) => ({ path, size: docs[path]!.length, updatedAt: null })),
        total: paths.length,
        truncated: false,
        entryBudgetExhausted: false,
      };
    },
    async read(_repo, candidate) {
      const text = docs[candidate];
      return text === undefined ? { ok: false, note: 'no such file' } : { ok: true, text };
    },
  };
}

interface FakeJobs {
  register: BriefDeps['jobs']['register'];
  enqueue: BriefDeps['jobs']['enqueue'];
  enqueued: { kind: string; payload: unknown }[];
  /** Run every job enqueued so far. Only a deferred queue has any. */
  run(): Promise<void>;
}

/**
 * A queue that runs the handler it was registered with — inline unless
 * `deferred`, in which case it accepts work and holds it until `run()`.
 */
function jobs(deferred = false): FakeJobs {
  const enqueued: { kind: string; payload: unknown }[] = [];
  const pending: unknown[] = [];
  let handler: ((payload: unknown, ctx: { jobId: string }) => Promise<void>) | null = null;

  return {
    enqueued,
    register(_kind, fn) {
      handler = fn;
    },
    async enqueue(_workspaceId, kind, payload) {
      enqueued.push({ kind, payload });
      const id = `job-${enqueued.length}`;
      if (deferred) pending.push(payload);
      else if (handler) await handler(payload, { jobId: id });
      return { id, done: Promise.resolve() };
    },
    async run() {
      const queued = pending.splice(0, pending.length);
      for (const payload of queued) await handler?.(payload, { jobId: 'job-run' });
    },
  };
}

interface Harness {
  service: BriefService;
  store: FakeStore;
  llm: LLMProvider & { calls?: { method: string; req: unknown }[] };
  jobs: FakeJobs;
  /** Every `(workspaceId, featureId)` the model resolver was asked for (AC-21). */
  resolved: [string, string][];
  /** Provider ids a provider was actually constructed for (AC-16, AC-28). */
  llmConstructed: string[];
}

function harness(
  opts: {
    draft?: PrBriefDraft;
    provider?: LLMProvider;
    store?: FakeStore;
    intent?: BriefIntentFacts;
    blast?: BriefBlastFacts;
    priorPrs?: BriefPriorPrsFacts;
    docs?: BriefDocReader;
    deferred?: boolean;
    choice?: FeatureModelChoice;
  } = {},
): Harness {
  const llm =
    opts.provider ??
    new MockLLMProvider('openai', {
      structuredBySchema: { [BRIEF_SCHEMA_NAME]: opts.draft ?? DRAFT },
    });
  const jobQueue = jobs(opts.deferred);
  const storeFake = opts.store ?? store();
  const resolved: [string, string][] = [];
  const llmConstructed: string[] = [];

  const deps: BriefDeps = {
    store: storeFake,
    intent: {
      async get() {
        return 'intent' in opts ? opts.intent : INTENT;
      },
    },
    blast: {
      async build() {
        return opts.blast ?? blastFacts();
      },
    },
    priorPrs: {
      async build() {
        return opts.priorPrs ?? PRIOR_PRS;
      },
    },
    projectContext: {
      async listEffectiveDocs() {
        return [];
      },
    },
    agents: {
      async listEnabled() {
        return [{ id: 'agent-1' }];
      },
    },
    repoDocs: opts.docs ?? repoDocs(),
    // A lock file is boilerplate and everything else is core, which is all the
    // ordering assertions here need; the real classifier is `smart-diff`'s and is
    // pinned by `test/brief-file-roles.test.ts`.
    fileRole: (path) => (path.endsWith('.yaml') ? 'boilerplate' : 'core'),
    async featureModel(workspaceId, id) {
      resolved.push([workspaceId, id]);
      return opts.choice ?? { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' };
    },
    async llm(id): Promise<LLMProvider> {
      llmConstructed.push(id);
      return llm;
    },
    async github() {
      throw new Error('GITHUB_TOKEN is not configured');
    },
    jobs: jobQueue,
  };

  const service = new BriefService(deps);
  service.registerJobHandler();
  return { service, store: storeFake, llm, jobs: jobQueue, resolved, llmConstructed };
}

const structuredCalls = (llm: Harness['llm']) =>
  (llm.calls ?? []).filter((call) => call.method === 'completeStructured');

/* ─── reading ─────────────────────────────────────────────────────────────── */

describe('reading a brief', () => {
  it('answers an empty document for a pull request nobody has generated one for', async () => {
    const h = harness();

    const brief = await h.service.getBrief(WORKSPACE, PR);

    expect(PrRiskBrief.safeParse(brief).success).toBe(true);
    expect(brief.generation_state).toBe('never_generated');
    expect(brief.generated_at).toBeNull();
    expect(brief.cache_key).toBeNull();
    expect(brief.stale).toBe(false);
    expect(brief.risks).toEqual([]);
    expect(h.store.writes).toEqual([]);
    expect(structuredCalls(h.llm)).toHaveLength(0);
  });

  it('makes no model call and no write across a hundred reads (AC-1, AC-7)', async () => {
    const h = harness();
    await h.service.runGeneration(WORKSPACE, PR);
    const writesAfterGeneration = [...h.store.writes];
    const callsAfterGeneration = structuredCalls(h.llm).length;
    expect(callsAfterGeneration).toBe(1);

    const first = await h.service.getBrief(WORKSPACE, PR);
    for (let i = 0; i < 99; i += 1) {
      const again = await h.service.getBrief(WORKSPACE, PR);
      // Byte-identical, which is the criterion's own observable: a read that
      // recomputed anything derived from the clock would differ here.
      expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    }

    expect(structuredCalls(h.llm)).toHaveLength(callsAfterGeneration);
    expect(h.store.writes).toEqual(writesAfterGeneration);
    expect(first.generated_at).not.toBeNull();
    expect(first.status).toBe('ok');
    expect(first.risk_level).toBe('medium');
    expect(first.review_focus).toHaveLength(1);
  });

  it('flips stale when the pull request changes, without regenerating (AC-3)', async () => {
    const h = harness();
    await h.service.runGeneration(WORKSPACE, PR);
    expect((await h.service.getBrief(WORKSPACE, PR)).stale).toBe(false);

    const writes = [...h.store.writes];
    h.store.files = [...FILES, { path: 'src/api/limits.ts', additions: 4, deletions: 0 }];

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.stale).toBe(true);
    expect(h.store.writes).toEqual(writes);
    expect(structuredCalls(h.llm)).toHaveLength(1);
  });

  it('reports a stored body that did not survive its parse as degraded', async () => {
    const h = harness({
      store: store({
        existing: storedBrief({ bodyValid: false, status: 'ok', cacheKey: 'stale-key' }),
      }),
    });

    const brief = await h.service.getBrief(WORKSPACE, PR);

    expect(brief.status).toBe('degraded');
    expect(brief.reason).toBe('model_invalid');
    expect(brief.what).toBeNull();
    expect(h.store.writes).toEqual([]);
  });

  it('404s a pull request outside the caller’s workspace (AC-35)', async () => {
    const h = harness();

    await expect(h.service.getBrief(OTHER_WORKSPACE, PR)).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.service.requestGeneration(OTHER_WORKSPACE, PR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(h.store.writes).toEqual([]);
  });
});

/* ─── the freshness rule ──────────────────────────────────────────────────── */

describe('the freshness rule (AC-4, AC-5, AC-6)', () => {
  it('spends one provider call for two generation requests with nothing changed', async () => {
    const h = harness();

    await h.service.requestGeneration(WORKSPACE, PR);
    await h.service.requestGeneration(WORKSPACE, PR);

    expect(structuredCalls(h.llm)).toHaveLength(1);
    expect(h.jobs.enqueued).toHaveLength(1);
    expect(h.jobs.enqueued[0]?.kind).toBe(BRIEF_JOB_KIND);
  });

  it('rebuilds when the description changed (AC-4)', async () => {
    const h = harness();
    await h.service.requestGeneration(WORKSPACE, PR);

    h.store.pull = pullRow({ body: 'Adds a per-pull-request rate limit, and a keyGenerator.' });
    await h.service.requestGeneration(WORKSPACE, PR);

    expect(structuredCalls(h.llm)).toHaveLength(2);
  });

  it('rebuilds an unchanged pull request when force is sent (AC-6)', async () => {
    const h = harness();
    await h.service.requestGeneration(WORKSPACE, PR);

    await h.service.requestGeneration(WORKSPACE, PR, { force: true });

    expect(structuredCalls(h.llm)).toHaveLength(2);
    expect(h.jobs.enqueued).toHaveLength(2);
  });

  it('answers a fresh brief with no job at all, rather than enqueueing one', async () => {
    const h = harness();
    await h.service.requestGeneration(WORKSPACE, PR);

    const accepted = await h.service.requestGeneration(WORKSPACE, PR);

    expect(accepted.status).toBe('accepted');
    expect(accepted.jobId).toBe('');
    expect(h.jobs.enqueued).toHaveLength(1);
  });

  it('is a predicate a caller can ask instead of re-deriving (DDG-ARCH-001)', () => {
    const fresh = storedBrief({ cacheKey: 'key-1' });
    expect(needsGeneration(undefined, 'key-1')).toBe(true);
    expect(needsGeneration(fresh, 'key-1')).toBe(false);
    expect(needsGeneration(fresh, 'key-2')).toBe(true);
    expect(needsGeneration(storedBrief({ cacheKey: null }), 'key-1')).toBe(true);
    expect(needsGeneration({ ...fresh, bodyValid: false }, 'key-1')).toBe(true);
  });
});

/* ─── concurrency and the staleness window ────────────────────────────────── */

describe('two generations at once (AC-8, AC-9)', () => {
  it('accepts one, refuses the other, and spends exactly one provider call', async () => {
    // Deferred on purpose: "in flight" is the one state a queue that runs its
    // handler inline never has.
    const h = harness({ deferred: true });

    const accepted = await h.service.requestGeneration(WORKSPACE, PR);
    await expect(h.service.requestGeneration(WORKSPACE, PR)).rejects.toBeInstanceOf(
      ValidationError,
    );

    expect(accepted.jobId).toBe('job-1');
    expect(h.jobs.enqueued).toHaveLength(1);

    await h.jobs.run();
    expect(structuredCalls(h.llm)).toHaveLength(1);
  });

  it('lets a claim six minutes old be taken over (AC-9)', async () => {
    const abandonedAt = new Date(Date.now() - 6 * 60_000);
    expect(Date.now() - abandonedAt.getTime()).toBeGreaterThan(BRIEF_STALE_AFTER_MS);
    const h = harness({
      store: store({
        existing: storedBrief({ state: 'running', startedAt: abandonedAt, cacheKey: 'old-key' }),
      }),
    });

    const accepted = await h.service.requestGeneration(WORKSPACE, PR);

    expect(accepted.jobId).toBe('job-1');
    expect(structuredCalls(h.llm)).toHaveLength(1);
    expect((await h.service.getBrief(WORKSPACE, PR)).generation_state).toBe('done');
  });

  it('treats a running claim with no start time as abandoned', async () => {
    const h = harness({
      store: store({
        existing: storedBrief({ state: 'running', startedAt: null, cacheKey: 'old-key' }),
      }),
    });

    await expect(h.service.requestGeneration(WORKSPACE, PR)).resolves.toMatchObject({
      status: 'accepted',
    });
  });

  it('releases the claim when the queue will not take the job', async () => {
    const h = harness();
    // A queue with no room, which is what a missing handler or a full connection
    // pool looks like from here.
    h.jobs.enqueue = async () => {
      throw new Error('the queue refused the job');
    };

    await expect(h.service.requestGeneration(WORKSPACE, PR, { force: true })).rejects.toThrow(
      'the queue refused the job',
    );

    // Not left on `running`: a claim nobody will finish refuses every later
    // generation until the staleness window expires.
    expect(h.store.writes).toEqual(['claimRunning', 'clearRunning']);
    expect((await h.service.getBrief(WORKSPACE, PR)).generation_state).toBe('done');
  });
});

/* ─── what a generation stores when it cannot call, or the call fails ─────── */

describe('a generation that never reaches a provider (AC-16, AC-28, AC-57)', () => {
  it('makes no call for a pull request with no changed file recorded (AC-28)', async () => {
    const h = harness({ store: store({ files: [] }) });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('degraded');
    expect(brief.reason).toBe('no_changed_files');
    expect(structuredCalls(h.llm)).toHaveLength(0);
    // AC-28 is about the SPEND, not only the status: no provider was constructed
    // and no model choice was resolved, so nothing was charged and no key read.
    expect(h.llmConstructed).toEqual([]);
    expect(h.resolved).toEqual([]);
  });

  it('refuses honestly when the core input alone overruns the budget (AC-16)', async () => {
    // The title is core and is never shed, so a title this long puts the core
    // itself past the ceiling — which is the one input state that must not be
    // paid for.
    const h = harness({
      store: store({ pull: pullRow({ title: 'x'.repeat(MAX_PROMPT_TOKENS * 4 + 1_000) }) }),
    });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('degraded');
    expect(brief.reason).toBe('inputs_too_large');
    expect(h.llmConstructed).toEqual([]);
    expect(structuredCalls(h.llm)).toHaveLength(0);
  });

  it('carries the deterministic figures and no invented advice (AC-30)', async () => {
    // The blast counts are the half of AC-30 a type cannot assert: the four
    // figures are all different, so a brief that reached for `crons` or reported
    // `symbols` twice would fail here rather than pass on a coincidence.
    const h = harness({
      provider: new ThrowingProvider(),
      blast: blastFacts({ counts: { symbols: 4, callers: 9, endpoints: 3, crons: 2 } }),
    });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.diff_stats).toEqual({
      files_changed: 2,
      files_listed: 2,
      additions: 412,
      deletions: 22,
      symbols: 4,
      endpoints: 3,
    });
    expect(brief.risk_level).toBeNull();
    expect(brief.risks).toEqual([]);
    expect(brief.review_focus).toEqual([]);
    expect(brief.what).toBeNull();
    // The audit trail survives a failed call: one entry per input the generation
    // was offered, whatever became of it (AC-33).
    expect(brief.sources.map((source) => source.kind)).toContain('file_list');
    expect(brief.sources.every((source) => source.status === 'used')).toBe(true);
  });
});

/* ─── the three provider failures ────────────────────────────────────────── */

/** A provider stub whose only real method is `completeStructured`. */
abstract class FailingProvider implements LLMProvider {
  readonly id = 'openai' as const;
  public calls: { method: string; req: unknown }[] = [];
  public lastRequest?: StructuredRequest<unknown>;

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'stub', provider: 'openai' }];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() must not be reached by this feature');
  }
  async embed(): Promise<number[][]> {
    throw new Error('embed() must not be reached by this feature');
  }
  abstract completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** The call fails outright — a network error, a 500, a missing key. */
class ThrowingProvider extends FailingProvider {
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    this.lastRequest = req;
    throw new Error('upstream refused the connection');
  }
}

/** The call never answers. Only a deadline of our own can end this. */
class HangingProvider extends FailingProvider {
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    return new Promise<StructuredResult<T>>(() => {
      /* deliberately never settles */
    });
  }
}

describe('the three failure modes stay distinguishable (AC-29)', () => {
  it('records model_failed when the call throws', async () => {
    const h = harness({ provider: new ThrowingProvider() });

    await expect(h.service.runGeneration(WORKSPACE, PR)).resolves.toBeUndefined();

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.reason).toBe('model_failed');
    expect(brief.error).toContain('upstream refused the connection');
  });

  it('records model_invalid when the answer does not validate', async () => {
    // `{}` is missing every field of the draft, so the provider rejects with a
    // message carrying the word the two reasons are told apart by.
    const h = harness({ provider: new MockLLMProvider('openai', { structured: {} }) });

    await expect(h.service.runGeneration(WORKSPACE, PR)).resolves.toBeUndefined();

    expect((await h.service.getBrief(WORKSPACE, PR)).reason).toBe('model_invalid');
  });

  it('pins the provider’s own retry count, so one call cannot cost three round-trips (AC-19)', async () => {
    const provider = new ThrowingProvider();
    const h = harness({ provider });

    await h.service.runGeneration(WORKSPACE, PR);

    expect(provider.lastRequest?.maxRetries).toBe(BRIEF_MAX_RETRIES);
    expect(BRIEF_MAX_RETRIES).toBe(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('leaves the three reasons distinct, and none of them an HTTP error', async () => {
    const thrown = harness({ provider: new ThrowingProvider() });
    await thrown.service.runGeneration(WORKSPACE, PR);
    const invalid = harness({ provider: new MockLLMProvider('openai', { structured: {} }) });
    await invalid.service.runGeneration(WORKSPACE, PR);

    const reasons = [
      (await thrown.service.getBrief(WORKSPACE, PR)).reason,
      (await invalid.service.getBrief(WORKSPACE, PR)).reason,
      // The third is asserted on its own below, on fake timers.
      'model_timeout',
    ];
    expect(new Set(reasons).size).toBe(3);
  });
});

describe('the call is bounded by a deadline of its own (AC-20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes and stores a degraded brief when the provider never answers', async () => {
    const provider = new HangingProvider();
    const h = harness({ provider });

    const running = h.service.runGeneration(WORKSPACE, PR);
    // One millisecond short of the deadline nothing has been written: the
    // generation is genuinely waiting rather than failing fast.
    await vi.advanceTimersByTimeAsync(BRIEF_CALL_DEADLINE_MS - 1);
    expect(h.store.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    await expect(running).resolves.toBeUndefined();

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('degraded');
    expect(brief.reason).toBe('model_timeout');
    expect(brief.risks).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });
});

/* ─── the qualifications ─────────────────────────────────────────────────── */

describe('what makes a brief partial (AC-27, AC-31, AC-32)', () => {
  it('marks it partial with no_intent when no intent has been derived (AC-31)', async () => {
    const h = harness({ intent: undefined });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('partial');
    expect(brief.reason).toBe('no_intent');
    // Still a real brief: the model was called and its answer survived.
    expect(brief.what).not.toBeNull();
  });

  it('carries the blast map’s OWN reason rather than re-deriving one (AC-32)', async () => {
    const h = harness({ blast: blastFacts({ status: 'partial', reason: 'index_partial' }) });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('partial');
    expect(brief.reason).toBe('index_partial');
  });

  it('does not translate a blast reason this vocabulary has no word for', async () => {
    // `flag_off` is a `BliastReason` member and not a `BriefReason` one. Inventing
    // a translation would be a third story about the same index, so the status is
    // partial with no reason and the card falls back to its generic sentence.
    const h = harness({ blast: blastFacts({ status: 'degraded', reason: 'flag_off' }) });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.status).toBe('partial');
    expect(brief.reason).toBeNull();
  });

  it('stores a what that only restates the title as null (AC-27)', async () => {
    const pull = pullRow();
    const h = harness({
      draft: { ...DRAFT, what: `  ${pull.title.toUpperCase()}  ` },
    });

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(brief.what).toBeNull();
    expect(brief.status).toBe('partial');
    expect(brief.reason).toBe('restates_title');
    // The why and the risks are still real, which is why this is partial rather
    // than degraded.
    expect(brief.why).not.toBeNull();
    expect(brief.risks).toHaveLength(1);
  });
});

/* ─── the receipt ─────────────────────────────────────────────────────────── */

describe('the provenance a generation records (AC-21, AC-33, AC-34)', () => {
  it('records the model choice, the round-trips, the tokens, the cost and the key', async () => {
    const h = harness();

    await h.service.runGeneration(WORKSPACE, PR);

    const brief = await h.service.getBrief(WORKSPACE, PR);
    expect(h.resolved).toEqual([[WORKSPACE, 'risk_brief']]);
    expect(h.llmConstructed).toEqual(['openrouter']);
    expect(brief.provider).toBe('openrouter');
    expect(brief.model).toBe('deepseek/deepseek-v4-flash');
    expect(brief.attempts).toBe(1);
    expect(brief.tokens_in).toBe(100);
    expect(brief.tokens_out).toBe(50);
    expect(brief.cost_usd).toBe(0.001);
    expect(brief.head_sha).toBe(SHA);
    expect(brief.cache_key).not.toBeNull();
    expect(PrRiskBrief.safeParse(brief).success).toBe(true);
  });

  it('records one source entry per offered input, and the shed ones say so', async () => {
    const h = harness();

    await h.service.runGeneration(WORKSPACE, PR);

    const kinds = (await h.service.getBrief(WORKSPACE, PR)).sources.map((s) => s.kind);
    expect(kinds).toContain('pr_title');
    expect(kinds).toContain('file_list');
    expect(kinds).toContain('intent');
    expect(kinds).toContain('blast');
    expect(kinds).toContain('pr_body');
    expect(kinds).toContain('prior_prs');
    // No document is attached in this fixture and no issue is referenced, so
    // neither kind is offered — an entry for an input nobody offered would be a
    // gap that does not exist.
    expect(kinds).not.toContain('repo_doc');
    expect(kinds).not.toContain('linked_issue');
  });
});
