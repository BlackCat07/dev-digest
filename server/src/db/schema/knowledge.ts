import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One extraction run over one repo (L02).
 *
 * Rows are NEVER deleted on re-scan. A candidate points at the scan that
 * produced it, and the screen's "last scan" line reads the newest row — so
 * keeping the history is what lets `dropped_unverified` / `dropped_low_adherence`
 * be compared across runs after a threshold or prompt change. Without that
 * comparison there is no way to tell a better extractor from a quieter one.
 *
 * `status = 'partial'` means the scan FINISHED but the sample was capped by the
 * budget — the same distinction `repo_index_state.status` draws, and not a
 * failure.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['queued', 'running', 'done', 'partial', 'failed'],
    })
      .notNull()
      .default('queued'),
    /** The commit the clone sat at; evidence lines and GitHub links pin to it. */
    commitSha: text('commit_sha'),
    /** The `ConventionScanOptions` this run was started with, verbatim. */
    options: jsonb('options').notNull().default({}),
    eligibleFiles: integer('eligible_files').notNull().default(0),
    sampledFiles: integer('sampled_files').notNull().default(0),
    proposed: integer('proposed').notNull().default(0),
    droppedUnverified: integer('dropped_unverified').notNull().default(0),
    droppedLowAdherence: integer('dropped_low_adherence').notNull().default(0),
    kept: integer('kept').notNull().default(0),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId, t.startedAt) }),
);

/**
 * Extracted convention candidates (L02) — the triage queue behind the
 * Conventions screen.
 *
 * Reshaped from the placeholder this file shipped with, while the table was
 * still empty and read by nothing:
 *
 *  - `evidence_path` + `evidence_snippet` (exactly ONE citation) became
 *    `evidence`, a jsonb ARRAY of verified citations. A rule backed by three
 *    places in the repo is a stronger rule than one backed by one, and two
 *    singular columns cannot express that. Every entry in the array has been
 *    read back off the clone before it is written here — an unverified citation
 *    never reaches this table, it is counted in `convention_scans` instead.
 *  - `accepted` boolean became `status`, because a boolean cannot tell
 *    "rejected" apart from "not triaged yet", and this whole table is a triage
 *    queue where that difference is the point.
 *
 * `matcher` is the pattern the model supplied for finding VIOLATIONS of the
 * rule. Storing it means adherence can be recounted after the repo moves
 * without paying for another model call.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => conventionScans.id, { onDelete: 'cascade' }),
    category: text('category', {
      enum: [
        'naming',
        'structure',
        'error-handling',
        'api-contract',
        'testing',
        'imports',
        'async',
        'logging',
        'typing',
        'security',
      ],
    }).notNull(),
    rule: text('rule').notNull(),
    rationale: text('rationale').notNull().default(''),
    evidence: jsonb('evidence')
      .$type<
        Array<{
          path: string;
          start_line: number;
          end_line: number;
          snippet: string;
          match: 'exact' | 'shifted' | 'moved';
        }>
      >()
      .notNull(),
    /** Regex or ast-grep pattern matching a VIOLATION. Null when unmatchable. */
    matcher: text('matcher'),
    /** Null together with `adherenceViolating` when the rule is unmeasurable. */
    adherenceConforming: integer('adherence_conforming'),
    adherenceViolating: integer('adherence_violating'),
    /** 0..1, derived from adherence when it is present. Never model-reported. */
    confidence: doublePrecision('confidence').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    /** Set once a human edits the rule text, so a re-scan leaves it alone. */
    edited: boolean('edited').notNull().default(false),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => ({
    repoIdx: index('conventions_repo_status_idx').on(t.repoId, t.status),
    scanIdx: index('conventions_scan_idx').on(t.scanId),
  }),
);
