import { z } from 'zod';
import {
  ProjectDocType,
  type ContextAttachment,
  type ContextAttachmentInput,
  type ContextDocSource,
  type ProjectDoc,
  type ProjectDocList,
  type ProjectDocListStatus,
  type RepoRef,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import {
  DEFAULT_CONTEXT_ROOTS,
  EXCLUDED_DIR_NAMES,
  MAX_DIRECTORY_ENTRIES,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  RUN_TOKEN_BUDGET,
} from './constants.js';
import type {
  AttachmentRow,
  ContextDocSkip,
  ContextRepoRow,
  EffectiveAttachment,
  InheritedAttachmentRow,
  ProjectContext,
  ProjectContextDeps,
  ProjectDocContent,
  RunContextResolution,
} from './types.js';

/**
 * L05 — Project Context. Which markdown documents a repository carries, which
 * of them an agent or a skill sends with a review, and what a run actually read.
 *
 * Three claims this file is arranged to make provable rather than merely stated:
 *
 *  - **The list writes nothing and enqueues nothing** (AC-27). {@link ProjectContextDeps}
 *    declares two ports — a store and a confined document reader — and there is
 *    no job queue, no LLM and no embedder in reach, so "it makes no model call
 *    and starts no job" is a property of the signature, not a promise.
 *  - **The workspace lookup happens first** (AC-12). Every request-facing method
 *    opens with `getRepo` / `agentExists` / `skillExists` and throws
 *    `NotFoundError` before a single byte of the clone is touched. The
 *    attachment tables carry no `workspace_id` of their own, so that first read
 *    IS the authorization check.
 *  - **One counting rule** (AC-4). Every token figure in this feature comes from
 *    `approxTokens` — `ceil(characters / 4)` — including the one beside a row in
 *    the list. NOT `container.tokenizer`, which is the js-tiktoken counter used
 *    by the repo-map budget search: reaching for it would silently break the
 *    guarantee that the number shown before a run and the number shown after it
 *    are produced by the same rule as the client's own estimate.
 *
 * A note on cost, because it is a deliberate choice and not an oversight: the
 * list reads each document it reports. The walk itself opens no file — it stats
 * and returns bytes — but a token count derived from BYTES is wrong the moment a
 * document is not ASCII (EC-16), and AC-3 asks for characters. Documents over
 * {@link MAX_DOCUMENT_BYTES} are the one exception and are estimated from their
 * size, so a binary blob given a `.md` name cannot be pulled into memory.
 */

/** The shape a `context_roots` setting must have to be believed. */
const ContextRootsSetting = z.array(z.string().min(1)).min(1);

/**
 * Root directory name → the label the badge shows.
 *
 * Keyed off `ProjectDocType`'s own members rather than bare strings, so a change
 * to the contract's enum breaks this file at compile time instead of silently
 * relabelling every document as `other`.
 */
const DOC_TYPE_BY_ROOT_NAME: ReadonlyMap<string, ProjectDocType> = new Map([
  ['specs', ProjectDocType.enum.spec],
  ['docs', ProjectDocType.enum.doc],
  ['insights', ProjectDocType.enum.insight],
]);

/**
 * The filename that matches anywhere outside the excluded directories.
 *
 * Duplicated from the adapter's own rule on purpose: the adapter decides what to
 * LIST, this decides how to LABEL what came back. A document matched by this
 * rule outside every configured root has no root to be grouped under, so it
 * reports itself as its own group (AC-33 needs a label for every row).
 */
const ALWAYS_MATCHED_FILENAME = 'INSIGHTS.md';

export class ProjectContextService implements ProjectContext {
  constructor(private readonly deps: ProjectContextDeps) {}

  /**
   * Every markdown document in the repository's clone (AC-1 … AC-8, AC-11).
   *
   * Derived on every request: no row, no cache, no freshness rule. An empty
   * `docs` is never self-explanatory — a repository with no documents and a
   * repository with no clone both come back empty — so `status` and `reason`
   * always say which (AC-11).
   */
  async listDocs(workspaceId: string, repoId: string): Promise<ProjectDocList> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const roots = await this.resolveRoots(workspaceId);

    const walk = await this.deps.repoDocs.list(toRepoRef(repo), {
      roots,
      excludedDirs: EXCLUDED_DIR_NAMES,
      maxEntries: MAX_DIRECTORY_ENTRIES,
      limit: MAX_DOCUMENTS,
    });

    if (!walk.ok) {
      // AC-11: a missing clone is a state, not an error. HTTP 200, empty list,
      // and a reason naming what is missing.
      return { docs: [], roots, total: 0, truncated: false, status: 'unavailable', reason: walk.note };
    }

    const counts = await this.deps.store.countAgentsByPath(workspaceId, repoId);
    const docs: ProjectDoc[] = [];
    for (const entry of walk.docs) {
      const { root, doc_type } = classifyDoc(entry.path, roots);
      docs.push({
        path: entry.path,
        doc_type,
        root,
        size: entry.size,
        tokens: await this.tokensFor(repo, entry.path, entry.size),
        updated_at: entry.updatedAt ? entry.updatedAt.toISOString() : null,
        used_by_agents: counts.get(entry.path) ?? 0,
      });
    }

    const { status, reason } = coverageOf(walk.truncated, walk.entryBudgetExhausted, walk.total);
    return { docs, roots, total: walk.total, truncated: walk.truncated, status, reason };
  }

  /**
   * One document's full text, read path-confined (AC-9, AC-10).
   *
   * A refusal — a path that escapes the clone, a document deleted between the
   * list and the click — comes back as a 200 carrying the reason. It is never a
   * throw: a stale list is the ordinary case, not an exceptional one, and the
   * screen renders the explanation beside the list it came from.
   */
  async readDoc(
    workspaceId: string,
    repoId: string,
    docPath: string,
  ): Promise<ProjectDocContent> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const read = await this.deps.repoDocs.read(toRepoRef(repo), docPath);
    if (!read.ok) {
      return { path: docPath, content: null, size: null, updated_at: null, reason: read.note };
    }
    // `updated_at` is null rather than re-stat'ed: the mtime belongs to the list
    // entry, and this module has no filesystem of its own to ask.
    return {
      path: docPath,
      content: read.text,
      size: Buffer.byteLength(read.text, 'utf8'),
      updated_at: null,
      reason: null,
    };
  }

  /** This agent's attachments, across every repository it holds a set for. */
  async listAgentDocs(workspaceId: string, agentId: string): Promise<ContextAttachment[]> {
    if (!(await this.deps.store.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    return (await this.deps.store.listAgentAttachments(agentId)).map(toAttachment);
  }

  /**
   * Replace this agent's attachments for ONE repository (AC-13, AC-16).
   *
   * Replace-all, in one transaction, and no version is bumped and no version row
   * written — the same shape the existing agent-skills write already has, for
   * the same reason: an attachment set is a link table, not a configuration
   * snapshot.
   */
  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    input: ContextAttachmentInput,
  ): Promise<ContextAttachment[]> {
    if (!(await this.deps.store.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    await this.requireRepo(workspaceId, input.repo_id);
    await this.deps.store.setAgentAttachments(agentId, input.repo_id, dedupePaths(input.paths));
    return this.listAgentDocs(workspaceId, agentId);
  }

  /** This skill's attachments, across every repository it holds a set for. */
  async listSkillDocs(workspaceId: string, skillId: string): Promise<ContextAttachment[]> {
    if (!(await this.deps.store.skillExists(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
    return (await this.deps.store.listSkillAttachments(skillId)).map(toAttachment);
  }

  /** As {@link setAgentDocs}, for a skill (AC-15). */
  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    input: ContextAttachmentInput,
  ): Promise<ContextAttachment[]> {
    if (!(await this.deps.store.skillExists(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
    await this.requireRepo(workspaceId, input.repo_id);
    await this.deps.store.setSkillAttachments(skillId, input.repo_id, dedupePaths(input.paths));
    return this.listSkillDocs(workspaceId, skillId);
  }

  /**
   * The documents one run should carry, their text, and everything that was
   * left out with the reason why (AC-19, AC-21, AC-22, AC-23).
   *
   * Takes no `workspaceId`: the caller is the review executor, which has already
   * resolved the pull request through its own workspace scope, and the pull
   * request's repository IS the scope here — an attachment naming any other
   * repository is skipped and recorded by name (EC-8).
   *
   * Every failure below degrades rather than throws. A missing document, an
   * unreadable one, one refused by path confinement, one over the size cap and
   * one over the token budget all produce a skip entry and let the rest through,
   * because a project-context lookup that fails must not fail the review.
   */
  async resolveForRun(agentId: string, repoId: string): Promise<RunContextResolution> {
    const [own, inherited] = await Promise.all([
      this.deps.store.listAgentAttachments(agentId),
      this.deps.store.listInheritedAttachments(agentId),
    ]);

    const merged = mergeEffectiveAttachments(own, inherited, repoId);
    const skipped: ContextDocSkip[] = await this.describeForeign(merged.foreign);
    if (merged.effective.length === 0) return { texts: [], paths: [], skipped, tokens: 0 };

    const repo = await this.deps.store.getRepoById(repoId);
    if (!repo) {
      for (const doc of merged.effective) {
        skipped.push({ path: doc.path, reason: 'the repository could not be resolved' });
      }
      return { texts: [], paths: [], skipped, tokens: 0 };
    }

    const candidates: BudgetedDoc[] = [];
    for (const doc of merged.effective) {
      const read = await this.deps.repoDocs.read(toRepoRef(repo), doc.path);
      if (!read.ok) {
        skipped.push({ path: doc.path, reason: read.note });
        continue;
      }
      const bytes = Buffer.byteLength(read.text, 'utf8');
      if (bytes > MAX_DOCUMENT_BYTES) {
        skipped.push({
          path: doc.path,
          reason: `over the ${MAX_DOCUMENT_BYTES}-byte per-document size cap`,
        });
        continue;
      }
      candidates.push({ path: doc.path, text: read.text, tokens: approxTokens(read.text) });
    }

    const budgeted = applyTokenBudget(candidates, RUN_TOKEN_BUDGET);
    skipped.push(...budgeted.skipped);
    return {
      // Raw and UNWRAPPED. `assemblePrompt` wraps this slot itself, unlike the
      // `skills` slot, which the skills service wraps before handing it over —
      // wrapping here would double-wrap and make the block read to the model as
      // data about data (AC-18).
      texts: budgeted.kept.map((d) => d.text),
      paths: budgeted.kept.map((d) => d.path),
      skipped,
      tokens: budgeted.kept.reduce((sum, d) => sum + d.tokens, 0),
    };
  }

  /**
   * The repository, or `404 not_found` — the first read of every request-facing
   * method (AC-12).
   *
   * A repository id belonging to another workspace is indistinguishable from one
   * that does not exist, deliberately: the answer must not tell a caller that a
   * repository they cannot see is real.
   */
  private async requireRepo(workspaceId: string, repoId: string): Promise<ContextRepoRow> {
    const repo = await this.deps.store.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /**
   * The roots to search (AC-2).
   *
   * `context_roots` rides the `passthrough()` on the `Settings` contract rather
   * than being a `SettingsKnown` field, so nothing has ever validated it —
   * `safeParse`, never `parse`, and never a cast: a jsonb column holding a
   * string, a number or `{}` must fall back to the defaults rather than throw a
   * 500 out of a read-only list.
   */
  private async resolveRoots(workspaceId: string): Promise<string[]> {
    const raw = await this.deps.store.getContextRootsSetting(workspaceId);
    const parsed = ContextRootsSetting.safeParse(raw);
    return parsed.success ? parsed.data : [...DEFAULT_CONTEXT_ROOTS];
  }

  /**
   * A document's approximate token count.
   *
   * The one exception to reading the text: a document past the size cap is
   * estimated from its byte count instead, which over-states a multi-byte file
   * and is the safe direction for a figure a reader spends context against.
   */
  private async tokensFor(repo: ContextRepoRow, docPath: string, size: number): Promise<number> {
    if (size > MAX_DOCUMENT_BYTES) return Math.ceil(size / 4);
    const read = await this.deps.repoDocs.read(toRepoRef(repo), docPath);
    // A document that vanished between the walk and this read still belongs in
    // the list — the walk saw it — so fall back to the size estimate rather than
    // dropping the row.
    return read.ok ? approxTokens(read.text) : Math.ceil(size / 4);
  }

  /**
   * Name the repository each cross-repository attachment belongs to (AC-22).
   *
   * One query for the whole set rather than one per document, and a repository
   * that no longer exists still produces a skip line — with its id, which is
   * more use than silence.
   */
  private async describeForeign(
    foreign: readonly ForeignAttachment[],
  ): Promise<ContextDocSkip[]> {
    if (foreign.length === 0) return [];
    const names = await this.deps.store.repoNames([...new Set(foreign.map((f) => f.repoId))]);
    const byId = new Map(names.map((n) => [n.repoId, n.fullName]));
    return foreign.map((f) => ({
      path: f.path,
      reason: `attached to ${byId.get(f.repoId) ?? f.repoId}, not this pull request's repository`,
    }));
  }
}

/* ─── pure logic, exported so it can be tested without a database ─────────── */

/** One document that lost its place, and the repository it names instead. */
export interface ForeignAttachment {
  path: string;
  repoId: string;
}

/** The effective set, plus what fell outside it for being another repository's. */
export interface MergedAttachments {
  effective: EffectiveAttachment[];
  foreign: ForeignAttachment[];
}

/**
 * Merge an agent's own attachments with those of its skills, for one repository
 * (AC-19).
 *
 * The order is the requirement, stated once here: the agent's own in their
 * order, then each ENABLED skill's in skill-link order and, within a skill, in
 * that skill's attachment order — deduplicated by path with the first
 * occurrence winning. A document attached directly and through two skills
 * therefore appears once, at the agent's position, sourced to the agent.
 *
 * The `enabled` filter lives HERE rather than in the query on purpose. It is a
 * rule of the effective set, not of the storage, and keeping it in a pure
 * function is what lets "a disabled skill contributes nothing" be proved
 * without a database — which on this run is the only kind of test there is.
 *
 * Deduplication is by path and happens AFTER the repository filter, because a
 * path is only unique within a clone: the same `specs/api.md` in two
 * repositories is two different documents, and the one that does not belong to
 * the pull request is reported rather than silently dropped (AC-22).
 */
export function mergeEffectiveAttachments(
  own: readonly AttachmentRow[],
  inherited: readonly InheritedAttachmentRow[],
  repoId: string,
): MergedAttachments {
  const effective: EffectiveAttachment[] = [];
  const foreign: ForeignAttachment[] = [];
  const seen = new Set<string>();
  const seenForeign = new Set<string>();

  const take = (row: AttachmentRow, source: ContextDocSource): void => {
    if (row.repoId !== repoId) {
      const key = `${row.repoId} ${row.path}`;
      if (!seenForeign.has(key)) {
        seenForeign.add(key);
        foreign.push({ path: row.path, repoId: row.repoId });
      }
      return;
    }
    if (seen.has(row.path)) return;
    seen.add(row.path);
    effective.push({ path: row.path, source, order: effective.length });
  };

  for (const row of own) take(row, { kind: 'agent' });
  for (const row of inherited) {
    if (!row.enabled) continue;
    take(row, { kind: 'skill', skill_id: row.skillId, skill_name: row.skillName });
  }

  // A path that made it into the effective set from THIS repository is not
  // reported as skipped as well, even though another repository's attachment to
  // the same path was passed over: a log line contradicting a `specs_read` entry
  // costs more than the one it saves.
  return { effective, foreign: foreign.filter((f) => !seen.has(f.path)) };
}

/** One document with its text and its cost, on the way into the budget. */
export interface BudgetedDoc {
  path: string;
  text: string;
  tokens: number;
}

/**
 * Apply the per-run token budget, SKIPPING what would overflow and continuing
 * (AC-23).
 *
 * Skip-and-continue rather than stop-at-first-overflow, and the difference is
 * the requirement: one oversized document early in the effective order must not
 * silently discard every smaller one behind it. With a 100-token budget and
 * documents of 60 / 60 / 10, the prompt carries the first and the third, and the
 * second is recorded.
 */
export function applyTokenBudget(
  docs: readonly BudgetedDoc[],
  budget: number,
): { kept: BudgetedDoc[]; skipped: ContextDocSkip[] } {
  const kept: BudgetedDoc[] = [];
  const skipped: ContextDocSkip[] = [];
  let total = 0;
  for (const doc of docs) {
    if (total + doc.tokens > budget) {
      skipped.push({
        path: doc.path,
        reason: `would carry the project context past the ${budget}-token budget`,
      });
      continue;
    }
    total += doc.tokens;
    kept.push(doc);
  }
  return { kept, skipped };
}

/**
 * Which root a document was found under, and the label that goes on its badge
 * (AC-3, AC-33).
 *
 * Roots are matched in the order they were searched, so a document under two
 * overlapping roots reports the first — the same one the walk would have matched
 * it against. A file matched by the `INSIGHTS.md` filename rule outside every
 * root has no root at all and reports itself: this repository keeps its insights
 * at each package root rather than in an `insights/` directory (EC-1), so that
 * group is the normal case here, not an oddity.
 */
export function classifyDoc(
  docPath: string,
  roots: readonly string[],
): { root: string; doc_type: ProjectDocType } {
  for (const root of roots) {
    const normalized = normalizeRoot(root);
    // Matched as a path SEGMENT at any depth, exactly as the walk matches it
    // (`isUnderRoot` in `adapters/git/confined-doc.ts`) — the two rules have to
    // agree or a document the walk listed would report a root it was not found
    // under. So `server/specs/README.md` groups under `specs/` beside
    // `specs/public-api.md`, which is what makes the grouping a statement about
    // KIND rather than about which package happened to own the file.
    if (
      normalized === '' ||
      docPath.startsWith(`${normalized}/`) ||
      docPath.includes(`/${normalized}/`)
    ) {
      return { root, doc_type: docTypeForRootName(normalized) };
    }
  }
  return { root: ALWAYS_MATCHED_FILENAME, doc_type: ProjectDocType.enum.insight };
}

/** `'docs/'`, `'/docs'`, `'./docs'` and `'docs'` all name the same directory. */
function normalizeRoot(root: string): string {
  return root.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** The badge label for a root, defaulting to `other` for a configured extra. */
function docTypeForRootName(normalized: string): ProjectDocType {
  const first = normalized.split('/')[0] ?? '';
  return DOC_TYPE_BY_ROOT_NAME.get(first) ?? ProjectDocType.enum.other;
}

/**
 * How much of the repository the answer covers (AC-6).
 *
 * `entryBudgetExhausted` is read alongside `truncated` because it is the only
 * signal that the walk stopped early — ignoring it makes a list cut short by the
 * directory budget look like a complete one, which is the shape of failure where
 * an empty answer and a partial answer are indistinguishable.
 */
function coverageOf(
  truncated: boolean,
  entryBudgetExhausted: boolean,
  total: number,
): { status: ProjectDocListStatus; reason: string | null } {
  const reasons: string[] = [];
  if (truncated) {
    reasons.push(`only the first ${MAX_DOCUMENTS} of ${total} matching documents are listed`);
  }
  if (entryBudgetExhausted) {
    reasons.push(
      `the walk stopped after ${MAX_DIRECTORY_ENTRIES} directory entries, so the total is a floor`,
    );
  }
  if (reasons.length === 0) return { status: 'ok', reason: null };
  return { status: 'partial', reason: reasons.join('; ') };
}

/** Drop a repeated path, keeping the first occurrence and its position. */
function dedupePaths(paths: readonly string[]): string[] {
  // The attachment tables' primary key is (owner, repo, path), so a duplicate in
  // the incoming array is a constraint violation rather than a harmless repeat —
  // and a 500 on a write the user thinks is a reorder.
  return [...new Set(paths)];
}

function toAttachment(row: AttachmentRow): ContextAttachment {
  return { repo_id: row.repoId, path: row.path, order: row.order };
}

/** The two fields the confined reader needs to find a clone. */
function toRepoRef(repo: ContextRepoRow): RepoRef {
  return { owner: repo.owner, name: repo.name };
}
