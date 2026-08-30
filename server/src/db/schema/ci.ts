import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Exporting the same agent to the same repository twice is an UPDATE, not a
    // second row — and an `ON CONFLICT` target has to be a UNIQUE index. Not a
    // partial one: a partial index cannot serve as a conflict target at all.
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    /**
     * GitHub's workflow-run id — a 64-bit integer, so `bigint`, not `integer`
     * and not a uuid. With `ci_installation_id` it is the idempotency key: the
     * same run read twice leaves one row.
     */
    workflowRunId: bigint('workflow_run_id', { mode: 'number' }).notNull(),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    /** Head commit reviewed — read from the workflow run, never from the artifact. */
    headSha: text('head_sha'),
    /**
     * Repository and agent name, denormalised on purpose: `ci_installation_id`
     * is ON DELETE SET NULL and `ci_installations.agent_id` cascades from
     * `agents`, so a deleted agent would otherwise take a run's provenance with
     * it and leave unreadable history behind.
     */
    repo: text('repo'),
    agent: text('agent'),
    /** Findings that tripped the agent's gate (severity >= its `ci_fail_on`). */
    blockers: integer('blockers'),
    durationS: doublePrecision('duration_s'),
    /**
     * Why this run carries no result — `artifact_missing`, `artifact_unreadable`,
     * `result_file_missing`, `result_unparseable`. null on a run whose result was
     * read. An unreadable artifact is still ONE row with a named reason: dropping
     * it would report a run that happened as a run that did not.
     */
    reason: text('reason'),
    /** The `agent_runs` row this CI run produced (`source = 'ci'`, `pr_id` null). */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // Idempotency: reading the same workflow run twice upserts on this.
    installationRunUq: uniqueIndex('ci_runs_installation_run_uq').on(
      t.ciInstallationId,
      t.workflowRunId,
    ),
    // PostgreSQL does not auto-index FK columns, and this one is both the join
    // key of the workspace-scoped list and the "latest run per installation" key.
    installationIdx: index('ci_runs_installation_idx').on(t.ciInstallationId),
    // The CI Runs list needs a TOTAL order: `ran_at` alone ties, and an UPDATE
    // writes a new tuple version elsewhere in the heap, so a tied row moves.
    ranAtIdx: index('ci_runs_ran_at_idx').on(t.ranAt.desc(), t.id.desc()),
  }),
);
