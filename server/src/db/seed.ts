import 'dotenv/config';
import { FEATURE_MODELS } from '@devdigest/shared';
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
 * PR #482's own text, hoisted out of the insert below.
 *
 * The L03 intent row records the exact character count of every source the
 * classifier would have read, and its `head_sha` has to equal this PR's. Reading
 * both off the same constants is what stops the two drifting the first time
 * anyone edits the fixture's description — a literal `chars: 89` would go quietly
 * wrong instead.
 */
const SEED_PR_NUMBER = 482;
const SEED_PR_TITLE = 'Add rate limiting to public API endpoints';
const SEED_PR_BODY =
  'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.';
const SEED_PR_HEAD_SHA = 'a1b2c3d4e5f6';
/**
 * PR #482's changed files, as PATCHES — the one source of truth for every figure
 * the fixture reports.
 *
 * L03b needs real patch text for three reasons the previous file-list-only
 * fixture could not serve. The `pr_files.patch` column was NULL for every seeded
 * row, so on a fresh install: the Files-changed tab rendered "No diff text
 * available" for all of them, a findings badge had no line to scroll to, and
 * `pseudocode_summary` had no `@@` header to quote. All three are the parts of
 * Smart Diff a reviewer actually touches.
 *
 * `additions` and `deletions` are COUNTED from the patch (see
 * {@link countChanges}) rather than written down, and the PR row's three totals
 * are summed from these (see {@link SEED_PR_TOTALS}). That is deliberate: the old
 * fixture hand-wrote `additions: 247, deletions: 38, filesCount: 9` over four
 * file rows that summed to 126/8, so the header disagreed with the list below it
 * and nothing could notice. Derived figures cannot drift.
 *
 * The nine paths span all three Smart Diff roles on purpose, so a fresh install
 * demonstrates the feature rather than a single group: `core` (the limiter, the
 * webhook forwarder, the user list), `wiring` (the route barrel, the entry point,
 * the config) and `boilerplate` (the manifest, the lock file, the test).
 *
 * TWO LINE NUMBERS ARE LOAD-BEARING. The seeded findings sit at
 * `src/config.ts:12` and `src/api/users.ts:45`, so those lines must exist on the
 * NEW side of these patches or the badge has nothing to scroll to and the demo
 * shows the feature failing. `src/config.ts`'s hunk therefore starts at line 11
 * and `src/api/users.ts`'s at line 44. Changing either hunk header means changing
 * the findings below, and `test/smart-diff.it.test.ts` asserts the pair.
 */
const SEED_PR_PATCHES: ReadonlyArray<{ path: string; patch: string }> = [
  {
    path: 'src/middleware/ratelimit.ts',
    patch: [
      '@@ -8,2 +8,6 @@ function bucketKey(',
      ' function bucketKey(req: Req): string {',
      "+  const ip = req.headers['x-forwarded-for'] ?? req.ip;",
      "+  const route = req.routeOptions?.url ?? 'unknown';",
      '+  return `rl:${route}:${ip}`;',
      ' }',
      '@@ -24,3 +28,11 @@ export async function rateLimit(',
      ' export async function rateLimit(req: Req, res: Res, next: Next) {',
      '+  const key = bucketKey(req);',
      '+  const count = await redis.incr(key);',
      '+  if (count === 1) await redis.expire(key, 3600);',
      '+',
      '+  if (count > limitFor(req)) {',
      '+    return res.status(429).end();',
      '+  }',
      '   return next();',
      ' }',
    ].join('\n'),
  },
  {
    path: 'src/api/public/webhooks.ts',
    patch: [
      '@@ -60,4 +60,7 @@ export async function webhookHandler(',
      ' export async function webhookHandler(req: Req, res: Res) {',
      '+  const target = req.body.callback_url;',
      '   const account = await db.accounts.find(req.accountId);',
      '-  await notifyAccount(account);',
      '+  const token = account.apiToken;',
      '+  await fetch(target, { headers: { Authorization: token } });',
      '   return res.status(202).end();',
      ' }',
    ].join('\n'),
  },
  {
    path: 'src/api/users.ts',
    patch: [
      '@@ -44,2 +44,7 @@ export async function listUsers(',
      '   const users = await db.users.findMany();',
      '+  const result = [];',
      '+  for (const u of users) {',
      '+    const posts = await db.posts.findMany({ userId: u.id });',
      '+    result.push({ ...u, posts });',
      '+  }',
      '   return result;',
    ].join('\n'),
  },
  {
    path: 'src/api/public/index.ts',
    patch: [
      '@@ -12,3 +12,4 @@ export function registerPublicRoutes(',
      ' export function registerPublicRoutes(app: App) {',
      "+  app.addHook('onRequest', rateLimit);",
      "   app.post('/webhooks', webhookHandler);",
      "   app.get('/users', listUsers);",
    ].join('\n'),
  },
  {
    path: 'src/server.ts',
    patch: [
      '@@ -4,3 +4,4 @@ async function start(',
      ' async function start() {',
      '   const app = buildApp();',
      '+  await redis.connect();',
      '   await app.listen({ port: config.port });',
    ].join('\n'),
  },
  {
    path: 'src/config.ts',
    patch: [
      '@@ -11,3 +11,4 @@ export const config = {',
      '   port: Number(process.env.PORT ?? 3000),',
      // The leaked key the seeded CRITICAL finding points at, written so it can
      // never be mistaken for one. Underscores are deliberate: a secret scanner
      // matches `sk_live_` followed by a long run of ALPHANUMERICS, so a
      // realistic-looking fixture value (the design mock's
      // `sk_live_51H8xq...`) is detected by GitHub push protection and blocks the
      // push — a fake secret costing a real outage. Every other `sk_live_` in
      // this repo is a non-matching placeholder for the same reason
      // (`src/adapters/mocks.ts` uses `sk_live_xxx`).
      '+  stripeKey: "sk_live_EXAMPLE_NOT_A_REAL_KEY",',
      '   redisUrl: process.env.REDIS_URL,',
      ' };',
    ].join('\n'),
  },
  {
    path: 'package.json',
    patch: [
      '@@ -14,3 +14,4 @@',
      '   "dependencies": {',
      '     "fastify": "^5.1.0",',
      '+    "ioredis": "^5.4.1"',
      '   },',
    ].join('\n'),
  },
  {
    path: 'package-lock.json',
    patch: [
      '@@ -1204,6 +1204,26 @@',
      '     "node_modules/fastify": {',
      '       "version": "5.1.0",',
      '-      "resolved": "https://registry.npmjs.org/fastify/-/fastify-5.1.0.tgz"',
      '+      "resolved": "https://registry.npmjs.org/fastify/-/fastify-5.1.0.tgz",',
      '+      "dependencies": {',
      '+        "ioredis": "^5.4.1"',
      '+      }',
      '+    },',
      '+    "node_modules/ioredis": {',
      '+      "version": "5.4.1",',
      '+      "resolved": "https://registry.npmjs.org/ioredis/-/ioredis-5.4.1.tgz",',
      '+      "engines": {',
      '+        "node": ">=12.22.0"',
      '+      },',
      '+      "dependencies": {',
      '+        "cluster-key-slot": "^1.1.0",',
      '+        "denque": "^2.1.0",',
      '+        "redis-errors": "^1.2.0",',
      '+        "redis-parser": "^3.0.0",',
      '+        "standard-as-callback": "^2.1.0"',
      '+      }',
      '     },',
    ].join('\n'),
  },
  {
    path: 'test/ratelimit.test.ts',
    patch: [
      '@@ -1,2 +1,8 @@',
      "-import { describe, it } from 'vitest';",
      "+import { describe, it, expect } from 'vitest';",
      '+',
      "+describe('rateLimit', () => {",
      "+  it('returns 429 once the bucket is exhausted', async () => {",
      '+    expect(await hit(11)).toBe(429);',
      '+  });',
      '+});',
    ].join('\n'),
  },
];

/**
 * `+`/`-` line counts of one patch, so the columns cannot disagree with the text.
 *
 * `+++`/`---` are excluded because they are file headers rather than changed
 * lines. The seeded patches carry none, but a patch pasted from `git diff` would.
 */
function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

/**
 * The `pr_files` rows, with their two counts derived from the patch.
 *
 * Exported so tests assert against the same array the seed writes rather than
 * re-typing its figures — a hardcoded `+47` in a test is the same drift this
 * fixture just removed from the PR row, moved one file over.
 */
export const SEED_PR_FILES = SEED_PR_PATCHES.map((file) => ({
  ...file,
  ...countChanges(file.patch),
}));

/**
 * The PR row's three totals, summed from the files.
 *
 * Read off the same array the `pr_files` rows come from, so the header can never
 * report a different size from the list — the drift the previous hand-written
 * `247 / 38 / 9` had against four rows that summed to `126 / 8`.
 */
export const SEED_PR_TOTALS = {
  additions: SEED_PR_FILES.reduce((sum, f) => sum + f.additions, 0),
  deletions: SEED_PR_FILES.reduce((sum, f) => sum + f.deletions, 0),
  filesCount: SEED_PR_FILES.length,
};

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
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, SEED_PR_NUMBER)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: SEED_PR_NUMBER,
        title: SEED_PR_TITLE,
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: SEED_PR_HEAD_SHA,
        ...SEED_PR_TOTALS,
        status: 'needs_review',
        body: SEED_PR_BODY,
      })
      .returning();

    // pr_files — the whole changed-file list, with patches.
    await db.insert(t.prFiles).values(SEED_PR_FILES.map((f) => ({ prId: pr!.id, ...f })));

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: SEED_PR_HEAD_SHA,
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

  await seedPrIntent(db, pr!.id);
  await seedSkills(db, workspaceId);
  await seedConventions(db, workspaceId, repoId);

  return { workspaceId, userId };
}

/**
 * The `review_intent` registry default, read from the registry rather than
 * copied, so the seeded row keeps naming whichever model that feature actually
 * defaults to after the next flip.
 */
const SEED_INTENT_MODEL = FEATURE_MODELS.find((f) => f.id === 'review_intent')!;

/**
 * A figure `deriveConfidence` can actually produce for this PR — deliberately
 * not a round one picked to look good.
 *
 * PR #482 offers four source kinds: `pr_title` (0.05), `pr_body` (0.35),
 * `file_list` (0.05) and — since L03b gave the seeded `pr_files` rows real patch
 * text — `hunk_headers` (0.05). No linked issue and no repo document. That sums to
 * 0.50, which is the CEILING for this PR: the model's own self-report may only
 * lower it, never raise it, and it lowers it as a bounded discount rather than as
 * a competing number. 0.45 is what a classifier self-reporting 0.8 would have
 * stored (`0.50 × (0.5 + 0.5 × 0.8) = 0.45`), and it reads on the card as what it
 * is: an intent taken from a description and a diff outline, with no ticket and no
 * spec behind it.
 *
 * RAISED from 0.4 in the same change that added the patches, because the figure
 * has to follow the material. Adding a source and leaving the number alone would
 * have made the card under-report its own confidence, and the whole point of
 * deriving it is that it cannot be a taste decision. `e2e/specs/11-pr-intent.flow.json`
 * asserts the rendered percentage, so it moved from `40%` to `45%` alongside.
 *
 * See `src/modules/intent/{confidence,constants}.ts` for the derivation.
 */
const SEED_INTENT_CONFIDENCE = 0.45;

/**
 * Fixed, never `new Date()`: two runs of `db:seed` must produce the same row, and
 * a moving timestamp would make the card's "derived …" line differ per machine.
 */
const SEED_INTENT_DERIVED_AT = new Date('2026-08-08T09:14:00.000Z');

/**
 * L03 — the intent PR #482's classifier would have derived, so the INTENT card
 * renders on a freshly seeded database without a model call and without anyone
 * pressing re-derive first.
 *
 * Idempotent in the same style as `seedConventions`: keyed on "does this PR
 * already have an intent row", never updated once present, so a real
 * re-derivation someone triggered from the card survives a re-seed.
 *
 * Everything here is what the real derivation would have produced for THIS
 * fixture, not a prettier version of it:
 *
 *  - `head_sha` equals the seeded PR's, or the card would say the intent was
 *    derived from an earlier commit on a database seeded a second ago.
 *  - `sources` holds the four kinds this PR actually offers. `hunk_headers` is
 *    among them as of L03b: the seeded `pr_files` rows now carry real `patch`
 *    text, so `collectSources` WOULD read `@@` lines out of them. Before L03b
 *    there was no patch and therefore no such source, and claiming it would have
 *    put a source on the card that never existed — the reverse is just as true,
 *    which is why this entry arrived in the same commit as the patches.
 *  - `tokens_in`/`tokens_out`/`cost_usd` stay null. No call was made, and a
 *    plausible-looking token count is exactly the kind of invention the whole
 *    feature is built to avoid.
 */
async function seedPrIntent(db: Db, prId: string): Promise<void> {
  const [existing] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (existing) return;

  // The same rendering `collectSources` gives the `file_list` block, so `chars`
  // below is the size of the text the classifier would have been handed.
  const fileList = SEED_PR_FILES.map((f) => `${f.path} +${f.additions}/-${f.deletions}`).join('\n');

  // And the same rendering it gives the hunk-header block: one `--- <path>` line
  // per file, then that file's `@@` lines. Mirrored here rather than imported from
  // `modules/intent/` — a seed script reaching into a feature module's internals
  // is the wrong direction for one regex, and the shape is pinned by the comment
  // above `collectSources`'s `headerLines`.
  const headerBlock = SEED_PR_FILES.flatMap((f) => [
    `--- ${f.path}`,
    ...f.patch.split('\n').filter((line) => /^@@ .*$/.test(line)),
  ]).join('\n');

  await db.insert(t.prIntent).values({
    prId,
    intent: SEED_PR_BODY,
    inScope: [
      'Add middleware for rate limiting',
      'Apply to /api/public/* routes',
      'Return 429 with Retry-After header',
    ],
    outOfScope: [
      'Authentication changes',
      'Adding new endpoints',
      'Logging / observability for the limiter',
    ],
    headSha: SEED_PR_HEAD_SHA,
    confidence: SEED_INTENT_CONFIDENCE,
    sources: [
      {
        kind: 'pr_title',
        ref: `pull/${SEED_PR_NUMBER}`,
        status: 'used',
        chars: SEED_PR_TITLE.length,
        note: null,
      },
      {
        kind: 'pr_body',
        ref: `pull/${SEED_PR_NUMBER}#description`,
        status: 'used',
        chars: SEED_PR_BODY.length,
        note: null,
      },
      {
        kind: 'file_list',
        ref: `pull/${SEED_PR_NUMBER}/files`,
        status: 'used',
        chars: fileList.length,
        note: null,
      },
      {
        kind: 'hunk_headers',
        ref: `pull/${SEED_PR_NUMBER}/patch`,
        status: 'used',
        chars: headerBlock.length,
        // No truncation note: the fixture's header count is far below
        // MAX_HUNK_HEADERS, so `collectSources` would show all of them.
        note: null,
      },
    ],
    // What a classifier could truthfully say was absent here. Nothing came back
    // `unfetched` — nothing was referenced at all — so `status` stays 'ok' and
    // these lines are gaps in the material, not failures to read it.
    // What a classifier could truthfully say was absent. The third line used to
    // read "No hunk headers were available"; L03b gave the seeded rows real
    // patches, so that gap closed and the line had to go — a missing-context
    // entry that names material the classifier DID have is worse than none,
    // because the block is the one place the card is trusted to be candid.
    missingContext: [
      'No issue or ticket is linked from the description.',
      'No plan or spec document is referenced, so the intended design is not stated anywhere.',
      'Only hunk headers were available, never diff bodies, so the implementation itself was not read.',
    ],
    // Two risk areas, and both are anchored to paths that really are in
    // `SEED_PR_FILES` — the fixture has to survive its own grounding gate, or it
    // would demonstrate the opposite of what the gate does.
    //
    // Still deliberately NO `deps` risk, though the reason narrowed in L03b.
    // `SEED_PR_FILES` now DOES contain `package.json` and `package-lock.json`, so
    // `kindFromPaths` would happily label a risk `deps` if one existed. What has
    // not changed is that the classifier could not write the risk's TEXT: it
    // receives paths and `@@` headers, never diff bodies, so it cannot know which
    // package was added. A seeded "New dependency: ioredis" would put the one
    // capability this feature provably lacks into its own demo data.
    riskAreas: [
      {
        kind: 'security',
        title: 'Auth surface touched',
        explanation:
          'The limiter sits in front of the public webhook route and decides which callers get through, so a mistake here changes who is admitted.',
        severity: 'high',
        file_refs: ['src/middleware/ratelimit.ts', 'src/api/public/webhooks.ts'],
      },
      {
        kind: 'breaking_api',
        title: 'Existing lines changed in a public module',
        explanation:
          'src/api/users.ts is +7/-2, so lines were replaced rather than added, and the description does not mention that endpoint.',
        severity: 'medium',
        file_refs: ['src/api/users.ts'],
      },
    ],
    status: 'ok',
    provider: SEED_INTENT_MODEL.defaultProvider,
    model: SEED_INTENT_MODEL.defaultModel,
    derivedAt: SEED_INTENT_DERIVED_AT,
  });
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
