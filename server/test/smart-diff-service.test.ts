import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type {
  SmartDiffDeps,
  SmartDiffFindingRow,
  SmartDiffPrFile,
  SmartDiffReviewRow,
  SmartDiffStore,
} from '../src/modules/smart-diff/types.js';

/**
 * L03b — the service that assembles the response.
 *
 * Hermetic by name and by construction: no Postgres, no queue, no provider. The
 * store is a structural fixture whose UNREACHABLE methods throw rather than
 * returning an empty value — the shape `intent-sources.test.ts` set — so a future
 * edit that starts reading files before the workspace check fails loudly here
 * instead of silently succeeding.
 *
 * Two cases carry more than their length:
 *
 *  - **The workspace check is the FIRST await.** `pr_files` and `findings` carry no
 *    `workspace_id` of their own, so a PR belonging to another workspace must 404
 *    before either read, not after. The throwing fixture is what proves the order.
 *  - **`SmartDiff.parse` on the assembled object.** No route in this server
 *    declares a `response:` schema, so the contract is otherwise a compile-time
 *    claim only — and this codebase has already shipped a cast-not-parsed response
 *    that reached the client as `$NaN` (`server/INSIGHTS.md`, 2026-08-02).
 */

const WORKSPACE = 'ws-1';
const PR = 'pr-1';

let seq = 0;

function prFile(
  path: string,
  additions = 1,
  deletions = 0,
  patch: string | null = null,
): SmartDiffPrFile {
  return { id: `f-${++seq}`, path, additions, deletions, patch };
}

/** The nine-file shape a real PR has, spanning all three roles. */
const FILES: SmartDiffPrFile[] = [
  prFile('src/middleware/ratelimit.ts', 84, 0, '@@ -24,6 +24,12 @@ export async function rateLimit(\n+  const key = 1;'),
  prFile('src/api/public/webhooks.ts', 31, 6, '@@ -60,4 +60,14 @@ export async function webhookHandler(\n+  const t = 1;'),
  prFile('src/api/users.ts', 7, 2),
  prFile('src/api/public/index.ts', 12, 2),
  prFile('src/server.ts', 8, 1),
  prFile('src/config.ts', 4, 0),
  prFile('package.json', 3, 1),
  prFile('package-lock.json', 92, 24),
  prFile('test/ratelimit.test.ts', 6, 0),
];

const SEEDED_FINDINGS: SmartDiffFindingRow[] = [
  { file: 'src/config.ts', startLine: 12 },
  { file: 'src/api/users.ts', startLine: 45 },
];

/**
 * A store whose every method throws until the test opts in to it.
 *
 * `never` returns rather than empty ones, deliberately: an accidental read must
 * be a failure, not a quiet no-op.
 */
function store(over: Partial<SmartDiffStore> = {}): SmartDiffStore {
  return {
    getPull: () => {
      throw new Error('getPull was not stubbed for this case');
    },
    getPrFiles: () => {
      throw new Error('getPrFiles must not be reached in this case');
    },
    reviewsForPull: () => {
      throw new Error('reviewsForPull must not be reached in this case');
    },
    ...over,
  };
}

function serviceWith(over: Partial<SmartDiffStore> = {}): SmartDiffService {
  return new SmartDiffService({ reviewRepo: store(over) });
}

/** The whole PR, one agent-less review — i.e. the seeded database's shape. */
function fullStore(
  reviews: readonly { review: SmartDiffReviewRow; findings: SmartDiffFindingRow[] }[] = [
    { review: { id: 'r1', agentId: null, kind: 'review' }, findings: SEEDED_FINDINGS },
  ],
): Partial<SmartDiffStore> {
  return {
    getPull: async () => ({ id: PR }),
    getPrFiles: async () => FILES,
    reviewsForPull: async () => reviews,
  };
}

describe('SmartDiffService — authorization', () => {
  it('404s for a PR that is not in this workspace, before reading anything', async () => {
    const service = serviceWith({ getPull: async () => undefined });
    // The other two fixtures throw, so reaching them fails with their message
    // instead of NotFoundError — which is how this asserts the ORDER.
    await expect(service.build(WORKSPACE, PR)).rejects.toThrow(NotFoundError);
  });

  it('passes the workspace to the lookup, so the scope cannot be dropped', async () => {
    const seen: string[] = [];
    const service = serviceWith({
      getPull: async (workspaceId) => {
        seen.push(workspaceId);
        return undefined;
      },
    });
    await expect(service.build(WORKSPACE, PR)).rejects.toThrow(NotFoundError);
    expect(seen).toEqual([WORKSPACE]);
  });
});

describe('SmartDiffService — the assembled response', () => {
  it('satisfies the SmartDiff contract at runtime', async () => {
    const result = await serviceWith(fullStore()).build(WORKSPACE, PR);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('groups the whole PR core → wiring → boilerplate', async () => {
    const { groups } = await serviceWith(fullStore()).build(WORKSPACE, PR);
    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(groups.flatMap((g) => g.files)).toHaveLength(FILES.length);
  });

  it('puts the lock file in boilerplate', async () => {
    const { groups } = await serviceWith(fullStore()).build(WORKSPACE, PR);
    const boilerplate = groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files.map((f) => f.path)).toContain('package-lock.json');
  });

  it('overlays the findings of an agent-less review onto the right files', async () => {
    const { groups } = await serviceWith(fullStore()).build(WORKSPACE, PR);
    const byPath = new Map(
      groups.flatMap((g) => g.files).map((f) => [f.path, f.finding_lines]),
    );
    expect(byPath.get('src/config.ts')).toEqual([12]);
    expect(byPath.get('src/api/users.ts')).toEqual([45]);
    // Everything else is overlay-free, not undefined.
    expect(byPath.get('package-lock.json')).toEqual([]);
  });

  it('summarises only the files that have a stored patch', async () => {
    const { groups } = await serviceWith(fullStore()).build(WORKSPACE, PR);
    const byPath = new Map(
      groups.flatMap((g) => g.files).map((f) => [f.path, f.pseudocode_summary]),
    );
    expect(byPath.get('src/middleware/ratelimit.ts')).toBe('rateLimit');
    expect(byPath.get('src/config.ts')).toBeNull();
  });
});

describe('SmartDiffService — states that are not errors', () => {
  it('answers 200-shaped for a PR whose files have never been imported', async () => {
    // The common case: nobody has opened the PR detail route, so `pr_files` is
    // empty. The PR exists — this must not 404, and must not fetch from GitHub.
    const result = await serviceWith({
      getPull: async () => ({ id: PR }),
      getPrFiles: async () => [],
      reviewsForPull: async () => [],
    }).build(WORKSPACE, PR);

    expect(result).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('groups the files with no overlay when the PR has never been reviewed', async () => {
    const { groups } = await serviceWith(fullStore([])).build(WORKSPACE, PR);
    // The pre-review state the brief requires: ordering works, badges do not exist.
    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
  });

  it('ignores a review that carries no per-line findings', async () => {
    const { groups } = await serviceWith(
      fullStore([{ review: { id: 'r1', agentId: null, kind: 'summary' }, findings: SEEDED_FINDINGS }]),
    ).build(WORKSPACE, PR);
    expect(groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
  });

  it('drops a finding citing a file the PR no longer changes, and logs it once', async () => {
    const logged: { payload: Record<string, unknown>; message: string }[] = [];
    const result = await serviceWith(
      fullStore([
        {
          review: { id: 'r1', agentId: null, kind: 'review' },
          findings: [{ file: 'src/gone.ts', startLine: 3 }],
        },
      ]),
    ).build(WORKSPACE, PR, {
      debug: (payload, message) => logged.push({ payload, message }),
    });

    expect(result.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.payload).toMatchObject({ prId: PR, unmatched: 1 });
  });

  it('works with no logger at all', async () => {
    await expect(serviceWith(fullStore()).build(WORKSPACE, PR)).resolves.toBeDefined();
  });
});

describe('SmartDiffService — it cannot call a model', () => {
  /**
   * The structural half of the "no new LLM call" acceptance criterion, and the
   * half that survives refactoring: `test/smart-diff.it.test.ts` proves no call
   * was RECORDED on a real request, while this proves the service has no way to
   * make one.
   *
   * The Proxy throws on every dependency except `reviewRepo`, so any future
   * `deps.llm(...)`, `deps.github()` or `deps.jobs.enqueue(...)` fails here — at
   * the moment it is written, rather than on a bill.
   */
  it('touches no dependency other than the review repository', async () => {
    const reached: string[] = [];
    const deps: SmartDiffDeps = new Proxy({ reviewRepo: store(fullStore()) }, {
      get(target, prop, receiver) {
        if (prop !== 'reviewRepo') {
          reached.push(String(prop));
          throw new Error(`smart-diff reached for a dependency it must not have: ${String(prop)}`);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await new SmartDiffService(deps).build(WORKSPACE, PR);
    expect(reached).toEqual([]);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('reads each table exactly once per request', async () => {
    // No retry loop, no per-file query: the whole response comes from three reads.
    const calls: string[] = [];
    const service = new SmartDiffService({
      reviewRepo: {
        getPull: async () => {
          calls.push('getPull');
          return { id: PR };
        },
        getPrFiles: async () => {
          calls.push('getPrFiles');
          return FILES;
        },
        reviewsForPull: async () => {
          calls.push('reviewsForPull');
          return [];
        },
      },
    });

    await service.build(WORKSPACE, PR);
    expect(calls.sort()).toEqual(['getPrFiles', 'getPull', 'reviewsForPull']);
  });
});
