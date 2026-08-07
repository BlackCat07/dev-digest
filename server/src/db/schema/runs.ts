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

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
