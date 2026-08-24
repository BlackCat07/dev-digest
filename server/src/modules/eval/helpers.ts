import { z } from 'zod';
import {
  EvalAnchor,
  EvalBatchStatus,
  EvalCaseOutcome,
  EvalExpectation,
  EvalNotRunReason,
} from '@devdigest/shared';
import type {
  EvalAgentCase,
  EvalBatch,
  EvalBatchCaseResult,
  EvalBatchTrendPoint,
  EvalPeriod,
} from '@devdigest/shared';
import type {
  EvalSourcePrFile,
  StoredEvalBatch,
  StoredEvalCase,
  StoredEvalCaseExecution,
  StoredEvalRunResult,
} from './types.js';

/**
 * The pure half of the Eval Pipeline: anchor arithmetic, the one-file diff
 * fragment, the byte budget, the period window, and every Row → DTO map.
 *
 * No I/O, no clock passed implicitly, no `db` and no `drizzle-orm` — which is not
 * merely tidy: `application-no-db-schema` puts `helpers.ts` in the ring that must
 * not know the Drizzle schema, so the persisted shapes this file maps from are
 * declared field by field in `./types.js` and the real rows satisfy them
 * structurally. `periodStart` takes its `now` as an argument for the same reason:
 * a helper that reads the clock cannot be tested twice with the same answer.
 *
 * **Every boundary here PARSES; none of them casts.** Two of these maps close a
 * real gap between what Postgres allows and what the contract promises —
 * `eval_cases.expectation` and `eval_cases.input_diff` are both nullable columns
 * feeding non-nullable contract fields, and `expected_output` is untyped jsonb
 * carrying the expected anchors. An `as` on any of the three has already shipped
 * `$NaN` to a client from this codebase once; each is resolved below with
 * `safeParse` and a documented fallback, and every fallback is chosen so that a
 * row we cannot read makes the agent look WORSE rather than better. A harness
 * whose unreadable rows pass for free is a harness measuring itself.
 */

/* ─── where the expected anchors live ─────────────────────────────────────── */

/**
 * The shape `eval_cases.expected_output` is expected to hold.
 *
 * There is no anchors COLUMN, deliberately: `expected_output` was already
 * untyped jsonb, so the anchors ride inside it and no shipped column had to be
 * reshaped. That makes this the module's one storage secret, and the reason
 * `insertCase` / `updateCase` take `expectedAnchors` as a first-class argument
 * instead of letting a caller assemble the blob its own way.
 *
 * Not `.strict()`: the blob is hand-edited in the case editor and may legitimately
 * carry a reviewer's own keys beside the anchors. Anything that is not a readable
 * anchor list simply yields no anchors.
 */
const StoredExpectedOutput = z.object({ anchors: EvalAnchor.array() });

/** Any JSON object, so a hand-edited blob's own keys survive an anchor rewrite. */
const StoredExpectedOutputBase = z.record(z.unknown());

/**
 * The expected anchors of a stored case, or none.
 *
 * `safeParse`, never a cast: a blob written before this feature existed, or one a
 * human hand-edited into an array or a string, comes back as an EMPTY anchor
 * list. Empty is the safe answer in both directions — a `must_find` case with no
 * anchor fails, and a `must_not_flag` case with no anchor forbids nothing and so
 * cannot manufacture a false positive.
 */
export function readExpectedAnchors(raw: unknown): EvalAnchor[] {
  const parsed = StoredExpectedOutput.safeParse(raw);
  return parsed.success ? parsed.data.anchors : [];
}

/**
 * Put `anchors` into an expected-output blob, keeping whatever else it carried.
 *
 * A blob that is not a JSON object (null, an array, a bare string) is REPLACED
 * rather than merged: there is nowhere to put a key on it, and silently dropping
 * the anchors would store a case that asserts nothing.
 */
export function withExpectedAnchors(raw: unknown, anchors: readonly EvalAnchor[]): unknown {
  const base = StoredExpectedOutputBase.safeParse(raw);
  return { ...(base.success ? base.data : {}), anchors: [...anchors] };
}

/* ─── anchors ─────────────────────────────────────────────────────────────── */

/**
 * One anchor from a file and a pair of line numbers, in either order.
 *
 * The `Finding` contract does not guarantee `start_line <= end_line` and the live
 * `findings` table holds rows where it does not, so normalising is not defensive
 * programming — it is the only way `:105-30` and `:30-105` describe the same
 * place. `low_line`/`high_line` are NEW-side diff line numbers, the same side the
 * citation-grounding gate indexes.
 */
export function normaliseAnchor(file: string, a: number, b: number): EvalAnchor {
  return { file, low_line: Math.min(a, b), high_line: Math.max(a, b) };
}

/**
 * Do two anchors describe overlapping places? Equal file path, and overlapping
 * inclusive ranges.
 *
 * The same predicate the scorer uses to decide "the agent found it", which is why
 * it is stated once here and applied by the service: the `conflicting_anchor`
 * refusal must mean exactly what a score means, or a case can be accepted that
 * the scorer will then read as contradicting another.
 *
 * Both sides are normalised again even though the producer normalises: an anchor
 * can arrive from a hand-edited `expected_output` blob, and `readExpectedAnchors`
 * validates its SHAPE, not its bounds.
 */
export function anchorsOverlap(a: EvalAnchor, b: EvalAnchor): boolean {
  if (a.file !== b.file) return false;
  const aLo = Math.min(a.low_line, a.high_line);
  const aHi = Math.max(a.low_line, a.high_line);
  const bLo = Math.min(b.low_line, b.high_line);
  const bHi = Math.max(b.low_line, b.high_line);
  return aLo <= bHi && bLo <= aHi;
}

/* ─── the stored input diff ───────────────────────────────────────────────── */

/**
 * Cut one file's patch out of a pull request's stored patches and assemble a
 * standalone unified diff for it.
 *
 * The four-line shape is exactly what `diffFromPrFiles` already assembles for a
 * whole PR — `diff --git`, `---`, `+++`, then the patch — because the parser on
 * the other end is the same one, and a fragment shaped differently would parse to
 * a different set of new-side line numbers than the review that produced the
 * finding did. The stored case would then anchor at lines the agent can never
 * report.
 *
 * `null` when that path is not among the PR's files, or when its row carries no
 * patch (GitHub omits one for a binary or very large file). Null is a refusal for
 * the caller to name, not an empty diff to store.
 */
export function diffFragmentFor(
  files: readonly EvalSourcePrFile[],
  path: string,
): string | null {
  const file = files.find((f) => f.path === path);
  if (!file || !file.patch) return null;
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, file.patch].join(
    '\n',
  );
}

/**
 * The size of a diff in BYTES, not characters.
 *
 * `DIFF_MAX_BYTES` bounds what is replayed into a provider on every run of the
 * set, and a provider is charged the bytes: a 64 000-character diff of CJK
 * identifiers is three times the budget. `Buffer.byteLength` rather than a
 * `node:buffer` import — `Buffer` is a global, and a feature module may not
 * import any `node:` specifier.
 */
export function diffByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/* ─── the dashboard window ────────────────────────────────────────────────── */

/**
 * The start of a named period, or `null` for `all`.
 *
 * `now` is a parameter, so the same call twice gives the same answer and a test
 * needs no fake clock. `null` rather than the epoch for `all`: the caller then
 * omits the predicate entirely instead of scanning against a sentinel date, and
 * `all` is bounded anyway by the 50-batch-per-agent retention cap.
 *
 * Returns a `Date`, which every caller must bind through Drizzle's `gte()` and
 * never interpolate into a raw `sql` template: postgres-js rejects a `Date`
 * inside one at RUNTIME while the code typechecks, and Fastify swallows the
 * throw into a generic `500 internal_error`. Nothing in this module writes raw
 * SQL, which is how that trap is avoided rather than remembered.
 */
export function periodStart(period: EvalPeriod, now: Date): Date | null {
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * day);
    case '30d':
      return new Date(now.getTime() - 30 * day);
    case '90d':
      return new Date(now.getTime() - 90 * day);
    case 'all':
      return null;
    default: {
      const unreachable: never = period;
      throw new Error(`unhandled eval period: ${String(unreachable)}`);
    }
  }
}

/* ─── Row → DTO ───────────────────────────────────────────────────────────── */

/**
 * The expectation of a stored case.
 *
 * The column is NULLABLE — the table shipped before this feature and nothing
 * backfills history — while the contract's field is not, so the gap is closed
 * here and the fallback is a decision rather than a convenience. `must_find` is
 * the non-flattering reading: a `must_find` case with no anchors scores as
 * FAILED and turns its findings into false positives, where a `must_not_flag`
 * fallback would pass for free at zero cost and quietly raise the pass count of
 * every batch it appeared in.
 */
export function readExpectation(raw: string | null): EvalExpectation {
  return EvalExpectation.safeParse(raw).data ?? 'must_find';
}

/**
 * The outcome and reason of one recorded execution.
 *
 * An unreadable or absent outcome reads as `not_run`, which counts in a batch's
 * covered total and in NEITHER the passed nor the failed tally — "we do not know"
 * has a value in this vocabulary, and it is not "passed". A `not_run` outcome
 * always carries a reason (the contract says so), so an unreadable reason becomes
 * `not_scorable` rather than a null the renderer has no wording for.
 */
function outcomeOf(
  rawOutcome: string | null,
  rawReason: string | null,
): { outcome: EvalCaseOutcome; notRunReason: EvalNotRunReason | null } {
  const outcome = EvalCaseOutcome.safeParse(rawOutcome).data ?? 'not_run';
  const reason = EvalNotRunReason.safeParse(rawReason).data ?? null;
  return {
    outcome,
    notRunReason: reason ?? (outcome === 'not_run' ? 'not_scorable' : null),
  };
}

/**
 * Map a stored case (plus the most recent execution of it, if any) to the DTO an
 * agent's eval set renders.
 *
 * `input_diff` resolves a null column to `''` — again the non-flattering reading:
 * an empty diff parses to zero files and is recorded `not_run` /
 * `diff_unparseable` with no model call, never a free pass.
 *
 * `last_execution` is `null` — not a block of nulls — when the case has never
 * run, so "never run" and "ran and measured nothing" stay distinguishable all the
 * way to the screen.
 */
export function toEvalAgentCase(
  row: StoredEvalCase,
  execution?: StoredEvalCaseExecution,
): EvalAgentCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
    expectation: readExpectation(row.expectation),
    expected_anchors: readExpectedAnchors(row.expectedOutput),
    source_finding_id: row.sourceFindingId,
    source_severity: row.sourceSeverity,
    source_category: row.sourceCategory,
    edited: row.edited,
    last_execution: execution ? toLastExecution(execution) : null,
  };
}

function toLastExecution(
  execution: StoredEvalCaseExecution,
): NonNullable<EvalAgentCase['last_execution']> {
  const { outcome, notRunReason } = outcomeOf(execution.outcome, execution.notRunReason);
  return {
    outcome,
    not_run_reason: notRunReason,
    expected_count: execution.expectedCount,
    actual_count: execution.actualCount,
  };
}

/**
 * Map a stored batch to its DTO.
 *
 * `status` falls back to `error` when the column holds something the contract
 * does not recognise: a batch whose state cannot be read is not one whose numbers
 * may be presented as final. Both timestamps go out as ISO strings, which is what
 * every other contract in this repository serves and what a client sorts on.
 */
export function toEvalBatch(row: StoredEvalBatch): EvalBatch {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    agent_name: row.agentName,
    agent_version: row.agentVersion,
    system_prompt_snapshot: row.systemPromptSnapshot,
    model_snapshot: row.modelSnapshot,
    status: EvalBatchStatus.safeParse(row.status).data ?? 'error',
    label: row.label,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    cases_covered: row.casesCovered,
    cases_passed: row.casesPassed,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cost_usd: row.costUsd,
    error: row.error,
  };
}

/** Map one stored per-case execution of a batch to its DTO. */
export function toEvalBatchCaseResult(row: StoredEvalRunResult): EvalBatchCaseResult {
  const { outcome, notRunReason } = outcomeOf(row.outcome, row.notRunReason);
  return {
    case_id: row.caseId,
    case_name: row.caseName,
    outcome,
    not_run_reason: notRunReason,
    expected_count: row.expectedCount,
    actual_count: row.actualCount,
    kept_count: row.keptCount,
    dropped_count: row.droppedCount,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/**
 * One point of an agent's metric trend, from one of its batches.
 *
 * `pass_rate` is null — never 0 — when the batch covered nothing or recorded no
 * counts, for the same reason every metric here is nullable: "we could not
 * measure this" and "this measured zero" are different facts, and a chart that
 * draws them the same way invents a regression.
 */
export function toEvalBatchTrendPoint(batch: EvalBatch): EvalBatchTrendPoint {
  const covered = batch.cases_covered;
  const passed = batch.cases_passed;
  return {
    batch_id: batch.id,
    started_at: batch.started_at,
    agent_version: batch.agent_version,
    recall: batch.recall,
    precision: batch.precision,
    citation_accuracy: batch.citation_accuracy,
    pass_rate: covered !== null && covered > 0 && passed !== null ? passed / covered : null,
    cost_usd: batch.cost_usd,
  };
}

/**
 * The shipped `eval_runs.pass` boolean, kept consistent with the `outcome` column
 * this feature added beside it.
 *
 * `null` for `not_run`, because a case that never executed neither passed nor
 * failed — which is precisely why `outcome` exists and `pass` alone was not
 * enough. Writing `false` there would make an infrastructure failure
 * indistinguishable from a wrong answer in the one column that shipped.
 */
export function passFromOutcome(outcome: EvalCaseOutcome): boolean | null {
  switch (outcome) {
    case 'passed':
      return true;
    case 'failed':
      return false;
    case 'not_run':
      return null;
    default: {
      const unreachable: never = outcome;
      throw new Error(`unhandled eval case outcome: ${String(unreachable)}`);
    }
  }
}
