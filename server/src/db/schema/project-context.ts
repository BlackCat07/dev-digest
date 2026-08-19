/**
 * Project Context — which repository documents an owner sends with a review.
 *
 * TWO tables rather than one polymorphic `owner_kind`/`owner_id` table, because
 * a polymorphic owner column cannot carry a foreign key: deleting a skill would
 * leave orphan rows that every effective-set query would then have to filter out
 * by hand. With a real FK per owner, `ON DELETE CASCADE` removes a deleted
 * skill's documents from every inheriting agent's effective set in one step, and
 * the database — not the application — is what guarantees it. The cost is that a
 * count across both owners is a two-branch query; that is the cheaper half.
 *
 * PATHS ARE STORED, TEXT NEVER IS. A row names a repository and a repo-relative
 * path, so a run reads whatever the clone holds at that moment. That is why
 * `repo_id` is part of the identity and not a convenience column: one owner may
 * hold a different set per repository, and a run only ever sees the set matching
 * the pull request's repository.
 *
 * Shape mirrors `agent_skills` in ./agents deliberately — composite primary key,
 * `order` as a plain integer assigned by the writer, no surrogate id and no
 * timestamp. The replace-all write (delete-then-insert in one transaction,
 * `order = index`) is the same move `AgentsRepository.setSkills` already makes,
 * and keeping the shapes identical keeps that precedent readable.
 *
 * Relative imports here are EXTENSIONLESS on purpose: `src/db/schema/**` is
 * loaded by drizzle-kit, not by the ESM server, and is the named exception to
 * this package's `.js`-extension rule.
 */
import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';
import { repos } from './repos';

/**
 * Documents attached directly to an agent.
 *
 * PK `(agent_id, repo_id, path)` is the "unique per (owner, repository, path)"
 * rule: the same document may hang off many agents, and off any one agent
 * exactly once per repository. The leading `agent_id` also serves every "read
 * this agent's attachments" lookup, so no separate index is needed for it.
 *
 * `repo_id` gets an index of its own because Postgres does NOT auto-index a
 * foreign-key column, and this one is both a join key (the per-document
 * `used_by_agents` count groups across this table and `skill_context_docs`) and
 * the column a cascading `repos` delete has to scan.
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative to that repository's clone root, e.g. `specs/api.md`. */
    path: text('path').notNull(),
    /** Position within this owner's set for this repository; writer-assigned. */
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    repoIdx: index('agent_context_docs_repo_idx').on(t.repoId),
  }),
);

/**
 * Documents attached to a skill, inherited by every agent the skill is linked
 * to. Identical to `agent_context_docs` but for the owner FK.
 *
 * Both `repo_id` and `skill_id` carry an explicit index for the reason above —
 * neither is auto-indexed by its foreign key, and both are read as join keys by
 * the effective-set and `used_by_agents` queries, which reach this table through
 * `agent_skills` rather than through the primary key.
 */
export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative to that repository's clone root. */
    path: text('path').notNull(),
    /** Position within this skill's set for this repository; writer-assigned. */
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoIdx: index('skill_context_docs_repo_idx').on(t.repoId),
    skillIdx: index('skill_context_docs_skill_idx').on(t.skillId),
  }),
);
