/**
 * shape.ts — the projection layer: pure functions from a DevDigest API payload to
 * the small, ordered structure a tool answers with.
 *
 * Three properties, and each one is a rule rather than a preference:
 *
 *  1. **No I/O of any kind.** No `fetch`, no `process`, no clock, no randomness.
 *     Every function here is a function of its arguments alone, which is what
 *     makes the reductions below assertable in `test/shape.test.ts` without a
 *     server, and what keeps the traps documented here in one place instead of
 *     re-derived inside five tools.
 *  2. **Never a passthrough.** Every projection is an explicit allowlist of
 *     fields. That is not tidiness: the payloads this server reads carry
 *     `system_prompt` (thousands of tokens), a whole `scan`/`budget` envelope,
 *     verified `evidence` snippets, and per-row ids the model has no use for. A
 *     spread would ship all of it the first time the contract grew a field.
 *  3. **Every order is TOTAL.** A list a client renders in order and a list a
 *     model reads are the same problem: `ORDER BY <score> DESC` with no
 *     tiebreaker is the ABSENCE of an order, and Postgres will happily return a
 *     tie group in whatever physical order it read the heap — which changes when
 *     a row is updated (`server/INSIGHTS.md`, 2026-08-06). So every comparator
 *     here ends on a unique column, and the tests assert the returned ids equal
 *     the SORTED ids: asserting "unchanged" passes without the fix.
 *
 * What lives here and not in a tool: `latestReviewPerAgent`, `aggregateVerdict`
 * and `aggregateScore` are only needed by `devdigest_get_findings` on the
 * `repo`+`pr` path (one review per agent fans out over N agents), but they are
 * pure reductions over a list, so this is where they can be tested.
 */
import type {
  ConventionCategory,
  ConventionsPayload,
  ExtractedConvention,
  FindingCategory,
  FindingRecord,
  FindingsBySeverity,
  PrBlastRadius,
  ReviewRecord,
  Severity,
  Verdict,
} from '@devdigest/shared';

/**
 * `response_format` — the name is fixed by the tool contract (not `detail`).
 * `concise` is the default everywhere; `detailed` adds prose fields and nothing
 * else, so the two differ in SIZE, never in which rows are returned.
 */
export type ResponseFormat = 'concise' | 'detailed';

/** Longest prose field a `detailed` projection carries, in characters. */
export const MAX_PROSE_CHARS = 1200;

/** Findings returned when the caller passes no `limit`. */
export const DEFAULT_FINDINGS_LIMIT = 20;

/**
 * Ceiling on `limit`. A `detailed` finding can carry 2×`MAX_PROSE_CHARS`, so 50
 * of them is already a large answer; a caller wanting more pages through with
 * `offset` rather than raising this.
 */
export const MAX_FINDINGS_LIMIT = 50;

/** Conventions returned in one answer. There is no paging on that tool. */
export const MAX_CONVENTIONS = 30;

/** Longest evidence snippet a `detailed` convention carries. */
export const MAX_SNIPPET_CHARS = 400;

/** Evidence citations kept per convention in `detailed`. */
export const MAX_EVIDENCE_PER_CONVENTION = 3;

// --------------------------------------------------------------------------
// Ranks and small helpers
// --------------------------------------------------------------------------

/** Worst first. `Record<Severity, …>` so a fourth severity fails to compile. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/**
 * Worst first: `request_changes` gates a pull request, `comment` does not block
 * it, `approve` is the absence of an objection.
 */
const VERDICT_RANK: Record<Verdict, number> = {
  request_changes: 0,
  comment: 1,
  approve: 2,
};

/**
 * Byte-order comparison, deliberately not `localeCompare`: the order has to be
 * the same on every machine and in every locale, because it is what the tests
 * pin and what a caller pages through.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** At most `max` characters INCLUDING the ellipsis, so the cap is a real cap. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

/**
 * `"13-19"`, or `"13"` for a single line. One string rather than two numbers:
 * the model reads it, it never does arithmetic on it, and a range printed as two
 * fields costs two keys per finding.
 */
function formatLines(startLine: number, endLine: number): string {
  return endLine > startLine ? `${startLine}-${endLine}` : String(startLine);
}

// --------------------------------------------------------------------------
// 1. One review per agent
// --------------------------------------------------------------------------

/**
 * The per-agent bucket key.
 *
 * `reviews.agent_id` carries **no foreign key and no `notNull`**
 * (`server/src/db/schema/reviews.ts`), so keying a `Map` on the raw value
 * collapses every agent-deleted row into a single bucket and a reduction over it
 * then drops all but one — no error, just a quietly smaller answer
 * (`server/INSIGHTS.md`, 2026-08-03). The `row:` prefix is what makes a fallback
 * key unable to collide with a real agent id.
 */
export function reviewAgentKey(review: Pick<ReviewRecord, 'agent_id' | 'id'>): string {
  return review.agent_id ?? `row:${review.id}`;
}

/**
 * Newest first, and TOTAL: `created_at` descending with `id` ascending as the
 * tiebreaker.
 *
 * The tiebreaker is load-bearing rather than defensive. `reviewsForPull` orders
 * on `desc(createdAt)` alone, and the executor writes a run's rows inside one
 * transaction where `now()` is transaction-scoped — so rows genuinely share a
 * timestamp and the server returns them in no defined order at all
 * (`server/INSIGHTS.md`, 2026-08-06).
 *
 * `created_at` is a string in the contract. It is compared as a timestamp when
 * both sides parse and byte-wise otherwise, so the comparator stays total even
 * for a value this package never has to trust.
 */
function compareReviewsNewestFirst(a: ReviewRecord, b: ReviewRecord): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  const bothParsed = !Number.isNaN(at) && !Number.isNaN(bt);

  if (bothParsed) {
    if (at !== bt) return bt - at;
  } else if (a.created_at !== b.created_at) {
    return compareText(b.created_at, a.created_at);
  }
  return compareText(a.id, b.id);
}

/**
 * The newest `kind: 'review'` row per agent, newest agent first.
 *
 * Three traps, each one a journal entry rather than a guess:
 *
 *  - **`kind` is not filtered by the server.** `reviewsForPull` returns every
 *    row of the pull request, and a `kind: 'summary'` row is a different thing
 *    with its own verdict and score (`server/INSIGHTS.md`, 2026-08-03). Folding
 *    one into a per-agent reduction silently double-counts a PR.
 *  - **The order has to be re-established here** (see
 *    `compareReviewsNewestFirst`).
 *  - **The bucket key needs a fallback** (see `reviewAgentKey`).
 *
 * Re-running one agent therefore REPLACES that agent's row instead of adding to
 * it, which is the same basis `PrMeta.score` and `PrMeta.cost_usd` use.
 */
export function latestReviewPerAgent(reviews: readonly ReviewRecord[]): ReviewRecord[] {
  const ordered = reviews
    .filter((review) => review.kind === 'review')
    .sort(compareReviewsNewestFirst);

  const seen = new Set<string>();
  const latest: ReviewRecord[] = [];
  for (const review of ordered) {
    const key = reviewAgentKey(review);
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(review);
  }
  return latest;
}

// --------------------------------------------------------------------------
// 2. Findings
// --------------------------------------------------------------------------

/**
 * One finding, as a tool answers it.
 *
 * The fields are an allowlist. What a `FindingRecord` also carries and this
 * deliberately drops: `id`, `review_id`, `accepted_at`, `dismissed_at` (row
 * identity and triage state the model cannot act on), `start_line`/`end_line`
 * (folded into `lines`), `kind`, `scope`, `trifecta_components` and the
 * finding's own `evidence` array.
 */
export interface ShapedFinding {
  readonly severity: Severity;
  readonly category: FindingCategory;
  readonly title: string;
  /** Repo-relative path, exactly as the finding cites it. */
  readonly file: string;
  /** `"13-19"`, or `"13"` when the finding is one line. */
  readonly lines: string;
  readonly confidence: number;
  /** `detailed` only, capped at `MAX_PROSE_CHARS`. */
  readonly rationale?: string;
  /** `detailed` only, capped at `MAX_PROSE_CHARS`; absent when there is none. */
  readonly suggestion?: string;
}

export interface ShapeFindingsOptions {
  /** Defaults to `concise`. */
  readonly format?: ResponseFormat;
  /** Defaults to 0. Counted over the ORDERED, non-dismissed list. */
  readonly offset?: number;
  /** Defaults to `DEFAULT_FINDINGS_LIMIT`, clamped to `MAX_FINDINGS_LIMIT`. */
  readonly limit?: number;
}

export interface ShapedFindings {
  /** Findings after dismissed ones are dropped, BEFORE the cap. */
  readonly total: number;
  /** Per severity over those same `total` findings — never over the page. */
  readonly counts: FindingsBySeverity;
  /** The offset actually applied, after clamping. */
  readonly offset: number;
  readonly findings: readonly ShapedFinding[];
  /** Present only when the page is not the whole list; says how to narrow. */
  readonly truncated?: string;
}

/**
 * The TOTAL order over findings: severity, then confidence descending, then
 * `file`, then `start_line`, then `id`.
 *
 * Severity leads because it is the feature's thesis — a list of review findings
 * is read worst-first — and `id` closes it because everything above it ties in
 * practice: one file, one line, one confidence value shared by a whole batch.
 */
function compareFindings(a: FindingRecord, b: FindingRecord): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;

  const byFile = compareText(a.file, b.file);
  if (byFile !== 0) return byFile;
  if (a.start_line !== b.start_line) return a.start_line - b.start_line;
  return compareText(a.id, b.id);
}

function projectFinding(finding: FindingRecord, format: ResponseFormat): ShapedFinding {
  const base: ShapedFinding = {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    lines: formatLines(finding.start_line, finding.end_line),
    confidence: finding.confidence,
  };
  if (format === 'concise') return base;

  // `suggestion` is nullish in the contract, and an empty one is no suggestion:
  // an absent key costs nothing, `"suggestion": ""` costs a key and says nothing.
  const suggestion = finding.suggestion ?? '';
  return {
    ...base,
    rationale: capText(finding.rationale, MAX_PROSE_CHARS),
    ...(suggestion === '' ? {} : { suggestion: capText(suggestion, MAX_PROSE_CHARS) }),
  };
}

/** How many findings a page may hold, given what the caller asked for. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_FINDINGS_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_FINDINGS_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/**
 * A truncation notice that names the next call, not just the fact of the cap.
 *
 * "5 of 23 shown" leaves the model to invent how to see the rest; naming the
 * exact `offset` to pass makes the follow-up mechanical. The tail says what was
 * left out, because the order is worst-first and that is what makes a partial
 * answer safe to act on.
 */
function findingsTruncationNotice(input: {
  readonly total: number;
  readonly offset: number;
  readonly shown: number;
}): string {
  const { total, offset, shown } = input;
  if (shown === 0) {
    return (
      `No findings at offset ${offset}: this review has ${total} of them, so the last ` +
      `page starts before that. Retry devdigest_get_findings with a smaller offset ` +
      `(0 shows the most serious findings first).`
    );
  }
  const next = offset + shown;
  const remaining = total - next;
  const tail =
    remaining > 0
      ? `Call devdigest_get_findings again with offset ${next} for the next ${remaining}, ` +
        'or retry it with a smaller limit. '
      : 'Retry devdigest_get_findings with offset 0 to re-read the most serious ones. ';
  return (
    `Showing findings ${offset + 1}-${next} of ${total}, ordered worst first (severity, ` +
    `then confidence). ${tail}` +
    'Nothing was dropped for being wrong - what is not shown is lower severity or lower ' +
    'confidence.'
  );
}

/**
 * Dismissed dropped, ordered worst-first, projected, then paged.
 *
 * The step order is the contract: `counts` and `total` are computed **before**
 * the cap, so a capped answer still reports how many findings the review really
 * has. A page count would make the model read "1 CRITICAL" off an answer that
 * happens to show one of four.
 *
 * A dismissed finding is a human decision that it is not a problem here. It is
 * dropped rather than labelled, because a labelled one still costs tokens and
 * still invites the model to argue with the human who dismissed it.
 */
export function shapeFindings(
  findings: readonly FindingRecord[],
  options: ShapeFindingsOptions = {},
): ShapedFindings {
  const format = options.format ?? 'concise';
  const kept = findings
    .filter((finding) => finding.dismissed_at === null)
    .sort(compareFindings);

  const counts = countsBySeverity(kept);
  const offset = clampOffset(options.offset);
  const limit = clampLimit(options.limit);
  const page = kept.slice(offset, offset + limit);
  const shaped = page.map((finding) => projectFinding(finding, format));

  const complete = offset === 0 && shaped.length === kept.length;
  return {
    total: kept.length,
    counts,
    offset,
    findings: shaped,
    ...(complete
      ? {}
      : {
          truncated: findingsTruncationNotice({
            total: kept.length,
            offset,
            shown: shaped.length,
          }),
        }),
  };
}

// --------------------------------------------------------------------------
// 3. + 4. Aggregating over the agents that reviewed one pull request
// --------------------------------------------------------------------------

/**
 * The worst verdict wins.
 *
 * A review fans out over N agents, each with its own verdict, and one agent
 * asking for changes is not cancelled by another approving: the pull request is
 * gated. `null` when no agent recorded a verdict at all — which is not
 * `approve`, and must not be reported as one.
 */
export function aggregateVerdict(
  reviews: readonly { readonly verdict: Verdict | null }[],
): Verdict | null {
  let worst: Verdict | null = null;
  for (const review of reviews) {
    const verdict = review.verdict;
    if (verdict === null) continue;
    if (worst === null || VERDICT_RANK[verdict] < VERDICT_RANK[worst]) worst = verdict;
  }
  return worst;
}

/**
 * The MINIMUM score across the agents that reviewed the pull request.
 *
 * Not an average, and this is settled rather than a choice: the contract says so
 * where the number is defined. `PrMeta.score`
 * (`server/src/vendor/shared/contracts/platform.ts`) is documented as
 *
 *   "LOWEST score across the agents that reviewed this PR - a review fans out
 *    over N agents, and the worst verdict gates the PR"
 *
 * so the score this server reports for a pull request and the score the
 * DevDigest studio shows for the same pull request are the same number. An
 * average would silently disagree with the UI, and would let a lenient agent
 * dilute a security agent's 20.
 *
 * `null` when no agent recorded a score (see also `server/INSIGHTS.md`,
 * 2026-08-03: `agent_runs.score` was added with no backfill, so the real figure
 * lives on the review row).
 */
export function aggregateScore(
  reviews: readonly { readonly score: number | null }[],
): number | null {
  let lowest: number | null = null;
  for (const review of reviews) {
    const score = review.score;
    if (score === null) continue;
    if (lowest === null || score < lowest) lowest = score;
  }
  return lowest;
}

// --------------------------------------------------------------------------
// 5. Counts
// --------------------------------------------------------------------------

/**
 * Findings per severity, over exactly the list given.
 *
 * Callers pass the full non-dismissed list — `shapeFindings` calls this before
 * it pages, which is what makes "counts are not page counts" structural rather
 * than remembered. Keys mirror `Severity` exactly, so this is the same shape as
 * `PrMeta.findings_by_severity` and `AgentStats.findings_by_severity`.
 */
export function countsBySeverity(
  findings: readonly Pick<FindingRecord, 'severity'>[],
): FindingsBySeverity {
  const counts: FindingsBySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

// --------------------------------------------------------------------------
// 6. Conventions
// --------------------------------------------------------------------------

/** One verified citation, `detailed` only. */
export interface ShapedEvidence {
  readonly file: string;
  readonly lines: string;
  /** The lines as they appear in the file, capped at `MAX_SNIPPET_CHARS`. */
  readonly snippet: string;
}

/**
 * One house rule, as a tool answers it.
 *
 * Always dropped, whatever the format: `id`, `edited`, `skill_id`, `created_at`,
 * `status` (reduced to `accepted`) and `adherence`. `evidence` appears only in
 * `detailed` — verified snippets are by far the biggest token sink in this
 * payload, and `file`/`lines` already carry the citation a caller needs to go
 * look.
 */
export interface ShapedConvention {
  readonly rule: string;
  readonly category: ConventionCategory;
  /** The first citation's path — the place to go read the rule in practice. */
  readonly file: string;
  readonly lines: string;
  /** 0..1, measured from adherence rather than claimed by the model. */
  readonly confidence: number;
  /** A human accepted this rule. `false` covers both pending and rejected. */
  readonly accepted: boolean;
  /** `detailed` only, capped at `MAX_PROSE_CHARS`. */
  readonly rationale?: string;
  /** `detailed` only. NEVER present in `concise`. */
  readonly evidence?: readonly ShapedEvidence[];
}

export interface ShapeConventionsOptions {
  /** Defaults to `concise`. */
  readonly format?: ResponseFormat;
}

export interface ShapedConventions {
  /** `owner/name`, so an answer names the repository it describes. */
  readonly repo: string;
  /** `false` = never scanned. The two empty cases are NOT the same answer. */
  readonly scanned: boolean;
  /** Candidates the scan kept, before the cap. */
  readonly count: number;
  readonly accepted_count: number;
  readonly conventions: readonly ShapedConvention[];
  /** Present only when the cap hid rows. */
  readonly truncated?: string;
  /** Present only on the two empty cases; each one says something different. */
  readonly next_step?: string;
}

/**
 * Triage rank: accepted first, then untriaged, then rejected.
 *
 * The plan's order is "accepted first"; the split of the remainder is a
 * refinement with a reason. `rejected` is a human saying "this is not a rule
 * here", so ranking it alongside `pending` would let a rejected candidate with
 * 0.95 confidence outrank a pending one with 0.6 and be read as a house rule.
 * Nothing is hidden — every candidate is still returned, as the contract
 * requires.
 */
function triageRank(convention: ExtractedConvention): number {
  switch (convention.status) {
    case 'accepted':
      return 0;
    case 'pending':
      return 1;
    case 'rejected':
      return 2;
  }
}

/**
 * TOTAL order: triage, then confidence descending, then `category`, then `rule`,
 * then `id`.
 *
 * `id` never reaches the output and is still needed here: conventions tie on
 * confidence constantly (a measured 62/62 is `1.0`, and so is the next one), and
 * every candidate of one scan is written in a single statement, so `created_at`
 * ties too (`server/INSIGHTS.md`, 2026-08-06).
 */
function compareConventions(a: ExtractedConvention, b: ExtractedConvention): number {
  const byTriage = triageRank(a) - triageRank(b);
  if (byTriage !== 0) return byTriage;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;

  const byCategory = compareText(a.category, b.category);
  if (byCategory !== 0) return byCategory;
  const byRule = compareText(a.rule, b.rule);
  if (byRule !== 0) return byRule;
  return compareText(a.id, b.id);
}

function projectEvidence(evidence: ExtractedConvention['evidence']): ShapedEvidence[] {
  return evidence.slice(0, MAX_EVIDENCE_PER_CONVENTION).map((citation) => ({
    file: citation.path,
    lines: formatLines(citation.start_line, citation.end_line),
    snippet: capText(citation.snippet, MAX_SNIPPET_CHARS),
  }));
}

function projectConvention(
  convention: ExtractedConvention,
  format: ResponseFormat,
): ShapedConvention {
  // `evidence` is `.min(1)` in the contract, but this package parses what the
  // API sent rather than trusting the annotation, and an indexed read is
  // `T | undefined` under `noUncheckedIndexedAccess` either way.
  const first = convention.evidence.at(0);
  const base: ShapedConvention = {
    rule: convention.rule,
    category: convention.category,
    file: first?.path ?? '',
    lines: first === undefined ? '' : formatLines(first.start_line, first.end_line),
    confidence: convention.confidence,
    accepted: convention.status === 'accepted',
  };
  if (format === 'concise') return base;

  return {
    ...base,
    rationale: capText(convention.rationale, MAX_PROSE_CHARS),
    evidence: projectEvidence(convention.evidence),
  };
}

/**
 * Never scanned. The absence of rules is not the absence of a scan, and this is
 * the message that keeps the model from concluding the first thing.
 */
function neverScannedNextStep(repo: string): string {
  return (
    `DevDigest has never extracted conventions for ${repo}, so this empty result is not ` +
    'evidence that the repository has no house rules - nothing has been scanned. Open the ' +
    'Conventions screen for that repository in the DevDigest studio and run a scan, then ' +
    'retry this tool. Until then, check the repository\'s own CLAUDE.md, README and the ' +
    'files next to the one you are changing before proposing code.'
  );
}

/**
 * Scanned, and nothing survived. A different fact from "never scanned" and it
 * needs a different instruction: re-running the scan is what changes this
 * answer, and the reason the list is empty is a floor the extractor applied.
 */
function scannedEmptyNextStep(repo: string): string {
  return (
    `DevDigest has scanned ${repo} for conventions and kept none: every candidate was ` +
    'dropped because its evidence could not be verified against the clone, or because the ' +
    'rule held in too few places to count as a convention. That is a measurement, not a ' +
    'licence - do not read it as "anything goes". Re-run the scan from the Conventions ' +
    'screen in the DevDigest studio if the repository has changed since, and meanwhile ' +
    'check the files next to the one you are changing for the local style.'
  );
}

function conventionsTruncationNotice(input: {
  readonly repo: string;
  readonly total: number;
  readonly shown: number;
}): string {
  return (
    `Showing ${input.shown} of ${input.total} conventions for ${input.repo}, accepted ` +
    'first and then by measured confidence. This tool has no paging: the ones left out ' +
    'are the lower-confidence and untriaged candidates, and response_format:\'detailed\' ' +
    'adds evidence to these rows rather than more rows. Read the rest on the Conventions ' +
    'screen for that repository in the DevDigest studio, and check a specific rule there ' +
    'if you need one that is missing here.'
  );
}

/**
 * The whole `ConventionsPayload` reduced to the rules and their triage state.
 *
 * Two things this drops on every path, and both are the point of the function:
 *
 *  - **The `scan` and `budget` envelope.** Twenty-odd counters about the scan
 *    itself (`eligible_files`, `planned_tokens`, `dropped_low_adherence`,
 *    `can_scan`, …). They are what the Conventions screen renders; a model
 *    proposing code has no use for any of them, and `scan.error` can carry a
 *    stack.
 *  - **`evidence` in `concise`.** See `ShapedConvention`.
 *
 * ALL candidates are returned, each with `accepted`, not only the accepted ones:
 * a repository whose candidates nobody has triaged yet would otherwise answer
 * "no conventions" while holding twenty measured ones.
 *
 * The two empty cases are deliberately distinguishable. `scan === null` means
 * nothing was ever measured; a scan with no surviving candidates means the
 * extractor measured and kept nothing. A model cannot tell those apart from an
 * empty array, and they call for different actions — hence `scanned` plus two
 * different `next_step` texts.
 */
export function shapeConventions(
  payload: ConventionsPayload,
  options: ShapeConventionsOptions = {},
): ShapedConventions {
  const format = options.format ?? 'concise';
  const repo = payload.repo.full_name;
  const scanned = payload.scan !== null;
  const ordered = [...payload.candidates].sort(compareConventions);
  const accepted = ordered.filter((convention) => convention.status === 'accepted').length;

  if (ordered.length === 0) {
    return {
      repo,
      scanned,
      count: 0,
      accepted_count: 0,
      conventions: [],
      next_step: scanned ? scannedEmptyNextStep(repo) : neverScannedNextStep(repo),
    };
  }

  const page = ordered.slice(0, MAX_CONVENTIONS);
  return {
    repo,
    scanned,
    count: ordered.length,
    accepted_count: accepted,
    conventions: page.map((convention) => projectConvention(convention, format)),
    ...(page.length === ordered.length
      ? {}
      : {
          truncated: conventionsTruncationNotice({
            repo,
            total: ordered.length,
            shown: page.length,
          }),
        }),
  };
}

// --------------------------------------------------------------------------
// 7. Blast radius
// --------------------------------------------------------------------------

/**
 * Cap on symbol rows in one answer.
 *
 * A PR touching fifty files declares hundreds of symbols, and the ones worth a
 * reviewer's attention are the few with the most callers — the server already sorts
 * most-impacted-first, so a prefix is the useful part rather than an arbitrary slice.
 */
export const MAX_BLAST_SYMBOLS = 10;

/** Cap on caller rows per symbol in `concise`. The server caps at 20 per symbol. */
export const MAX_BLAST_CALLERS_CONCISE = 5;

/** Cap on endpoint/cron entries in one answer. */
export const MAX_BLAST_IMPACTED = 25;

/** One caller of a changed symbol: `file:line`, and what encloses it. */
export interface ShapedBlastCaller {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
}

/** One changed symbol with what depends on it. */
export interface ShapedBlastSymbol {
  readonly symbol: string;
  readonly file: string;
  readonly caller_count: number;
  readonly callers: readonly ShapedBlastCaller[];
  /** Present only when `callers` is shorter than `caller_count`. */
  readonly callers_truncated?: true;
  readonly endpoints?: readonly string[];
  readonly crons?: readonly string[];
}

/**
 * The impact map as a tool answers it.
 *
 * `status` and `reason` are FIRST and never omitted, for the same reason the stub
 * this replaced put `implemented: false` first: a model reads top-down, and an empty
 * `symbols` array must be met by the explanation before it is met by the emptiness.
 * `next_step` says what to do about a non-`ok` status, and — crucially — names the
 * inference that must not be drawn from it.
 */
export interface ShapedBlastRadius {
  /** Absent when the pull request was addressed by uuid and its repo is unnamed. */
  readonly repo?: string;
  readonly pr: number;
  readonly status: 'ok' | 'partial' | 'degraded';
  readonly reason?: string;
  readonly counts: { symbols: number; callers: number; endpoints: number; crons: number };
  readonly changed_files: readonly string[];
  readonly symbols: readonly ShapedBlastSymbol[];
  /** Endpoints and crons across the whole map, "METHOD /path" or a job name. */
  readonly impacted: readonly string[];
  readonly symbols_truncated?: string;
  readonly next_step?: string;
}

export interface ShapeBlastOptions {
  readonly format?: 'concise' | 'detailed';
}

/**
 * What to do next, per status — and what NOT to conclude.
 *
 * The `degraded` text is the important one and is inherited from the stub's fifth
 * property: "no data" invites "so there is no impact", and that inference is exactly
 * the failure this feature exists to prevent. Saying it plainly costs one sentence.
 */
function blastNextStep(
  status: string,
  reason: string | null,
  repoOrNull: string | null,
): string | undefined {
  // "this repository" reads correctly when the name is unknown, and no sentence
  // below has to branch on it.
  const repo = repoOrNull ?? 'this repository';
  if (status === 'ok') return undefined;
  if (status === 'partial') {
    return (
      `The codebase index for ${repo} covers only part of the repository, so callers may be ` +
      `missing. Do NOT read an absent caller as proof there is none. Open the DevDigest studio ` +
      `and re-index ${repo} for a complete map.`
    );
  }
  const because =
    reason === 'no_changed_files'
      ? `this pull request's changed files have not been imported yet`
      : reason === 'flag_off'
        ? `codebase indexing is turned off for this workspace`
        : `${repo} has no usable codebase index`;
  return (
    `No impact map could be built because ${because}. Nothing was analysed, so do NOT infer ` +
    `that this pull request has no callers or no impacted endpoints. Read the changed files ` +
    `directly, or index ${repo} in the DevDigest studio, instead.`
  );
}

/**
 * `PrBlastRadius` → the tool payload.
 *
 * Nothing here re-derives a fact. The order of `downstream` and of each `callers`
 * list is the server's importance ranking and is preserved; this function only
 * truncates and renames. `counts` is passed through verbatim rather than recomputed
 * from the truncated rows, so the figures keep describing the whole map — a caller
 * that sees `callers: 14` above five rows is reading it correctly.
 */
export function shapeBlastRadius(
  blast: PrBlastRadius,
  meta: { repo: string | null; pr: number },
  options: ShapeBlastOptions = {},
): ShapedBlastRadius {
  const detailed = (options.format ?? 'concise') === 'detailed';
  const callerCap = detailed ? Number.POSITIVE_INFINITY : MAX_BLAST_CALLERS_CONCISE;

  const page = blast.downstream.slice(0, MAX_BLAST_SYMBOLS);
  const symbols: ShapedBlastSymbol[] = page.map((d) => {
    const callers = d.callers.slice(0, callerCap);
    return {
      symbol: d.symbol,
      file: d.file,
      caller_count: d.caller_count,
      callers: callers.map((c) => ({ file: c.file, line: c.line, symbol: c.name })),
      ...(callers.length < d.caller_count ? { callers_truncated: true as const } : {}),
      ...(d.endpoints_affected.length > 0 ? { endpoints: d.endpoints_affected } : {}),
      ...(d.crons_affected.length > 0 ? { crons: d.crons_affected } : {}),
    };
  });

  const nextStep = blastNextStep(blast.status, blast.reason, meta.repo);
  return {
    // Omitted rather than nulled or faked: a `repo` key holding a placeholder is
    // worse than its absence, because a model will quote it back.
    ...(meta.repo === null ? {} : { repo: meta.repo }),
    pr: meta.pr,
    status: blast.status,
    ...(blast.reason === null ? {} : { reason: blast.reason }),
    counts: blast.counts,
    changed_files: blast.changed_files,
    symbols,
    impacted: blast.impacted.slice(0, MAX_BLAST_IMPACTED).map((e) => e.label),
    ...(page.length < blast.downstream.length
      ? {
          symbols_truncated:
            `Showing the ${page.length} most-impacted of ${blast.downstream.length} changed ` +
            `symbols, ranked by caller count. Open pull request ${meta.pr} in the DevDigest ` +
            `studio for the whole map.`,
        }
      : {}),
    ...(nextStep === undefined ? {} : { next_step: nextStep }),
  };
}
