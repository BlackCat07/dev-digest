import { describe, it, expect } from 'vitest';
import type { PrIntent } from '@devdigest/shared';
import {
  IntentService,
  type IntentCandidate,
  type IntentWarnLogger,
} from '../src/modules/intent/service.js';
import type { IntentDeps, IntentStore } from '../src/modules/intent/sources.js';
import {
  INTENT_IMPORT_SCAN_LIMIT,
  INTENT_JOB_KIND,
  INTENT_STALE_AFTER_MS,
} from '../src/modules/intent/constants.js';

/**
 * L03 — the import trigger: `IntentService.enqueueDerivations`.
 *
 * `specs/intent-layer.md` Behaviour #4 is the contract, and every rule it states
 * is one the caller (`modules/pulls/routes.ts`) deliberately does NOT hold a copy
 * of, so this method is the only place any of them can be checked. Four classes of
 * regression, each of which is silent in production:
 *
 *  1. **The window bounds rows EXAMINED, not rows enqueued.** Bounding the
 *     enqueue count instead would make a repository whose intents are all fresh
 *     pay one `getIntent` round-trip per PR on every list read — no error, just a
 *     `GET /repos/:id/pulls` that gets slower as the repo grows. The assertions
 *     are therefore on *which PR ids were looked up at all*, in order: a row
 *     outside the window must never reach `getIntent`.
 *  2. **Deduplication.** A stored intent that does not satisfy `needsDerivation`
 *     must not be re-queued, or every list read re-derives the whole window at
 *     one model call per PR.
 *  3. **Per-ROW failure isolation.** The `try` sits inside the loop; hoisting it
 *     around the loop still passes a happy-path test and quietly drops the nine
 *     PRs behind the first unreadable row.
 *  4. **The bookkeeping `.catch` on `job.done`.** Load-bearing twice over: a
 *     discarded rejection from a failed job killed the API process in production
 *     (`server/INSIGHTS.md`, 2026-08-06 and 2026-08-07), and without the
 *     `failIntent` write a derivation that dies inside the job leaves `pr_intent`
 *     stuck on `running` until the staleness window expires. Asserted after an
 *     explicit microtask/event-loop flush, because the side branch is not
 *     awaited by the method — and with an `unhandledRejection` listener, which is
 *     the crash shape itself rather than a proxy for it.
 *
 * Hermetic by name and by construction: no Postgres, no queue, no provider. The
 * ports are structural fixtures whose unreachable methods THROW rather than
 * returning an empty value, the shape `intent-sources.test.ts` set — a future edit
 * that starts collecting sources or resolving a model from this method fails
 * loudly here instead of silently doing nothing.
 */

const WORKSPACE = 'ws-1';

/** The PRs' current head. A stored row on any other sha is stale by definition. */
const HEAD = 'a1b2c3d4';

/** Fixed base for `updatedAt`, so the window's ordering is deterministic. */
const NOW = Date.now();

function pr(n: number, minutesAgo: number): IntentCandidate {
  return {
    id: `pr-${n}`,
    number: n,
    headSha: HEAD,
    updatedAt: new Date(NOW - minutesAgo * 60_000),
  };
}

/** A candidate whose `updatedAt` was never populated. Must sort last, not throw. */
const UNDATED: IntentCandidate = {
  id: 'pr-undated',
  number: 99,
  headSha: HEAD,
  updatedAt: null,
};

/** A complete, terminal `pr_intent` row. Overrides carry each case's difference. */
function intentRow(prId: string, over: Partial<PrIntent> = {}): PrIntent {
  return {
    pr_id: prId,
    intent: 'Adds a rate limiter to the payments API.',
    in_scope: ['the limiter middleware'],
    out_of_scope: ['the billing schema'],
    head_sha: HEAD,
    confidence: 0.5,
    sources: [],
    missing_context: [],
    risk_areas: [],
    status: 'ok',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    tokens_in: 900,
    tokens_out: 120,
    cost_usd: 0.0001,
    derived_at: new Date(NOW).toISOString(),
    error: null,
    ...over,
  };
}

interface EnqueueCall {
  workspaceId: string;
  kind: string;
  payload: unknown;
}

interface Warning {
  obj: unknown;
  msg?: string;
}

interface Harness {
  service: IntentService;
  /** Every PR id whose stored intent was looked up, in call order. */
  examined: string[];
  enqueued: EnqueueCall[];
  /** `failIntent` calls — the bookkeeping half of the `job.done` catch. */
  failed: { prId: string; message: string }[];
  warned: Warning[];
  log: IntentWarnLogger;
}

function harness(
  opts: {
    /** Stored rows by PR id; a missing key means the PR has no row at all. */
    stored?: Record<string, PrIntent>;
    /** PR ids whose `getIntent` read fails. */
    unreadable?: readonly string[];
    /** PR ids whose queued job's `done` promise rejects, and with what. */
    jobFails?: Record<string, Error>;
    /** Make the bookkeeping `failIntent` write fail as well. */
    failIntentThrows?: boolean;
  } = {},
): Harness {
  const stored = opts.stored ?? {};
  const unreadable = new Set(opts.unreadable ?? []);
  const examined: string[] = [];
  const enqueued: EnqueueCall[] = [];
  const failed: { prId: string; message: string }[] = [];
  const warned: Warning[] = [];

  // Everything the import trigger has no business touching. Throwing, not
  // empty: a source collection or a model resolution creeping into this method
  // must fail the suite rather than pass it with nothing to show.
  const unreachable = (name: string) => async (): Promise<never> => {
    throw new Error(`${name} must not be reached by enqueueDerivations`);
  };

  const reviewRepo: IntentStore = {
    getPull: unreachable('IntentStore.getPull'),
    getRepo: unreachable('IntentStore.getRepo'),
    getPrFiles: unreachable('IntentStore.getPrFiles'),
    markIntentRunning: unreachable('IntentStore.markIntentRunning'),
    upsertIntent: unreachable('IntentStore.upsertIntent'),
    getIntent: async (prId: string) => {
      examined.push(prId);
      if (unreadable.has(prId)) throw new Error(`the pr_intent read failed for ${prId}`);
      return stored[prId];
    },
    failIntent: async (prId: string, message: string) => {
      failed.push({ prId, message });
      if (opts.failIntentThrows) throw new Error('the pr_intent write failed too');
    },
  };

  const deps: IntentDeps = {
    reviewRepo,
    github: unreachable('the GitHub port'),
    repoDocs: { read: unreachable('the repo-doc reader') },
    featureModel: unreachable('the feature-model resolver'),
    llm: unreachable('the LLM port'),
    jobs: {
      enqueue: async (workspaceId: string, kind: string, payload: unknown) => {
        enqueued.push({ workspaceId, kind, payload });
        const prId = (payload as { prId?: string }).prId ?? '';
        const failure = opts.jobFails?.[prId];
        return {
          id: `job-${enqueued.length}`,
          // Already rejected, deliberately: the service attaches its catch on
          // the same microtask turn it receives this, so an already-rejected
          // `done` is the tightest version of the crash shape and still must
          // not surface as an unhandled rejection.
          done: failure ? Promise.reject(failure) : Promise.resolve(),
        };
      },
    },
  };

  return {
    service: new IntentService(deps),
    examined,
    enqueued,
    failed,
    warned,
    log: {
      warn: (obj: unknown, msg?: string) => {
        warned.push({ obj, msg });
      },
    },
  };
}

/** The PR ids the trigger actually queued, in order. */
function queuedPrIds(calls: readonly EnqueueCall[]): string[] {
  return calls.map((call) => (call.payload as { prId?: string }).prId ?? '(no prId)');
}

/**
 * Let the un-awaited `job.done` side branch run to completion.
 *
 * Two full event-loop turns, which is also when Node reports an unhandled
 * rejection — so the same flush makes both halves of the assertion deterministic
 * (the shape `test/jobs.test.ts` uses for the same reason).
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('enqueueDerivations — the window', () => {
  it('examines only the most recently updated rows, newest first', async () => {
    // Offered OLDEST first, so the DESC window can only come from the sort.
    const rows = [...Array(INTENT_IMPORT_SCAN_LIMIT + 2)]
      .map((_, i) => pr(i + 1, i))
      .reverse();
    const newest = [...rows].reverse().slice(0, INTENT_IMPORT_SCAN_LIMIT);
    const outside = [...rows].reverse().slice(INTENT_IMPORT_SCAN_LIMIT);
    const h = harness();

    const queued = await h.service.enqueueDerivations(WORKSPACE, rows, h.log);

    // Rows EXAMINED is the bounded quantity, and the bound is on lookups: the
    // two oldest PRs are never even looked up, let alone queued.
    expect(h.examined).toEqual(newest.map((row) => row.id));
    for (const row of outside) {
      expect(h.examined).not.toContain(row.id);
      expect(queuedPrIds(h.enqueued)).not.toContain(row.id);
    }
    // Nothing is stored, so every examined row is a candidate — the count only
    // equals the cap because of that, not because the cap bounds it.
    expect(queued).toBe(INTENT_IMPORT_SCAN_LIMIT);
    expect(h.warned).toEqual([]);
  });

  it('sorts a row with no `updatedAt` last, without throwing', async () => {
    // A full window of dated rows plus one undated: the undated row sorts last
    // and therefore falls out of the window entirely.
    const dated = [...Array(INTENT_IMPORT_SCAN_LIMIT)].map((_, i) => pr(i + 1, i));
    const full = harness();

    const queuedFromFull = await full.service.enqueueDerivations(
      WORKSPACE,
      [UNDATED, ...dated],
      full.log,
    );

    expect(queuedFromFull).toBe(INTENT_IMPORT_SCAN_LIMIT);
    expect(full.examined).not.toContain(UNDATED.id);

    // Under the cap it IS examined — last, after every dated row.
    const room = harness();

    const queuedWithRoom = await room.service.enqueueDerivations(
      WORKSPACE,
      [UNDATED, pr(1, 5), pr(2, 0)],
      room.log,
    );

    expect(room.examined).toEqual(['pr-2', 'pr-1', UNDATED.id]);
    expect(queuedWithRoom).toBe(3);
  });
});

describe('enqueueDerivations — deduplication', () => {
  it('queues only the PRs whose stored intent needs a derivation', async () => {
    const claimedAt = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    const h = harness({
      stored: {
        // Fresh and terminal at the current head — the case that must be skipped.
        'pr-1': intentRow('pr-1'),
        // Derived against a commit the PR has moved past.
        'pr-2': intentRow('pr-2', { head_sha: 'deadbeef' }),
        // A recorded failure is worth retrying.
        'pr-3': intentRow('pr-3', {
          status: 'failed',
          intent: null,
          error: 'the classifier call failed: no API key',
        }),
        // 'pr-4' deliberately absent — never classified.
        // Claimed a second ago: a derivation really is in flight.
        'pr-5': intentRow('pr-5', {
          status: 'running',
          intent: null,
          derived_at: claimedAt(1_000),
        }),
        // Claimed before the staleness window: the worker is gone, and a row
        // that can never age out would brick this PR's intent forever.
        'pr-6': intentRow('pr-6', {
          status: 'running',
          intent: null,
          derived_at: claimedAt(INTENT_STALE_AFTER_MS + 1_000),
        }),
      },
    });
    const rows = [pr(1, 0), pr(2, 1), pr(3, 2), pr(4, 3), pr(5, 4), pr(6, 5)];

    const queued = await h.service.enqueueDerivations(WORKSPACE, rows, h.log);

    expect(queuedPrIds(h.enqueued)).toEqual(['pr-2', 'pr-3', 'pr-4', 'pr-6']);
    expect(queued).toBe(4);
    // All six were still looked up: skipping a PR costs a lookup, and that is
    // exactly the cost `INTENT_IMPORT_SCAN_LIMIT` bounds.
    expect(h.examined).toHaveLength(rows.length);
    expect(h.warned).toEqual([]);
  });

  it('queues one job per PR, with the workspace and the PR id as the whole payload', async () => {
    const h = harness();

    const queued = await h.service.enqueueDerivations(WORKSPACE, [pr(1, 0), pr(2, 1)], h.log);

    // `toEqual`, not `objectContaining`: the payload is what the job handler
    // parses, so an extra or renamed field is the regression.
    expect(h.enqueued).toEqual([
      {
        workspaceId: WORKSPACE,
        kind: INTENT_JOB_KIND,
        payload: { workspaceId: WORKSPACE, prId: 'pr-1' },
      },
      {
        workspaceId: WORKSPACE,
        kind: INTENT_JOB_KIND,
        payload: { workspaceId: WORKSPACE, prId: 'pr-2' },
      },
    ]);
    expect(queued).toBe(h.enqueued.length);
  });
});

describe('enqueueDerivations — failure isolation', () => {
  it('keeps queuing the PRs behind one whose stored intent cannot be read', async () => {
    // The unreadable row is the NEWEST, so it is first in the window and the
    // two behind it are the ones a loop-level `try` would drop.
    const h = harness({ unreadable: ['pr-1'] });

    const queued = await h.service.enqueueDerivations(
      WORKSPACE,
      [pr(1, 0), pr(2, 1), pr(3, 2)],
      h.log,
    );

    expect(queuedPrIds(h.enqueued)).toEqual(['pr-2', 'pr-3']);
    expect(queued).toBe(2);

    const warning = h.warned[0];
    expect(h.warned).toHaveLength(1);
    expect(warning?.msg).toBe('PR intent derivation enqueue skipped');
    expect(warning?.obj).toMatchObject({ prId: 'pr-1', number: 1 });
    // The cause reaches the log, not just the fact that something was skipped.
    expect((warning?.obj as { err: Error }).err.message).toContain('pr-1');
  });

  it('never throws when no logger is passed at all', async () => {
    const h = harness({ unreadable: ['pr-1'] });

    // No third argument: the logger is optional and the failure path must not
    // depend on it existing.
    await expect(
      h.service.enqueueDerivations(WORKSPACE, [pr(1, 0), pr(2, 1)]),
    ).resolves.toBe(1);
    expect(queuedPrIds(h.enqueued)).toEqual(['pr-2']);
  });
});

describe('enqueueDerivations — bookkeeping on a failed job', () => {
  it('records the failure on the row and never leaves an unhandled rejection', async () => {
    const h = harness({ jobFails: { 'pr-2': new Error('job timed out') } });
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);

    try {
      const queued = await h.service.enqueueDerivations(WORKSPACE, [pr(1, 0), pr(2, 1)], h.log);

      // Both were queued: the job's later failure is not the trigger's failure.
      expect(queued).toBe(2);
      // The catch runs on a side branch the method does not await, so the
      // assertion waits for it explicitly rather than racing it.
      await flush();

      expect(h.failed).toEqual([
        { prId: 'pr-2', message: 'the derivation job failed: job timed out' },
      ]);
      expect(h.warned.map((w) => w.msg)).toEqual(['PR intent derivation job failed']);
      expect(h.warned[0]?.obj).toMatchObject({ prId: 'pr-2', number: 2 });
      // The 2026-08-06 / 2026-08-07 crash shape: this is the assertion that
      // fails if the `.catch` is ever dropped.
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('survives a bookkeeping write that fails too', async () => {
    const h = harness({
      jobFails: { 'pr-1': new Error('the worker died') },
      failIntentThrows: true,
    });
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);

    try {
      const queued = await h.service.enqueueDerivations(WORKSPACE, [pr(1, 0)], h.log);
      await flush();

      expect(queued).toBe(1);
      // The write was attempted; that it then failed is swallowed, because a
      // database that cannot record the failure must not also take the process
      // down through the async catch handler.
      expect(h.failed).toEqual([
        { prId: 'pr-1', message: 'the derivation job failed: the worker died' },
      ]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
