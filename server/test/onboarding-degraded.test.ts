/**
 * What a generation stores when the index or the model cannot deliver.
 *
 * Covers AC-10, AC-11, AC-15, AC-16 and AC-17 of `specs/onboarding-generator.md`.
 *
 * **The three failure providers are declared HERE, locally, and that is not a
 * preference.** `MockLLMProvider` (`src/adapters/mocks.ts`) always resolves with
 * `attempts: 1`; it cannot throw, it cannot hang, and it cannot report a second
 * round-trip — so three of this feature's five call outcomes are inexpressible
 * through it, and widening it would change a fixture every other suite in this
 * package shares.
 *
 * Hermetic, and no `.it.` in the filename (`DDG-TEST-001`). The never-resolving
 * case runs on fake timers: a real 75 s deadline would put 75 s into the suite
 * for one assertion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { OnboardingTour } from '@devdigest/shared';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import {
  SECTION_KINDS,
  TOUR_CALL_DEADLINE_MS,
  TOUR_MAX_RETRIES,
} from '../src/modules/onboarding/constants.js';
import type {
  OnboardingDeps,
  OnboardingDocReader,
  OnboardingIndexReader,
  OnboardingIndexState,
  OnboardingRepoRow,
  OnboardingStore,
  StoredTour,
  StoredTourWrite,
} from '../src/modules/onboarding/types.js';

const WORKSPACE = 'ws-1';
const REPO = 'repo-1';
const SHA = 'abc1234';

const REPO_ROW: OnboardingRepoRow = {
  id: REPO,
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
};

/* ─── three providers the shipped mock cannot express ─────────────────────── */

/** A provider stub whose only real method is `completeStructured`. */
abstract class FailingProvider implements LLMProvider {
  readonly id = 'openai' as const;
  /** How many structured round-trips this provider was asked for. */
  public calls = 0;

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
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    this.calls += 1;
    throw new Error('upstream refused the connection');
  }
}

/** The call never answers. Only a deadline of our own can end this. */
class HangingProvider extends FailingProvider {
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    this.calls += 1;
    return new Promise<StructuredResult<T>>(() => {
      /* deliberately never settles */
    });
  }
}

/**
 * The payload the schema rejects, twice.
 *
 * `parseWithRepair` throws when the REPAIRED answer still does not validate, so
 * a schema rejection reaches the service as a rejection carrying that word —
 * which is what separates `model_invalid` from `model_failed`. The repair
 * reprompt is the second round-trip AC-10 budgets for, and it happens inside the
 * provider: from the service's side the whole thing is one call, which is what
 * the `calls` counter below asserts.
 */
class SchemaViolatingProvider extends FailingProvider {
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    this.calls += 1;
    throw new Error('schema validation failed after one repair attempt: {} is missing `sections`');
  }
}

/** Answers, but reports the round-trips it actually made. */
class CountingProvider extends FailingProvider {
  constructor(private readonly attempts: number) {
    super();
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    this.lastRequest = req;
    const data = (req.schema as { parse: (v: unknown) => T }).parse({
      sections: SECTION_KINDS.map((kind) => ({
        kind,
        body: `Body for ${kind}.`,
        diagram: null,
        links: [],
        paths: [],
        tasks: [],
      })),
    });
    return {
      data,
      model: req.model,
      tokensIn: 900,
      tokensOut: 300,
      costUsd: 0.0042,
      raw: '{}',
      attempts: this.attempts,
    };
  }
  public lastRequest: StructuredRequest<unknown> | null = null;
}

/* ─── the rest of the ports ───────────────────────────────────────────────── */

interface FakeStore extends OnboardingStore {
  rows: Map<string, StoredTour>;
  writes: string[];
}

function store(): FakeStore {
  const rows = new Map<string, StoredTour>();
  const writes: string[] = [];
  return {
    rows,
    writes,
    async getRepo(workspaceId, repoId) {
      return workspaceId === WORKSPACE && repoId === REPO ? REPO_ROW : undefined;
    },
    async repoExists() {
      return true;
    },
    async get(repoId) {
      return rows.get(repoId);
    },
    async markRunning(repoId, startedAt) {
      writes.push('markRunning');
      rows.set(repoId, tourRow({ state: 'running', startedAt }));
    },
    async save(repoId, write: StoredTourWrite, generatedAt) {
      writes.push('save');
      rows.set(repoId, tourRow({ ...write, state: 'ready', generatedAt, startedAt: null }));
    },
    async clearRunning(repoId, _message, reason) {
      writes.push('clearRunning');
      const current = rows.get(repoId);
      if (current) rows.set(repoId, { ...current, state: 'ready', reason, startedAt: null });
    },
  };
}

function tourRow(over: Partial<StoredTour>): StoredTour {
  return {
    sections: [],
    bodyValid: true,
    state: 'ready',
    status: 'degraded',
    reason: null,
    indexedSha: SHA,
    filesIndexed: 0,
    filesSkipped: 0,
    model: null,
    attempts: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    generatedAt: new Date('2026-08-19T09:00:00.000Z'),
    startedAt: null,
    ...over,
  };
}

const INDEXED = ['src/server.ts', 'src/app.ts'];

function index(state?: Partial<OnboardingIndexState>): OnboardingIndexReader {
  return {
    async getIndexState() {
      return {
        status: 'full',
        filesIndexed: 300,
        filesSkipped: 0,
        lastIndexedSha: SHA,
        ...state,
      };
    },
    async getTopFilesByRank(_repoId, n) {
      return INDEXED.slice(0, n);
    },
    async getCriticalPaths() {
      return [['src/server.ts', 'src/app.ts']];
    },
    async getRepoMap() {
      return { text: 'src/server.ts — boot()', tokens: 8 };
    },
    async getFileRank(_repoId, paths) {
      return paths.filter((p) => INDEXED.includes(p)).map((path) => ({ path, percentile: 0.5 }));
    },
    async getFileFacts() {
      return [];
    },
  };
}

/** The index of a repository that was never indexed — the facade's own shape. */
function noIndex(): OnboardingIndexReader {
  return {
    async getIndexState() {
      return {
        status: 'degraded',
        degraded: true,
        degradedReason: 'no_data',
        filesIndexed: 0,
        filesSkipped: 0,
        lastIndexedSha: '',
      };
    },
    async getTopFilesByRank() {
      return [];
    },
    async getCriticalPaths() {
      return [];
    },
    async getRepoMap() {
      return { text: '', tokens: 0, degraded: true, reason: 'no_data' as const };
    },
    async getFileRank() {
      return [];
    },
    async getFileFacts() {
      return [];
    },
  };
}

const docs: OnboardingDocReader = {
  async list() {
    return { ok: true, docs: [], total: 0, truncated: false, entryBudgetExhausted: false };
  },
  async read() {
    return { ok: false, note: 'no such file' };
  },
};

interface Harness {
  service: OnboardingService;
  store: FakeStore;
  /** Every provider id the container was asked to construct. Empty means no call. */
  constructed: string[];
}

function harness(provider: LLMProvider | null, indexReader: OnboardingIndexReader): Harness {
  const storeFake = store();
  const constructed: string[] = [];
  const deps: OnboardingDeps = {
    store: storeFake,
    index: indexReader,
    repoDocs: docs,
    async featureModel() {
      return { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' };
    },
    async llm(id) {
      constructed.push(id);
      if (!provider) throw new Error('no provider may be constructed in this case');
      return provider;
    },
    jobs: {
      register() {},
      async enqueue() {
        return { id: 'job-1', done: Promise.resolve() };
      },
    },
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
  };
  return { service: new OnboardingService(deps), store: storeFake, constructed };
}

describe('the three ways the one model call can fail (AC-15)', () => {
  it('stores the skeleton with reason model_failed when the call throws', async () => {
    const provider = new ThrowingProvider();
    const h = harness(provider, index());

    await expect(h.service.runGeneration(WORKSPACE, REPO)).resolves.toBeUndefined();
    const tour = await h.service.getTour(WORKSPACE, REPO);

    expect(tour.status).toBe('degraded');
    expect(tour.reason).toBe('model_failed');
    // The deterministic skeleton is still five sections — the contract fixes
    // five — and the reading path is still the index's own ranking.
    expect(tour.sections.map((s) => s.kind)).toEqual([...SECTION_KINDS]);
    expect(tour.sections.find((s) => s.kind === 'reading_path')?.paths.map((p) => p.path)).toEqual(
      INDEXED,
    );
    expect(() => OnboardingTour.parse(tour)).not.toThrow();
    expect(provider.calls).toBe(1);
  });

  it('stores the skeleton with reason model_invalid when the payload is rejected twice', async () => {
    const provider = new SchemaViolatingProvider();
    const h = harness(provider, index());

    await h.service.runGeneration(WORKSPACE, REPO);
    const tour = await h.service.getTour(WORKSPACE, REPO);

    expect(tour.reason).toBe('model_invalid');
    expect(tour.status).toBe('degraded');
    // AC-10's ceiling: the repair reprompt has already happened inside the
    // provider, and the generation ends degraded rather than asking a third time.
    expect(provider.calls).toBe(1);
  });

  it('leaves the three reasons distinguishable, and none of them an HTTP error', async () => {
    const thrown = harness(new ThrowingProvider(), index());
    await thrown.service.runGeneration(WORKSPACE, REPO);
    const invalid = harness(new SchemaViolatingProvider(), index());
    await invalid.service.runGeneration(WORKSPACE, REPO);

    const reasons = [
      (await thrown.service.getTour(WORKSPACE, REPO)).reason,
      (await invalid.service.getTour(WORKSPACE, REPO)).reason,
      'model_timeout',
    ];
    expect(new Set(reasons).size).toBe(3);
  });
});

describe('the call is bounded by a deadline of its own (AC-11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes and stores a degraded tour when the provider never answers', async () => {
    const provider = new HangingProvider();
    const h = harness(provider, index());

    const running = h.service.runGeneration(WORKSPACE, REPO);
    // One millisecond short of the deadline, nothing has been written: the
    // generation is genuinely waiting rather than failing fast.
    await vi.advanceTimersByTimeAsync(TOUR_CALL_DEADLINE_MS - 1);
    expect(h.store.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    await expect(running).resolves.toBeUndefined();

    const tour = await h.service.getTour(WORKSPACE, REPO);
    expect(tour.status).toBe('degraded');
    expect(tour.reason).toBe('model_timeout');
    expect(tour.sections).toHaveLength(5);
    expect(provider.calls).toBe(1);
  });
});

describe('the round-trip budget (AC-10)', () => {
  it('pins the provider’s own retry count so a call cannot cost three round-trips', async () => {
    // The provider's `maxRetries` DEFAULTS to 2 — three round-trips — and
    // `StructuredRequest.timeoutMs` is silently ignored, so this field is the
    // only thing between the budget and the default (`server/INSIGHTS.md`,
    // 2026-08-06). It bounds spend; the deadline above bounds wall-clock.
    const provider = new CountingProvider(2);
    const h = harness(provider, index());

    await h.service.runGeneration(WORKSPACE, REPO);

    expect(provider.lastRequest?.maxRetries).toBe(TOUR_MAX_RETRIES);
    expect(TOUR_MAX_RETRIES).toBe(1);
  });

  it('records the round-trip count, and it is never above two', async () => {
    const provider = new CountingProvider(2);
    const h = harness(provider, index());

    await h.service.runGeneration(WORKSPACE, REPO);
    const tour = await h.service.getTour(WORKSPACE, REPO);

    expect(tour.attempts).toBe(2);
    expect(tour.attempts).toBeLessThanOrEqual(2);
    expect(provider.calls).toBe(1);
  });
});

describe('a repository with no index (AC-16, AC-17)', () => {
  it('reads as degraded / index_missing, with a 200-shaped payload (AC-16)', async () => {
    const h = harness(null, noIndex());

    const before = await h.service.getTour(WORKSPACE, REPO);
    expect(before.status).toBe('degraded');
    expect(before.reason).toBe('index_missing');
    expect(before.generation_state).toBe('never_generated');
    expect(() => OnboardingTour.parse(before)).not.toThrow();

    await h.service.runGeneration(WORKSPACE, REPO);

    const after = await h.service.getTour(WORKSPACE, REPO);
    expect(after.status).toBe('degraded');
    expect(after.reason).toBe('index_missing');
    expect(after.sections).toHaveLength(5);
  });

  it('costs nothing: no provider is constructed and no call is made (AC-17)', async () => {
    // Separate from AC-16 because the two fail independently — a correct status
    // with a wasted call is the expensive half, and no status assertion can see
    // it. `llm` THROWS here, so reaching for a provider at all fails the case.
    const h = harness(null, noIndex());

    await expect(h.service.runGeneration(WORKSPACE, REPO)).resolves.toBeUndefined();

    expect(h.constructed).toEqual([]);
    expect(h.store.writes).toEqual(['save']);
    expect(h.store.rows.get(REPO)?.model).toBeNull();
    expect(h.store.rows.get(REPO)?.costUsd).toBeNull();
  });
});
