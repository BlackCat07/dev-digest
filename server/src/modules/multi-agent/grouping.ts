/**
 * Multi-Agent Review — where the agents disagree, derived on read. Pure.
 *
 * Everything arrives as an argument: no database, no container, no clock, no
 * `node:` specifier and no provider is in reach, so every rule below is testable
 * against plain objects — which is what `test/multi-agent-grouping.test.ts` does.
 * Groups are **computed, never persisted** (N-5): this file reads no row, writes
 * no row and modifies no finding (AC-33). The caller hands it the multi-run's
 * columns and gets `Conflict[]` back.
 *
 * **THE ENTRY CONDITION IS THE THING TO READ TWICE.** A group is emitted when at
 * least one agent of the multi-run flagged the location **and at least one other
 * did not** (AC-29). A single flagger is legal and is the common shape. A
 * location that **every** agent flagged emits **no group at all** (AC-100) — that
 * looks like a bug and is not: the block is named *where agents disagree*, and a
 * location the whole panel agreed on is the one case with no disagreement in it.
 * A one-agent multi-run therefore emits nothing, because there is no second agent
 * available to be silent (EC-8).
 *
 * The stricter "two or more distinct agents flagged it" rule is **not** this
 * module's: it was SPEC-06's original condition, it renders the design's own
 * reference screen with zero panels, and it survives as the client's
 * `Show only conflicts` filter (AC-81), which asks a different question of an
 * already-emitted group.
 *
 * **TITLES ARE THE FALLBACK RULE ONLY** (AC-31): the title of the group's
 * highest-severity finding, ties broken by lowest start line and then by lowest
 * finding id. A multi-run may also carry a *synthesised* label per group, which
 * overrides that title — but the synthesis is a model call, this module never
 * makes one and never sees a label, and the service merges the labels in over
 * what this returns. The fallback is the common case, not the rare one: synthesis
 * fires only once every run is terminal, so every poll taken while the fan-out is
 * in flight renders under this rule, and so does every read after a synthesis
 * failure (AC-38).
 *
 * **THE AGENT KEY IS PREFIXED.** `agent_runs.agent_id` is nullable
 * (`ON DELETE SET NULL`), so keying a per-agent map on the raw value collapses
 * every agent-deleted row into one bucket. The key is
 * `agent_id ?? 'run:' + run_id` — prefixed, so a run id can never be mistaken for
 * an agent id (EC-2, `server/INSIGHTS.md` 2026-08-03).
 *
 * **THE SIMILARITY RULE IS RE-DERIVED HERE ON PURPOSE.** `reviewer-core`'s eval
 * scorer has a `covers`/`normalise` pair that looks like this one; they are
 * module-private, they must not be imported, and they answer a different
 * question anyway — the scorer compares a finding to a fixed anchor, this
 * compares two findings to each other. `modules/brief/grounding.ts` re-derives
 * `modules/intent/risks.ts`'s two rules for the same reason.
 */
import type { AgentColumnFinding, Conflict, ConflictTake, Severity } from '@devdigest/shared';

import { MIN_TITLE_TOKEN_LENGTH, TITLE_SIMILARITY_THRESHOLD } from './constants.js';

// ---------------------------------------------------------------------------
// What grouping needs to be handed
// ---------------------------------------------------------------------------

/**
 * One finding, reduced to the fields the rule reads.
 *
 * A structural subset of `AgentColumnFinding`, so the service can pass the
 * columns it already built without mapping them, while a test can build a
 * six-field literal instead of a fourteen-field one.
 */
export type GroupableFinding = Pick<
  AgentColumnFinding,
  'id' | 'severity' | 'title' | 'file' | 'start_line' | 'end_line'
>;

/**
 * One agent of the multi-run and everything it reported.
 *
 * A structural subset of `AgentColumn`, with one widening: `agent_id` is
 * `string | null` here because the run row's column is nullable and the caller
 * may not have resolved a name for it yet. A column whose `agent_id` is a plain
 * `string` satisfies this type unchanged.
 *
 * **Every column of the multi-run must be passed, including the failed, the
 * cancelled and the still-running ones.** The stance list is one per agent *of
 * the multi-run*, not one per flagging agent (AC-30), and the entry condition
 * counts silence — so a column omitted here is an agent whose silence is
 * invisible, which changes both which groups exist and what they say (EC-7).
 */
export interface GroupableColumn {
  readonly run_id: string;
  readonly agent_id: string | null;
  readonly agent_name: string;
  readonly findings: readonly GroupableFinding[];
}

/** An inclusive line range, `start <= end` by construction. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// The three rules a group is built out of
// ---------------------------------------------------------------------------

/**
 * The stable per-agent key of one column (EC-2).
 *
 * Prefixed on the fallback path so a run id can never collide with an agent id.
 * It is also what a stance reports as its `agent_id`, so a stance produced by an
 * agent-deleted run still names something the column list can be joined on
 * (AC-34).
 */
export function agentKey(column: Pick<GroupableColumn, 'agent_id' | 'run_id'>): string {
  return column.agent_id ?? `run:${column.run_id}`;
}

/**
 * A title as a token set (AC-27): lowercased, split on every character that is
 * not a letter or a digit, tokens shorter than {@link MIN_TITLE_TOKEN_LENGTH}
 * discarded and **nothing else discarded**.
 *
 * `"Hard-coded 3600: a magic number!"` becomes `{hard, coded, 3600, magic,
 * number}`. The digits survive because a magic number's value is the most
 * identifying token it has; `"a"` goes by the length rule. There is no stop-word
 * list and none is to be added without the measurement
 * `TITLE_SIMILARITY_THRESHOLD` names.
 */
export function normaliseTitle(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= MIN_TITLE_TOKEN_LENGTH) tokens.add(token);
  }
  return tokens;
}

/**
 * Jaccard index of two token sets — intersection over union (AC-26).
 *
 * Two empty sets score **0, not 1**: a title that normalises to nothing (every
 * token under the length rule) says nothing about which problem it names, so it
 * is never "the same problem" as another one. Left as `0/0 = NaN` it would fail
 * the comparison anyway; returning 0 makes that deliberate rather than accidental.
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Whether two already-normalised token sets clear {@link TITLE_SIMILARITY_THRESHOLD}. */
export function tokensSimilar(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return jaccard(a, b) >= TITLE_SIMILARITY_THRESHOLD;
}

/**
 * Whether two raw titles name the same problem (AC-26).
 *
 * The convenience form. The grouping loop uses {@link tokensSimilar} against
 * token sets it normalised once per finding, because this one normalises on
 * every comparison.
 */
export function titlesSimilar(a: string, b: string): boolean {
  return tokensSimilar(normaliseTitle(a), normaliseTitle(b));
}

/**
 * A finding's line range, inverted ends swapped before anything intersects them
 * (EC-12).
 *
 * `start_line` is not guaranteed to be the smaller of the two — it is whatever a
 * model produced and the grounding gate let through — and an un-normalised
 * inverted range intersects nothing at all, so the finding would silently group
 * with no other.
 */
export function normaliseRange(start: number, end: number): LineRange {
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Inclusive intersection: ranges touching at a single line count (AC-25). */
function rangesIntersect(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Highest first. `Record<Severity, …>` so a fourth severity breaks this file. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** One finding plus everything derived from it once, rather than per comparison. */
interface Entry {
  /** The {@link agentKey} of the column that reported it. */
  readonly key: string;
  readonly finding: GroupableFinding;
  readonly tokens: ReadonlySet<string>;
  readonly range: LineRange;
}

/** Same file, intersecting inclusive ranges, similar titles — all three (AC-25). */
function sameLocation(a: Entry, b: Entry): boolean {
  return (
    a.finding.file === b.finding.file &&
    rangesIntersect(a.range, b.range) &&
    tokensSimilar(a.tokens, b.tokens)
  );
}

/** A cluster after the ordering keys have been derived from it. */
interface Group {
  readonly file: string;
  readonly line: number;
  readonly title: string;
  /** Lowest finding id in the cluster — the last resort of the total order. */
  readonly tiebreakId: string;
  readonly takes: ConflictTake[];
}

/** `a < b ? -1 : …`, so ordering never depends on a locale or a collation. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The group's title while the multi-run carries no synthesised label for it
 * (AC-31): the highest-severity finding's title, ties broken by lowest start
 * line, then by lowest finding id.
 *
 * Both tie-breaks are load-bearing for the same reason any client-rendered value
 * is: without them the title of a group whose findings share a severity is
 * whatever order the rows came back in, and the panel's heading changes between
 * two polls of an unchanged multi-run (`server/INSIGHTS.md`, 2026-08-06).
 */
function titleOf(cluster: readonly Entry[]): string {
  let best: Entry | undefined;
  for (const entry of cluster) {
    if (best === undefined || compareForTitle(entry, best) < 0) best = entry;
  }
  return best?.finding.title ?? '';
}

/** Orders the *candidates for the group's title*; lower sorts first. */
function compareForTitle(a: Entry, b: Entry): number {
  const bySeverity = SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity];
  if (bySeverity !== 0) return bySeverity;
  const byLine = a.range.start - b.range.start;
  if (byLine !== 0) return byLine;
  return compareStrings(a.finding.id, b.finding.id);
}

/**
 * One stance per agent of the multi-run (AC-30, AC-34).
 *
 * An agent that flagged the location contributes the severity it assigned; an
 * agent that did not — including one whose run failed, was cancelled or is still
 * running — contributes `ignored` (EC-7). An agent with **two** findings in one
 * group contributes **one** stance carrying the higher severity, and both of its
 * findings stay visible in its own column, which this module does not touch
 * (EC-11).
 *
 * `note` is empty here always. The stance sentences are the note-synthesis call's
 * output, merged in by the service after every run is terminal, and a read taken
 * before that renders them empty (AC-38).
 */
function takesFor(columns: readonly GroupableColumn[], cluster: readonly Entry[]): ConflictTake[] {
  return columns.map((column) => {
    const key = agentKey(column);
    let verdict: Severity | 'ignored' = 'ignored';
    for (const entry of cluster) {
      if (entry.key !== key) continue;
      if (verdict === 'ignored' || SEVERITY_RANK[entry.finding.severity] > SEVERITY_RANK[verdict]) {
        verdict = entry.finding.severity;
      }
    }
    return { agent_id: key, persona: column.agent_name, verdict, note: '' };
  });
}

/**
 * Group a multi-run's findings into the locations its agents did not all agree on.
 *
 * Reads nothing and writes nothing (AC-33). Deterministic: the partition is the
 * connected components of the "same location" relation, which does not depend on
 * the order the findings arrive in, and every value derived from a cluster is a
 * minimum under an explicit total order — so two reads of the same multi-run
 * return the same groups in the same order (AC-32).
 */
export function groupFindings(columns: readonly GroupableColumn[]): Conflict[] {
  const entries: Entry[] = [];
  for (const column of columns) {
    const key = agentKey(column);
    for (const finding of column.findings) {
      entries.push({
        key,
        finding,
        tokens: normaliseTitle(finding.title),
        range: normaliseRange(finding.start_line, finding.end_line),
      });
    }
  }

  // Connected components of `sameLocation`, built by insertion: a finding joins
  // every cluster it matches, and those clusters become one. Transitivity is the
  // point — A and C belong together when both match B, which is what makes the
  // partition independent of the order the findings arrived in.
  const clusters: Entry[][] = [];
  for (const entry of entries) {
    const matched = clusters.filter((cluster) =>
      cluster.some((other) => sameLocation(entry, other)),
    );
    const first = matched[0];
    if (first === undefined) {
      clusters.push([entry]);
      continue;
    }
    first.push(entry);
    for (const other of matched.slice(1)) {
      first.push(...other);
      const at = clusters.indexOf(other);
      if (at !== -1) clusters.splice(at, 1);
    }
  }

  // How many agents there are to be silent. Distinct keys, not column count, so
  // the comparison is against the same identity the stances are keyed on.
  const agentCount = new Set(columns.map(agentKey)).size;

  const groups: Group[] = [];
  for (const cluster of clusters) {
    const flaggers = new Set(cluster.map((entry) => entry.key));
    // At least one flagged, at least one other did not (AC-29). `flaggers.size
    // === agentCount` is the every-agent-agreed case and emits nothing (AC-100).
    if (flaggers.size === 0 || flaggers.size >= agentCount) continue;

    groups.push({
      file: cluster[0]?.finding.file ?? '',
      // The group's line is the lowest start line among its findings (AC-103),
      // taken from the normalised range so an inverted finding reports the line
      // its range actually begins at.
      line: Math.min(...cluster.map((entry) => entry.range.start)),
      title: titleOf(cluster),
      tiebreakId: cluster
        .map((entry) => entry.finding.id)
        .reduce((lowest, id) => (compareStrings(id, lowest) < 0 ? id : lowest)),
      takes: takesFor(columns, cluster),
    });
  }

  // File, then line, then title (AC-32) — plus the lowest finding id, which
  // decides the one case those three leave open: two groups in one file, at one
  // line, whose titles are equal but whose token sets did not clear the
  // similarity threshold. Without it the order is not total, and "total" is the
  // whole claim AC-32 makes.
  groups.sort(
    (a, b) =>
      compareStrings(a.file, b.file) ||
      a.line - b.line ||
      compareStrings(a.title, b.title) ||
      compareStrings(a.tiebreakId, b.tiebreakId),
  );

  return groups.map(({ file, line, title, takes }) => ({ file, line, title, takes }));
}
