import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { CiRepository } from '../src/modules/ci/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[ci-runs-order] Docker not available — skipping integration tests.');
}

/**
 * The ONE database-backed file in Export to CI, and it has to be one.
 *
 * Ordering a list on a non-unique column returns tied rows in PHYSICAL HEAP
 * ORDER, and an `UPDATE` physically moves the row it touched — which is reported
 * as "the run I just refreshed moved down the list" and is intermittent enough
 * that "it stopped happening" is not evidence it is fixed. **No fake reproduces
 * heap order:** an in-memory array preserves insertion order for free, which is
 * exactly the bug it would fail to catch.
 *
 * So every assertion below compares the returned ids against the ids SORTED by
 * the documented key, `ran_at desc, id desc` — never merely "unchanged after an
 * update", which passes on a query with no tiebreaker at all.
 *
 * Three things, all AC-27:
 *  - the list's total order over rows that share a `ran_at`;
 *  - that the order survives an `UPDATE` to one of those rows;
 *  - that a run belonging to another workspace is absent, since `ci_runs` carries
 *    no `workspace_id` and the scope runs `ci_runs → ci_installations → agents`.
 */

const WORKSPACE = '0000c1a0-0000-4000-8000-000000000000';
const OTHER_WORKSPACE = '0000c1b0-0000-4000-8000-000000000000';
const AGENT = '0000a100-0000-4000-8000-000000000000';
const OTHER_AGENT = '0000a200-0000-4000-8000-000000000000';
const INSTALLATION = '0000e100-0000-4000-8000-000000000000';
const OTHER_INSTALLATION = '0000e200-0000-4000-8000-000000000000';

/**
 * Ids are FIXED rather than random, and chosen so insertion order disagrees with
 * sorted order. A random uuid would make a missing tiebreaker pass roughly half
 * the time — the exact flakiness this file exists to remove.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const runId = (n: number) => `0000cc${pad(n)}-0000-4000-8000-000000000000`;
const OTHER_RUN = '0000cd99-0000-4000-8000-000000000000';

/** Code-unit compare, which for lowercase hex uuids is byte compare — Postgres's own. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The documented key: `ran_at desc, id desc`. */
function sortedIds(rows: { id: string; ranAt: Date | null }[]): string[] {
  return [...rows]
    .sort((a, b) => {
      const at = a.ranAt?.getTime() ?? 0;
      const bt = b.ranAt?.getTime() ?? 0;
      if (at !== bt) return bt - at;
      return cmp(b.id, a.id);
    })
    .map((r) => r.id);
}

/** Six runs: four sharing one timestamp, one earlier and one later to pin the ends. */
const TIED = new Date('2026-08-20T10:00:00.000Z');
const EARLIER = new Date('2026-08-19T10:00:00.000Z');
const LATER = new Date('2026-08-21T10:00:00.000Z');

const seeded = [
  { id: runId(1), ranAt: EARLIER },
  { id: runId(2), ranAt: TIED },
  { id: runId(3), ranAt: TIED },
  { id: runId(4), ranAt: TIED },
  { id: runId(5), ranAt: TIED },
  { id: runId(6), ranAt: LATER },
];

d('CI runs read order (Postgres)', () => {
  let pg: PgFixture;
  let repo: CiRepository;

  beforeAll(async () => {
    pg = await startPg();
    repo = new CiRepository(pg.handle.db);

    await pg.handle.db.insert(t.workspaces).values([
      { id: WORKSPACE, name: 'CI Order' },
      { id: OTHER_WORKSPACE, name: 'Someone Else' },
    ]);
    await pg.handle.db.insert(t.agents).values(
      [
        { id: AGENT, workspaceId: WORKSPACE, name: 'Security Reviewer' },
        { id: OTHER_AGENT, workspaceId: OTHER_WORKSPACE, name: 'Their Reviewer' },
      ].map((a) => ({
        ...a,
        provider: 'openrouter' as const,
        model: 'deepseek/deepseek-chat',
        systemPrompt: 'Review the diff.',
      })),
    );
    await pg.handle.db.insert(t.ciInstallations).values([
      { id: INSTALLATION, agentId: AGENT, repo: 'acme/payments-api', targetType: 'gha' },
      {
        id: OTHER_INSTALLATION,
        agentId: OTHER_AGENT,
        repo: 'other/repo',
        targetType: 'gha',
      },
    ]);

    // Inserted in ASCENDING id order, so the heap's physical order is the reverse
    // of the answer for every tied row.
    await pg.handle.db.insert(t.ciRuns).values(
      seeded.map((r, i) => ({
        id: r.id,
        ciInstallationId: INSTALLATION,
        workflowRunId: 90_000 + i,
        prNumber: 400 + i,
        ranAt: r.ranAt,
        status: 'succeeded',
        findingsCount: i,
        costUsd: 0.01,
        githubUrl: `https://github.com/acme/payments-api/actions/runs/${90_000 + i}`,
        source: 'gha',
        headSha: `sha${i}`,
        repo: 'acme/payments-api',
        agent: 'Security Reviewer',
        blockers: 0,
        durationS: 42,
      })),
    );
    await pg.handle.db.insert(t.ciRuns).values({
      id: OTHER_RUN,
      ciInstallationId: OTHER_INSTALLATION,
      workflowRunId: 91_000,
      prNumber: 1,
      ranAt: LATER,
      status: 'succeeded',
      source: 'gha',
      repo: 'other/repo',
      agent: 'Their Reviewer',
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('returns the workspace’s runs in a TOTAL order, ties broken by id', async () => {
    const rows = await repo.listRuns(WORKSPACE, 50);
    expect(rows.map((r) => r.id)).toEqual(sortedIds(seeded));
  });

  it('returns the SAME order on a repeated request', async () => {
    const first = await repo.listRuns(WORKSPACE, 50);
    const second = await repo.listRuns(WORKSPACE, 50);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it('keeps that order after one of the tied rows is updated', async () => {
    // The regression itself. An `UPDATE` writes a NEW tuple version elsewhere in
    // the heap, so without the `id desc` tiebreaker the refreshed row slides down
    // its tie group. Asserting against the SORTED ids rather than against the
    // previous answer is what makes this fail on a query with no tiebreaker —
    // "unchanged after an update" passes without the fix.
    const moved = runId(3);
    await pg.handle.db
      .update(t.ciRuns)
      .set({ status: 'no_findings', findingsCount: 0 })
      .where(eq(t.ciRuns.id, moved));

    const rows = await repo.listRuns(WORKSPACE, 50);
    expect(rows.map((r) => r.id)).toEqual(sortedIds(seeded));
    expect(rows.find((r) => r.id === moved)?.status).toBe('no_findings');
  });

  it('excludes a run belonging to another workspace', async () => {
    // `ci_runs` carries no `workspace_id`; the scope is the join through
    // `ci_installations` to `agents.workspace_id`, which is NOT NULL.
    const rows = await repo.listRuns(WORKSPACE, 50);
    expect(rows.map((r) => r.id)).not.toContain(OTHER_RUN);

    const theirs = await repo.listRuns(OTHER_WORKSPACE, 50);
    expect(theirs.map((r) => r.id)).toEqual([OTHER_RUN]);
  });

  it('honours the page size', async () => {
    const rows = await repo.listRuns(WORKSPACE, 2);
    expect(rows.map((r) => r.id)).toEqual(sortedIds(seeded).slice(0, 2));
  });

  it('attaches each installation’s LATEST run, and null for one that never ran', async () => {
    // The other half of the same hazard: `DISTINCT ON` picks a row per group, and
    // without `id desc` the winner among tied timestamps is heap order again. The
    // never-run installation is the LEFT half of the join — an inner join would
    // drop it, which is exactly the repository a user opens the tab to ask about.
    const NEVER_RUN = '0000e300-0000-4000-8000-000000000000';
    await pg.handle.db
      .insert(t.ciInstallations)
      .values({ id: NEVER_RUN, agentId: AGENT, repo: 'acme/billing', targetType: 'gha' });

    const rows = await repo.listInstallationsForAgent(WORKSPACE, AGENT);
    const byRepo = new Map(rows.map((r) => [r.repo, r]));

    expect(byRepo.get('acme/billing')?.lastRunStatus).toBeNull();
    expect(byRepo.get('acme/billing')?.lastRunAt).toBeNull();

    const latest = byRepo.get('acme/payments-api');
    expect(latest?.lastRunAt?.toISOString()).toBe(LATER.toISOString());
    expect(latest?.lastRunStatus).toBe('succeeded');
  });

  it('upserts one installation row per (agent, repository)', async () => {
    // AC-17 against the real UNIQUE index rather than against a fake's Map key.
    const first = await repo.upsertInstallation({
      agentId: AGENT,
      repo: 'acme/payments-api',
      targetType: 'gha',
      installedAt: new Date('2026-08-22T00:00:00.000Z'),
    });
    const second = await repo.upsertInstallation({
      agentId: AGENT,
      repo: 'acme/payments-api',
      targetType: 'gha',
      installedAt: new Date('2026-08-23T00:00:00.000Z'),
    });

    expect(second.id).toBe(first.id);
    expect(second.installedAt.toISOString()).toBe('2026-08-23T00:00:00.000Z');

    const all = await pg.handle.db
      .select({ id: t.ciInstallations.id })
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, INSTALLATION));
    expect(all).toHaveLength(1);
  });

  it('records a run and its agent_runs row once, however many times it is read', async () => {
    // AC-26 against the real `(ci_installation_id, workflow_run_id)` UNIQUE index.
    // The second read must UPDATE the `agent_runs` row it already points at, not
    // insert a second one — which no fake can prove, because the fake is the
    // thing being asserted about.
    const write = {
      ciInstallationId: INSTALLATION,
      workflowRunId: 95_555,
      prNumber: 900,
      ranAt: TIED,
      status: 'succeeded',
      findingsCount: 2,
      costUsd: 0.02,
      githubUrl: 'https://github.com/acme/payments-api/actions/runs/95555',
      headSha: 'deadbeef',
      repo: 'acme/payments-api',
      source: 'gha',
      agent: 'Security Reviewer',
      blockers: 1,
      durationS: 12,
      reason: null,
    };
    const agentRun = {
      workspaceId: WORKSPACE,
      agentId: AGENT,
      ranAt: TIED,
      provider: null,
      model: null,
      durationMs: 12_000,
      costUsd: 0.02,
      status: 'succeeded',
      error: null,
      findingsCount: 2,
      blockers: 1,
    };

    const first = await repo.recordRun(write, agentRun);
    const second = await repo.recordRun({ ...write, findingsCount: 3 }, {
      ...agentRun,
      findingsCount: 3,
    });

    expect(second.id).toBe(first.id);
    expect(second.findingsCount).toBe(3);

    const ciRows = await pg.handle.db
      .select({ id: t.ciRuns.id, agentRunId: t.ciRuns.agentRunId })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.workflowRunId, 95_555));
    expect(ciRows).toHaveLength(1);

    const agentRunId = ciRows[0]?.agentRunId;
    expect(agentRunId).not.toBeNull();

    const agentRows = await pg.handle.db
      .select({
        id: t.agentRuns.id,
        prId: t.agentRuns.prId,
        source: t.agentRuns.source,
        findingsCount: t.agentRuns.findingsCount,
      })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.workspaceId, WORKSPACE));

    // AC-25 and AC-26 together: ONE `agent_runs` row, `source = 'ci'`, `pr_id`
    // null — which is what keeps a CI run out of every PR-feed aggregate.
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0]).toMatchObject({ source: 'ci', prId: null, findingsCount: 3 });
    expect(agentRows[0]?.id).toBe(agentRunId);
  });
});
