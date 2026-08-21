import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { needsGeneration } from '../src/modules/brief/service.js';
import { BRIEF_STALE_AFTER_MS } from '../src/modules/brief/constants.js';
import type { StoredBrief } from '../src/modules/brief/types.js';

/**
 * L05 — the automatic trigger on the pull-request detail read (AC-8, AC-58).
 *
 * Two halves, and the split is the point.
 *
 *  1. **The predicate, not the route.** `GET /pulls/:id` decides nothing: it
 *     calls `requestGeneration` and the freshness rule, the dedup and the
 *     abandoned-generation window all live in the brief service (`DDG-ARCH-001`).
 *     So what "reading a pull request with no matching brief enqueues exactly
 *     one generation, and reading it again while that generation is in flight
 *     enqueues none" MEANS is a property of `needsGeneration`, and this is where
 *     it can be asserted hermetically. The route half needs Postgres — a real
 *     `pr_brief` row, a real claim — and belongs to the `.it` suite; no `.it.`
 *     segment in this filename (`DDG-TEST-001`).
 *  2. **The two structural facts about the call site**, which no unit test can
 *     reach and which a reader would otherwise take on trust: the trigger is
 *     called on BOTH exits of the handler (the GitHub-refresh path and the
 *     offline persisted path), and the call is `void`-ed and `.catch`-ed. A
 *     discarded `job.done` killed this API process twice
 *     (`server/INSIGHTS.md`, 2026-08-06 / 2026-08-07); the central catch in
 *     `JobRunner.enqueue` does not cover a promise dropped at THIS call site,
 *     and dropping the second call site is invisible — the offline path would
 *     simply never produce a brief, with no error anywhere. Asserted against the
 *     route's own source text, the shape `test/seed-skills.test.ts` uses for the
 *     two-copies-of-one-text problem.
 */

/** The trigger never forces, so the key comparison is what it turns on. */
const KEY = 'sha256:0f1e2d3c';

const NOW = new Date('2026-08-20T10:00:00.000Z');

/** A complete stored row that needs nothing. Overrides carry each case's difference. */
function storedBrief(over: Partial<StoredBrief> = {}): StoredBrief {
  return {
    what: 'Adds a rate limiter to the payments API.',
    why: 'Repeated bursts from one client were exhausting the pool.',
    risks: [],
    reviewFocus: [],
    diffStats: {
      files_changed: 3,
      files_listed: 3,
      additions: 40,
      deletions: 8,
      symbols: 2,
      endpoints: 1,
    },
    sources: [],
    bodyValid: true,
    state: 'done',
    status: 'ok',
    reason: null,
    riskLevel: 'low',
    cacheKey: KEY,
    headSha: 'a1b2c3d4',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    attempts: 1,
    tokensIn: 900,
    tokensOut: 120,
    costUsd: 0.0001,
    generatedAt: NOW,
    startedAt: null,
    error: null,
    ...over,
  };
}

/** A row claimed `msAgo` milliseconds before `NOW`, i.e. a generation in flight. */
function claimed(msAgo: number): StoredBrief {
  return storedBrief({
    state: 'running',
    startedAt: new Date(NOW.getTime() - msAgo),
  });
}

describe('the detail-read trigger, as the predicate it asks (AC-58)', () => {
  it('needs one generation for a pull request with no brief, and none once it is fresh', () => {
    // First read: no row at all. This is the enqueue AC-58 asks for.
    expect(needsGeneration(undefined, KEY, NOW)).toBe(true);

    // Second read of an unchanged pull request: the stored key still describes
    // it, so the trigger must enqueue NOTHING. Getting this wrong spends a model
    // call on every detail read, for every reader.
    expect(needsGeneration(storedBrief(), KEY, NOW)).toBe(false);
  });

  it('needs none while a generation is in flight, and one once that claim is abandoned', () => {
    // In flight a second ago: the answer to "does this need a generation" is no,
    // because one is already happening (AC-8). The refusal itself belongs to the
    // claim; this is only the trigger's own question.
    expect(needsGeneration(claimed(1_000), KEY, NOW)).toBe(false);
    expect(needsGeneration(claimed(BRIEF_STALE_AFTER_MS - 1_000), KEY, NOW)).toBe(false);

    // Past the window the worker is gone, and a claim that can never age out
    // would brick this card forever (AC-9).
    expect(needsGeneration(claimed(BRIEF_STALE_AFTER_MS + 1_000), KEY, NOW)).toBe(true);

    // A claim with no start time cannot be aged out at all, so it is abandoned
    // by construction rather than by arithmetic.
    expect(needsGeneration(storedBrief({ state: 'running', startedAt: null }), KEY, NOW)).toBe(
      true,
    );
  });

  it('needs one whenever the pull request has moved on, or the stored body is unusable', () => {
    // The detail route writes `pr_files`, `pull_requests.body` and the head SHA
    // immediately above the trigger, so a key computed after those writes is
    // exactly what differs here — this is the case the trigger exists for.
    expect(needsGeneration(storedBrief(), 'sha256:something-else', NOW)).toBe(true);
    // A claim writes the row with no key: nothing has ever completed.
    expect(needsGeneration(storedBrief({ cacheKey: null }), KEY, NOW)).toBe(true);
    // A body that did not survive its parse is no brief, whatever the columns
    // claim, and is offered for regeneration rather than served.
    expect(needsGeneration(storedBrief({ bodyValid: false }), KEY, NOW)).toBe(true);
  });

  it('reads the window from the constant rather than from a literal', () => {
    // Pins the constant to the five minutes every other claim in this server
    // uses; a shorter window re-enqueues a generation that is still running.
    expect(BRIEF_STALE_AFTER_MS).toBe(5 * 60_000);
  });
});

/* ─── the call site itself ────────────────────────────────────────────────── */

const ROUTES = readFileSync(new URL('../src/modules/pulls/routes.ts', import.meta.url), 'utf8');

/**
 * The `GET /pulls/:id` handler alone.
 *
 * Sliced rather than searched over the whole file, so a later route below it
 * cannot satisfy — or break — an assertion about this handler's exits.
 */
const DETAIL_HANDLER = (() => {
  const start = ROUTES.indexOf("app.get('/pulls/:id',");
  const end = ROUTES.indexOf("'/pulls/:id/comments'");
  // An explicit throw rather than an assertion, because this runs at module
  // load: a rename that breaks the slice must say so, not produce an empty
  // string that satisfies every `not.toMatch` below.
  if (start < 0 || end <= start) {
    throw new Error('could not locate the GET /pulls/:id handler in modules/pulls/routes.ts');
  }
  return ROUTES.slice(start, end);
})();

describe('the trigger at its call site', () => {
  it('is called on both exits of the handler, as the intent trigger is', () => {
    const briefCalls = DETAIL_HANDLER.match(/triggerBrief\(\)/g) ?? [];
    const intentCalls = DETAIL_HANDLER.match(/triggerIntent\(/g) ?? [];

    // Two exits: the GitHub-refresh return and the offline persisted return.
    // Counted against the intent trigger beside it, so a THIRD exit added later
    // fails here instead of quietly serving a brief-less pull request.
    expect(briefCalls).toHaveLength(2);
    expect(briefCalls).toHaveLength(intentCalls.length);
    // Declared exactly once — two closures would be two policies.
    expect(DETAIL_HANDLER.match(/const triggerBrief =/g)).toHaveLength(1);
  });

  it('is void-ed and catch-ed, and reaches the brief only through the container', () => {
    const trigger = DETAIL_HANDLER.slice(
      DETAIL_HANDLER.indexOf('const triggerBrief ='),
      DETAIL_HANDLER.indexOf('// Local-first: refresh detail from GitHub'),
    );

    // `void` is what keeps the response independent of the generation, and
    // `.catch` is what keeps a rejection — an already-running refusal included —
    // from becoming an unhandled rejection.
    expect(trigger).toMatch(/void\s+container\s*\n?\s*\.brief/);
    expect(trigger).toMatch(/\.requestGeneration\(/);
    expect(trigger).toMatch(/\.catch\(/);
    // Never `await`ed: awaiting it would put the whole generation, model call
    // included, inside this response.
    expect(trigger).not.toMatch(/await\s+container\s*\n?\s*\.brief/);
    // The options object is EMPTY: an automatic trigger never forces, so the
    // freshness rule always applies to it. Asserted on the argument list rather
    // than on the absence of the word, so a comment cannot fail — or pass — it.
    expect(trigger).toMatch(/\.requestGeneration\(\s*workspaceId,\s*pr\.id,\s*\{\}\s*,/);
  });

  it('adds no query of its own to a route that already carries the data-access warning', () => {
    // `modules/pulls/routes.ts` already contributes a `routes-no-data-access`
    // warning to the dependency-cruiser baseline. Selecting from the brief's own
    // table here would add another and move that baseline; the brief is
    // reachable only through the service behind the container. Scoped to the
    // table accessor rather than to the name, so prose naming the table is not a
    // failure.
    expect(ROUTES).not.toMatch(/t\.prBrief/);
    expect(ROUTES).toMatch(/container\s*\n?\s*\.brief/);
  });
});
