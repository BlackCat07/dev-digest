import type { EvalPeriod } from '@devdigest/shared';

/**
 * Every figure the Eval Pipeline is bounded by, with the reason beside it.
 *
 * They live here rather than inline because three of them are read in two rings
 * at once — the service refuses on `CASE_LIMIT` and `DIFF_MAX_BYTES`, the runner
 * enforces `CASE_DEADLINE_MS`, `CASE_CONCURRENCY` and `BATCH_DEADLINE_MS`, and
 * the repository trims on `BATCH_RETENTION` — and a bound that disagrees with
 * itself across two files is a bound nobody can reason about.
 *
 * No I/O, no clock, no import but a type: this file is safe to read from any
 * ring of the module.
 */

/**
 * Cases one agent may hold. A set is a dataset a human curates and re-reads, not
 * a log; past this size the "run the whole set" button stops being affordable at
 * `CASE_DEADLINE_MS` each and the list stops being readable without paging,
 * which this feature deliberately does not build.
 */
export const CASE_LIMIT = 50;

/**
 * 64 KB — the largest stored input diff a case may carry.
 *
 * The diff is replayed into a model prompt on every run of the set, so its size
 * is multiplied by every batch this case ever appears in. It is measured in
 * BYTES rather than characters: the limit exists to bound what reaches a
 * provider, and a multi-byte character costs a provider its bytes.
 */
export const DIFF_MAX_BYTES = 65_536;

/**
 * 120 s per case, owned by the CALLER.
 *
 * `StructuredRequest.timeoutMs` is silently ignored by the OpenAI adapter — the
 * timeout is fixed when the client is constructed — so a deadline expressed in
 * the request is a deadline that does not exist. The runner races the model call
 * against its own timer and passes `maxRetries: 0`, because the default retry
 * budget of 2 turns one bounded call into three unbounded ones.
 */
export const CASE_DEADLINE_MS = 120_000;

/**
 * Three cases of one batch execute at once.
 *
 * Fixed, and deliberately not tuned: tuning a batch size against a live provider
 * does not converge — concurrency 4 and 5 each both fit and overran on different
 * runs of the same repository and model. Bounded concurrency with a per-call
 * deadline keeps whatever answered; a wave-level deadline discards good answers.
 */
export const CASE_CONCURRENCY = 3;

/**
 * 15 minutes for the whole batch.
 *
 * Well past `JobRunner`'s fixed 120 s timeout, which is why a batch is NOT a
 * background job. It doubles as the staleness window: a `running` batch older
 * than this is an orphan from a dead process and must not block the agent's next
 * run for ever.
 */
export const BATCH_DEADLINE_MS = 900_000;

/**
 * 15 s of silence before the progress stream sends a heartbeat.
 *
 * A case can legitimately take the full `CASE_DEADLINE_MS`, so "no event yet" is
 * indistinguishable from "the connection died" without one.
 */
export const HEARTBEAT_MS = 15_000;

/**
 * The 50 most recent batches per agent are kept; older ones are deleted with
 * their per-case rows (`eval_runs.batch_id` is `ON DELETE CASCADE`).
 *
 * This cap is what bounds the trend query and the history table, and it is why
 * `period=all` is not an unbounded read.
 */
export const BATCH_RETENTION = 50;

/**
 * The window a dashboard read covers when the caller names none.
 *
 * 30 days rather than `all`: the default answer to "did the last prompt edit
 * help" is about recent runs, and a first paint that scans every retained batch
 * of every agent is the slowest possible way to say "no data yet".
 */
export const DEFAULT_PERIOD: EvalPeriod = '30d';
