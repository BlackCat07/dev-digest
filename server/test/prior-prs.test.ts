import { describe, it, expect } from 'vitest';
import { PrPriorPrs } from '@devdigest/shared';
import { PriorPrsService } from '../src/modules/prior-prs/service.js';
import { MAX_PRIOR_PRS, MAX_SHARED_FILES } from '../src/modules/prior-prs/constants.js';
import { NotFoundError } from '../src/platform/errors.js';
import type {
  PriorPrsDeps,
  PriorPrsOverlapRow,
  PriorPrsStore,
} from '../src/modules/prior-prs/types.js';

/**
 * L04 — the service behind `GET /pulls/:id/prior-prs`.
 *
 * Hermetic by construction: no Postgres, no queue, no provider. Same fixture shape
 * as `blast-service.test.ts` — every unstubbed store method THROWS rather than
 * returning an empty value, so a future edit that reads history before the
 * workspace check fails here instead of silently succeeding.
 *
 * What the cases below are actually for:
 *
 *  - **The workspace check is the FIRST await.** `pr_files` carries no
 *    `workspace_id`, so a PR from another workspace must 404 before any history is
 *    read. The throwing fixture proves the order.
 *  - **`PrPriorPrs.parse` on the assembled object**, because no route here declares
 *    a `response:` schema and a cast-not-parsed response has reached a client as
 *    `$NaN` in this codebase before (`server/INSIGHTS.md`, 2026-08-02).
 *  - **The order is asserted over a SHUFFLED fixture.** `Array.prototype.sort` is
 *    stable, so a list fed in the intended order comes back in it with every
 *    tiebreaker deleted — the mistake `mcp-server/INSIGHTS.md` (2026-08-13) records.
 *  - **Every empty answer states why.** Four different empties — no changed files,
 *    a repository with one PR, no imported file lists, some imported — must arrive
 *    with four different `status`/`reason` pairs. That distinction IS the feature.
 */

const WORKSPACE = 'ws-1';
const PR = 'pr-1';
const REPO = 'repo-1';

const HELPER = 'src/lib/helpers.ts';
const ROUTES = 'src/modules/agents/routes.ts';
const README = 'README.md';

/** A store whose every method throws until a case opts in to it. */
function store(over: Partial<PriorPrsStore> = {}): PriorPrsStore {
  return {
    getPull: () => {
      throw new Error('getPull was not stubbed for this case');
    },
    getPrFiles: () => {
      throw new Error('getPrFiles must not be reached in this case');
    },
    listPriorPrOverlaps: () => {
      throw new Error('listPriorPrOverlaps must not be reached in this case');
    },
    countPullCoverage: () => {
      throw new Error('countPullCoverage must not be reached in this case');
    },
    ...over,
  };
}

/**
 * Deps behind a `Proxy` that throws on any key other than the ONE port
 * `PriorPrsDeps` declares.
 *
 * The "no model, no index, no clone" claim, enforced rather than asserted in prose:
 * reading `deps.llm`, `deps.repoIntel` or `deps.git` from the service is a test
 * failure, so the property cannot decay into "does not happen to, today".
 */
function deps(reviewRepo: PriorPrsStore): PriorPrsDeps {
  const target: PriorPrsDeps = { reviewRepo };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop !== 'reviewRepo') {
        throw new Error(`PriorPrsService reached for a port it must not have: ${prop}`);
      }
      return t[prop as keyof PriorPrsDeps];
    },
  });
}

/** The pull request under review, always present and always in the workspace. */
function pull() {
  return { id: PR, repoId: REPO };
}

function overlap(
  number: number,
  path: string,
  updatedAt: Date | null,
  over: Partial<PriorPrsOverlapRow> = {},
): PriorPrsOverlapRow {
  return {
    id: `pr-${number}`,
    number,
    title: `PR ${number}`,
    author: 'octocat',
    updatedAt,
    openedAt: null,
    path,
    ...over,
  };
}

/** A store wired for the happy path: two changed files, full coverage. */
function historyStore(
  overlaps: readonly PriorPrsOverlapRow[],
  coverage = { total: 4, withFileLists: 4 },
  files: readonly string[] = [HELPER, ROUTES],
): PriorPrsStore {
  return store({
    getPull: async () => pull(),
    getPrFiles: async () => files.map((path) => ({ path })),
    listPriorPrOverlaps: async () => overlaps,
    countPullCoverage: async () => coverage,
  });
}

function service(s: PriorPrsStore): PriorPrsService {
  return new PriorPrsService(deps(s));
}

describe('PriorPrsService', () => {
  it('404s for a pull request outside the workspace, before reading any history', async () => {
    const svc = service(store({ getPull: async () => undefined }));
    await expect(svc.build(WORKSPACE, PR)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('groups the overlap per pull request and answers the published contract', async () => {
    const svc = service(
      historyStore([
        overlap(15, HELPER, new Date('2026-08-04T00:00:00Z')),
        overlap(15, ROUTES, new Date('2026-08-04T00:00:00Z')),
        overlap(12, HELPER, new Date('2026-07-01T00:00:00Z')),
      ]),
    );

    const answer = await svc.build(WORKSPACE, PR);
    expect(() => PrPriorPrs.parse(answer)).not.toThrow();

    expect(answer.prs).toHaveLength(2);
    expect(answer.total).toBe(2);
    expect(answer.truncated).toBe(false);
    expect(answer.status).toBe('ok');
    expect(answer.reason).toBeNull();

    const [first] = answer.prs;
    expect(first?.number).toBe(15);
    expect(first?.shared_files).toEqual([HELPER, ROUTES].sort());
    expect(first?.shared_file_count).toBe(2);
    expect(first?.updated_at).toBe('2026-08-04T00:00:00.000Z');
  });

  it('orders newest first over a SHUFFLED fixture, and breaks ties by number', async () => {
    const tie = new Date('2026-08-01T00:00:00Z');
    const unordered = [
      overlap(7, HELPER, new Date('2026-06-01T00:00:00Z')),
      overlap(21, HELPER, tie),
      overlap(30, HELPER, new Date('2026-08-09T00:00:00Z')),
      overlap(22, HELPER, tie),
      // No timestamp at all: sorts last rather than crashing or sorting first.
      overlap(9, HELPER, null),
    ];

    const answer = await service(historyStore(unordered)).build(WORKSPACE, PR);

    expect(answer.prs.map((p) => p.number)).toEqual([30, 22, 21, 7, 9]);
  });

  it('caps the list, and reports the pre-cap total', async () => {
    const many = Array.from({ length: MAX_PRIOR_PRS + 3 }, (_, i) =>
      overlap(100 + i, HELPER, new Date(Date.UTC(2026, 0, i + 1))),
    );

    const answer = await service(historyStore(many)).build(WORKSPACE, PR);

    expect(answer.prs).toHaveLength(MAX_PRIOR_PRS);
    expect(answer.total).toBe(MAX_PRIOR_PRS + 3);
    expect(answer.truncated).toBe(true);
  });

  it('caps a row\'s shared files while still reporting the whole overlap', async () => {
    const paths = Array.from({ length: MAX_SHARED_FILES + 2 }, (_, i) => `src/f${i}.ts`);
    const rows = paths.map((path) => overlap(42, path, new Date('2026-08-01T00:00:00Z')));

    const answer = await service(historyStore(rows, undefined, paths)).build(WORKSPACE, PR);

    const [row] = answer.prs;
    expect(row?.shared_files).toHaveLength(MAX_SHARED_FILES);
    expect(row?.shared_file_count).toBe(paths.length);
    // The cap keeps the same five every time, not whichever five the join emitted.
    expect(row?.shared_files).toEqual(paths.slice().sort().slice(0, MAX_SHARED_FILES));
  });

  describe('an empty list always says which empty it is', () => {
    it('degrades when this pull request has no imported file list', async () => {
      const svc = service(
        store({
          getPull: async () => pull(),
          getPrFiles: async () => [],
          countPullCoverage: async () => ({ total: 6, withFileLists: 5 }),
          // listPriorPrOverlaps still throws: there is nothing to compare, so it
          // must not be called with an empty path set.
        }),
      );

      const answer = await svc.build(WORKSPACE, PR);
      expect(answer.status).toBe('degraded');
      expect(answer.reason).toBe('no_changed_files');
      expect(answer.prs).toEqual([]);
    });

    it('states plainly that a repository with one pull request has no prior work', async () => {
      const answer = await service(historyStore([], { total: 1, withFileLists: 1 })).build(
        WORKSPACE,
        PR,
      );

      expect(answer.status).toBe('ok');
      expect(answer.reason).toBeNull();
      expect(answer.coverage).toEqual({ with_file_lists: 1, total: 1 });
    });

    it('degrades when no OTHER pull request has an imported file list', async () => {
      const answer = await service(historyStore([], { total: 9, withFileLists: 1 })).build(
        WORKSPACE,
        PR,
      );

      expect(answer.status).toBe('degraded');
      expect(answer.reason).toBe('no_file_lists');
    });

    it('reports partial coverage when only some file lists were imported', async () => {
      const answer = await service(
        historyStore([overlap(3, HELPER, new Date('2026-05-01T00:00:00Z'))], {
          total: 9,
          withFileLists: 4,
        }),
      ).build(WORKSPACE, PR);

      expect(answer.status).toBe('partial');
      expect(answer.reason).toBe('incomplete_file_lists');
      // Partial is a caveat over REAL data, not an empty answer.
      expect(answer.prs).toHaveLength(1);
    });
  });

  it('searches the changed files it was given, deduplicated and sorted', async () => {
    let asked: readonly string[] = [];
    const svc = service(
      store({
        getPull: async () => pull(),
        getPrFiles: async () => [{ path: ROUTES }, { path: HELPER }, { path: ROUTES }],
        countPullCoverage: async () => ({ total: 3, withFileLists: 3 }),
        listPriorPrOverlaps: async (_repoId, _prId, paths) => {
          asked = paths;
          return [];
        },
      }),
    );

    await svc.build(WORKSPACE, PR);

    expect(asked).toEqual([HELPER, ROUTES]);
  });

  it('passes the repository from the workspace-scoped row, not from the request', async () => {
    let scopedTo: string | null = null;
    const svc = service(
      store({
        getPull: async () => ({ id: PR, repoId: REPO }),
        getPrFiles: async () => [{ path: README }],
        countPullCoverage: async () => ({ total: 2, withFileLists: 2 }),
        listPriorPrOverlaps: async (repoId) => {
          scopedTo = repoId;
          return [];
        },
      }),
    );

    await svc.build(WORKSPACE, PR);

    expect(scopedTo).toBe(REPO);
  });
});
