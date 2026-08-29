import { describe, it, expect } from 'vitest';
import type {
  Review,
  RunTrace,
  StructuredRequest,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { MAX_CONCURRENT_AGENT_RUNS } from '../src/modules/reviews/constants.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository, PullRow, ReviewRow } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';
import type * as schema from '../src/db/schema.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * SPEC-06 T3 — the executor's per-agent loop is a bounded worker pool.
 *
 * Covers AC-12 (at most `MAX_CONCURRENT_AGENT_RUNS` in flight), AC-89 (a slot is
 * refilled the instant one run settles, not when the batch drains), AC-13/AC-90
 * (the diff is loaded once and the shared pre-work log reaches every run exactly
 * once, with no cross-agent leakage), AC-14/AC-91 (one run failing or being
 * cancelled leaves every sibling reaching a terminal status) and AC-92 (the
 * trace is persisted before the run's status turns terminal).
 *
 * HERMETIC — no Postgres, so no `.it.` in the filename (the two CI workflows
 * filter on exactly that substring). Everything the executor reaches is
 * injected, exactly as `test/project-context-run.test.ts` does it: a real
 * `RunBus`, a `MockLLMProvider` subclass, and a fake `ReviewRepository`.
 *
 * The observation mechanism is a DEFERRED PROMISE the test resolves, never a
 * timer. That is what distinguishes a real pool from `chunk(jobs, 4)` batching:
 * with a timer, "four ran at once" and "four ran in a batch" look identical; with
 * a gate the test can hold all four open, see that a fifth has NOT started, then
 * release exactly one and watch the fifth start while three are still parked.
 */

/** A one-file diff — enough for a single-pass review. */
const DIFF: UnifiedDiff = parseUnifiedDiff(
  [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -10,3 +10,4 @@',
    '   port: 3000,',
    '+  timeout: 5,',
    '   redisUrl: x,',
  ].join('\n'),
);

/** Zero findings, so grounding drops nothing and a released run always reaches `done`. */
const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Nothing to report.',
  score: 95,
  findings: [],
};

/**
 * Agent names, in job order. Deliberately non-overlapping as substrings: the
 * cross-agent log assertion below searches each run's buffer for every OTHER
 * agent's name, and "Agent 1" inside "Agent 10" would make it vacuously pass.
 */
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'] as const;

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Spin until `pred` holds, with a real deadline.
 *
 * A pool bug must make a test FAIL, not hang the suite — so every wait is
 * bounded and throws a named error. `setTimeout(…, 1)` yields a macrotask, which
 * lets every pending microtask of the runs under test drain between checks.
 */
async function waitUntil(pred: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

/** Let the runtime settle so "nothing else happened" is a claim about a quiet loop. */
async function settle(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await new Promise((r) => setTimeout(r, 1));
}

/**
 * A provider that parks every structured call on a gate the test owns.
 *
 * The agent is recovered from `sessionId`, which the executor builds as
 * `${owner}/${name}#${number}:${agent.name}` — the only per-agent value that
 * reaches the provider, since `container.llm` is handed a provider id and
 * nothing else.
 */
class GatedLLMProvider extends MockLLMProvider {
  constructor(private readonly harness: Harness) {
    super('openai', { structured: REVIEW_FIXTURE });
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const agentName = (req.sessionId ?? '').split(':').pop() ?? 'unknown';
    this.harness.providerArrivals.push(agentName);
    await this.harness.gate(this.harness.providerGates, agentName);
    const failure = this.harness.failAtProvider.get(agentName);
    if (failure) throw new Error(failure);
    return super.completeStructured(req);
  }
}

interface HarnessOptions {
  /** How many agents to queue, taken from `NAMES` in order. */
  agentCount: number;
  /** Hold every provider call until the test releases it. */
  gateProvider?: boolean;
  /** Agent names whose skill resolution parks until released (a pre-provider slot hold). */
  gateSkillsFor?: string[];
  /** Agent name → the message its provider call throws instead of answering. */
  failAtProvider?: Map<string, string>;
}

/**
 * One executor run against injected fakes, with per-agent gates.
 *
 * Nothing here is shared between tests: each `Harness` builds its own `RunBus`,
 * provider and repository, so the buffers a test reads belong to it alone.
 */
class Harness {
  readonly bus = new RunBus();
  /** Agent names in the order their model call was reached. */
  readonly providerArrivals: string[] = [];
  /** Agent names in the order their skill resolution was reached. */
  readonly skillArrivals: string[] = [];
  /** Agent names in the order their run turned terminal. */
  readonly settledOrder: string[] = [];
  readonly status = new Map<string, string>();
  readonly error = new Map<string, string | null>();
  readonly traces = new Map<string, RunTrace>();
  /** Per agent: was the trace already persisted when the terminal status was written? */
  readonly traceBeforeStatus = new Map<string, boolean>();
  readonly providerGates = new Map<string, Deferred>();
  readonly skillGates = new Map<string, Deferred>();
  readonly failAtProvider: Map<string, string>;

  /** How many times the executor loaded the diff (AC-13). */
  diffLoads = 0;

  readonly runIdByAgent = new Map<string, string>();
  readonly agentNameByRunId = new Map<string, string>();
  readonly jobs: { agent: AgentRow; runId: string }[] = [];

  private readonly gateProvider: boolean;
  private readonly gateSkillsFor: Set<string>;
  private readonly repo: ReviewRepository;
  private readonly container: Container;

  constructor(opts: HarnessOptions) {
    this.gateProvider = opts.gateProvider ?? false;
    this.gateSkillsFor = new Set(opts.gateSkillsFor ?? []);
    this.failAtProvider = opts.failAtProvider ?? new Map();

    for (let i = 0; i < opts.agentCount; i += 1) {
      const name = NAMES[i];
      if (name === undefined) throw new Error(`no fixture name for agent #${i}`);
      const runId = `run-${i + 1}`;
      this.runIdByAgent.set(name, runId);
      this.agentNameByRunId.set(runId, name);
      this.jobs.push({ agent: agentRow(name, `agent-${i + 1}`), runId });
    }

    const llm = new GatedLLMProvider(this);

    this.container = {
      runBus: this.bus,
      llm: async () => llm,
      // No intent: the derivation rejects, `resolveIntent` logs and returns
      // undefined. Shared pre-work still emits its two steps into every buffer.
      intent: { derive: async () => Promise.reject(new Error('no intent in this test')) },
      skills: {
        resolveBodiesForAgent: async (agentId: string) => {
          const name = this.nameForAgentId(agentId);
          this.skillArrivals.push(name);
          if (this.gateSkillsFor.has(name)) await this.gate(this.skillGates, name);
          return { bodies: [], used: [] };
        },
        recordRunSkills: async () => undefined,
      },
      tokenizer: { count: (s: string) => Math.ceil(s.length / 4) },
      git: {
        diff: async () => {
          this.diffLoads += 1;
          return DIFF;
        },
        currentHead: async () => 'deadbee1234567890abcdef',
      },
      projectContext: {
        resolveForRun: async () => ({ texts: [], paths: [], skipped: [], tokens: 0 }),
      },
    } as unknown as Container;

    this.repo = {
      getPrFiles: async () => [],
      insertReview: async () => ({ id: 'review-1' }) as unknown as ReviewRow,
      insertFindings: async () => [],
      markReviewed: async () => undefined,
      saveRunTrace: async (runId: string, trace: RunTrace) => {
        this.traces.set(this.nameForRunId(runId), trace);
      },
      completeAgentRun: async (
        runId: string,
        values: { status: string; error?: string | null },
      ) => {
        const name = this.nameForRunId(runId);
        // AC-92 — read BEFORE recording the status, so this is a statement about
        // the order the two writes reached the repository for THIS run.
        this.traceBeforeStatus.set(name, this.traces.has(name));
        this.status.set(name, values.status);
        this.error.set(name, values.error ?? null);
        this.settledOrder.push(name);
      },
    } as unknown as ReviewRepository;
  }

  private nameForRunId(runId: string): string {
    return this.agentNameByRunId.get(runId) ?? `unknown-run:${runId}`;
  }

  private nameForAgentId(agentId: string): string {
    const job = this.jobs.find((j) => j.agent.id === agentId);
    return job?.agent.name ?? `unknown-agent:${agentId}`;
  }

  /** Park on the named gate, creating it if the test has not pre-armed it. */
  async gate(gates: Map<string, Deferred>, name: string): Promise<void> {
    if (!this.gateProvider && gates === this.providerGates) return;
    let d = gates.get(name);
    if (!d) {
      d = deferred();
      gates.set(name, d);
    }
    await d.promise;
  }

  /** Release one agent's provider gate (arming it if it has not been hit yet). */
  releaseProvider(name: string): void {
    let d = this.providerGates.get(name);
    if (!d) {
      d = deferred();
      this.providerGates.set(name, d);
    }
    d.resolve();
  }

  releaseAllProviders(): void {
    for (const name of this.jobs.map((j) => j.agent.name)) this.releaseProvider(name);
  }

  releaseSkills(name: string): void {
    let d = this.skillGates.get(name);
    if (!d) {
      d = deferred();
      this.skillGates.set(name, d);
    }
    d.resolve();
  }

  /** Every message in one agent's persisted event buffer. */
  bufferFor(name: string): string[] {
    const runId = this.runIdByAgent.get(name);
    if (!runId) throw new Error(`no run for agent ${name}`);
    return this.bus.buffer(runId).map((e) => e.msg);
  }

  /** Start the executor. NOT awaited here — the caller drives the gates. */
  start(): Promise<void> {
    const executor = new ReviewRunExecutor(
      this.container,
      this.repo,
      {} as Container['agentsRepo'],
    );
    return executor.executeRuns('ws-1', PULL, REPO_ROW, this.jobs);
  }
}

function agentRow(name: string, id: string): AgentRow {
  return {
    id,
    name,
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    strategy: 'single-pass',
    ciFailOn: 'critical',
    // Off, so no repo-intel fake is needed and the prompt stays minimal.
    repoIntel: false,
    version: 1,
  } as unknown as AgentRow;
}

const PULL = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 482,
  title: 'rate limit',
  author: 'octocat',
  base: 'main',
  headSha: 'head-sha',
  body: null,
} as unknown as PullRow;

const REPO_ROW = {
  id: 'repo-1',
  owner: 'acme',
  name: 'payments-api',
} as unknown as typeof schema.repos.$inferSelect;

describe('bounded-concurrency fan-out over a review run’s agents', () => {
  it('runs four agents concurrently — all four reach the provider before any completes', async () => {
    // AC-12 — the sequential loop could never show more than one arrival.
    expect(MAX_CONCURRENT_AGENT_RUNS).toBe(4);

    const h = new Harness({ agentCount: 4, gateProvider: true });
    const done = h.start();

    await waitUntil(() => h.providerArrivals.length === 4, 'four provider arrivals');
    expect([...h.providerArrivals].sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    // Nothing has settled: every one of the four is parked inside its model call.
    expect(h.settledOrder).toEqual([]);

    h.releaseAllProviders();
    await done;

    expect([...h.status.entries()].sort()).toEqual([
      ['Alpha', 'done'],
      ['Bravo', 'done'],
      ['Charlie', 'done'],
      ['Delta', 'done'],
    ]);
  });

  it('refills a slot the instant one run settles, not when the in-flight set drains', async () => {
    // AC-89 — the assertion that separates a promise pool from
    // `chunk(jobs, 4).map(Promise.all)`. Under batching the fifth agent could
    // only start once ALL FOUR of the first batch had settled.
    const h = new Harness({ agentCount: 6, gateProvider: true });
    const done = h.start();

    await waitUntil(() => h.providerArrivals.length === 4, 'the first four arrivals');
    await settle();
    // The bound holds: agents five and six have not reached a model call.
    expect(h.providerArrivals).toHaveLength(4);
    expect(h.providerArrivals).not.toContain('Echo');
    expect(h.providerArrivals).not.toContain('Foxtrot');

    // Release exactly ONE of the four.
    h.releaseProvider('Alpha');
    await waitUntil(() => h.providerArrivals.length === 5, 'the fifth arrival');

    // The fifth started after the first settled…
    expect(h.settledOrder).toEqual(['Alpha']);
    expect(h.providerArrivals[4]).toBe('Echo');
    // …and BEFORE the other three of the first four settled: they are still
    // parked on their gates, so exactly one slot was freed and exactly one
    // waiting agent took it.
    expect(h.status.has('Bravo')).toBe(false);
    expect(h.status.has('Charlie')).toBe(false);
    expect(h.status.has('Delta')).toBe(false);

    h.releaseAllProviders();
    await done;

    expect(h.providerArrivals).toHaveLength(6);
    expect([...h.status.values()]).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  });

  it('loads the diff once for the whole set and fans the shared pre-work into every run', async () => {
    // AC-13 + AC-90 — a pin on behaviour the concurrency change must not disturb.
    const h = new Harness({ agentCount: 4 });
    await h.start();

    expect(h.diffLoads).toBe(1);

    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
      const msgs = h.bufferFor(name);
      // The two shared pre-work steps, once each — not once per agent.
      expect(msgs.filter((m) => m.startsWith('Loading PR diff…'))).toHaveLength(1);
      expect(msgs.filter((m) => m.startsWith('Deriving PR intent…'))).toHaveLength(1);
      // This run's own work is here…
      expect(msgs.some((m) => m.includes(`agent "${name}"`))).toBe(true);
      // …and no other agent's is. Concurrency is what most easily breaks this:
      // a shared logger that was never narrowed would leak every neighbour's
      // events into every buffer, and nothing else in the suite would notice.
      for (const other of ['Alpha', 'Bravo', 'Charlie', 'Delta']) {
        if (other === name) continue;
        expect(msgs.some((m) => m.includes(other))).toBe(false);
      }
    }
  });

  it('persists each run’s trace before that run’s status turns terminal', async () => {
    // AC-92 — a terminal `agent_runs.status` is a promise that the trace row
    // already exists. Concurrency is exactly what would break the guarantee
    // silently, since the two writes of four runs now interleave.
    const h = new Harness({ agentCount: 4 });
    await h.start();

    expect([...h.traceBeforeStatus.entries()].sort()).toEqual([
      ['Alpha', true],
      ['Bravo', true],
      ['Charlie', true],
      ['Delta', true],
    ]);
    expect(h.traces.size).toBe(4);
  });

  it('lets the other three finish when one agent’s provider throws', async () => {
    // AC-14 / AC-91 — failure isolation, now across concurrent runs.
    const h = new Harness({
      agentCount: 4,
      failAtProvider: new Map([['Bravo', 'provider exploded']]),
    });
    await h.start();

    expect(h.status.get('Bravo')).toBe('failed');
    expect(h.error.get('Bravo')).toContain('provider exploded');
    expect(h.status.get('Alpha')).toBe('done');
    expect(h.status.get('Charlie')).toBe('done');
    expect(h.status.get('Delta')).toBe('done');
    // Every run of the set reached a terminal status, the failing one included.
    expect(h.settledOrder).toHaveLength(4);
  });

  it('lets the other three finish when one of four in flight is cancelled', async () => {
    // AC-91 — the cancelled run is holding a pool slot when it is cancelled: its
    // skill resolution is parked, which is inside `runOneAgent` and before the
    // engine's cancellation checkpoint.
    const h = new Harness({ agentCount: 4, gateProvider: true, gateSkillsFor: ['Bravo'] });
    const done = h.start();

    // Three are at the model call and Bravo is parked earlier — four in flight.
    await waitUntil(() => h.providerArrivals.length === 3, 'three provider arrivals');
    await waitUntil(() => h.skillArrivals.includes('Bravo'), 'Bravo reaching skill resolution');
    expect(h.settledOrder).toEqual([]);

    const bravoRunId = h.runIdByAgent.get('Bravo');
    if (bravoRunId === undefined) throw new Error('no run id for Bravo');
    h.bus.cancel(bravoRunId);
    h.releaseSkills('Bravo');

    await waitUntil(() => h.status.get('Bravo') === 'cancelled', 'Bravo reaching `cancelled`');
    // Bravo never reached a model call — cancellation was observed first.
    expect(h.providerArrivals).not.toContain('Bravo');

    h.releaseAllProviders();
    await done;

    expect(h.status.get('Bravo')).toBe('cancelled');
    expect(h.error.get('Bravo')).toBe('Cancelled by user');
    expect(h.status.get('Alpha')).toBe('done');
    expect(h.status.get('Charlie')).toBe('done');
    expect(h.status.get('Delta')).toBe('done');
    expect(h.traceBeforeStatus.get('Bravo')).toBe(true);
  });
});
