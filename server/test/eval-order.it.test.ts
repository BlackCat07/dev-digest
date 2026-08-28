import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { BATCH_RETENTION } from '../src/modules/eval/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-order] Docker not available — skipping integration tests.');
}

/**
 * The ONE database-backed file in the Eval Pipeline, and it has to be one.
 *
 * Ordering a list on a non-unique column returns tied rows in PHYSICAL HEAP ORDER,
 * and an `UPDATE` physically moves the row it touched. That was reported here once
 * as "the row I clicked moves down the list", and it is intermittent enough that
 * "it stopped happening" is not evidence it is fixed. No fake reproduces heap
 * order: an in-memory array preserves insertion order for free, which is exactly
 * the bug it would fail to catch.
 *
 * So every assertion below compares the returned ids against the ids SORTED by the
 * documented key — never merely "unchanged after an update", which passes on a
 * query with no tiebreaker at all. Each block uses its own agent, so the three are
 * independent of execution order.
 *
 *  - the case list's total order, `name asc, id asc` (AC-14);
 *  - the batch history's total order, `started_at desc, id desc` (AC-37);
 *  - the 50-most-recent-per-agent retention cap (AC-38).
 */

const WORKSPACE = '0000f5ac-0000-4000-8000-000000000000';
const AGENT_CASES = '0000a1ce-0000-4000-8000-000000000000';
const AGENT_HISTORY = '0000a2ce-0000-4000-8000-000000000000';
const AGENT_RETENTION = '0000a3ce-0000-4000-8000-000000000000';

/**
 * Ids are FIXED rather than random, and chosen so insertion order disagrees with
 * sorted order. A random uuid would make the tiebreaker's absence pass roughly
 * half the time — the exact flakiness this file exists to remove.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const caseId = (n: number) => `0000ca${pad(n)}-0000-4000-8000-000000000000`;
/** Two disjoint batch id spaces, so the history block and the retention block
 *  cannot collide on a primary key. */
const histBatchId = (n: number) => `0000bb${pad(n)}-0000-4000-8000-000000000000`;
const batchId = (n: number) => `0000ba${pad(n)}-0000-4000-8000-000000000000`;

/** Code-unit compare, which for lowercase hex uuids is byte compare — Postgres's own. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

d('eval read order (Postgres)', () => {
  let pg: PgFixture;
  let repo: EvalRepository;

  beforeAll(async () => {
    pg = await startPg();
    repo = new EvalRepository(pg.handle.db);
    await pg.handle.db.insert(t.workspaces).values({ id: WORKSPACE, name: 'Eval Order' });
    await pg.handle.db.insert(t.agents).values(
      [
        { id: AGENT_CASES, name: 'Cases Agent' },
        { id: AGENT_HISTORY, name: 'History Agent' },
        { id: AGENT_RETENTION, name: 'Retention Agent' },
      ].map((a) => ({
        ...a,
        workspaceId: WORKSPACE,
        provider: 'openai' as const,
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
      })),
    );
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // ---- AC-14 — the case list is a TOTAL order -----------------------------

  describe('the case list', () => {
    /**
     * Five cases share the name `dup`, inserted in DESCENDING id order, so the
     * table's physical order is the reverse of the answer. Two uniquely-named
     * cases sit either side of them to pin the primary key of the sort.
     */
    const inserted = [
      { id: caseId(90), name: 'alpha' },
      { id: caseId(50), name: 'dup' },
      { id: caseId(40), name: 'dup' },
      { id: caseId(30), name: 'dup' },
      { id: caseId(20), name: 'dup' },
      { id: caseId(10), name: 'dup' },
      { id: caseId(95), name: 'zeta' },
    ];
    const sortedIds = [...inserted]
      .sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id))
      .map((r) => r.id);

    beforeAll(async () => {
      await pg.handle.db.insert(t.evalCases).values(
        inserted.map((c) => ({
          id: c.id,
          workspaceId: WORKSPACE,
          ownerKind: 'agent' as const,
          ownerId: AGENT_CASES,
          name: c.name,
          inputDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n',
          expectedOutput: { anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }] },
          expectation: 'must_find' as const,
        })),
      );
    });

    it('returns the ids in SORTED order, not the order they were written in', async () => {
      const rows = await repo.listCases(WORKSPACE, 'agent', AGENT_CASES);
      expect(rows.map((r) => r.id)).toEqual(sortedIds);
      // And the sorted order is genuinely different from the write order, or the
      // assertion above would pass on a query with no ORDER BY at all.
      expect(sortedIds).not.toEqual(inserted.map((r) => r.id));
    });

    it('still returns the SORTED ids after a tied row is updated', async () => {
      // An UPDATE writes a new tuple, which moves the row in the heap. Without
      // `id asc` behind `name asc`, this is where the list reorders under a reader.
      const updated = await repo.updateCase(WORKSPACE, caseId(30), {
        name: 'dup',
        inputDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n',
        expectedOutput: {},
        expectation: 'must_find',
        expectedAnchors: [{ file: 'src/a.ts', low_line: 3, high_line: 9 }],
      });
      expect(updated?.edited).toBe(true);

      const rows = await repo.listCases(WORKSPACE, 'agent', AGENT_CASES);
      expect(rows.map((r) => r.id)).toEqual(sortedIds);
    });

    it('scopes the set to its workspace and owner', async () => {
      expect(await repo.listCases(WORKSPACE, 'agent', AGENT_HISTORY)).toEqual([]);
      expect(await repo.listCases(WORKSPACE, 'skill', AGENT_CASES)).toEqual([]);
      expect(await repo.countCases(WORKSPACE, 'agent', AGENT_CASES)).toBe(inserted.length);
    });
  });

  // ---- AC-37 — the batch history is a TOTAL order -------------------------

  describe('the batch history', () => {
    /**
     * Four batches share one `started_at` — the realistic case, because
     * `Run all agents` opens several in the same statement — inserted in ASCENDING
     * id order so the heap order is the reverse of `id desc`. A fifth, later batch
     * pins `started_at desc` as the primary key of the sort.
     */
    const sameInstant = new Date('2026-08-20T10:00:00.000Z');
    const later = new Date('2026-08-21T10:00:00.000Z');
    const inserted = [
      { id: histBatchId(11), startedAt: sameInstant },
      { id: histBatchId(12), startedAt: sameInstant },
      { id: histBatchId(13), startedAt: sameInstant },
      { id: histBatchId(14), startedAt: sameInstant },
      { id: histBatchId(15), startedAt: later },
    ];
    const sortedIds = [...inserted]
      .sort(
        (a, b) =>
          cmp(b.startedAt.toISOString(), a.startedAt.toISOString()) || cmp(b.id, a.id),
      )
      .map((r) => r.id);

    beforeAll(async () => {
      await pg.handle.db.insert(t.evalBatches).values(
        inserted.map((b) => ({
          id: b.id,
          workspaceId: WORKSPACE,
          agentId: AGENT_HISTORY,
          agentVersion: 7,
          systemPromptSnapshot: 'Review the diff.',
          modelSnapshot: 'gpt-4o-mini',
          status: 'complete' as const,
          startedAt: b.startedAt,
        })),
      );
    });

    it('returns the ids in SORTED order — started_at desc, then id desc', async () => {
      const rows = await repo.listAgentBatches(WORKSPACE, AGENT_HISTORY, null);
      expect(rows.map((r) => r.id)).toEqual(sortedIds);
      expect(sortedIds).not.toEqual(inserted.map((r) => r.id));
      // The joined agent name is what makes a batch readable; it is one column.
      expect(rows[0]!.agent_name).toBe('History Agent');
    });

    it('still returns the SORTED ids after a tied batch is updated', async () => {
      const updated = await repo.updateBatch(WORKSPACE, histBatchId(12), {
        status: 'complete',
        finishedAt: new Date('2026-08-20T10:05:00.000Z'),
        casesCovered: 4,
        casesPassed: 3,
        recall: 0.8,
      });
      expect(updated?.cases_passed).toBe(3);

      const rows = await repo.listAgentBatches(WORKSPACE, AGENT_HISTORY, null);
      expect(rows.map((r) => r.id)).toEqual(sortedIds);
    });

    it('applies a period window without interpolating a Date into raw SQL', async () => {
      // The window is bound through `gte()`. A `Date` inside a raw `sql` template
      // throws inside postgres-js at runtime while typechecking cleanly, and
      // Fastify swallows it into a generic 500 — so this call succeeding at all
      // is the assertion, alongside the filtered result.
      const recent = await repo.listAgentBatches(
        WORKSPACE,
        AGENT_HISTORY,
        new Date('2026-08-21T00:00:00.000Z'),
      );
      expect(recent.map((r) => r.id)).toEqual([histBatchId(15)]);
    });

    it('reads the workspace-wide list in the same total order', async () => {
      const rows = await repo.listWorkspaceBatches(WORKSPACE, null);
      const forThisAgent = rows.filter((r) => r.agent_id === AGENT_HISTORY).map((r) => r.id);
      expect(forThisAgent).toEqual(sortedIds);
    });
  });

  // ---- AC-38 — 50 batches per agent, and no more --------------------------

  describe('the retention cap', () => {
    const total = BATCH_RETENTION + 5;
    /** Strictly increasing `started_at`, so "the most recent 50" is unambiguous. */
    const inserted = Array.from({ length: total }, (_, i) => ({
      id: batchId(i + 1),
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    }));
    const survivorIds = [...inserted]
      .sort(
        (a, b) =>
          cmp(b.startedAt.toISOString(), a.startedAt.toISOString()) || cmp(b.id, a.id),
      )
      .slice(0, BATCH_RETENTION)
      .map((r) => r.id);
    const oldestId = batchId(1);
    const doomedRunCaseId = caseId(99);

    beforeAll(async () => {
      await pg.handle.db.insert(t.evalBatches).values(
        inserted.map((b) => ({
          id: b.id,
          workspaceId: WORKSPACE,
          agentId: AGENT_RETENTION,
          agentVersion: 3,
          systemPromptSnapshot: 'Review the diff.',
          modelSnapshot: 'gpt-4o-mini',
          status: 'complete' as const,
          startedAt: b.startedAt,
        })),
      );
      await pg.handle.db.insert(t.evalCases).values({
        id: doomedRunCaseId,
        workspaceId: WORKSPACE,
        ownerKind: 'agent',
        ownerId: AGENT_RETENTION,
        name: 'retained case',
        inputDiff: 'diff --git a/src/a.ts b/src/a.ts\n',
        expectedOutput: { anchors: [] },
        expectation: 'must_find',
      });
      // A per-case row on the OLDEST batch: the retention delete must take it.
      await repo.insertRun({
        caseId: doomedRunCaseId,
        batchId: oldestId,
        actualOutput: { findings: [] },
        outcome: 'failed',
        notRunReason: null,
        expectedCount: 1,
        actualCount: 0,
        keptCount: 0,
        droppedCount: 0,
        durationMs: 1200,
        costUsd: 0.0001,
      });
    });

    it('keeps exactly the 50 most recent batches and reports what it deleted', async () => {
      expect(await repo.pruneAgentBatches(WORKSPACE, AGENT_RETENTION, BATCH_RETENTION)).toBe(
        total - BATCH_RETENTION,
      );

      const rows = await repo.listAgentBatches(WORKSPACE, AGENT_RETENTION, null);
      expect(rows).toHaveLength(BATCH_RETENTION);
      // The SORTED survivors, not merely the right count: a scan without the
      // `id desc` tiebreaker can keep a different 50 on every call.
      expect(rows.map((r) => r.id)).toEqual(survivorIds);
      expect(rows.map((r) => r.id)).not.toContain(oldestId);
    });

    it('takes the dropped batches per-case rows with them', async () => {
      // `eval_runs.batch_id` is ON DELETE CASCADE, so a pruned batch leaves no
      // orphaned case rows growing without bound behind it.
      const orphans = await pg.handle.db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .where(eq(t.evalRuns.batchId, oldestId));
      expect(orphans).toEqual([]);
      // The case itself survives its batch — it is the dataset, not the run.
      const cases = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(inArray(t.evalCases.id, [doomedRunCaseId]));
      expect(cases).toHaveLength(1);
    });

    it('is a no-op when the agent holds fewer than the cap', async () => {
      expect(await repo.pruneAgentBatches(WORKSPACE, AGENT_RETENTION, BATCH_RETENTION)).toBe(0);
      expect(await repo.pruneAgentBatches(WORKSPACE, AGENT_HISTORY, BATCH_RETENTION)).toBe(0);
    });
  });
});
