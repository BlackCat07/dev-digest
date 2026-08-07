import { describe, it, expect } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/**
 * JobRunner crash-safety. Every fire-and-forget caller (clone, index, refresh,
 * resync) discards the `done` promise enqueue() returns; if a failed job's
 * rejection has no subscriber, Node kills the entire process. The 2026-08-07
 * incident: clicking Refresh on the seeded acme/payments-api (no such GitHub
 * repo) failed the clone job and took the API down with it.
 *
 * The DB is stubbed — these tests exercise promise wiring, not persistence.
 */
const stubDb = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Db;

describe('JobRunner', () => {
  it('a discarded `done` from a failed job never becomes an unhandled rejection', async () => {
    const runner = new JobRunner(stubDb, { retries: 0, timeoutMs: 1_000 });
    runner.register('boom', async () => {
      throw new Error('kaboom');
    });

    const seen: unknown[] = [];
    const listener = (reason: unknown) => {
      seen.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      await runner.enqueue('ws-1', 'boom', {}); // `done` discarded — the crash shape
      await runner.onIdle();
      // unhandledRejection is emitted after the microtask queue drains; give
      // the event loop two full turns before asserting silence.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(seen).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('a caller that awaits `done` still observes the failure', async () => {
    const runner = new JobRunner(stubDb, { retries: 0, timeoutMs: 1_000 });
    runner.register('boom', async () => {
      throw new Error('kaboom');
    });

    const job = await runner.enqueue('ws-1', 'boom', {});
    await expect(job.done).rejects.toThrow('kaboom');
  });

  it('a successful job resolves `done`', async () => {
    const runner = new JobRunner(stubDb, { retries: 0, timeoutMs: 1_000 });
    let ran = false;
    runner.register('ok', async () => {
      ran = true;
    });

    const job = await runner.enqueue('ws-1', 'ok', {});
    await job.done;
    expect(ran).toBe(true);
  });
});
