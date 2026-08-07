import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS } from './seed-skills.js';
import { SEED_CONVENTIONS, SEED_SCAN, SEED_SCAN_SHA } from './seed-conventions.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the built-in agents (General + Security + Performance,
 * plus L02's Test Quality Reviewer + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model, and L02's built-in skills with
 * their agent links.
 *
 * L02 adds a finished convention scan over the demo repo with three candidates
 * (see `seed-conventions.ts` for why a fixture is needed at all).
 *
 * Later course lessons populate the remaining tables (memory, eval, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // L02 control experiment. Both carry a deliberately generic system prompt;
    // what they know arrives from the skills linked below (see seed-prompts.ts).
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Reviews whether a change is actually covered by its tests.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract',
      description: 'Reviews changes to route signatures and shared schemas for breakage.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  await seedSkills(db, workspaceId);
  await seedConventions(db, workspaceId, repoId);

  return { workspaceId, userId };
}

/**
 * L02 — one finished scan over the demo repo, with its candidates.
 *
 * Idempotent in the same style as everything above: keyed on "does this repo
 * already have a scan", never updated once present. Re-seeding a workspace where
 * someone has accepted or rejected candidates therefore leaves their triage
 * alone — the same promise `seedSkills` makes about an edited body.
 */
async function seedConventions(db: Db, workspaceId: string, repoId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(t.conventionScans)
    .where(eq(t.conventionScans.repoId, repoId));
  if (existing) return;

  const [scan] = await db
    .insert(t.conventionScans)
    .values({
      workspaceId,
      repoId,
      status: 'done',
      commitSha: SEED_SCAN_SHA,
      options: {},
      eligibleFiles: SEED_SCAN.eligibleFiles,
      sampledFiles: SEED_SCAN.sampledFiles,
      proposed: SEED_SCAN.proposed,
      droppedUnverified: SEED_SCAN.droppedUnverified,
      droppedLowAdherence: SEED_SCAN.droppedLowAdherence,
      kept: SEED_CONVENTIONS.length,
      costUsd: SEED_SCAN.costUsd,
      finishedAt: new Date(),
    })
    .returning();

  for (const convention of SEED_CONVENTIONS) {
    await db.insert(t.conventions).values({
      workspaceId,
      repoId,
      scanId: scan!.id,
      category: convention.category,
      rule: convention.rule,
      rationale: convention.rationale,
      evidence: convention.evidence,
      matcher: convention.matcher,
      adherenceConforming: convention.adherenceConforming,
      adherenceViolating: convention.adherenceViolating,
      confidence: convention.confidence,
    });
  }
}

/**
 * L02 — built-in skills and their agent links. Idempotent in the same style as
 * the agents above: keyed on (workspace, name), never updated once present, so
 * re-seeding a workspace where the user has edited a body leaves their edit
 * alone.
 */
async function seedSkills(db: Db, workspaceId: string): Promise<void> {
  const idByName = new Map<string, string>();

  for (const s of SEED_SKILLS) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      idByName.set(s.name, existing.id);
      continue;
    }
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source: s.source,
        body: s.body,
        enabled: s.enabled,
        version: 1,
        evidenceFiles: s.evidenceFiles ?? null,
      })
      .returning();
    // Version 1 must exist too, or the Versions tab is empty for a seeded skill
    // while the row claims v1 — the same snapshot the repository writes on insert.
    await db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: s.body })
      .onConflictDoNothing();
    idByName.set(s.name, row!.id);
  }

  /**
   * Which skills each agent starts with, in prompt order.
   *
   * The two L02 agents get exactly the skill their control experiment turns on
   * and off. The starter three get the skills that match what their system
   * prompts already say, so attaching one is visible on the Agents screen from
   * the first run without changing how they behave.
   */
  const links: Array<{ agent: string; skills: string[] }> = [
    { agent: 'Security Reviewer', skills: ['secret-leakage-gate', 'lethal-trifecta'] },
    { agent: 'General Reviewer', skills: ['pr-quality-rubric', 'no-then-chains'] },
    {
      agent: 'Test Quality Reviewer',
      skills: ['edge-case-coverage', 'mock-overuse-gate', 'uncovered-branches'],
    },
    { agent: 'API Contract', skills: ['api-contract-guard'] },
  ];

  for (const link of links) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, link.agent)));
    if (!agent) continue;
    for (const [i, name] of link.skills.entries()) {
      const skillId = idByName.get(name);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
