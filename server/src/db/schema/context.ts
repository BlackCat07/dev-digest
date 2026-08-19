import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
// Type-only: erased before drizzle-kit's bundler ever resolves it, so the
// `@devdigest/shared` path alias never has to survive migration generation.
import type { OnboardingTourSection } from '@devdigest/shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

/**
 * `onboarding` — the single stored onboarding tour per repository (L05).
 *
 * Shape follows `pr_intent` (`reviews.ts`): parent-keyed PK, `jsonb` for the
 * payload arrays, and REAL columns for everything a screen or a log line reads
 * without opening the payload — state, status, provenance and the model's price.
 *
 *  - **No index.** `repo_id` is the PRIMARY KEY, so the FK column already
 *    carries a unique B-tree, and every read of this table is by that key.
 *  - **`never_generated` is the ABSENCE of a row**, not a `state` value.
 *  - `text(..., { enum: [...] })` emits a PLAIN `text` column: drizzle
 *    generates no CHECK constraint from it and the enum is TypeScript-level
 *    only. Do not hand-add a CHECK to the generated SQL.
 *  - Every column added after `0000_init.sql` is nullable or carries a
 *    NON-VOLATILE default, so the `ALTER TABLE` does not rewrite the table.
 */
export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  /**
   * The tour body: the ordered sections, and nothing the columns below already
   * carry. `$type` is a CAST, not a parse — the repository still `safeParse`s
   * this value against `OnboardingTour` on the way out, because a jsonb written
   * before a field existed reads back with the key ABSENT rather than null.
   */
  json: jsonb('json').$type<{ sections: OnboardingTourSection[] }>().notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Generation lifecycle. Read by the read path to answer `running`. */
  state: text('state', { enum: ['running', 'ready'] })
    .notNull()
    .default('ready'),
  /** Honesty of the stored tour; served as `OnboardingTour.status`. */
  status: text('status', { enum: ['ok', 'partial', 'degraded'] })
    .notNull()
    .default('degraded'),
  /**
   * Why the tour is not `ok`. Deliberately NOT a DB enum: `OnboardingReason` is
   * the authority and validates on the way out, and a DB enum would need its own
   * migration every time a reason is added.
   */
  reason: text('reason'),
  /** Index commit the generation ran against; the read path derives `stale` from it. */
  indexedSha: text('indexed_sha'),
  /** Index coverage at generation time; the screen's "generated from N files" caption. */
  filesIndexed: integer('files_indexed').notNull().default(0),
  filesSkipped: integer('files_skipped').notNull().default(0),
  /** The model that wrote the tour, served with it and emitted in the log line. */
  provider: text('provider'),
  model: text('model'),
  /** Provider round-trips the one structured call took. Nothing else here records it. */
  attempts: integer('attempts'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD. Null = no price is known for the model — NOT the same as a free call (0). */
  costUsd: doublePrecision('cost_usd'),
  /** When the current generation started; the staleness window for a dead worker reads it. */
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** Free-text failure message; `reason` is the machine-readable half. */
  error: text('error'),
});
