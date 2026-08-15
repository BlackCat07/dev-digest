/**
 * resolve.ts — human addressing to internal ids, plus the caches that make it
 * nearly free.
 *
 * This is the largest token saving in the package. Without it every tool call
 * would have to list repositories, list pull requests and read a whole payload
 * just to extract a uuid, and the model would then be carrying uuids it has no
 * way to check. With it, `repo` is `"owner/name"` (or the bare name when that is
 * unique) and `pr` is the GitHub pull request NUMBER — the two identifiers a
 * human, an issue tracker and a code agent all already have.
 *
 * Only what the SCHEMA guarantees is resolved here:
 *
 *  - `repos_ws_fullname_uq` makes `owner/name` unique, so a full name is a
 *    single row. A BARE name is not guaranteed unique — two owners may both have
 *    `payments-api` — so on two or more hits this reports the candidates rather
 *    than picking one.
 *  - `pr_repo_number_uq` makes (repo, number) unique, so a number is a row.
 *  - `agents.name` has NO unique constraint at all (`server/src/db/schema/
 *    agents.ts`), so agents are NEVER resolved by name: `agent` arrives as an id
 *    from `devdigest_list_agents`. The only agent-shaped thing here is
 *    `unknownAgentMessage`, the text for an id the API rejected.
 *
 * ## The caches, and the one refetch
 *
 * Three per-process caches — repos, pull requests per repo, agents — and they
 * are **positive only**: a successful list is remembered, a miss never is.
 * Remembering a miss is what would make "the PR I imported a minute ago" stay
 * unresolvable for the life of the process.
 *
 * A miss therefore triggers **exactly one** refetch of that list and then
 * decides. Two consequences, both deliberate:
 *
 *  - A pull request imported after this process started resolves on that second
 *    fetch attempt, with no restart.
 *  - A genuinely absent one costs one extra request and then reports. It is a
 *    single refetch, never a loop — `GET /repos/:id/pulls` drives a live GitHub
 *    sync plus up to ten detail backfills per call, so polling it would be
 *    expensive and would share the API's 120 req/min budget with the studio.
 *
 * An ambiguous bare name is the one case that does NOT refetch: a second copy of
 * the same list cannot disambiguate it.
 *
 * ## Every miss is an instruction
 *
 * There is no `devdigest_list_repos` tool, so a message that only said "not
 * found" would leave the model guessing. Each one therefore names the
 * alternatives it does know (capped at `MAX_LISTED_ALTERNATIVES` with a
 * `(+N more)` tail) and the next call to make. An empty `GET /repos` gets its
 * own text, because the most common cause is not "no repositories" but a
 * memoised workspace after a re-seed — `LocalNoAuthProvider.currentWorkspace`
 * caches the workspace for the life of the API process, so every list answers
 * `[]` while Postgres is visibly full (`server/INSIGHTS.md`, 2026-08-06). The
 * fix is restarting the API, which no amount of retrying from here achieves.
 *
 * API failures travel as they arrive: the `ApiFailure` union from `errors.ts`,
 * in the same `{ok}` result shape `ApiClient` uses. Nothing here throws on an
 * expected condition and nothing here parses — the client already did.
 */
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api/client.js';
import { instructionFor, type ApiFailure, type ApiResult } from './errors.js';
import { logger as defaultLogger, type Logger } from './log.js';

/**
 * How many alternatives a miss message spells out before summarising the rest.
 * Twenty is enough for the model to recognise the one it meant, and small
 * enough that a workspace with two hundred repositories does not turn one
 * mistake into a wall of text.
 */
export const MAX_LISTED_ALTERNATIVES = 20;

/** A repository, addressed by `owner/name`, with the id the API needs. */
export interface ResolvedRepo {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  /** `owner/name` exactly as DevDigest spells it, not as the caller did. */
  readonly fullName: string;
}

/** A pull request, addressed by number, with the id the API needs. */
export interface ResolvedPull {
  readonly id: string;
  readonly number: number;
  readonly repo: ResolvedRepo;
  /** The row as the API returned it, for callers that want title or head sha. */
  readonly meta: PrMeta;
}

/**
 * A pull request addressed by its ROW UUID.
 *
 * Identical to `ResolvedPull` except that `repo` is **nullable**, which is the one
 * honest difference: `PrMeta` carries no `repo_id`, so naming a uuid's repository
 * takes a lookup that can come up empty. `Resolver.resolvePullById` documents the
 * three sources it tries, cheapest first. A consumer should omit the repository from
 * its output rather than invent one.
 */
export interface ResolvedPullById {
  readonly id: string;
  readonly number: number;
  readonly repo: ResolvedRepo | null;
  readonly meta: PrMeta;
}

/**
 * Outcome of a resolution.
 *
 * Both failure branches carry `message`, so a tool can answer with
 * `result.message` without knowing which happened; `reason: 'api'` additionally
 * keeps the `ApiFailure` for a caller that wants to branch on `failure.kind`
 * (a 404 on an agent id, say).
 */
export type ResolveResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly reason: 'api';
      readonly failure: ApiFailure;
      /** `instructionFor(failure)`. */
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: 'unresolved'; readonly message: string };

function fromFailure<T>(failure: ApiFailure): ResolveResult<T> {
  return { ok: false, reason: 'api', failure, message: instructionFor(failure) };
}

function unresolved<T>(message: string): ResolveResult<T> {
  return { ok: false, reason: 'unresolved', message };
}

/**
 * What looking for one row in a list produced.
 *
 * `retry` and `stop` are both misses; they differ on whether a fresh copy of
 * the list could change the answer. A missing row could have been created a
 * moment ago (`retry`); an ambiguous name is ambiguous in any copy (`stop`).
 */
type Match<R> =
  | { readonly kind: 'hit'; readonly value: R }
  | { readonly kind: 'retry'; readonly message: string }
  | { readonly kind: 'stop'; readonly message: string };

interface Lookup<T, R> {
  /** What the cache holds, or `null` when it has never been filled. */
  readonly cached: readonly T[] | null;
  readonly fetchList: () => Promise<ApiResult<readonly T[]>>;
  /** Positive only: called with a successfully fetched list, never on a miss. */
  readonly store: (list: readonly T[]) => void;
  readonly match: (list: readonly T[]) => Match<R>;
  /** Name of the list, for the debug line. Never a caller-supplied string. */
  readonly what: string;
  readonly logger: Logger;
}

/**
 * The whole cache policy, in one place: read the cache, look up, and on a miss
 * refetch **exactly once** before deciding. Never more — see the file header.
 */
async function lookupInList<T, R>(input: Lookup<T, R>): Promise<ResolveResult<R>> {
  let list = input.cached;

  if (list === null) {
    const first = await input.fetchList();
    if (!first.ok) return fromFailure(first.failure);
    input.store(first.data);
    list = first.data;
  }

  const found = input.match(list);
  if (found.kind === 'hit') return { ok: true, data: found.value };
  if (found.kind === 'stop') return unresolved(found.message);

  input.logger.debug('resolver cache miss, refetching once', { list: input.what });

  const again = await input.fetchList();
  if (!again.ok) return fromFailure(again.failure);
  input.store(again.data);

  const retried = input.match(again.data);
  if (retried.kind === 'hit') return { ok: true, data: retried.value };
  return unresolved(retried.message);
}

// --------------------------------------------------------------------------
// Listing alternatives
// --------------------------------------------------------------------------

/** `a, b, c (+4 more)` — the capped enumeration every miss message ends with. */
function listOf(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED_ALTERNATIVES);
  const hidden = items.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')} (+${hidden} more)` : shown.join(', ');
}

/** `a and b`, `a, b and c (+4 more)` — for a sentence, not a list. */
function joinWithAnd(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED_ALTERNATIVES);
  const hidden = items.length - shown.length;
  const tail = hidden > 0 ? ` (+${hidden} more)` : '';
  const last = shown.at(-1);
  if (last === undefined) return tail.trim();
  if (shown.length === 1) return `${last}${tail}`;
  return `${shown.slice(0, -1).join(', ')} and ${last}${tail}`;
}

/** Alphabetical, so the same workspace always reads the same way. */
function repoNames(repos: readonly Repo[]): string[] {
  return repos.map((repo) => repo.full_name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Newest first: the pull request a caller mistyped is usually a recent one. */
function pullNumbers(pulls: readonly PrMeta[]): string[] {
  return pulls
    .filter((pull) => idOf(pull) !== null)
    .map((pull) => pull.number)
    .sort((a, b) => b - a)
    .map((number) => `#${number}`);
}

/** `PrMeta.id` is nullish in the contract; a blank id is no id either. */
function idOf(pull: PrMeta): string | null {
  const id = pull.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

// --------------------------------------------------------------------------
// The messages. Each one names the alternatives and the next call to make.
// --------------------------------------------------------------------------

function blankSpecMessage(): string {
  return (
    'No repository was given, so nothing can be resolved. Retry this tool with `repo` ' +
    'set to a repository imported into DevDigest, as "owner/name" (for example ' +
    '"acme/payments-api"), or as just the name when only one owner has it.'
  );
}

function emptyReposMessage(wanted: string): string {
  return (
    `DevDigest has no repositories imported at all, so "${wanted}" cannot be resolved. ` +
    'If its database does hold repositories, the API process is scoping every query to a ' +
    'workspace it memoised at startup: restart it (./scripts/dev.sh in the DevDigest ' +
    'repository) and retry this tool. Otherwise import the repository in the DevDigest ' +
    'studio first, then retry.'
  );
}

function repoNotFoundMessage(repos: readonly Repo[], wanted: string): string {
  return (
    `DevDigest has no repository matching "${wanted}". It knows ` +
    `${listOf(repoNames(repos))}. Retry this tool with one of those, spelled exactly as ` +
    'listed - "owner/name", or just the name when only one owner has it. Only ' +
    'repositories imported into DevDigest can be reviewed; import it in the studio if ' +
    'it is missing.'
  );
}

/**
 * A repository uuid that no row in this workspace has.
 *
 * Names the NAMES rather than the ids, and says so: a caller who mistyped a uuid
 * cannot spot the typo in a list of other uuids, but they can recognise the
 * repository they meant — and the name path is the one this server recommends
 * anyway. The whitespace clause is not hypothetical: a uuid copied out of a browser
 * URL bar routinely arrives with a leading or trailing space, and the id is trimmed
 * before this is reached.
 */
function unknownRepoIdMessage(repos: readonly Repo[], wanted: string): string {
  return (
    `DevDigest has no repository with the id "${wanted}" in this workspace. It knows ` +
    `${listOf(repoNames(repos))}. Retry with one of those names as \`repo\`, which is the ` +
    'recommended way to address a repository, or check the id you copied from the studio ' +
    'URL - it must be the whole uuid, with no surrounding whitespace.'
  );
}

/** A pull-request uuid the API would not return a row for. */
function unknownPullIdMessage(wanted: string): string {
  return (
    `DevDigest has no pull request with the id "${wanted}". Check the id you copied from the ` +
    'studio URL - it must be the whole uuid, with no surrounding whitespace - or address the ' +
    'pull request the recommended way instead, with `repo` as "owner/name" and `pr` as its ' +
    'GitHub number.'
  );
}

function ambiguousRepoMessage(hits: readonly Repo[], wanted: string): string {
  const names = joinWithAnd(repoNames(hits));
  if (wanted.includes('/')) {
    // Two rows whose full names differ only by case. `repos_ws_fullname_uq` is
    // exact, so this is legal in the database and cannot be disambiguated here.
    return (
      `"${wanted}" matches ${names} in DevDigest, which differ only in case. Retry this ` +
      'tool with the owner/name spelled exactly as one of those.'
    );
  }
  return (
    `"${wanted}" matches ${names}. Pass the full owner/name - retry this tool with ` +
    'exactly one of those.'
  );
}

function emptyPullsMessage(repo: ResolvedRepo, number: number): string {
  return (
    `DevDigest lists no pull requests at all for ${repo.fullName}, so #${number} cannot ` +
    'be resolved. That list is synced from GitHub on every read, so the usual causes are ' +
    'no GitHub token configured, a repository that does not exist on GitHub (the seeded ' +
    'acme/payments-api does not), or genuinely no open pull requests. Check the ' +
    'repository in the DevDigest studio, then retry this tool.'
  );
}

function pullNotFoundMessage(
  pulls: readonly PrMeta[],
  repo: ResolvedRepo,
  number: number,
): string {
  return (
    `${repo.fullName} has no pull request #${number} in DevDigest. It knows ` +
    `${listOf(pullNumbers(pulls))}. Check that number against the repository on GitHub - ` +
    '`pr` is the pull request NUMBER, not an internal id. If the pull request is newer ' +
    "than DevDigest's last sync, retry this tool in a moment; the list is re-synced from " +
    'GitHub on every read.'
  );
}

function missingPullIdMessage(repo: ResolvedRepo, number: number): string {
  return (
    `DevDigest lists pull request #${number} of ${repo.fullName} but returned no internal ` +
    'id for it, so it cannot be reviewed or read. Open that pull request once in the ' +
    'DevDigest studio so it is stored, then retry this tool. If it is already stored, ' +
    'report this line - GET /repos/:id/pulls returns an id for every persisted row.'
  );
}

function unknownAgentMessage(agentId: string, agents: readonly Agent[]): string {
  const described = agents.map((agent) => `${agent.name} (id ${agent.id})`);
  const known =
    described.length === 0
      ? 'It has no agents configured at all, so add one in the DevDigest studio first. '
      : `It knows ${listOf(described)}. `;
  return (
    `DevDigest has no agent with id "${agentId}". ${known}` +
    'Call devdigest_list_agents and retry with an id from its output - agent ids are not ' +
    'guessable and an agent name is not one, because DevDigest allows two agents to share ' +
    'a name.'
  );
}

function unlistableAgentsMessage(agentId: string): string {
  return (
    `DevDigest has no agent with id "${agentId}", and this server could not list the ` +
    'agents it does have. Call devdigest_list_agents and retry with an id from its ' +
    'output; if that call fails too, check that the DevDigest API is running.'
  );
}

// --------------------------------------------------------------------------
// Matching one row in a list
// --------------------------------------------------------------------------

function toResolvedRepo(repo: Repo): ResolvedRepo {
  return { id: repo.id, owner: repo.owner, name: repo.name, fullName: repo.full_name };
}

/**
 * `owner/name` matches on `full_name`; a bare name matches on `name`, which is
 * NOT unique — hence the third branch, which reports instead of choosing.
 * Comparison is case-insensitive: GitHub treats owner and repository names that
 * way, and a caller who typed the right repository in the wrong case has not
 * made the kind of mistake worth a round trip.
 */
/**
 * Exact match on the row uuid. No case folding and no bare-name branch: a uuid is
 * either the id of a row in this workspace or it is not one, and the failure text
 * therefore points at the id rather than offering near-misses.
 */
function matchRepoById(repos: readonly Repo[], wanted: string): Match<ResolvedRepo> {
  if (repos.length === 0) return { kind: 'retry', message: emptyReposMessage(wanted) };
  const hit = repos.find((repo) => repo.id === wanted);
  if (hit !== undefined) return { kind: 'hit', value: toResolvedRepo(hit) };
  return { kind: 'retry', message: unknownRepoIdMessage(repos, wanted) };
}

function matchRepo(repos: readonly Repo[], wanted: string): Match<ResolvedRepo> {
  if (repos.length === 0) return { kind: 'retry', message: emptyReposMessage(wanted) };

  const needle = wanted.toLowerCase();
  const hits = wanted.includes('/')
    ? repos.filter((repo) => repo.full_name.toLowerCase() === needle)
    : repos.filter((repo) => repo.name.toLowerCase() === needle);

  const only = hits.length === 1 ? hits[0] : undefined;
  if (only !== undefined) return { kind: 'hit', value: toResolvedRepo(only) };
  if (hits.length === 0) return { kind: 'retry', message: repoNotFoundMessage(repos, wanted) };
  return { kind: 'stop', message: ambiguousRepoMessage(hits, wanted) };
}

/**
 * A row without an id cannot be addressed, so it is skipped rather than
 * returned half-usable — and if the number asked for is exactly that row, it
 * gets its own message instead of "no such pull request", which would send the
 * caller off to check a number that is perfectly correct.
 */
function matchPull(
  pulls: readonly PrMeta[],
  repo: ResolvedRepo,
  number: number,
): Match<ResolvedPull> {
  if (pulls.length === 0) return { kind: 'retry', message: emptyPullsMessage(repo, number) };

  const sameNumber = pulls.filter((pull) => pull.number === number);
  for (const pull of sameNumber) {
    const id = idOf(pull);
    if (id !== null) {
      return { kind: 'hit', value: { id, number: pull.number, repo, meta: pull } };
    }
  }

  if (sameNumber.length > 0) {
    return { kind: 'retry', message: missingPullIdMessage(repo, number) };
  }
  return { kind: 'retry', message: pullNotFoundMessage(pulls, repo, number) };
}

// --------------------------------------------------------------------------

export interface ResolverOptions {
  readonly client: ApiClient;
  readonly logger?: Logger;
}

/**
 * Per-process resolver. One instance is built by the composition root and shared
 * by every tool, which is what makes the caches worth having: the second tool
 * call of a session usually resolves with no request at all.
 */
export class Resolver {
  private readonly client: ApiClient;
  private readonly log: Logger;

  /** `GET /repos` — cheap, and the same list answers every repository. */
  private repos: readonly Repo[] | null = null;
  /** `GET /repos/:id/pulls` per repo id — EXPENSIVE; see the file header. */
  private readonly pulls = new Map<string, readonly PrMeta[]>();
  /** `GET /agents` — cheap; only used to name alternatives on a bad agent id. */
  private agentList: readonly Agent[] | null = null;

  constructor({ client, logger = defaultLogger }: ResolverOptions) {
    this.client = client;
    this.log = logger;
  }

  /** `"owner/name"`, or the bare name when only one owner has it, to an id. */
  async resolveRepo(spec: string): Promise<ResolveResult<ResolvedRepo>> {
    const wanted = spec.trim();
    if (wanted === '') return unresolved(blankSpecMessage());

    const result = await lookupInList<Repo, ResolvedRepo>({
      cached: this.repos,
      fetchList: () => this.client.listRepos(),
      store: (list) => {
        this.repos = list;
      },
      match: (list) => matchRepo(list, wanted),
      what: 'repos',
      logger: this.log,
    });

    if (result.ok) {
      this.log.debug('resolved repository', { repo: result.data.fullName });
    }
    return result;
  }

  /** A repository plus a GitHub pull request NUMBER, to the pull request's id. */
  async resolvePull(spec: string, number: number): Promise<ResolveResult<ResolvedPull>> {
    const repo = await this.resolveRepo(spec);
    if (!repo.ok) return repo;

    const repoId = repo.data.id;
    const result = await lookupInList<PrMeta, ResolvedPull>({
      cached: this.pulls.get(repoId) ?? null,
      fetchList: () => this.client.listPulls(repoId),
      store: (list) => {
        this.pulls.set(repoId, list);
      },
      match: (list) => matchPull(list, repo.data, number),
      what: 'pulls',
      logger: this.log,
    });

    if (result.ok) {
      this.log.debug('resolved pull request', { repo: repo.data.fullName, pr: number });
    }
    return result;
  }

  /**
   * A repository's ROW UUID to the same `ResolvedRepo` the name path produces.
   *
   * Fully resolvable and exact: `GET /repos` carries both `id` and `full_name`, so
   * a uuid names one repository or none. No ambiguity branch is possible here,
   * which is the whole appeal of addressing by id.
   */
  async resolveRepoById(repoId: string): Promise<ResolveResult<ResolvedRepo>> {
    const wanted = repoId.trim();
    if (wanted === '') return unresolved(blankSpecMessage());

    const result = await lookupInList<Repo, ResolvedRepo>({
      cached: this.repos,
      fetchList: () => this.client.listRepos(),
      store: (list) => {
        this.repos = list;
      },
      match: (list) => matchRepoById(list, wanted),
      what: 'repos',
      logger: this.log,
    });

    if (result.ok) this.log.debug('resolved repository by id', { repo: result.data.fullName });
    return result;
  }

  /**
   * A pull request's ROW UUID to its id, number and repository.
   *
   * `GET /pulls/:id` validates the uuid and supplies the real number, so a mistyped
   * id fails here with the API's own 404 rather than silently addressing nothing.
   *
   * Naming its REPOSITORY is the awkward part, because `PrMeta` carries no
   * `repo_id` (`contracts/platform.ts`). Three sources are tried, cheapest first,
   * and the ordering is the whole design:
   *
   *  1. **Any pull list this process already cached** — free and exact.
   *  2. **A workspace holding exactly one repository** — then the pull can only
   *     belong to it. `GET /repos` is cached and is not the expensive call.
   *  3. **A bounded search**: list each remaining repository's pulls until one
   *     matches. This is the expensive path — `GET /repos/:id/pulls` syncs against
   *     live GitHub — so it is last, it stops at the first hit, and every list it
   *     fetches is cached, which means the cost is paid at most once per repository
   *     per process and every later call benefits.
   *
   * Step 3 exists because the alternative was worse than its cost. Without it a
   * uuid-addressed pull sometimes has no repository name, and `run_agent_on_pr`
   * builds ten sentences out of that name — so the choice was between paying here
   * once or spreading "the repository might be unknown" across every message a run
   * can produce. `repo` is still typed nullable, because step 3 can fail too (a
   * listing error, or a pull that genuinely belongs to no visible repository), and
   * a consumer must omit the name rather than invent one.
   */
  async resolvePullById(prId: string): Promise<ResolveResult<ResolvedPullById>> {
    const wanted = prId.trim();
    if (wanted === '') return unresolved(blankSpecMessage());

    const detail = await this.client.getPull(wanted);
    if (!detail.ok) {
      return {
        ok: false,
        reason: 'api',
        failure: detail.failure,
        message: unknownPullIdMessage(wanted),
      };
    }

    const repo = await this.repoHoldingPull(wanted);
    this.log.debug('resolved pull request by id', {
      pr: detail.data.number,
      repo: repo?.fullName ?? null,
    });
    return {
      ok: true,
      data: { id: wanted, number: detail.data.number, repo, meta: detail.data },
    };
  }

  /** The two free ways to name a uuid-addressed pull's repository — see above. */
  private async repoHoldingPull(prId: string): Promise<ResolvedRepo | null> {
    // 1 — already cached, free.
    const cached = this.repoFromCachedPulls(prId);
    if (cached !== null) return cached;

    if (this.repos === null) {
      const fetched = await this.client.listRepos();
      if (!fetched.ok) return null;
      this.repos = fetched.data;
    }

    // 2 — only one repository exists, so there is nothing to disambiguate.
    const [only, ...rest] = this.repos;
    if (only !== undefined && rest.length === 0) return toResolvedRepo(only);

    // 3 — pay for it, once per repository, stopping at the first hit. Each list is
    // cached on the way past, so a session pays this at most once per repository and
    // every later resolution — by name or by id — is served from those same caches.
    for (const repo of this.repos) {
      if (this.pulls.has(repo.id)) continue; // step 1 already ruled this one out
      const listed = await this.client.listPulls(repo.id);
      if (!listed.ok) continue; // one unreadable repository must not sink the lookup
      this.pulls.set(repo.id, listed.data);
      if (listed.data.some((pull) => idOf(pull) === prId)) return toResolvedRepo(repo);
    }

    this.log.debug('pull uuid resolved, repository not identifiable', { pr_id: prId });
    return null;
  }

  /** Step 1 of `repoHoldingPull`, split out so the expensive path can reuse it. */
  private repoFromCachedPulls(prId: string): ResolvedRepo | null {
    for (const [repoId, pulls] of this.pulls) {
      if (!pulls.some((pull) => idOf(pull) === prId)) continue;
      const hit = (this.repos ?? []).find((repo) => repo.id === repoId);
      if (hit !== undefined) return toResolvedRepo(hit);
    }
    return null;
  }

  /**
   * `GET /agents`, memoised for the process.
   *
   * This exists to enrich `unknownAgentMessage`, not to serve
   * `devdigest_list_agents`: a tool whose whole job is to return the agents that
   * exist right now must call `ApiClient.listAgents()` itself, or it would hand
   * the model a list that went stale when this process started.
   */
  async agents(): Promise<ApiResult<readonly Agent[]>> {
    const cached = this.agentList;
    if (cached !== null) return { ok: true, data: cached };

    const fetched = await this.client.listAgents();
    if (!fetched.ok) return fetched;
    this.agentList = fetched.data;
    return { ok: true, data: fetched.data };
  }

  /**
   * The one agent-shaped check in this file: the text for an agent id the API
   * answered 404 for. Agents are never resolved by NAME (`agents.name` carries
   * no unique constraint, so a name can legally address two agents), so this
   * does not try to guess what the caller meant — it names the ids that exist
   * and the call that produces them.
   *
   * Never throws: if the agent list cannot be read either, it says so and still
   * names the next call.
   */
  async unknownAgentMessage(agentId: string): Promise<string> {
    const agents = await this.agents();
    if (!agents.ok) {
      this.log.warn('could not list agents while explaining an unknown agent id', {
        kind: agents.failure.kind,
      });
      return unlistableAgentsMessage(agentId);
    }
    return unknownAgentMessage(agentId, agents.data);
  }
}
