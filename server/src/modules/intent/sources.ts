import type {
  FeatureModelChoice,
  FeatureModelId,
  GitHubClient,
  IntentSource,
  IntentSourceKind,
  LLMProvider,
  PrIntent,
  Risk,
} from '@devdigest/shared';
import { hunkHeaders } from './hunks.js';
import {
  MAX_BODY_CHARS,
  MAX_FETCHED_LINKS,
  MAX_FILES_LISTED,
  MAX_HUNK_HEADERS,
  MAX_RECORDED_LINKS,
  MAX_SOURCE_CHARS,
} from './constants.js';

/**
 * Everything the classifier is allowed to see, and an audit trail of what it
 * actually got.
 *
 * The rule that shapes this whole file: **nothing is ever invented.** A link we
 * do not follow is recorded as `unfetched` with the reason, a file we cannot
 * read is recorded as `unfetched` with the reason, and neither is replaced by a
 * plausible summary. `missing_context` and `sources[].status` exist so the gap
 * is visible on the card instead of being papered over by a model that will
 * happily guess what a ticket said.
 *
 * The fetch surface is deliberately tiny and adds NO new network capability:
 *
 *  - GitHub issues and PRs **of this PR's own repository**, through the existing
 *    octokit adapter, injected as the `github` port of {@link IntentDeps}.
 *  - Files **inside the existing local clone**, path-confined — through the
 *    {@link RepoDocReader} port, so the confinement and the read both live in
 *    the adapters ring (`adapters/git/confined-doc.ts`) rather than in this
 *    module. There is no `node:fs` import here.
 *
 * Everything else — a Jira ticket, a Notion page, any URL at all — is recorded
 * `unfetched` and never dereferenced. That removes the SSRF surface entirely
 * rather than filtering it, and still satisfies "flag the missing context".
 *
 * No `+`/`-` diff line ever reaches this prompt: the diff contributes paths,
 * counts and `@@` headers only.
 */

/**
 * The parts of a pull request this module reads.
 *
 * Structural on purpose, so nothing in the Intent module has to name a Drizzle
 * row type: a `PullRow` satisfies it, and so does a test fixture.
 */
export interface IntentPull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
}

/** The repository the PR belongs to — the only repo whose links we follow. */
export interface IntentRepoRef {
  owner: string;
  name: string;
}

/** One changed file of the pull request: paths, counts and the raw patch. */
export interface IntentPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/**
 * The columns of one `pr_intent` write, as this module needs to set them.
 *
 * Declared here rather than imported from the review module's repository: the
 * intent module owns no repository, and an inner ring naming a sibling's
 * internals is exactly the edge `no-cross-module-internals` forbids. Every field
 * is optional because a partial write is legitimate — the lifecycle writers
 * touch `status` and `head_sha` without disturbing the last good derivation.
 */
export interface IntentWrite {
  intent?: string | null;
  inScope?: string[];
  outOfScope?: string[];
  headSha?: string | null;
  confidence?: number;
  sources?: IntentSource[];
  missingContext?: string[];
  riskAreas?: Risk[];
  status?: 'running' | 'ok' | 'partial' | 'failed';
  provider?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  derivedAt?: Date | null;
  error?: string | null;
}

/**
 * The persistence this module reads and writes, stated as a port.
 *
 * `pr_intent` belongs to the review domain's data layer, so the implementation
 * is `ReviewRepository` — but the intent module describes what it needs rather
 * than naming that class, which keeps the dependency pointing inward and the
 * shape of the need visible in one place.
 */
export interface IntentStore {
  getPull(workspaceId: string, prId: string): Promise<IntentPull | undefined>;
  getRepo(repoId: string): Promise<IntentRepoRef | undefined>;
  getPrFiles(prId: string): Promise<readonly IntentPrFile[]>;
  getIntent(prId: string): Promise<PrIntent | undefined>;
  markIntentRunning(prId: string, headSha: string): Promise<void>;
  upsertIntent(prId: string, values: IntentWrite): Promise<void>;
  failIntent(prId: string, error: string): Promise<void>;
}

/** Either a document's text, or the reason it was refused. Never a throw. */
export type RepoDocRead = { ok: true; text: string } | { ok: false; note: string };

/**
 * Reading a repo-relative document out of the local clone, path-confined.
 *
 * Declared here and implemented in the adapters ring
 * (`adapters/git/confined-doc.ts`, satisfied structurally like
 * {@link IntentStore} is by `ReviewRepository`) for two reasons. The
 * confinement — `realpath` both ends, a prefix check, regular-file only — is
 * filesystem work, and a feature module doing its own `node:fs` is invisible to
 * `.dependency-cruiser.cjs`'s `modules-no-raw-sdk` rule, which lists SDKs and
 * not `node:fs`. And it is a port declared by its CONSUMER rather than a new
 * method on `GitClient`, because `src/vendor/shared/` is coordination-only and
 * this capability has exactly one caller.
 */
export interface RepoDocReader {
  read(repo: IntentRepoRef, candidate: string): Promise<RepoDocRead>;
}

/**
 * Resolving the workspace's chosen provider+model for one feature.
 *
 * A narrow port rather than a direct call to
 * `modules/settings/feature-models.ts`, for the reason the dependency graph
 * makes plain: `IntentService` importing a SIBLING module's internal both
 * crossed a module boundary (`no-cross-module-internals`) and closed a cycle
 * through the DI root (`no-circular`), because that function used to take the
 * `Container` itself. Declaring the need here and letting the composition root
 * satisfy it removes both edges — the root is the one place allowed to know
 * about every module.
 */
export interface FeatureModelResolver {
  (workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice>;
}

/** The one thing this module asks of the background queue. */
export interface IntentJobQueue {
  enqueue(
    workspaceId: string,
    kind: string,
    payload: unknown,
  ): Promise<{ id: string; done: Promise<void> }>;
}

/**
 * Everything the Intent module needs from the outside world — and nothing else.
 *
 * Both consumers take THIS type rather than the DI container: `collectSources`
 * below, which uses `reviewRepo`, `github` and `git`, and `IntentService`, which
 * additionally uses `llm` and `jobs`. Two reasons it is a structural interface
 * and not `Container`:
 *
 *  1. The dependencies are visible in the signature — the shape the
 *     `onion-architecture` skill asks of a NEW service.
 *  2. `Container` names this module, so naming `Container` here puts the two in
 *     an import cycle (`no-circular` in `.dependency-cruiser.cjs`). A real
 *     container satisfies this interface structurally, so the composition root
 *     still passes itself straight in.
 */
export interface IntentDeps {
  readonly reviewRepo: IntentStore;
  github(): Promise<GitHubClient>;
  readonly repoDocs: RepoDocReader;
  readonly featureModel: FeatureModelResolver;
  llm(id: LLMProvider['id']): Promise<LLMProvider>;
  readonly jobs: IntentJobQueue;
}

/** One labelled section of the classifier's user message. */
export interface IntentBlock {
  /** Markdown heading rendered above the block. */
  heading: string;
  /** `source=` label on the untrusted delimiter. */
  label: string;
  text: string;
  /**
   * False ONLY for counted facts this server produced. Everything derived from
   * the repository — titles, descriptions, paths, issue bodies, checked-in docs
   * — is untrusted and delimiter-wrapped.
   */
  untrusted: boolean;
}

export interface CollectedSources {
  blocks: IntentBlock[];
  sources: IntentSource[];
  /**
   * Paths the PR actually changed — the evidence set `groundRiskAreas` checks the
   * model's `file_refs` against. Returned from here rather than re-queried by the
   * caller because this function has already read `pr_files`, and a second query
   * could disagree with the list the model was actually shown.
   */
  changedPaths: string[];
}

/**
 * Assemble the classifier's material for one PR.
 *
 * `workspaceId` scopes the caller's resolution of the PR, which has already
 * happened by the time this runs — it is taken here so every entry point of the
 * module carries the same scope in its signature.
 */
export async function collectSources(
  deps: IntentDeps,
  workspaceId: string,
  pull: IntentPull,
  repo: IntentRepoRef,
): Promise<CollectedSources> {
  const blocks: IntentBlock[] = [];
  const sources: IntentSource[] = [];

  // --- title ---------------------------------------------------------------
  blocks.push({
    heading: 'Pull request title',
    label: 'pr:title',
    text: pull.title,
    untrusted: true,
  });
  sources.push(used('pr_title', `pull/${pull.number}`, pull.title.length, null));

  // --- description ---------------------------------------------------------
  // Omitted entirely when blank, rather than recorded as `unfetched`: there was
  // nothing to fetch. A PR with no description is a NORMAL case on the
  // degradation ladder — it lowers the derived confidence (no `pr_body` weight)
  // and adds a `missing_context` line, and it must not flip the derivation to
  // `partial`, which means "we wanted something and could not get it".
  const body = (pull.body ?? '').trim();
  if (body.length > 0) {
    const description = truncate(body, MAX_BODY_CHARS);
    blocks.push({
      heading: 'Pull request description',
      label: 'pr:body',
      text: description.text,
      untrusted: true,
    });
    sources.push(
      used('pr_body', `pull/${pull.number}#description`, description.text.length, description.note),
    );
  }

  // --- changed files + hunk headers ---------------------------------------
  const files = await deps.reviewRepo.getPrFiles(pull.id);
  const listed = files.slice(0, MAX_FILES_LISTED);

  if (listed.length > 0) {
    const fileList = listed
      .map((file) => `${file.path} +${file.additions}/-${file.deletions}`)
      .join('\n');
    blocks.push({
      heading: 'Changed files',
      label: 'pr:files',
      text: fileList,
      untrusted: true,
    });
    sources.push(
      used(
        'file_list',
        `pull/${pull.number}/files`,
        fileList.length,
        listed.length < files.length
          ? `showing ${listed.length} of ${files.length} changed files`
          : null,
      ),
    );
  }

  const headerLines: string[] = [];
  let headersFound = 0;
  for (const file of files) {
    if (!file.patch) continue;
    const headers = hunkHeaders(file.patch);
    headersFound += headers.length;
    const room = MAX_HUNK_HEADERS - countHeaders(headerLines);
    if (room <= 0 || headers.length === 0) continue;
    headerLines.push(`--- ${file.path}`, ...headers.slice(0, room));
  }
  if (headerLines.length > 0) {
    const headerBlock = headerLines.join('\n');
    const shown = countHeaders(headerLines);
    blocks.push({
      heading: 'Hunk headers (no diff bodies)',
      label: 'pr:hunks',
      text: headerBlock,
      untrusted: true,
    });
    sources.push(
      used(
        'hunk_headers',
        `pull/${pull.number}/patch`,
        headerBlock.length,
        shown < headersFound ? `showing ${shown} of ${headersFound} hunk headers` : null,
      ),
    );
  }

  // --- links referenced by the description --------------------------------
  if (body.length > 0) {
    const links = await resolveLinks(deps, pull, repo, body);
    blocks.push(...links.blocks);
    sources.push(...links.sources);
  }

  // --- counted facts (NOT wrapped) ----------------------------------------
  // Numbers this server counted, not text anyone wrote. Presenting them as
  // untrusted data would undercut the one part of the prompt the model is meant
  // to treat as settled — the same call `conventions/prompt.ts` makes for its
  // mined facts.
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  blocks.push({
    heading: 'Counted facts (produced by this server, not by the author)',
    label: 'facts',
    untrusted: false,
    text: [
      `Changed files: ${files.length}`,
      `Lines added: ${additions}`,
      `Lines removed: ${deletions}`,
      `Hunk headers: ${headersFound}`,
      `Description: ${body.length > 0 ? `${body.length} characters` : 'EMPTY'}`,
    ].join('\n'),
  });

  return { blocks, sources, changedPaths: files.map((file) => file.path) };
}

/**
 * The gaps we can state without asking the model.
 *
 * Derived from the audit trail alone, so it says only what actually happened.
 * The model's own `missing_context` is merged on top of this by the service —
 * this half is the half that cannot be hallucinated.
 */
export function deterministicMissingContext(sources: readonly IntentSource[]): string[] {
  const lines: string[] = [];
  if (!sources.some((source) => source.kind === 'pr_body' && source.status === 'used')) {
    lines.push('The pull request has no description.');
  }
  for (const source of sources) {
    if (source.status !== 'unfetched') continue;
    lines.push(
      source.note ? `Could not read ${source.ref}: ${source.note}` : `Could not read ${source.ref}`,
    );
  }
  return lines;
}

// ---- links ----------------------------------------------------------------

/** `#123` anywhere in the body — an issue or PR of this repository. */
const ISSUE_REF = /#(\d+)/g;

/** Any absolute URL. Everything that is not a same-repo link ends up unfetched. */
const URL_REF = /https?:\/\/[^\s<>()[\]"'`]+/g;

/** A repo-relative document path: `docs/plan.md`, `./specs/intent.txt`. */
const DOC_REF = /(?:^|[\s(`'"])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:md|txt))/gi;

/** `/<owner>/<repo>/issues|pull/<n>` */
const GITHUB_ISSUE_PATH = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/;

/** `/<owner>/<repo>/blob/<ref>/<path>` */
const GITHUB_BLOB_PATH = /^\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/;

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

async function resolveLinks(
  deps: IntentDeps,
  pull: IntentPull,
  repo: IntentRepoRef,
  body: string,
): Promise<{ blocks: IntentBlock[]; sources: IntentSource[] }> {
  const blocks: IntentBlock[] = [];
  const sources: IntentSource[] = [];

  const issues = new Set<number>();
  const docs = new Set<string>();
  const foreign: { ref: string; note: string }[] = [];

  for (const match of body.matchAll(ISSUE_REF)) {
    const n = Number(match[1]);
    // The PR's own number is not context about itself.
    if (Number.isSafeInteger(n) && n > 0 && n !== pull.number) issues.add(n);
  }

  for (const match of body.matchAll(URL_REF)) {
    const raw = match[0];
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    // ORIGIN + PATH ONLY, everywhere a URL is recorded. A query string can carry
    // a token, and this string is written to a database row and rendered on a
    // card — neither is a place a credential may end up.
    const ref = `${url.origin}${url.pathname}`;

    if (!GITHUB_HOSTS.has(url.hostname)) {
      foreign.push({ ref, note: 'external links are recorded, never fetched' });
      continue;
    }
    const issue = GITHUB_ISSUE_PATH.exec(url.pathname);
    if (issue && sameRepo(repo, issue[1], issue[2])) {
      const n = Number(issue[3]);
      if (n !== pull.number) issues.add(n);
      continue;
    }
    const blob = GITHUB_BLOB_PATH.exec(url.pathname);
    const blobPath = blob?.[3];
    if (blob && blobPath && sameRepo(repo, blob[1], blob[2]) && isDocPath(blobPath)) {
      docs.add(decodePath(blobPath));
      continue;
    }
    foreign.push({ ref, note: 'only issues, pull requests and documents of this repository are read' });
  }

  for (const match of body.matchAll(DOC_REF)) {
    const candidate = match[1];
    if (candidate) docs.add(candidate.replace(/^\.\//, ''));
  }

  // --- same-repo issues ----------------------------------------------------
  const issueRefs = [...issues];
  if (issueRefs.length > 0) {
    const wanted = issueRefs.slice(0, MAX_FETCHED_LINKS);
    let github: GitHubClient | null = null;
    let unavailable: string | null = null;
    try {
      github = await deps.github();
    } catch (error) {
      unavailable = (error as Error).message;
    }

    for (const n of wanted) {
      const ref = `${repo.owner}/${repo.name}#${n}`;
      if (!github) {
        sources.push(unfetched('linked_issue', ref, unavailable ?? 'GitHub is not configured'));
        continue;
      }
      try {
        const issue = await github.getIssue({ owner: repo.owner, name: repo.name }, n);
        const text = truncate(
          [`#${issue.number} ${issue.title} (${issue.state})`, issue.body ?? ''].join('\n').trim(),
          MAX_SOURCE_CHARS,
        );
        blocks.push({
          heading: `Linked issue ${ref}`,
          label: `issue:${n}`,
          text: text.text,
          untrusted: true,
        });
        sources.push(used('linked_issue', ref, text.text.length, text.note));
      } catch (error) {
        sources.push(unfetched('linked_issue', ref, (error as Error).message));
      }
    }
    for (const n of issueRefs.slice(MAX_FETCHED_LINKS, MAX_RECORDED_LINKS)) {
      sources.push(
        unfetched(
          'linked_issue',
          `${repo.owner}/${repo.name}#${n}`,
          `more than ${MAX_FETCHED_LINKS} links were referenced`,
        ),
      );
    }
  }

  // --- repo documents from the existing clone ------------------------------
  const docRefs = [...docs];
  if (docRefs.length > 0) {
    for (const candidate of docRefs.slice(0, MAX_FETCHED_LINKS)) {
      const read = await deps.repoDocs.read(repo, candidate);
      if (!read.ok) {
        sources.push(unfetched('repo_doc', candidate, read.note));
        continue;
      }
      const text = truncate(read.text, MAX_SOURCE_CHARS);
      blocks.push({
        heading: `Repository document ${candidate}`,
        label: `repo-doc:${candidate}`,
        text: text.text,
        untrusted: true,
      });
      sources.push(used('repo_doc', candidate, text.text.length, text.note));
    }
    for (const candidate of docRefs.slice(MAX_FETCHED_LINKS, MAX_RECORDED_LINKS)) {
      sources.push(
        unfetched('repo_doc', candidate, `more than ${MAX_FETCHED_LINKS} documents were referenced`),
      );
    }
  }

  for (const link of foreign.slice(0, MAX_RECORDED_LINKS)) {
    sources.push(unfetched('unfetched_link', link.ref, link.note));
  }

  return { blocks, sources };
}

function sameRepo(repo: IntentRepoRef, owner: string | undefined, name: string | undefined): boolean {
  return (
    owner?.toLowerCase() === repo.owner.toLowerCase() &&
    name?.replace(/\.git$/, '').toLowerCase() === repo.name.toLowerCase()
  );
}

function isDocPath(value: string): boolean {
  return /\.(?:md|txt)$/i.test(value);
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function countHeaders(lines: readonly string[]): number {
  return lines.filter((line) => line.startsWith('@@ ')).length;
}

function truncate(text: string, max: number): { text: string; note: string | null } {
  if (text.length <= max) return { text, note: null };
  return { text: text.slice(0, max), note: `truncated to ${max} characters` };
}

function used(
  kind: IntentSourceKind,
  ref: string,
  chars: number,
  note: string | null,
): IntentSource {
  return { kind, ref, status: 'used', chars, note };
}

/** `chars` is null: nothing was read, and a size would imply otherwise. */
function unfetched(kind: IntentSourceKind, ref: string, note: string): IntentSource {
  return { kind, ref, status: 'unfetched', chars: null, note };
}
