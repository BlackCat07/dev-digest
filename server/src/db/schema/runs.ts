import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    /**
     * The multi-agent run this run was created by, or null when it belongs to
     * none — a single-agent run has no parent, and every run made before this
     * column existed has none either. `set null` rather than `cascade` because
     * the parent cascades away with its pull request while the run row outlives
     * it, exactly as `pr_id` and `agent_id` already do.
     */
    multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
      onDelete: 'set null',
    }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /**
     * USD cost of the run. Prefers the provider's real billed figure (OpenRouter's
     * `usage.cost`), falling back to tokens × the price catalog. null = no cost
     * data at all; 0 = a genuinely free model. Never conflate the two.
     */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
  },
  (t) => ({
    // Both PR-scoped reads filter pr_id and order by ran_at desc: the PR list's
    // COST aggregate (pr_id IN (…) AND status='done') and `listRunsForPull`.
    prRanIdx: index('agent_runs_pr_ran_idx').on(t.prId, t.ranAt.desc()),
    // agent_id is ON DELETE SET NULL, so deleting an agent rewrites matching rows;
    // it is also the leftJoin key for the agent name in the run history.
    agentIdx: index('agent_runs_agent_idx').on(t.agentId),
    // Partial: 'running' rows are a handful at a time out of every run ever made.
    // Serves activeRunsForPull and the boot-time reaper, which scan for exactly this.
    runningIdx: index('agent_runs_running_idx')
      .on(t.workspaceId, t.prId)
      .where(sql`${t.status} = 'running'`),
    // Postgres does not auto-index a foreign-key column. The multi-run read's
    // whole query is `where multi_agent_run_id = :id`, and `set null` on delete
    // rewrites every matching row, so both paths want this index.
    multiAgentRunIdx: index('agent_runs_multi_agent_run_idx').on(t.multiAgentRunId),
  }),
);

/**
 * Which skills actually reached the prompt of a given run, and in which order.
 *
 * `agent_skills` records what an agent is *configured* with today; this records
 * what a run *carried*. The two diverge constantly — a skill can be linked but
 * disabled, toggled off mid-week, or attached after the run — so every per-skill
 * statistic (pull frequency, accept rate, findings) must read this table rather
 * than joining runs to the current link set, which would silently backdate a
 * link onto runs that never saw the skill.
 *
 * `version` is the skill version whose body was used, so a stat stays attached to
 * the exact text that produced it even after the body is edited.
 */
export const runSkills = pgTable(
  'run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.skillId] }),
    // Every stats query starts "all runs that carried skill X"; the composite PK
    // is prefixed by run_id and so cannot serve it.
    skillIdx: index('run_skills_skill_idx').on(t.skillId),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable(
  'multi_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    /**
     * The one structured synthesis output for this multi-run: a sentence per
     * (contended location, agent) pair, and a short label per contended
     * location. Written exactly once, when every run of the set has reached a
     * terminal status; read back on every subsequent read so no second model
     * call is ever made.
     *
     * Shape — deliberately two flat arrays rather than a nested document, so a
     * missing note and a missing label degrade independently:
     *
     * ```
     * {
     *   notes:  [{ file: string, line: number, agent_id: string, note: string }],
     *   labels: [{ file: string, line: number, label: string }]
     * }
     * ```
     *
     * `(file, line)` is the group key and matches a group's file and its lowest
     * `start_line`. `agent_id` is the agent key the grouping uses, so a run with
     * a deleted agent is keyed by its prefixed run id rather than by null.
     *
     * null — the common state — means "not synthesised": not yet, failed,
     * timed out, or unparseable. It is not an error condition. It renders as
     * every stance carrying an empty note and every group title falling back to
     * the deterministic rule (the highest-severity finding's title). Groups are
     * derived on read and are never stored here; only what cost a model call is.
     *
     * Untyped on purpose: it is a boundary, and the reader parses it rather
     * than trusting a `$type<>` cast over whatever the column happens to hold.
     */
    notes: jsonb('notes'),
  },
  (t) => ({
    // The only access path there is: the most recent multi-run of one pull
    // request. `ran_at` descending is the ordering the read asks for.
    prRanIdx: index('multi_agent_runs_pr_ran_idx').on(t.prId, t.ranAt.desc()),
  }),
);
