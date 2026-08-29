import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  CiAgentRunWrite,
  CiRunWrite,
  CiStore,
  StoredCiInstallation,
  StoredCiInstallationWithRun,
  StoredCiRun,
} from './types.js';

/**
 * Data access for Export-to-CI. The ONLY file in this module that names
 * `db/schema` or `drizzle-orm`; everything above it sees {@link CiStore}, which —
 * like every port and row view this module declares — lives in `types.ts`.
 *
 * Four things it is arranged to guarantee.
 *
 *  - **The workspace scope runs through `agents`.** `ci_installations` and
 *    `ci_runs` carry no `workspace_id` of their own; the path is
 *    `ci_runs → ci_installations → agents.workspace_id`, and `agents.workspaceId`
 *    is `NOT NULL`. Every read below joins it, so there is no way to reach a run
 *    by id alone.
 *  - **The run list joins INNER, and the installation list joins LEFT.** They look
 *    symmetric and are not. `ci_runs.ci_installation_id` is `ON DELETE SET NULL`,
 *    so an orphaned run has no workspace to belong to and must appear in nobody's
 *    list — inner. An installation that has never run is the ordinary first state
 *    of every export and is exactly what the CI tab is open to show — left.
 *  - **The latest run per installation is `DISTINCT ON`, not `GROUP BY`.** A
 *    `GROUP BY` can return the max timestamp but not the row that carries it, and
 *    the tab renders the row's status. `id desc` breaks a `ran_at` tie, so two
 *    runs recorded in the same millisecond do not pick a winner in heap order.
 *  - **One read-back is ONE transaction.** {@link CiRepository.recordRun} writes
 *    the `agent_runs` row and the `ci_runs` row together or not at all, and reads
 *    the existing `ci_runs` row first so the second read of the same workflow run
 *    updates one row of each rather than inserting a second (AC-26). Two
 *    sequential awaits from the service would be a two-statement transaction with
 *    no transaction, and the failure only shows when the second one throws.
 */
export class CiRepository implements CiStore {
  constructor(private db: Db) {}

  /**
   * Exporting the same agent to the same repository is an UPDATE, not a second
   * row (AC-17). The conflict target is the `(agent_id, repo)` unique index —
   * `ON CONFLICT` needs a real unique index and a partial one cannot serve.
   */
  async upsertInstallation(input: {
    agentId: string;
    repo: string;
    targetType: StoredCiInstallation['targetType'];
    installedAt: Date;
  }): Promise<StoredCiInstallation> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
        installedAt: input.installedAt,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: { targetType: input.targetType, installedAt: input.installedAt },
      })
      .returning({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
      });
    if (row === undefined) {
      throw new Error('ci_installations upsert returned no row');
    }
    return row;
  }

  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<StoredCiInstallationWithRun[]> {
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
        agentName: t.agents.name,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(asc(t.ciInstallations.repo), asc(t.ciInstallations.id));
    return this.withLatestRun(rows);
  }

  async listInstallationsForWorkspace(
    workspaceId: string,
    limit: number,
  ): Promise<StoredCiInstallationWithRun[]> {
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
        agentName: t.agents.name,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciInstallations.installedAt), desc(t.ciInstallations.id))
      .limit(limit);
    return this.withLatestRun(rows);
  }

  async listRuns(workspaceId: string, limit: number): Promise<StoredCiRun[]> {
    return this.db
      .select(RUN_COLUMNS)
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      // A TOTAL order. `ran_at` alone ties, and an UPDATE writes a new tuple
      // version elsewhere in the heap — so a tied row that was just refreshed
      // slides down the list under the reader.
      .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
      .limit(limit);
  }

  async recordRun(run: CiRunWrite, agentRun: CiAgentRunWrite | null): Promise<StoredCiRun> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: t.ciRuns.id, agentRunId: t.ciRuns.agentRunId })
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, run.ciInstallationId),
            eq(t.ciRuns.workflowRunId, run.workflowRunId),
          ),
        );

      let agentRunId: string | null = existing?.agentRunId ?? null;

      if (agentRun !== null) {
        const values = {
          workspaceId: agentRun.workspaceId,
          agentId: agentRun.agentId,
          // `source: 'ci'` and `pr_id: null` are this repository's to set, not the
          // caller's: the pull request lives in a repository the studio may never
          // have imported, and a non-null `pr_id` would fold a CI run into every
          // PR-feed aggregate.
          source: 'ci' as const,
          prId: null,
          ranAt: agentRun.ranAt ?? new Date(),
          provider: agentRun.provider,
          model: agentRun.model,
          durationMs: agentRun.durationMs,
          costUsd: agentRun.costUsd,
          status: agentRun.status,
          error: agentRun.error,
          findingsCount: agentRun.findingsCount,
          blockers: agentRun.blockers,
        };
        if (agentRunId === null) {
          const [inserted] = await tx
            .insert(t.agentRuns)
            .values(values)
            .returning({ id: t.agentRuns.id });
          if (inserted === undefined) throw new Error('agent_runs insert returned no row');
          agentRunId = inserted.id;
        } else {
          await tx.update(t.agentRuns).set(values).where(eq(t.agentRuns.id, agentRunId));
        }
      }

      const row = { ...run, agentRunId };
      const [stored] = await tx
        .insert(t.ciRuns)
        .values(row)
        .onConflictDoUpdate({
          target: [t.ciRuns.ciInstallationId, t.ciRuns.workflowRunId],
          set: {
            /**
             * `pr_number` is written only when GitHub still reports one.
             *
             * `workflow_run.pull_requests` is populated ONLY while the pull
             * request is open and from this repository; the moment it is merged
             * or closed GitHub returns an empty array, so the next refresh cycle
             * carries `prNumber: null` for a run that plainly had one. Setting it
             * unconditionally overwrote the stored number with null and blanked
             * the CI Runs screen's "Pull request" column for exactly the runs a
             * reader goes there to find — the historical, already-merged ones.
             *
             * Not a relaxation of AC-23. Provenance still comes from the workflow
             * run and never from the artifact; this only declines to unlearn a
             * value GitHub has stopped repeating. A run never changes which pull
             * request it belongs to, so there is no case where null is the newer
             * truth.
             */
            ...(row.prNumber === null ? {} : { prNumber: row.prNumber }),
            ranAt: row.ranAt,
            status: row.status,
            findingsCount: row.findingsCount,
            costUsd: row.costUsd,
            githubUrl: row.githubUrl,
            headSha: row.headSha,
            repo: row.repo,
            source: row.source,
            agent: row.agent,
            blockers: row.blockers,
            durationS: row.durationS,
            reason: row.reason,
            agentRunId: row.agentRunId,
          },
        })
        .returning(RUN_COLUMNS);
      if (stored === undefined) throw new Error('ci_runs upsert returned no row');
      return stored;
    });
  }

  /**
   * Attach each installation's most recent run.
   *
   * `DISTINCT ON (ci_installation_id) … ORDER BY ci_installation_id, ran_at DESC,
   * id DESC` — the one shape that returns a per-group LATEST ROW in SQL, which a
   * `GROUP BY` cannot do. The `Map` lookup is the LEFT half of the join: an
   * installation with no run gets `undefined` and reads back as `null`, rather
   * than disappearing the way an inner join would drop it.
   */
  private async withLatestRun(
    rows: {
      id: string;
      agentId: string;
      repo: string;
      targetType: StoredCiInstallation['targetType'];
      installedAt: Date;
      agentName: string | null;
    }[],
  ): Promise<StoredCiInstallationWithRun[]> {
    if (rows.length === 0) return [];
    const latest = await this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId], {
        ciInstallationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .where(
        inArray(
          t.ciRuns.ciInstallationId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(t.ciRuns.ciInstallationId), desc(t.ciRuns.ranAt), desc(t.ciRuns.id));

    const byInstallation = new Map(
      latest.flatMap((r) =>
        r.ciInstallationId === null
          ? []
          : [[r.ciInstallationId, { status: r.status, ranAt: r.ranAt }] as const],
      ),
    );

    return rows.map((row) => {
      const run = byInstallation.get(row.id);
      return {
        ...row,
        lastRunStatus: run?.status ?? null,
        lastRunAt: run?.ranAt ?? null,
      };
    });
  }
}

/** The `ci_runs` columns every read returns, named once so two reads cannot drift. */
const RUN_COLUMNS = {
  id: t.ciRuns.id,
  ciInstallationId: t.ciRuns.ciInstallationId,
  workflowRunId: t.ciRuns.workflowRunId,
  prNumber: t.ciRuns.prNumber,
  ranAt: t.ciRuns.ranAt,
  status: t.ciRuns.status,
  findingsCount: t.ciRuns.findingsCount,
  costUsd: t.ciRuns.costUsd,
  githubUrl: t.ciRuns.githubUrl,
  source: t.ciRuns.source,
  headSha: t.ciRuns.headSha,
  repo: t.ciRuns.repo,
  agent: t.ciRuns.agent,
  blockers: t.ciRuns.blockers,
  durationS: t.ciRuns.durationS,
  reason: t.ciRuns.reason,
};
