/**
 * Row → DTO, and the three aggregates a multi-run's header carries. Pure.
 *
 * Nothing here reads a row, opens a connection or knows what Drizzle is: it
 * takes the narrow persisted views `types.ts` declares and returns contract
 * shapes. That is not decoration — `helpers.ts` is inside
 * `application-no-db-schema`'s glob in `.dependency-cruiser.cjs`, so a single
 * `typeof t.agentRuns.$inferSelect` in this file would add a warning to a
 * baseline that is supposed to stay where it is.
 *
 * Three rules are enforced here and are worth stating before the code, because
 * each one is a criterion of its own and each is easy to get subtly wrong:
 *
 *  - **`null` and `0` are never interchangeable for cost** (AC-21). A run that
 *    recorded no cost reports `null`; a run on a free model reports `0`; and the
 *    total is `null` only when EVERY column's cost is null, not when the sum
 *    happens to be zero.
 *  - **The score is the REVIEW's score** (AC-20). `agent_runs.score` arrived with
 *    no backfill and is null on every run older than the column, while the
 *    `reviews` row holds the real figure (`server/INSIGHTS.md`, 2026-08-03). The
 *    persisted view this file consumes does not carry the run column at all, so
 *    the wrong one is not reachable from here.
 *  - **Every enum-shaped `text` column is PARSED, never cast.** `status`,
 *    `severity` and the stored notes are all plain `text`/`jsonb` with no CHECK
 *    constraint behind them; a value the contract does not know is mapped to a
 *    documented fallback rather than reaching a client as a literal it has no
 *    rendering for.
 */
import { AgentColumn, Severity } from '@devdigest/shared';
import type { AgentColumnFinding, Conflict, ConflictTake, MultiAgentRun } from '@devdigest/shared';

import type { MultiAgentNotes } from './schemas.js';
import type { StoredMultiAgentColumn, StoredMultiAgentFinding, StoredMultiAgentRun } from './types.js';

/**
 * The four run statuses a column may report, taken from the contract's own enum
 * rather than restated.
 *
 * `AgentColumn.shape.status` IS the list — restating it here would be a second
 * copy that can drift from the wire shape while both typecheck.
 */
const RunStatus = AgentColumn.shape.status;
type RunStatus = AgentColumn['status'];

/**
 * The statuses that mean "this run will not change again".
 *
 * Read by the totals (a duration only counts once the run is over) and by the
 * client's poll-stop condition, which asks the same question of the same four
 * values.
 */
const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(['done', 'failed', 'cancelled']);

/**
 * What a run's `status` column says, as one of the four the contract names.
 *
 * The column is plain `text` with no CHECK constraint, so `null` and an
 * unrecognised value are both reachable — a row written before the four-value
 * convention existed, or by hand. The fallback is `failed`, and the choice is
 * load-bearing rather than arbitrary: the results view polls while ANY column is
 * non-terminal, so reading an unknown status as `running` would poll forever on
 * a run that is never going to move, while reading it as terminal ends the poll
 * and shows the row with whatever reason the run recorded. Between two
 * inaccuracies, the one that stops is the one to pick.
 */
export function readStatus(raw: string | null): RunStatus {
  return RunStatus.safeParse(raw).data ?? 'failed';
}

/** Whether a column has reached a status it will not leave. */
export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * The name a column shows for an agent whose row is gone.
 *
 * `agent_runs.agent_id` is `ON DELETE SET NULL`, so the run outlives its agent
 * and the join comes back empty. The column still has to name something in TEXT
 * — colour is never the only carrier of an agent's identity (AC-88) — and the
 * honest thing to name is that the agent no longer exists. This is the only
 * user-visible string this module produces; every other word on the screen comes
 * from the client's `runs` message namespace.
 */
const DELETED_AGENT_NAME = 'Deleted agent';

/**
 * One `findings` row as the column renders it.
 *
 * `severity` falls back to `SUGGESTION` — the lowest of the three — for a value
 * the contract does not know: an unreadable severity must not be able to
 * manufacture a CRITICAL, and the finding stays visible either way. Both
 * timestamps are `null` when the finding was never acted on, which is what the
 * contract's `.nullable()` (not `.nullish()`) says: the field is always present.
 */
export function toColumnFinding(row: StoredMultiAgentFinding): AgentColumnFinding {
  return {
    id: row.id,
    severity: Severity.safeParse(row.severity).data ?? 'SUGGESTION',
    category: row.category,
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion,
    confidence: row.confidence,
    kind: row.kind,
    accepted_at: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    dismissed_at: row.dismissedAt ? row.dismissedAt.toISOString() : null,
  };
}

/**
 * One run of the multi-run as its column, carrying only its OWN findings
 * (AC-24).
 *
 * `findingsByReview` is keyed by review id and a run with no review — one that
 * failed before it persisted anything — takes the empty list, and the account of
 * what happened is then the status plus `error`, the run's own reason (AC-68).
 */
export function toColumn(
  row: StoredMultiAgentColumn,
  findingsByReview: ReadonlyMap<string, StoredMultiAgentFinding[]>,
): AgentColumn {
  const findings = row.reviewId ? (findingsByReview.get(row.reviewId) ?? []) : [];
  return {
    run_id: row.runId,
    // The prefixed agent key, so a column and the stances that name it agree on
    // one identity even when the agent row is gone (EC-2). `agentKey` in
    // `grouping.ts` computes exactly this from the same two fields; it is
    // inlined here rather than imported so the mapping direction stays one-way
    // (helpers → grouping is not an edge this file needs).
    agent_id: row.agentId ?? `run:${row.runId}`,
    agent_name: row.agentName ?? DELETED_AGENT_NAME,
    provider: row.provider,
    model: row.model,
    status: readStatus(row.status),
    // AC-68: the RUN's own reason, not the review's summary. The review row is
    // absent on a run that failed before writing one, which is exactly the case
    // the criterion is about, so `summary` cannot carry it.
    error: row.error,
    verdict: row.verdict,
    // AC-20: the review's score. The run column is not on this view.
    score: row.score,
    summary: row.summary,
    duration_ms: row.durationMs,
    // AC-21: passed through untouched. `null` stays `null` and `0` stays `0`.
    cost_usd: row.costUsd,
    findings: findings.map(toColumnFinding),
  };
}

/**
 * The multi-run's total duration: the LONGEST terminal column, not the sum
 * (AC-22).
 *
 * The runs are concurrent, so the wall clock the reviewer waited is the slowest
 * of them. Non-terminal columns are excluded — a run still in flight has no
 * duration yet — and the contract's `total_duration_ms` is a plain integer, so a
 * multi-run with nothing terminal reports `0` rather than null.
 */
export function totalDurationMs(columns: readonly AgentColumn[]): number {
  let longest = 0;
  for (const column of columns) {
    if (!isTerminal(column.status)) continue;
    if (column.duration_ms !== null && column.duration_ms > longest) longest = column.duration_ms;
  }
  return longest;
}

/**
 * The multi-run's total cost: the sum of the columns that recorded one, or
 * `null` when NONE of them did (AC-22).
 *
 * Not `columns.reduce((a, c) => a + (c.cost_usd ?? 0), 0)`, which reports `0` for
 * a fan-out whose price is simply unknown — the one confusion `cost_usd`'s
 * contract exists to prevent.
 */
export function totalCostUsd(columns: readonly AgentColumn[]): number | null {
  let total: number | null = null;
  for (const column of columns) {
    if (column.cost_usd === null) continue;
    total = (total ?? 0) + column.cost_usd;
  }
  return total;
}

/** `(file, line)` as one map key. The group key the synthesis writes against. */
function locationKey(file: string, line: number): string {
  return `${file}:${line}`;
}

/**
 * The persisted synthesis merged over the computed groups (AC-31, AC-101,
 * AC-38).
 *
 * The groups themselves are NEVER changed: the count, the order, the files, the
 * lines and the stance list are all what `grouping.ts` returned, and this
 * function only fills in two fields that the deterministic rule leaves at their
 * fallback.
 *
 *  - a group with a synthesised label takes it as its title; a group with none —
 *    not synthesised yet, dropped by a failed call, or simply not returned for
 *    this group — keeps the fallback title the grouping computed;
 *  - a stance with a synthesised note takes it; a stance with none renders the
 *    empty string it already carries.
 *
 * Notes and labels naming a location or an agent this multi-run does not have
 * are discarded by construction: the lookup runs from the group outward, so a
 * key nothing matches is simply never read.
 *
 * `notes` being `null` is the STEADY state, not the exception — synthesis fires
 * only once every run of the set is terminal, so every poll taken during the
 * fan-out lands here with nothing to merge.
 */
export function mergeSynthesis(
  conflicts: readonly Conflict[],
  synthesis: MultiAgentNotes | null,
): Conflict[] {
  if (!synthesis) return [...conflicts];

  const labels = new Map<string, string>();
  for (const label of synthesis.labels) labels.set(locationKey(label.file, label.line), label.label);

  const notes = new Map<string, string>();
  for (const note of synthesis.notes) {
    notes.set(`${locationKey(note.file, note.line)} ${note.agent_id}`, note.note);
  }

  return conflicts.map((conflict) => {
    const key = locationKey(conflict.file, conflict.line);
    const takes: ConflictTake[] = conflict.takes.map((take) => {
      const note = notes.get(`${key} ${take.agent_id}`);
      return note === undefined ? take : { ...take, note };
    });
    const label = labels.get(key);
    return { ...conflict, ...(label === undefined ? {} : { title: label }), takes };
  });
}

/**
 * The assembled response.
 *
 * `agent_count` is the number of columns — one per run the multi-run created
 * (AC-15) — and not the length of the id list the create path was given, so a
 * single-agent run started alongside the fan-out cannot move it.
 */
export function toMultiAgentRun(
  parent: StoredMultiAgentRun,
  columns: AgentColumn[],
  conflicts: Conflict[],
): MultiAgentRun {
  return {
    id: parent.id,
    pr_id: parent.prId,
    pr_number: parent.prNumber,
    ran_at: parent.ranAt.toISOString(),
    agent_count: columns.length,
    total_duration_ms: totalDurationMs(columns),
    total_cost_usd: totalCostUsd(columns),
    columns,
    conflicts,
  };
}
