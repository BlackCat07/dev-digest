/**
 * Ports and row shapes for the Project Context module (L05).
 *
 * Types only — no runtime code — so nothing here can join an import cycle, and
 * the module's whole dependency surface is one file. Same shape and same
 * reasoning as `modules/prior-prs/types.ts` and `modules/blast/types.ts`,
 * including the part that matters most: every dependency is declared by the
 * CONSUMER and satisfied structurally by whatever the composition root passes
 * in. Nothing here imports a sibling module — a types-only import of one is
 * still a real `no-cross-module-internals` violation (`server/INSIGHTS.md`,
 * 2026-08-14, measured 22 → 24 warnings) — and nothing here imports
 * `src/adapters/**`, which is why the walk's options and result are mirrored
 * below rather than imported from `adapters/git/confined-doc.ts`.
 *
 * The absences are the point. There is no LLM port, no job queue and no
 * embedder in reach: AC-24 ("no model call") and AC-27 ("no background job") are
 * properties of this file rather than promises in a comment.
 */
import type {
  ContextAttachment,
  ContextAttachmentInput,
  ContextDocSource,
  EffectiveContextDoc,
  ProjectDocList,
  RepoRef,
  SpecFile,
} from '@devdigest/shared';

/* ─── the filesystem port ─────────────────────────────────────────────────── */

/** Either a document's text, or the reason it was refused. Never a throw. */
export type RepoDocRead = { ok: true; text: string } | { ok: false; note: string };

/** One document the walk reported: metadata only, never text. */
export interface RepoDocEntry {
  /** Repo-relative, forward-slash separated. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** Last-modified time, or null when the filesystem reported none. */
  updatedAt: Date | null;
}

/**
 * The bounds of one walk — all four owned by this module (see `constants.ts`).
 *
 * They travel as arguments precisely because `src/adapters/**` may import
 * nothing from `src/modules/**`: the adapter enforces the bounds, the feature
 * chooses them.
 */
export interface RepoDocWalkOptions {
  roots: readonly string[];
  excludedDirs: readonly string[];
  maxEntries: number;
  limit: number;
}

/** The walk's result, or the reason there is none. Never a throw. */
export type RepoDocWalk =
  | {
      ok: true;
      docs: RepoDocEntry[];
      /** Confined matches found BEFORE the cap was applied. */
      total: number;
      truncated: boolean;
      /**
       * The entry budget ran out mid-walk, so `total` is itself a floor.
       *
       * Read alongside `truncated` when deriving `status`: ignoring it makes a
       * walk that stopped early look like a complete one.
       */
      entryBudgetExhausted: boolean;
    }
  | { ok: false; note: string };

/**
 * Listing and reading documents inside a repository's local clone,
 * path-confined.
 *
 * Declared here and implemented in the adapters ring
 * (`adapters/git/confined-doc.ts`, satisfied structurally) for the reason that
 * file's own doc-comment gives: the confinement is filesystem work, and a
 * feature module importing Node's own filesystem module is INVISIBLE to
 * `.dependency-cruiser.cjs` — its `modules-no-raw-sdk` rule enumerates SDKs and
 * not that one, so a module reading the disk passes the one gate that guards
 * this ring (`server/INSIGHTS.md`, 2026-08-10). No file under
 * `modules/project-context/` imports it; the grep for it is a gate of its own.
 */
export interface ProjectContextDocReader {
  read(repo: RepoRef, candidate: string): Promise<RepoDocRead>;
  list(repo: RepoRef, options: RepoDocWalkOptions): Promise<RepoDocWalk>;
}

/* ─── the persistence port ────────────────────────────────────────────────── */

/** A repository, narrowed to what this module reads. */
export interface ContextRepoRow {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  /** Null when the repository was imported but never cloned (EC-18). */
  clonePath: string | null;
}

/** One stored attachment row of an agent or a skill. */
export interface AttachmentRow {
  repoId: string;
  path: string;
  order: number;
}

/**
 * One attachment reached through a skill link.
 *
 * `linkOrder` is the skill's position on the agent and `order` its position
 * within that skill, which together are AC-19's "skill link order and, within a
 * skill, that skill's attachment order". `skillName` rides along so a row can
 * name its skill without a second lookup.
 */
export interface InheritedAttachmentRow extends AttachmentRow {
  skillId: string;
  skillName: string;
  linkOrder: number;
  /**
   * Whether the skill is currently enabled.
   *
   * Carried rather than filtered in SQL so the "a disabled skill contributes
   * nothing to a run" rule lives in the pure merge (`mergeEffectiveAttachments`)
   * where it can be proved without a database — which on this run is the only
   * kind of test there is. It is a rule of the effective SET, not of the
   * storage.
   */
  enabled: boolean;
}

/**
 * An attachment paired with the repository it names, for the cross-repository
 * skip AC-22 has to be able to explain by name.
 */
export interface AttachmentRepoName {
  repoId: string;
  fullName: string;
}

/**
 * The persistence this module owns, stated as a port.
 *
 * The implementation (`repository.ts`) is the ONLY file in this module allowed
 * to touch `db/schema` and `drizzle-orm`; the service sees this interface and a
 * test sees a fixture. Every read is workspace-scoped at its entry point, which
 * is what makes `getRepo` the authorization check rather than a lookup: neither
 * `agent_context_docs` nor `skill_context_docs` carries a `workspace_id` of its
 * own, so scoping happens on the way in through `repos`, `agents` and `skills`.
 */
export interface ProjectContextStore {
  /** The workspace's configured search roots, raw — `safeParse`d by the caller. */
  getContextRootsSetting(workspaceId: string): Promise<unknown>;

  getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRow | undefined>;
  /** Unscoped, for the run path, where the repository comes from the PR under review. */
  getRepoById(repoId: string): Promise<ContextRepoRow | undefined>;
  agentExists(workspaceId: string, agentId: string): Promise<boolean>;
  skillExists(workspaceId: string, skillId: string): Promise<boolean>;

  listAgentAttachments(agentId: string): Promise<AttachmentRow[]>;
  listSkillAttachments(skillId: string): Promise<AttachmentRow[]>;
  /**
   * The attachments of every skill linked to the agent, in link order then
   * skill order, each carrying its skill's `enabled` flag — the filter is the
   * merge's, not the query's (see {@link InheritedAttachmentRow.enabled}).
   */
  listInheritedAttachments(agentId: string): Promise<InheritedAttachmentRow[]>;

  /** Replace-all for one repository, in one transaction. */
  setAgentAttachments(agentId: string, repoId: string, paths: string[]): Promise<void>;
  setSkillAttachments(skillId: string, repoId: string, paths: string[]): Promise<void>;

  /**
   * AC-26 — per path, how many distinct agents' effective sets contain it.
   *
   * One grouped aggregate rather than a query per document: the list carries up
   * to 500 of them, and Drizzle's `count()` maps to a real `number`
   * (`server/INSIGHTS.md`, 2026-08-03), so there is no reason to over-fetch and
   * reduce in JS.
   */
  countAgentsByPath(workspaceId: string, repoId: string): Promise<Map<string, number>>;

  /** Full names for the repositories a set of attachments names (AC-22). */
  repoNames(repoIds: string[]): Promise<AttachmentRepoName[]>;
}

/* ─── what a run gets ─────────────────────────────────────────────────────── */

/** One document skipped before the prompt, and why (AC-22, AC-23). */
export interface ContextDocSkip {
  path: string;
  /** Sentence fragment, logged verbatim by the executor after the path. */
  reason: string;
}

/**
 * The project context of one run: what reached the prompt, and what did not.
 *
 * `texts` and `paths` are index-aligned by construction — `specs_read` must hold
 * exactly the documents whose text is in the prompt (AC-20), so the two are
 * produced together rather than derived from one another later.
 */
export interface RunContextResolution {
  /** Raw document text, in effective order. UNWRAPPED — the engine wraps this slot. */
  texts: string[];
  /** The same documents' paths, in the same order. */
  paths: string[];
  /** Every attachment that did not make it, with the reason. */
  skipped: ContextDocSkip[];
  /** Approximate tokens the kept documents carry, for the run log. */
  tokens: number;
}

/** One document of an agent's merged effective set, before any text is read. */
export interface EffectiveAttachment {
  path: string;
  source: ContextDocSource;
  order: number;
}

/* ─── the module's public face ────────────────────────────────────────────── */

/**
 * What the container exposes and what a consumer outside this module may call.
 *
 * An interface rather than the class, for the reason `RepoIntel` is one: the
 * review executor depends on the capability, and a test injects a fake through
 * `ContainerOverrides.projectContext` with no database in sight.
 *
 * Every method that takes a `workspaceId` performs the workspace lookup FIRST
 * and answers `404 not_found` for anything outside it (AC-12). `resolveForRun`
 * is the exception and takes none: it runs inside an already-authorized review
 * of a pull request whose repository is the scope.
 */
export interface ProjectContext {
  listDocs(workspaceId: string, repoId: string): Promise<ProjectDocList>;
  readDoc(workspaceId: string, repoId: string, docPath: string): Promise<ProjectDocContent>;
  listAgentDocs(workspaceId: string, agentId: string): Promise<ContextAttachment[]>;
  setAgentDocs(
    workspaceId: string,
    agentId: string,
    input: ContextAttachmentInput,
  ): Promise<ContextAttachment[]>;
  listSkillDocs(workspaceId: string, skillId: string): Promise<ContextAttachment[]>;
  setSkillDocs(
    workspaceId: string,
    skillId: string,
    input: ContextAttachmentInput,
  ): Promise<ContextAttachment[]>;
  resolveForRun(agentId: string, repoId: string): Promise<RunContextResolution>;
  /**
   * The same effective set as {@link resolveForRun}, as METADATA — paths, their
   * source and their effective order, with no document text.
   *
   * Additive and read-only: it exists so a consumer that needs to know *which*
   * documents an agent carries, and in what order, does not have to pay for
   * reading all of them. `resolveForRun` opens every document it keeps, which is
   * the right cost inside a review and the wrong one on a request-time path that
   * only needs to fingerprint the set.
   *
   * Both answers come from one call to `mergeEffectiveAttachments`, deliberately:
   * the effective set is defined in exactly one place, so a consumer cannot
   * accumulate a second definition of it by reading the attachment tables
   * itself. Whatever this returns, `resolveForRun` would have attempted — minus
   * whatever the clone then refused.
   *
   * Takes no `workspaceId` for the same reason `resolveForRun` takes none: the
   * caller has already resolved the repository within its own workspace scope,
   * and that repository is the scope here.
   */
  listEffectiveDocs(agentId: string, repoId: string): Promise<EffectiveContextDoc[]>;
}

/**
 * One document's text, as the single-document route answers it.
 *
 * `SpecFile` verbatim — the existing contract type, gaining its first consumer
 * and no field — plus `reason`, which AC-10 requires and `SpecFile` has nowhere
 * to put: a document that vanished from the clone between the list and the click
 * must come back as a 200 explaining itself, never as a throw. The extra key is
 * additive on the wire, so a client typing the response as `SpecFile` reads it
 * unchanged.
 */
export type ProjectDocContent = SpecFile & { reason: string | null };

/**
 * Everything this module needs from the outside world — and nothing else.
 *
 * A structural interface rather than `Container`: `platform/container.ts` names
 * this module, so naming `Container` here would close a `no-circular` cycle
 * through the DI root. The composition root passes the two ports in directly.
 */
export interface ProjectContextDeps {
  readonly store: ProjectContextStore;
  readonly repoDocs: ProjectContextDocReader;
}
