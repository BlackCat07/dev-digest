/**
 * Every port, every persisted shape and every public face of the Multi-Agent
 * Review module — all of them, here, and types only.
 *
 * No runtime code, so nothing in this file can join an import cycle and the
 * whole module's dependency surface is readable in one sitting. That is what
 * `modules/eval/types.ts`, `modules/brief/types.ts` and
 * `modules/onboarding/types.ts` already do.
 *
 * **NOTHING HERE IMPORTS A SIBLING MODULE, and that is the point of the file.**
 * A types-only import of another module's internals is a real
 * `no-cross-module-internals` violation — `import type` does NOT exempt it
 * (`tsPreCompilationDeps` is on in `.dependency-cruiser.cjs`), and it was
 * measured taking the gate from 22 warnings to 24 when another module did
 * exactly that (`server/INSIGHTS.md`, 2026-08-14). In particular this module
 * imports nothing from `modules/reviews/`, even though it reads that module's
 * tables: the reads live in `./repository.ts`, which is allowed to know
 * `db/schema`, and the one edge that runs the other way — the reviews module
 * writing the parent record — is {@link MultiAgentRecorder}, a
 * consumer-satisfiable interface the composition root binds.
 *
 * **No signature here carries a Drizzle Row type** (`OA-DEEP-002`). A port whose
 * signature names a Row has moved the schema into the contract: the shape
 * becomes whatever the table is, a fake has to build all of it, and the cast in
 * the fake is the tell. The persisted views below are therefore declared field
 * by field — the real rows satisfy them structurally, and `helpers.ts` maps them
 * to contract DTOs without ever naming `db/schema`.
 *
 * The two interfaces the composition root exposes:
 *
 *  - {@link MultiAgentReview} — satisfied by `./service.ts`, bound as
 *    `container.multiAgent` so `ContainerOverrides.multiAgent` can carry a fake
 *    with no database behind it;
 *  - {@link MultiAgentRecorder} — satisfied by `./repository.ts`, bound as
 *    `container.multiAgentRecorder` and consumed by the REVIEWS module when it
 *    fans a pull request out. The reviews module declares nothing of this module
 *    and imports nothing from it; the container satisfies the shape
 *    structurally, exactly as `featureModel` and `fileRole` already do.
 */
import type { MultiAgentRun } from '@devdigest/shared';
import type { MultiAgentNotes } from './schemas.js';

/* ─── the parent record ───────────────────────────────────────────────────── */

/**
 * A `multi_agent_runs` row as the create path needs it back: the id every run of
 * the fan-out is stamped with, and the timestamp the response reports.
 *
 * `ranAt` is a `Date` and not an ISO string on purpose — this is the persistence
 * ring's shape, and the one place a timestamp becomes a string is `helpers.ts`,
 * on the way to the wire.
 */
export interface CreatedMultiAgentRun {
  id: string;
  ranAt: Date;
}

/**
 * The pull request's most recent multi-run, with the pull-request number the
 * response carries.
 *
 * `prNumber` comes from the join rather than from a denormalised column: the
 * parent's `pr_id` is `NOT NULL` and cascades with the pull request, so the join
 * always finds a row.
 */
export interface StoredMultiAgentRun extends CreatedMultiAgentRun {
  prId: string;
  prNumber: number;
}

/* ─── one run of the fan-out, and what it produced ────────────────────────── */

/**
 * One `agent_runs` row of a multi-run, joined to its agent's name and to the
 * `reviews` row that run wrote.
 *
 * Three fields are worth reading twice.
 *
 *  - **`score` is the REVIEW's score, never `agent_runs.score`.** The run column
 *    arrived with no backfill, so every run created before it carries null while
 *    its `reviews` row holds the real figure (`server/INSIGHTS.md`, 2026-08-03).
 *    There is deliberately no `agent_runs.score` field on this view, so the
 *    wrong one is not reachable from the application ring at all.
 *  - **`agentId` is nullable.** `agent_runs.agent_id` is `ON DELETE SET NULL`,
 *    so a run whose agent was deleted keeps its row and loses its id. Every
 *    per-agent key downstream is therefore prefixed (`agentKey` in
 *    `grouping.ts`), never the raw value.
 *  - **`status` is `string | null`.** The column is plain `text` with no CHECK
 *    constraint; the four values the contract names are a TypeScript-level
 *    convention, so the mapper parses rather than casts.
 */
export interface StoredMultiAgentColumn {
  runId: string;
  agentId: string | null;
  /** `null` when the agent row was deleted; `helpers.ts` decides what to show. */
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  /** Failure reason on a failed run, cancellation note on a cancelled one. */
  error: string | null;
  durationMs: number | null;
  /** USD. `null` = nothing was recorded; `0` = the run genuinely cost nothing. */
  costUsd: number | null;
  /** The `reviews` row this run wrote, or `null` when it never got that far. */
  reviewId: string | null;
  score: number | null;
  summary: string | null;
  verdict: string | null;
}

/**
 * One `findings` row of one review, narrowed to what a column renders.
 *
 * `severity` and `category` are plain `text` in the table (no CHECK constraint),
 * so `severity` is parsed against the contract on the way out and never cast.
 * `startLine`/`endLine` arrive in whatever order the model produced them — the
 * `Finding` contract does not guarantee `start_line <= end_line` and the live
 * table holds rows where it does not, which is why the grouping rule normalises
 * before it intersects anything.
 */
export interface StoredMultiAgentFinding {
  id: string;
  reviewId: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  rationale: string;
  suggestion: string | null;
  confidence: number;
  kind: string | null;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/* ─── the ports ───────────────────────────────────────────────────────────── */

/**
 * Writing and finding the parent record — the whole of what the REVIEWS module
 * needs from this one, and nothing else.
 *
 * Narrow on purpose. A helper that takes the whole `Container` puts every caller
 * into an import cycle with the DI root (`server/INSIGHTS.md`, 2026-08-10), and a
 * wider interface here would hand the create path reads it has no business
 * making. `latestForPull` is included because the create path's own refusal —
 * "this pull request's most recent multi-run still has a run in flight" — has to
 * start from which multi-run that is; the in-flight test itself is a query over
 * `agent_runs`, which belongs to the reviews module's own repository.
 *
 * Satisfied structurally by `./repository.ts`, bound as
 * `container.multiAgentRecorder`.
 */
export interface MultiAgentRecorder {
  /** Insert the parent record every run of one fan-out will be stamped with. */
  create(workspaceId: string, prId: string): Promise<CreatedMultiAgentRun>;
  /** The pull request's most recent multi-run, or `undefined` when it has none. */
  latestForPull(workspaceId: string, prId: string): Promise<StoredMultiAgentRun | undefined>;
  /**
   * Delete the parent record — the create path's COMPENSATING write, and the
   * only reason this port carries a delete at all.
   *
   * `createMultiAgentRun` commits this parent and only then creates one
   * `agent_runs` row per agent, and the two writes cannot join a transaction:
   * the fan-out fires `void executeRuns(...)` in the same call, so that
   * background work would read and write `agent_runs` on a different pooled
   * connection against rows no other connection can see yet. A mid-sequence
   * failure is therefore UNDONE rather than prevented — the caller's 500 is
   * paired with the orphaned parent disappearing.
   *
   * **This is compensation, not atomicity, and the difference is observable.**
   * Any `agent_runs` row the failed fan-out already created is deliberately NOT
   * deleted: `agent_runs.multi_agent_run_id` is `ON DELETE SET NULL`, so such a
   * run loses its parent and carries on as an ordinary single-agent run — which
   * is exactly what a lone run of an abandoned fan-out is. What the discard buys
   * is that no half-populated multi-run survives for the results screen to read
   * back as "the pull request's most recent fan-out", and that the next `POST`
   * is not refused with a `409` about a fan-out nobody can see.
   *
   * Workspace-scoped by parameter like every other method here — a valid uuid is
   * not authorization — and two ids are the whole signature: no Drizzle handle
   * and no Row type crosses this port (`OA-DEEP-002`).
   */
  discard(workspaceId: string, id: string): Promise<void>;
}

/**
 * Everything the read service asks of storage. Satisfied by `./repository.ts`,
 * which is the only file in this module allowed to name `db/schema` or
 * `drizzle-orm`.
 *
 * `readNotes` returns an already-PARSED value, not the raw column: jsonb read
 * back from Postgres is a boundary, and an `as` on a boundary has already
 * shipped `$NaN` to a client from this codebase (`server/INSIGHTS.md`,
 * 2026-08-02). `null` means "not synthesised" — not yet, failed, timed out or
 * unparseable — which is one state with one rendering (AC-38), so the reader
 * needs no fourth case.
 */
export interface MultiAgentStore extends MultiAgentRecorder {
  /** Every run the multi-run created, in a total order, with its review. */
  runsOf(workspaceId: string, multiAgentRunId: string): Promise<StoredMultiAgentColumn[]>;
  /** The findings of those runs' reviews. An empty id list makes no query. */
  findingsOf(reviewIds: readonly string[]): Promise<StoredMultiAgentFinding[]>;
  /** The persisted synthesis output, parsed, or `null` when there is none. */
  readNotes(workspaceId: string, multiAgentRunId: string): Promise<MultiAgentNotes | null>;
  /** Persist the one synthesis output. Written once, by the synthesis task. */
  saveNotes(workspaceId: string, multiAgentRunId: string, notes: MultiAgentNotes): Promise<void>;
}

/**
 * The public face of this module: the pull request's most recent multi-agent
 * run, assembled.
 *
 * Exposed as the INTERFACE from the container — the shape `repoIntel`, `brief`
 * and `eval` already have — so `ContainerOverrides.multiAgent` can carry a fake
 * with no database behind it, which is what makes the route tests hermetic.
 *
 * **It makes no model call** (AC-23), and there is no provider port anywhere in
 * this module's dependency surface: not a call it chose not to make, one it has
 * no way to make.
 */
export interface MultiAgentReview {
  /**
   * The pull request's most recent multi-run.
   *
   * Throws `NotFoundError` when the pull request has none, which the shared
   * error handler turns into the service's own
   * `{"error":{"code":"not_found",…}}` envelope — the one thing that tells a
   * registered module apart from an unregistered one (`server/INSIGHTS.md`,
   * 2026-08-20).
   */
  latest(workspaceId: string, prId: string): Promise<MultiAgentRun>;
}
