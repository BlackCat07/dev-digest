import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ConventionsService } from '../src/modules/conventions/service.js';
import { ConventionsRepository } from '../src/modules/conventions/repository.js';
import {
  EXTRACTION_SCHEMA_NAME,
  SCAN_STALE_AFTER_MS,
  SELECTION_SCHEMA_NAME,
  UNMEASURED_CONFIDENCE_CEILING,
} from '../src/modules/conventions/constants.js';
import type { RepoRef } from '@devdigest/shared';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * The extraction pipeline end to end, over a real clone on disk and a real
 * Postgres, with only the model faked.
 *
 * What earns the Postgres and the temp directory: every rule this feature rests
 * on is a decision made BETWEEN a model answer and a database row — a fabricated
 * citation dropped, a line number corrected against the file, a counted
 * adherence overriding the model's self-report, a rejected rule not coming back.
 * None of those are visible in a unit test of the pieces, because each piece
 * passes on its own.
 */

/** Two files with an obvious house rule and one deliberate exception. */
const FILES: Record<string, string> = {
  'src/modules/tasks/repo.ts': `import { db } from '../../db/client.js';
import { tasks } from '../../db/schema.js';

export async function listTasks(projectId: string) {
  const rows = await db.select().from(tasks);
  return rows;
}

export async function getTask(id: string) {
  const rows = await db.select().from(tasks);
  return rows[0];
}
`,
  // Cited at line 4. Everything below it is padding that gives the
  // await-vs-.then() rule enough occurrences to clear the adherence floors —
  // the counts are now taken from this text, so the fixture has to be a
  // corpus a real rule could actually be measured against.
  'src/modules/users/repo.ts': `import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

export async function listUsers(workspaceId: string) {
  const rows = await db.select().from(users);
  return rows;
}

export async function getUser(id: string) {
  const rows = await db.select().from(users);
  return rows[0];
}

export async function countUsers() {
  const rows = await db.select().from(users);
  return rows.length;
}

export async function deleteUser(id: string) {
  const rows = await db.delete(users);
  return rows;
}

export async function touchUser(id: string) {
  const rows = await db.update(users);
  return rows;
}
`,
  'src/legacy/client.ts': `export function fetchAll() {
  return http.get('/all').then((r) => r.data);
}
`,
};

/** A git client rooted at a real temp directory instead of /mock/clones. */
class TempCloneGit extends MockGitClient {
  constructor(private root: string) {
    super({ head: 'deadbeefcafe' });
  }
  override clonePathFor(_repo: RepoRef): string {
    return this.root;
  }
}

d('conventions extractor', () => {
  let pg: PgFixture;
  let root: string;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    root = await mkdtemp(join(tmpdir(), 'devdigest-conventions-'));
    for (const [path, source] of Object.entries(FILES)) {
      const absolute = join(root, ...path.split('/'));
      await mkdir(join(absolute, '..'), { recursive: true });
      await writeFile(absolute, source, 'utf8');
    }

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'conventions-fixture',
        fullName: 'acme/conventions-fixture',
        defaultBranch: 'main',
      })
      .returning();
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
    if (root) await rm(root, { recursive: true, force: true });
  });

  /**
   * The model's answer for one scan. Four candidates, each planted to exercise
   * one gate:
   *   1. real evidence, adherence 7:1 over the corpus → kept, confidence 0.875
   *   2. FABRICATED evidence                          → dropped, unverified
   *   3. real evidence, 1 conforming (under the floor) → dropped, low-adherence
   *   4. real evidence, unmeasurable                   → kept, confidence capped
   *
   * The adherence figures are COUNTED over `FILES` above, not stubbed, so a
   * change to the fixture text moves them — which is the point: the numbers on
   * a candidate have to come from real code or they prove nothing.
   */
  const EXTRACTION = {
    candidates: [
      {
        rule: 'Repository functions await the query builder rather than chaining .then()',
        rationale: 'Every repo module awaits; only src/legacy/client.ts chains.',
        // Claimed two lines off, and re-indented — the gate must correct it.
        evidence: [
          {
            path: 'src/modules/tasks/repo.ts',
            start_line: 7,
            snippet: 'const rows = await db.select().from(tasks);',
          },
        ],
        match_conforming: '\\bawait\\s',
        match_violating: '\\.then\\s*\\(',
        confidence: 0.5,
      },
      {
        rule: 'Every route handler returns a typed Result<T, ApiError>',
        rationale: 'Sounds plausible and is not in this codebase at all.',
        evidence: [
          {
            path: 'src/modules/tasks/routes.ts',
            start_line: 14,
            snippet: 'function handler(): Result<Item[], ApiError> {',
          },
        ],
        match_conforming: 'Result<',
        match_violating: 'reply\\.send',
        confidence: 0.78,
      },
      {
        rule: 'Repository functions take a workspaceId as their first argument',
        rationale: 'True in one place, false in most.',
        evidence: [
          {
            path: 'src/modules/users/repo.ts',
            start_line: 4,
            snippet: 'export async function listUsers(workspaceId: string) {',
          },
        ],
        match_conforming: 'workspaceId: string',
        match_violating: 'projectId: string',
        confidence: 0.9,
      },
      {
        rule: 'Data access lives in repo.ts, never in a route module',
        rationale: 'Structural: no line-level pattern can express it.',
        evidence: [
          {
            path: 'src/modules/tasks/repo.ts',
            start_line: 1,
            snippet: "import { db } from '../../db/client.js';",
          },
        ],
        match_conforming: null,
        match_violating: null,
        confidence: 0.95,
      },
    ],
  };

  function makeService(extraction: unknown = EXTRACTION): ConventionsService {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    // The facade is wide and this scan touches two of its methods; a partial
    // stub keeps the fixture readable and fails loudly if that ever changes.
    const repoIntel = {
      getConventionSamples: async () => Object.keys(FILES),
      getIndexState: async () => ({ filesIndexed: Object.keys(FILES).length }),
    } as unknown as RepoIntel;

    const container = new Container(config, pg.handle.db, {
      git: new TempCloneGit(root),
      repoIntel,
      llm: {
        openrouter: new MockLLMProvider('openai', {
          structuredBySchema: {
            [SELECTION_SCHEMA_NAME]: { paths: Object.keys(FILES) },
            [EXTRACTION_SCHEMA_NAME]: extraction,
          },
        }),
      },
    });
    return new ConventionsService(container);
  }

  const OPTIONS = { categories: ['async'] as const };

  /** Clear this repo's scans and candidates so each test starts from nothing. */
  async function reset(): Promise<void> {
    await pg.handle.db.delete(t.conventions).where(eq(t.conventions.repoId, repoId));
    await pg.handle.db.delete(t.conventionScans).where(eq(t.conventionScans.repoId, repoId));
  }

  /**
   * Run the pipeline directly, creating the scan row the way the job worker
   * would find it.
   *
   * Deliberately NOT through `requestScan`: that enqueues, and a registered
   * handler would then run the same scan a second time in the background, on
   * the same rows, while the assertions read them. The queue hop is worth one
   * test of its own, not a race under every other one.
   */
  async function runScan(service: ConventionsService) {
    const repo = new ConventionsRepository(pg.handle.db);
    const scan = await repo.createScan(workspaceId, repoId, OPTIONS);
    await service.runScan(workspaceId, repoId, scan.id, { ...OPTIONS, categories: ['async'] });
    return service.payload(workspaceId, repoId);
  }

  /** Reset, then run one scan. The shape most tests want. */
  async function scanOnce(extraction: unknown = EXTRACTION) {
    await reset();
    return runScan(makeService(extraction));
  }

  it('drops the candidate whose evidence does not exist, and counts it', async () => {
    const payload = await scanOnce();
    const rules = payload.candidates.map((c) => c.rule);
    expect(rules).not.toContain('Every route handler returns a typed Result<T, ApiError>');
    expect(payload.scan?.dropped_unverified).toBe(1);
  });

  it('drops the candidate the repository mostly ignores, and counts it', async () => {
    const payload = await scanOnce();
    const rules = payload.candidates.map((c) => c.rule);
    expect(rules).not.toContain(
      'Repository functions take a workspaceId as their first argument',
    );
    expect(payload.scan?.dropped_low_adherence).toBe(1);
  });

  it('reports what the model proposed, not just what survived', async () => {
    const payload = await scanOnce();
    expect(payload.scan?.proposed).toBe(4);
    expect(payload.scan?.kept).toBe(2);
  });

  it('replaces the model’s confidence with the counted adherence', async () => {
    const payload = await scanOnce();
    const kept = payload.candidates.find((c) => c.rule.startsWith('Repository functions await'));
    // The model said 0.5. Counted over the fixture corpus: 7 awaited lines
    // against the one `.then()` chain in src/legacy/client.ts.
    expect(kept?.adherence).toEqual({ conforming: 7, violating: 1 });
    expect(kept?.confidence).toBeCloseTo(7 / 8, 3);
  });

  it('corrects the cited line to where the code actually is', async () => {
    const payload = await scanOnce();
    const kept = payload.candidates.find((c) => c.rule.startsWith('Repository functions await'));
    const evidence = kept?.evidence[0];
    // Claimed line 7; the snippet is on line 5, re-indented.
    expect(evidence?.start_line).toBe(5);
    expect(evidence?.match).toBe('shifted');
    // And the stored snippet is the file's own text, indentation included.
    expect(evidence?.snippet).toBe('  const rows = await db.select().from(tasks);');
  });

  it('keeps an unmeasurable rule but caps its confidence below any measured one', async () => {
    const payload = await scanOnce();
    const structural = payload.candidates.find((c) => c.rule.startsWith('Data access lives'));
    expect(structural).toBeDefined();
    expect(structural?.adherence).toBeNull();
    // The model claimed 0.95.
    expect(structural?.confidence).toBe(UNMEASURED_CONFIDENCE_CEILING);
  });

  it('pins the scan to the commit the clone sat at, for the GitHub links', async () => {
    const payload = await scanOnce();
    expect(payload.scan?.commit_sha).toBe('deadbeefcafe');
    expect(payload.repo.sha).toBe('deadbeefcafe');
    expect(payload.repo.full_name).toBe('acme/conventions-fixture');
  });

  it('does not propose a rule the user already rejected', async () => {
    const service = makeService();
    const before = await scanOnce();
    const target = before.candidates.find((c) => c.rule.startsWith('Data access lives'))!;
    await service.update(workspaceId, target.id, { status: 'rejected' });

    // Same model, same answer, second scan. The rejected rule must not return.
    const after = await runScan(service);
    const matching = after.candidates.filter((c) => c.rule.startsWith('Data access lives'));
    expect(matching).toHaveLength(1);
    expect(matching[0]!.status).toBe('rejected');
  });

  it('marks an edited rule so a re-scan leaves it alone', async () => {
    const service = makeService();
    const payload = await scanOnce();
    const target = payload.candidates.find((c) => !c.edited)!;

    const edited = await service.update(workspaceId, target.id, {
      rule: 'Repository functions always await the query builder',
      status: 'accepted',
    });
    expect(edited.edited).toBe(true);
    expect(edited.status).toBe('accepted');

    // A re-scan clears only untriaged rows, so the edit survives verbatim.
    await runScan(service);
    const after = await service.payload(workspaceId, repoId);
    const survivor = after.candidates.find((c) => c.id === target.id);
    expect(survivor?.rule).toBe('Repository functions always await the query builder');
    expect(survivor?.edited).toBe(true);
  });

  it('refuses a second scan while one is already in flight', async () => {
    await reset();
    const service = makeService();
    // A row in flight, without going through the queue — the guard reads the
    // newest scan's status, which is exactly what an enqueued scan leaves.
    await new ConventionsRepository(pg.handle.db).createScan(workspaceId, repoId, OPTIONS);
    await expect(service.requestScan(workspaceId, repoId, OPTIONS)).rejects.toThrow(
      /already running/i,
    );
  });

  it('abandons a scan whose worker died, instead of bricking the repo', async () => {
    // A crashed process leaves its row `running` forever. Treating that as
    // active refuses every later scan and reports `scan_running` in the budget,
    // with no way out from the UI. Measured against the row's own age.
    await reset();
    const repo = new ConventionsRepository(pg.handle.db);
    const stuck = await repo.createScan(workspaceId, repoId, OPTIONS);
    await repo.updateScan(stuck.id, { status: 'running' });

    const justAfter = new Date(stuck.startedAt.getTime() + SCAN_STALE_AFTER_MS - 1_000);
    expect(await repo.activeScan(workspaceId, repoId, justAfter)).toBeDefined();

    const wellAfter = new Date(stuck.startedAt.getTime() + SCAN_STALE_AFTER_MS + 1_000);
    expect(await repo.activeScan(workspaceId, repoId, wellAfter)).toBeUndefined();
  });

  it('quotes a budget without reading a file, and blocks an uncloned repo', async () => {
    await reset();
    const service = makeService();
    const budget = await service.budget(workspaceId, repoId);
    expect(budget.eligible_files).toBe(Object.keys(FILES).length);
    expect(budget.planned_tokens).toBeGreaterThan(0);
    // One selection call plus one per category.
    expect(budget.planned_calls).toBeGreaterThan(1);

    const [other] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'never-cloned',
        fullName: 'acme/never-cloned',
        defaultBranch: 'main',
      })
      .returning();
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    const uncloned = new ConventionsService(
      new Container(config, pg.handle.db, {
        git: new MockGitClient(),
      }),
    );
    const blocked = await uncloned.budget(workspaceId, other!.id);
    expect(blocked.can_scan).toBe(false);
    expect(blocked.blocked_reason).toBe('not_cloned');
  });

  it('is workspace-scoped: another tenant’s repo id is a 404', async () => {
    const service = makeService();
    await expect(service.payload('00000000-0000-0000-0000-000000000000', repoId)).rejects.toThrow(
      /not found/i,
    );
  });

  it('records the scan even when every candidate is dropped', async () => {
    const payload = await scanOnce({ candidates: [EXTRACTION.candidates[1]] });
    expect(payload.scan?.proposed).toBe(1);
    expect(payload.scan?.kept).toBe(0);
    expect(payload.scan?.dropped_unverified).toBe(1);
    expect(payload.scan?.status).toBe('done');
  });

  describe('skill generation', () => {
    /** Scan, then accept the two survivors and reject nothing. */
    async function scanAndAccept(service: ConventionsService) {
      const payload = await scanOnce();
      for (const candidate of payload.candidates) {
        await service.update(workspaceId, candidate.id, { status: 'accepted' });
      }
      return service.payload(workspaceId, repoId);
    }

    it('folds every accepted candidate into one skill', async () => {
      const service = makeService();
      const payload = await scanAndAccept(service);
      const skills = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: payload.candidates.map((c) => c.id),
      });

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('conventions-fixture-conventions');
      expect(skills[0]!.body).toContain('Repository functions await');
      expect(skills[0]!.body).toContain('Data access lives in repo.ts');
    });

    it('records the skill as extracted, with its evidence files', async () => {
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [skill] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: payload.candidates.map((c) => c.id),
      });

      // `extracted` is NOT a trusted source, so this body is delimiter-wrapped
      // before it reaches a prompt — the same treatment an imported file gets.
      expect(skill!.source).toBe('extracted');
      expect(skill!.type).toBe('convention');
      expect(skill!.evidence_files).toContain('src/modules/tasks/repo.ts');
      expect(skill!.enabled).toBe(true);
    });

    it('snapshots version 1 so the Versions tab is not empty', async () => {
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [skill] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: payload.candidates.map((c) => c.id),
      });

      const versions = await pg.handle.db
        .select()
        .from(t.skillVersions)
        .where(eq(t.skillVersions.skillId, skill!.id));
      expect(versions).toHaveLength(1);
      expect(versions[0]!.body).toBe(skill!.body);
    });

    it('NEVER puts a rejected candidate in the body, even when its id is sent', async () => {
      // The acceptance rule of the feature. Enforced on the server against the
      // stored status, not by trusting the client to send only accepted ids.
      const service = makeService();
      const payload = await scanOnce();
      const [first, second] = payload.candidates;
      await service.update(workspaceId, first!.id, { status: 'accepted' });
      await service.update(workspaceId, second!.id, { status: 'rejected' });

      const [skill] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: [first!.id, second!.id],
      });

      expect(skill!.body).toContain(first!.rule);
      expect(skill!.body).not.toContain(second!.rule);
      expect(skill!.description).toBe('1 house convention extracted from conventions-fixture');
    });

    it('excludes an untriaged candidate too — accepted is the only pass', async () => {
      const service = makeService();
      const payload = await scanOnce();
      const [first, second] = payload.candidates;
      await service.update(workspaceId, first!.id, { status: 'accepted' });
      // `second` stays pending.

      const [skill] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: [first!.id, second!.id],
      });
      expect(skill!.body).not.toContain(second!.rule);
    });

    it('refuses when nothing among the ids was accepted', async () => {
      const service = makeService();
      const payload = await scanOnce();
      await expect(
        service.generateSkills(workspaceId, repoId, {
          candidate_ids: payload.candidates.map((c) => c.id),
        }),
      ).rejects.toThrow(/no accepted candidates/i);
    });

    it('links each candidate back to the skill that carries it', async () => {
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [skill] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: payload.candidates.map((c) => c.id),
      });

      const after = await service.payload(workspaceId, repoId);
      expect(after.candidates.every((c) => c.skill_id === skill!.id)).toBe(true);
    });

    it('writes ONE skill however many categories the accepted candidates span', async () => {
      // The per-category shape was removed on purpose: which rules belong in one
      // skill is the user's decision, expressed by which candidates they accept.
      // Re-filing one candidate into a second category must therefore change
      // nothing about how many skills a call writes.
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [first, ...rest] = payload.candidates;
      await service.update(workspaceId, first!.id, { category: 'imports' });

      const skills = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: [first!.id, ...rest.map((c) => c.id)],
      });

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('conventions-fixture-conventions');
      expect(skills[0]!.body).toContain(first!.rule);
      for (const other of rest) expect(skills[0]!.body).toContain(other.rule);
    });

    it('files the skill under a caller-chosen type, defaulting to convention', async () => {
      // The modal shows Type as an editable field, so it has to reach the row.
      // `source` stays server-owned — it is a fact about where the text came
      // from, not a judgement about the rules.
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [typed] = await service.generateSkills(workspaceId, repoId, {
        candidate_ids: payload.candidates.map((c) => c.id),
        type: 'security',
      });
      expect(typed!.type).toBe('security');
      expect(typed!.source).toBe('extracted');
    });

    it('ignores a candidate id belonging to another repository', async () => {
      const service = makeService();
      const payload = await scanAndAccept(service);
      const [other] = await pg.handle.db
        .insert(t.repos)
        .values({
          workspaceId,
          owner: 'acme',
          name: 'other-repo',
          fullName: 'acme/other-repo',
          defaultBranch: 'main',
        })
        .returning();

      await expect(
        service.generateSkills(workspaceId, other!.id, {
          candidate_ids: payload.candidates.map((c) => c.id),
        }),
      ).rejects.toThrow(/no accepted candidates/i);
    });
  });

  it('keeps tied candidates in a fixed order, before and after triage', async () => {
    // The list is ordered by confidence DESC, and a scan routinely produces
    // several rules at the SAME confidence. Without a tiebreaker Postgres
    // returns tied rows in whatever physical order it reads them, and the
    // UPDATE behind Accept rewrites the row elsewhere in the heap — so the card
    // just triaged slid down the list. Triage must never reorder anything.
    await reset();
    const repo = new ConventionsRepository(pg.handle.db);
    const scan = await repo.createScan(workspaceId, repoId, OPTIONS);
    const inserted = await repo.insertCandidates(
      ['one', 'two', 'three', 'four', 'five'].map((n) => ({
        workspaceId,
        repoId,
        scanId: scan.id,
        category: 'async' as const,
        rule: `Tied rule ${n}`,
        rationale: '',
        evidence: [],
        matcher: null,
        adherenceConforming: 62,
        adherenceViolating: 0,
        // Every one a measured 62/62 — the real shape of the tie.
        confidence: 1,
      })),
    );

    const before = await repo.listCandidates(workspaceId, repoId);
    // Insertion order is the heap order; ids are random, so an order that
    // matches the sorted ids is the tiebreaker doing the work, not luck.
    expect(before.map((c) => c.id)).toEqual([...inserted.map((c) => c.id)].sort());

    await repo.updateCandidate(workspaceId, inserted[1]!.id, { status: 'accepted' });
    await repo.updateCandidate(workspaceId, inserted[3]!.id, { status: 'rejected' });

    const after = await repo.listCandidates(workspaceId, repoId);
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  });

  it('writes the whole scan as a row that survives a re-read', async () => {
    await scanOnce();
    const rows = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.finishedAt !== null)).toBe(true);
  });
});
