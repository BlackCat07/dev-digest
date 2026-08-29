import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MultiAgentRepository } from '../src/modules/multi-agent/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-create-race] Docker not available — skipping integration tests.');
}

/**
 * AC-9 under CONCURRENCY, which is the only condition that ever broke it.
 *
 * DB-backed on purpose, and `.it.test.ts` for that reason (`DDG-TEST-001`): the
 * defect was a check and an insert that were not one operation, and no fake can
 * demonstrate that — a fake either answers atomically (and passes whatever the
 * service does) or does not (and fails whatever the service does). Only a real
 * transaction against a real Postgres shows the difference.
 */
d('createIfIdle — two concurrent fan-outs on one pull request', () => {
  let pg: PgFixture;
  let repo: MultiAgentRepository;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    repo = new MultiAgentRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select({ id: t.workspaces.id }).from(t.workspaces).limit(1);
    workspaceId = ws!.id;
    const [pr] = await pg.handle.db.select({ id: t.pullRequests.id }).from(t.pullRequests).limit(1);
    prId = pr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const parents = async (): Promise<number> => {
    const rows = await pg.handle.db
      .select({ id: t.multiAgentRuns.id })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)));
    return rows.length;
  };

  it('creates ONE parent when two fan-outs start at the same instant', async () => {
    // The real race, and the one a fake cannot show. Nothing is running and the
    // pull request has no parent, so BOTH callers are entitled to create one —
    // and before the fix both did: each read the state, each found no live
    // predecessor, each inserted. Two fan-outs, two bills, and only the later
    // one visible to `GET /pulls/:id/multi-agent`.
    const [a, b] = await Promise.all([
      repo.createIfIdle(workspaceId, prId),
      repo.createIfIdle(workspaceId, prId),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(await parents()).toBe(1);
  });

  it('keeps refusing while a run of that fan-out is still going', async () => {
    const [latest] = await pg.handle.db
      .select({ id: t.multiAgentRuns.id })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)));

    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId,
      multiAgentRunId: latest!.id,
      status: 'running',
    });

    expect(await repo.createIfIdle(workspaceId, prId)).toBeNull();
    expect(await parents()).toBe(1);
  });

  it('lets a new fan-out through once the previous one has settled', async () => {
    // The guard must not latch: a terminal predecessor stops blocking.
    await pg.handle.db
      .update(t.agentRuns)
      .set({ status: 'done' })
      .where(eq(t.agentRuns.workspaceId, workspaceId));

    expect(await repo.createIfIdle(workspaceId, prId)).not.toBeNull();
    expect(await parents()).toBe(2);
  });
});
