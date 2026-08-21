/**
 * `OnboardingService` — the read, the generation control, and what a generation
 * is allowed to store.
 *
 * Covers AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-14, AC-25, AC-26, AC-27, AC-28,
 * AC-29, AC-30 and EC-21 of `specs/onboarding-generator.md`.
 *
 * Hermetic: no Postgres, no clone, no queue, no network. The service is
 * constructed with the ports it declares, which is what makes an in-memory fake
 * sufficient — the shape `test/project-context-service.test.ts` uses. The
 * filename carries no `.it.` segment (`DDG-TEST-001`).
 *
 * Two choices carry more than their length:
 *
 *  - **Every store and index method throws until a case opts in.** A generation
 *    that started reading the index before the workspace lookup, or a read that
 *    began writing, fails loudly here instead of passing quietly.
 *  - **`MockLLMProvider.calls` is the proof of "exactly one call" (AC-9), and of
 *    "no call at all" (AC-3, AC-27).** Counting the provider is the only
 *    assertion that can see a second call; a status field cannot.
 */
import { describe, it, expect } from 'vitest';
import { OnboardingTour, type FeatureModelChoice, type LLMProvider } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { NotFoundError, ValidationError } from '../src/platform/errors.js';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import {
  MAX_FIRST_TASKS,
  ONBOARDING_SCHEMA_NAME,
  SECTION_KINDS,
} from '../src/modules/onboarding/constants.js';
import type { OnboardingDraft } from '../src/modules/onboarding/schemas.js';
import type {
  OnboardingDeps,
  OnboardingDocReader,
  OnboardingFileFacts,
  OnboardingFileRank,
  OnboardingIndexReader,
  OnboardingIndexState,
  OnboardingRepoRow,
  OnboardingStore,
  StoredTour,
  StoredTourWrite,
} from '../src/modules/onboarding/types.js';

const WORKSPACE = 'ws-1';
const OTHER_WORKSPACE = 'ws-2';
const REPO = 'repo-1';
const SHA = 'abc1234';

const REPO_ROW: OnboardingRepoRow = {
  id: REPO,
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
};

/** The paths the fixture index holds. Everything else is "not in the index". */
const INDEXED = [
  'src/server.ts',
  'src/app.ts',
  'src/modules/index.ts',
  'src/db/client.ts',
  'src/routes.ts',
];

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

/* ─── the store ───────────────────────────────────────────────────────────── */

interface FakeStore extends OnboardingStore {
  /** Every stored tour, by repository id. One repository, one tour (AC-28). */
  rows: Map<string, StoredTour>;
  /** Names of the write methods that were called, in order (AC-27). */
  writes: string[];
}

function store(
  opts: { existing?: Partial<StoredTour>; repoExists?: boolean; repo?: OnboardingRepoRow } = {},
): FakeStore {
  const rows = new Map<string, StoredTour>();
  const writes: string[] = [];
  if (opts.existing) rows.set(REPO, storedTour(opts.existing));

  return {
    rows,
    writes,
    async getRepo(workspaceId, repoId) {
      const repo = opts.repo ?? REPO_ROW;
      return workspaceId === WORKSPACE && repoId === repo.id ? repo : undefined;
    },
    async repoExists() {
      return opts.repoExists ?? true;
    },
    async get(repoId) {
      return rows.get(repoId);
    },
    async markRunning(repoId, startedAt) {
      writes.push('markRunning');
      const current = rows.get(repoId);
      rows.set(repoId, storedTour({ ...current, state: 'running', startedAt }));
    },
    async save(repoId, write: StoredTourWrite, generatedAt) {
      writes.push('save');
      rows.set(repoId, storedTour({ ...write, state: 'ready', generatedAt, startedAt: null }));
    },
    async clearRunning(repoId, _message, reason) {
      writes.push('clearRunning');
      const current = rows.get(repoId);
      if (current) rows.set(repoId, { ...current, state: 'ready', reason, startedAt: null });
    },
  };
}

function storedTour(over: Partial<StoredTour> = {}): StoredTour {
  return {
    sections: [],
    bodyValid: true,
    state: 'ready',
    status: 'ok',
    reason: null,
    indexedSha: SHA,
    filesIndexed: 300,
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

/* ─── the index ───────────────────────────────────────────────────────────── */

function index(
  opts: {
    state?: Partial<OnboardingIndexState>;
    ranked?: string[];
    chains?: string[][];
    facts?: OnboardingFileFacts[];
    unreachable?: boolean;
  } = {},
): OnboardingIndexReader {
  if (opts.unreachable) {
    return {
      getIndexState: unreachable('index.getIndexState'),
      getTopFilesByRank: unreachable('index.getTopFilesByRank'),
      getCriticalPaths: unreachable('index.getCriticalPaths'),
      getRepoMap: unreachable('index.getRepoMap'),
      getFileRank: unreachable('index.getFileRank'),
      getFileFacts: unreachable('index.getFileFacts'),
    };
  }
  const ranked = opts.ranked ?? INDEXED;
  return {
    async getIndexState(): Promise<OnboardingIndexState> {
      return {
        status: 'full',
        filesIndexed: 300,
        filesSkipped: 0,
        lastIndexedSha: SHA,
        ...opts.state,
      };
    },
    async getTopFilesByRank(_repoId, n) {
      return ranked.slice(0, n);
    },
    async getCriticalPaths() {
      return opts.chains ?? [['src/server.ts', 'src/app.ts']];
    },
    async getRepoMap() {
      return { text: 'src/server.ts — boot()', tokens: 8 };
    },
    async getFileRank(_repoId, paths): Promise<OnboardingFileRank[]> {
      // `file_rank` holds a row for every INDEXED file, which is why it is the
      // membership oracle AC-8 uses — including for a test file the ranked
      // sample filters out (EC-27).
      const known = new Set([...ranked, 'src/a.test.ts']);
      return paths.filter((p) => known.has(p)).map((path) => ({ path, percentile: 0.5 }));
    },
    async getFileFacts() {
      return opts.facts ?? [];
    },
  };
}

/* ─── the clone, the queue, the model ─────────────────────────────────────── */

function repoDocs(commands: Record<string, string> = {}): OnboardingDocReader {
  const paths = Object.keys(commands);
  return {
    async list() {
      return {
        ok: true,
        docs: paths.map((path) => ({ path, size: commands[path]!.length, updatedAt: null })),
        total: paths.length,
        truncated: false,
        entryBudgetExhausted: false,
      };
    },
    async read(_repo, candidate) {
      const text = commands[candidate];
      return text === undefined ? { ok: false, note: 'no such file' } : { ok: true, text };
    },
  };
}

interface FakeJobs {
  register: OnboardingDeps['jobs']['register'];
  enqueue: OnboardingDeps['jobs']['enqueue'];
  enqueued: { kind: string; payload: unknown }[];
}

/** A queue that accepts work and never runs it — so a 202 is measurably a 202. */
function jobs(): FakeJobs {
  const enqueued: { kind: string; payload: unknown }[] = [];
  return {
    enqueued,
    register() {},
    async enqueue(_workspaceId, kind, payload) {
      enqueued.push({ kind, payload });
      return { id: `job-${enqueued.length}`, done: Promise.resolve() };
    },
  };
}

const DRAFT_SECTION = (kind: (typeof SECTION_KINDS)[number]) => ({
  kind,
  body: `Body for ${kind}.`,
  diagram: null,
  links: [],
  paths: [],
  tasks: [],
});

const FULL_DRAFT: OnboardingDraft = { sections: SECTION_KINDS.map(DRAFT_SECTION) };

interface Harness {
  service: OnboardingService;
  store: FakeStore;
  llm: MockLLMProvider;
  jobs: FakeJobs;
  /** Every `(workspaceId, featureId)` the model resolver was asked for (AC-14). */
  resolved: [string, string][];
  llmConstructed: string[];
}

function harness(
  opts: {
    draft?: OnboardingDraft;
    store?: FakeStore;
    index?: OnboardingIndexReader;
    docs?: OnboardingDocReader;
    choice?: FeatureModelChoice;
  } = {},
): Harness {
  const llm = new MockLLMProvider('openai', {
    structuredBySchema: { [ONBOARDING_SCHEMA_NAME]: opts.draft ?? FULL_DRAFT },
  });
  const jobQueue = jobs();
  const storeFake = opts.store ?? store();
  const resolved: [string, string][] = [];
  const llmConstructed: string[] = [];

  const deps: OnboardingDeps = {
    store: storeFake,
    index: opts.index ?? index(),
    repoDocs: opts.docs ?? repoDocs({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) }),
    async featureModel(workspaceId, id) {
      resolved.push([workspaceId, id]);
      return opts.choice ?? { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' };
    },
    async llm(id): Promise<LLMProvider> {
      llmConstructed.push(id);
      return llm;
    },
    jobs: jobQueue,
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
  };

  return {
    service: new OnboardingService(deps),
    store: storeFake,
    llm,
    jobs: jobQueue,
    resolved,
    llmConstructed,
  };
}

const structuredCalls = (llm: MockLLMProvider) =>
  llm.calls.filter((call) => call.method === 'completeStructured');

/* ─── the read ────────────────────────────────────────────────────────────── */

describe('reading a tour', () => {
  it('answers the five kinds in the contract’s order, twice, whatever order the model used (AC-1)', async () => {
    // The model returns them shuffled, one twice, one missing and one it was
    // never asked for — the order on the screen is the CONTRACT's, so none of
    // that can reorder or shorten it.
    const h = harness({
      draft: {
        sections: [
          DRAFT_SECTION('first_tasks'),
          DRAFT_SECTION('run_locally'),
          { ...DRAFT_SECTION('architecture'), body: 'First architecture body.' },
          { ...DRAFT_SECTION('architecture'), body: 'Second architecture body.' },
          DRAFT_SECTION('reading_path'),
        ],
      },
    });

    await h.service.runGeneration(WORKSPACE, REPO);

    const first = await h.service.getTour(WORKSPACE, REPO);
    const second = await h.service.getTour(WORKSPACE, REPO);

    expect(first.sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
    expect(second.sections.map((s) => s.kind)).toEqual(first.sections.map((s) => s.kind));
    // A kind the model omitted still gets a section, and the first of two
    // duplicates wins rather than the last.
    expect(first.sections[0]?.body).toBe('First architecture body.');
    expect(first.sections[1]?.body.length).toBeGreaterThan(0);
    // The whole payload satisfies the contract, since no route here declares a
    // `response:` schema — a cast-not-parsed response has already reached a
    // client as `$NaN` from this codebase.
    expect(() => OnboardingTour.parse(first)).not.toThrow();
  });

  it('answers 200-shaped with no sections for a repository nobody has generated one for (AC-2)', async () => {
    const h = harness();

    const tour = await h.service.getTour(WORKSPACE, REPO);

    expect(tour.generation_state).toBe('never_generated');
    expect(tour.sections).toEqual([]);
    expect(tour.generated_at).toBeNull();
    expect(tour.indexed_sha).toBeNull();
    expect(tour.stale).toBe(false);
    // Not an error and not a 404: the service returns a value, so the route
    // answers 200.
    expect(() => OnboardingTour.parse(tour)).not.toThrow();
  });

  it('reports a tour as stale once the index has moved past the commit it recorded (AC-26)', async () => {
    const fresh = harness({ store: store({ existing: { indexedSha: SHA } }) });
    expect((await fresh.service.getTour(WORKSPACE, REPO)).stale).toBe(false);

    const moved = harness({
      store: store({ existing: { indexedSha: SHA } }),
      index: index({ state: { lastIndexedSha: 'def5678' } }),
    });
    const tour = await moved.service.getTour(WORKSPACE, REPO);

    expect(tour.stale).toBe(true);
    // Computed on read. Nothing was regenerated and nothing was written.
    expect(moved.store.writes).toEqual([]);
    expect(structuredCalls(moved.llm)).toHaveLength(0);
  });

  it('makes no model call and no database write, a hundred times over (AC-27)', async () => {
    const generatedAt = new Date('2026-08-19T09:00:00.000Z');
    const h = harness({ store: store({ existing: { generatedAt } }) });

    for (let i = 0; i < 100; i += 1) await h.service.getTour(WORKSPACE, REPO);

    expect(h.llm.calls).toEqual([]);
    expect(h.store.writes).toEqual([]);
    expect(h.jobs.enqueued).toEqual([]);
    expect(h.store.rows.get(REPO)?.generatedAt).toBe(generatedAt);
  });

  it('resolves the repository in the caller’s workspace before touching the index (AC-29)', async () => {
    // The index and the clone reader throw on any call, so "the lookup happens
    // FIRST" is measured rather than asserted in prose.
    const h = harness({
      index: index({ unreachable: true }),
      docs: {
        read: unreachable('repoDocs.read'),
        list: unreachable('repoDocs.list'),
      },
    });

    await expect(h.service.getTour(OTHER_WORKSPACE, REPO)).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.service.requestGeneration(OTHER_WORKSPACE, REPO)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(h.store.writes).toEqual([]);
    expect(h.llm.calls).toEqual([]);
  });
});

/* ─── generation control ──────────────────────────────────────────────────── */

describe('requesting a generation', () => {
  it('answers accepted with a job id without holding the request open for the model (AC-3)', async () => {
    const h = harness();

    const accepted = await h.service.requestGeneration(WORKSPACE, REPO);

    expect(accepted).toEqual({ status: 'accepted', jobId: 'job-1' });
    // The queue took the work and has not run it, so the provider has not been
    // called — which is what "did not hold the request open" means here.
    expect(h.jobs.enqueued).toEqual([
      { kind: 'onboarding-generate', payload: { workspaceId: WORKSPACE, repoId: REPO } },
    ]);
    expect(h.llm.calls).toEqual([]);
    // The claim is written before the slow work, so the screen has something to
    // show the moment the button is pressed.
    expect(h.store.rows.get(REPO)?.state).toBe('running');
    expect((await h.service.getTour(WORKSPACE, REPO)).generation_state).toBe('running');
  });

  it('refuses a second generation while one is running, and the model is called once (AC-4)', async () => {
    const h = harness();

    const first = await h.service.requestGeneration(WORKSPACE, REPO);
    await expect(h.service.requestGeneration(WORKSPACE, REPO)).rejects.toBeInstanceOf(
      ValidationError,
    );

    // One accepted, one refused — and the refusal started nothing: only the
    // accepted request's own generation reaches the provider.
    expect(first.status).toBe('accepted');
    expect(h.jobs.enqueued).toHaveLength(1);
    await h.service.runGeneration(WORKSPACE, REPO);
    expect(structuredCalls(h.llm)).toHaveLength(1);
  });

  it('accepts again once a running claim has outlived its worker (EC-18)', async () => {
    // A row left `running` by a process that died must not brick the repository's
    // tour forever, so the refusal reads the claim through a staleness window.
    const h = harness({
      store: store({
        existing: { state: 'running', startedAt: new Date(Date.now() - 60 * 60_000) },
      }),
    });

    await expect(h.service.requestGeneration(WORKSPACE, REPO)).resolves.toEqual({
      status: 'accepted',
      jobId: 'job-1',
    });
  });
});

/* ─── what a generation stores ────────────────────────────────────────────── */

describe('running a generation', () => {
  it('issues exactly one structured request, whatever the size of the repository (AC-9)', async () => {
    const ranked = Array.from({ length: 200 }, (_, i) => `src/f${String(i).padStart(3, '0')}.ts`);
    const h = harness({ index: index({ ranked }) });

    await h.service.runGeneration(WORKSPACE, REPO);

    expect(structuredCalls(h.llm)).toHaveLength(1);
    expect(h.llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);
    expect(h.llmConstructed).toEqual(['openrouter']);
  });

  it('asks the workspace’s onboarding feature-model choice and calls the model it names (AC-14)', async () => {
    const chosen = harness({ choice: { provider: 'openai', model: 'acme/override-model' } });
    await chosen.service.runGeneration(WORKSPACE, REPO);

    expect(chosen.resolved).toEqual([[WORKSPACE, 'onboarding']]);
    expect(reqOf(chosen.llm).model).toBe('acme/override-model');
    expect(chosen.store.rows.get(REPO)?.model).toBe('acme/override-model');

    // With no override stored the resolver answers the registry default, and the
    // request carries THAT — the service uses the resolver's answer and nothing
    // of its own. (The fallback itself belongs to `resolveFeatureModel`, which
    // this module deliberately does not import; see `## Not tested`.)
    const fallback = harness({
      choice: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
    });
    await fallback.service.runGeneration(WORKSPACE, REPO);
    expect(reqOf(fallback.llm).model).toBe('deepseek/deepseek-v4-flash');
  });

  it('records the indexed commit the tour was generated from (AC-25)', async () => {
    const h = harness({ index: index({ state: { lastIndexedSha: 'feedface' } }) });

    await h.service.runGeneration(WORKSPACE, REPO);

    expect(h.store.rows.get(REPO)?.indexedSha).toBe('feedface');
    expect((await h.service.getTour(WORKSPACE, REPO)).indexed_sha).toBe('feedface');
  });

  it('drops every item naming a path the index does not hold, and stores the rest (AC-8)', async () => {
    const h = harness({
      draft: {
        sections: [
          {
            ...DRAFT_SECTION('architecture'),
            links: [
              { label: 'Invented', path: 'src/does-not-exist.ts' },
              { label: 'Real', path: 'src/server.ts' },
              { label: 'Outside', path: '../../etc/passwd' },
              { label: 'Absolute', path: '/etc/passwd' },
            ],
          },
          {
            ...DRAFT_SECTION('first_tasks'),
            tasks: [
              { title: 'Fix the invented file', path: 'src/does-not-exist.ts', complexity: 'low' },
              { title: 'Read the entrypoint', path: 'src/server.ts', complexity: 'medium' },
              // EC-27: a test file can only come from the model, and it IS in the
              // index even though the ranked sample filters it out.
              { title: 'Extend the suite', path: 'src/a.test.ts', complexity: 'high' },
            ],
          },
        ],
      },
    });

    await h.service.runGeneration(WORKSPACE, REPO);
    const tour = await h.service.getTour(WORKSPACE, REPO);

    const architecture = tour.sections.find((s) => s.kind === 'architecture');
    expect(architecture?.links).toEqual([{ label: 'Real', path: 'src/server.ts' }]);
    // EC-14 falls out of the same check: an absolute or outside path is simply
    // not in the index.
    expect(architecture?.body).toBe('Body for architecture.');

    const tasks = tour.sections.find((s) => s.kind === 'first_tasks')?.tasks ?? [];
    expect(tasks.map((task) => task.path)).toEqual(['src/server.ts', 'src/a.test.ts']);

    // Nothing anywhere in the stored tour names a path the index does not hold.
    for (const section of tour.sections) {
      for (const path of [
        ...section.links.map((l) => l.path),
        ...section.paths.map((p) => p.path),
      ]) {
        expect(INDEXED).toContain(path);
      }
    }
  });

  it('keeps whole items when a section overflows its cap, never a fragment (AC-30)', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      title: `Task number ${i}`,
      path: 'src/server.ts',
      complexity: 'low' as const,
    }));
    const h = harness({
      draft: { sections: [{ ...DRAFT_SECTION('first_tasks'), tasks }] },
    });

    await h.service.runGeneration(WORKSPACE, REPO);
    const stored = h.store.rows.get(REPO)?.sections.find((s) => s.kind === 'first_tasks');

    expect(stored?.tasks).toHaveLength(MAX_FIRST_TASKS);
    // Six WHOLE tasks: the first six in the order returned, each with its title
    // and path intact — not six-and-a-fragment.
    expect(stored?.tasks.map((task) => task.title)).toEqual([
      'Task number 0',
      'Task number 1',
      'Task number 2',
      'Task number 3',
      'Task number 4',
      'Task number 5',
    ]);
    for (const task of stored?.tasks ?? []) {
      expect(task.path).toBe('src/server.ts');
      expect(task.complexity).toBe('low');
    }
  });

  it('replaces the repository’s single stored tour rather than adding one (AC-28)', async () => {
    const h = harness();

    await h.service.runGeneration(WORKSPACE, REPO);
    const firstAt = h.store.rows.get(REPO)?.generatedAt;
    await h.service.runGeneration(WORKSPACE, REPO);

    expect(h.store.rows.size).toBe(1);
    expect(h.store.writes.filter((w) => w === 'save')).toHaveLength(2);
    expect(h.store.rows.get(REPO)?.generatedAt).not.toBe(firstAt);
    expect((await h.service.getTour(WORKSPACE, REPO)).sections).toHaveLength(5);
  });

  it('writes nothing and reports no failure when the repository is deleted mid-generation (EC-21)', async () => {
    // `onboarding.repo_id` is `ON DELETE cascade`, so a user who deleted the
    // repository took the running row with it. Asserted by the WRITE FAKE
    // recording no save — the absence of a throw alone would also be satisfied
    // by a swallowed constraint violation.
    const h = harness({ store: store({ repoExists: false }) });

    await expect(h.service.runGeneration(WORKSPACE, REPO)).resolves.toBeUndefined();

    expect(h.store.writes).toEqual([]);
    expect(h.store.rows.size).toBe(0);
  });
});

/** The one structured request the provider recorded. */
function reqOf(llm: MockLLMProvider): { model: string; schemaName: string; maxRetries?: number } {
  const call = structuredCalls(llm)[0];
  if (!call) throw new Error('the provider recorded no structured call');
  return call.req as { model: string; schemaName: string; maxRetries?: number };
}
