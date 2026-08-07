import type { ConventionCategory } from '@devdigest/shared';

/**
 * Built-in convention candidates for the demo repo (L02).
 *
 * These exist because the seeded repo `acme/payments-api` has `clonePath: null`
 * and no index — there is nothing on disk to scan, so a real extraction cannot
 * run against it. Without a fixture the Conventions screen would only ever be
 * reachable on a repo someone added by hand, which is exactly the kind of screen
 * an e2e flow cannot cover and a reviewer never sees.
 *
 * The three rules mirror the product design's Conventions mock. Two of its
 * confidence figures do NOT, and deliberately so — a fixture must depict a state
 * the real pipeline could actually produce, or it teaches a reader something
 * false about the system:
 *
 *  - the mock's 78% candidate is below `MIN_ADHERENCE` (0.8), so a default scan
 *    would have dropped it before anyone saw it;
 *  - the mock's 85% candidate is one with no matcher, and `deriveConfidence`
 *    caps an unmeasured rule at `UNMEASURED_CONFIDENCE_CEILING` (0.6) precisely
 *    so it can never outrank a counted one.
 *
 * Both are adjusted here to what the extractor would really write. Every
 * measured `confidence` below equals `conforming / (conforming + violating)`,
 * because that is how the pipeline computes it — a fixture where the two
 * disagreed would hide a regression in exactly that computation.
 *
 * Two rules carry a MEASURED adherence and one does not, on purpose: the
 * difference between "312 of 343 places follow this" and "the model's own
 * estimate" is the claim this whole feature rests on, and a fixture where every
 * card looked alike would let a regression in that distinction ship unnoticed.
 */

export interface SeedConvention {
  category: ConventionCategory;
  rule: string;
  rationale: string;
  evidence: Array<{
    path: string;
    start_line: number;
    end_line: number;
    snippet: string;
    match: 'exact' | 'shifted' | 'moved';
  }>;
  matcher: string | null;
  adherenceConforming: number | null;
  adherenceViolating: number | null;
  confidence: number;
}

/** The commit the fixture's citations are pinned to, for the GitHub links. */
export const SEED_SCAN_SHA = 'a1b2c3d4e5f6';

/**
 * Counters for the seeded scan.
 *
 * `proposed` is deliberately higher than the three kept: the screen's "4 dropped
 * before reaching this list" line is a real feature, and a fixture where nothing
 * was dropped would leave it untested and unseen.
 */
export const SEED_SCAN = {
  sampledFiles: 84,
  eligibleFiles: 84,
  proposed: 7,
  droppedUnverified: 3,
  droppedLowAdherence: 1,
  costUsd: 0.0142,
};

export const SEED_CONVENTIONS: SeedConvention[] = [
  {
    category: 'async',
    rule: 'Always use async/await instead of .then() chains',
    rationale:
      'Every module in src/api and src/lib awaits; the four remaining chains are all in src/legacy and predate the convention.',
    evidence: [
      {
        path: 'src/api/users.ts',
        start_line: 23,
        end_line: 24,
        snippet:
          '  const user = await db.users.find(id);\n  const posts = await db.posts.findMany({ userId });',
        match: 'exact',
      },
    ],
    matcher: '\\.then\\s*\\(',
    adherenceConforming: 312,
    adherenceViolating: 31,
    confidence: 0.91,
  },
  {
    category: 'api-contract',
    rule: 'All public route handlers return typed Result<T, ApiError>',
    rationale:
      'Handlers under src/api/public never throw to the framework; they return a Result so the error shape is part of the signature.',
    evidence: [
      {
        path: 'src/api/public/index.ts',
        start_line: 14,
        end_line: 16,
        snippet: 'function handler(): Result<Item[], ApiError> {\n  return ok(items);\n}',
        match: 'exact',
      },
    ],
    matcher: 'reply\\.send\\(',
    adherenceConforming: 43,
    adherenceViolating: 7,
    confidence: 0.86,
  },
  {
    category: 'structure',
    rule: 'Redis access goes through the src/lib/redis.ts singleton',
    rationale:
      'One client is constructed for the process; no other module calls new Redis(). Structural, so it has no line-level matcher.',
    evidence: [
      {
        path: 'src/lib/redis.ts',
        start_line: 1,
        end_line: 1,
        snippet: 'export const redis = new Redis(config.redisUrl);',
        match: 'exact',
      },
    ],
    matcher: null,
    adherenceConforming: null,
    adherenceViolating: null,
    // The unmeasured ceiling, not the mock's 0.85 — see the file header.
    confidence: 0.6,
  },
];
