# Implementation Plan — Eval Pipeline (SPEC-04)

**Goal:** A reviewer turns their own accepted/dismissed findings into an eval set for the agent that produced them, runs that agent over the whole set on demand with live progress, and reads back recall, precision and citation accuracy computed arithmetically — so a prompt edit produces a number that says whether the agent got better or worse, comparable run-to-run and promotable back onto the agent.

**Execution mode:** `EXECUTION MODE: multi-agent` — 7 waves. The dispatch fixed this; no question is carried.

## Scope

Packages in: `reviewer-core` (one pure scorer), `server` (one new module, one new table, one migration, one route on the agents module, two container bindings), `client` (one new route subtree, one new agent-editor tab, one finding-card action, one hook file, two message catalogues, one `vendor/ui/nav.ts` entry), and the repository root (`scripts/verify-l06.sh`).

Packages out: `e2e` (no browser flow requested; N8 keeps this out of CI and the spec asks for no flow), `mcp-server` (no new tool requested; it is an HTTP client of the API and is deliberately absent from `modules/index.ts`), `evals` (unrelated — that package is the harness that measures this repo's own skills and subagents; it shares only the word "eval" with this feature, and nothing in this plan touches it).

## Execution mode

- **Multi-agent, 7 waves.** Two implementers run per wave at most, one in `server` and one in `client`, because both packages' Done-conditions are whole-package `tsc --noEmit` runs and two implementers inside one package read each other's half-written files. `reviewer-core` cannot share a wave with `server` either: `server/tsconfig.json` aliases `@devdigest/reviewer-core` → `../reviewer-core/src`, so a server typecheck compiles the other implementer's in-flight scorer. `reviewer-core/tsconfig.json` symmetrically aliases `@devdigest/shared` → `../server/src/vendor/shared/index.ts`, which is why T1 stands alone in wave 1.
- **Single-agent alternative — one pass, `T1 → T2 → … → T12`,** same Owned paths, same Done-conditions. No task exists only to keep packages apart, so nothing merges away in that mode; the only loss is parallelism.

## Requirements (verified)

Every one of the spec's 100 acceptance criteria is covered below; `Source:` names the exact criteria.

**Server**

- **R1** — Turning a decided finding into a case creates a case whose expectation is `must_find` for an accepted finding and `must_not_flag` for a dismissed one, storing one expected anchor (file, low line, high line, the low line being the smaller of `start_line` and `end_line`), the finding's id as provenance, the unified-diff text for that finding's file taken from the PR its review belongs to, owner kind `agent` and owner id `reviews.agent_id`.
  Source: `specs/eval-pipeline.md` AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- **R2** — Creation is refused with a named reason and no row written: `422 review_has_no_agent`, `422 finding_has_no_decision`, `409` returning the existing case's id for a duplicate source finding, `422 conflicting_anchor` naming the existing case when the derived anchor overlaps an anchor of the *other* expectation type on the same file, `422 case_limit_reached` at 50 cases, `422 diff_too_large` above 64 KB.
  Source: AC-7, AC-8, AC-9, AC-10, AC-11, AC-12
- **R3** — Reading an agent's set returns every case with its expectation, expected anchors, source finding id, and the outcome plus expected and actual counts of its most recent execution, in a total order: name ascending, then case id ascending.
  Source: AC-13, AC-14
- **R4** — Saving an edited case persists name, input diff, expectation and anchors as submitted, refusing `422 anchor_not_in_diff` when a `must_not_flag` anchor names a file absent from that case's diff; deleting a case leaves every stored batch's recorded metrics and counts unchanged.
  Source: AC-15, AC-16, AC-17
- **R5** — Any eval read or write naming an agent outside the caller's workspace answers `404` with the service's own error envelope, not Fastify's route-not-found.
  Source: AC-18
- **R6** — Requesting a run acknowledges with the new batch's id and status `running` before the first case executes, and the batch records the agent's current config version number plus a snapshot of the system prompt and model text that version carries, never re-read afterwards.
  Source: AC-19, AC-20
- **R7** — A case executes by replaying its stored input diff through the review engine with the batch's snapshotted prompt and model, creating no `pull_requests`, `reviews`, `findings` or `agent_runs` row and no clone.
  Source: AC-21
- **R8** — Progress is a live event stream keyed on the batch id: one event as each case reaches an outcome, a heartbeat after 15 s with no outcome, and for a subscriber arriving after completion a replay of the buffered events followed by the stream closing.
  Source: AC-22, AC-23, AC-24
- **R9** — At most 3 cases of one batch execute concurrently, and each case's model work is bounded at 120 000 ms by a deadline the caller owns, with provider retries disabled.
  Source: AC-25, AC-26
- **R10** — A case that misses its deadline, whose provider errors, or whose stored diff parses to no files is recorded `not_run` with the reason `deadline`, `provider_error` or `diff_unparseable` — the last without issuing a model call — without ending the batch; a batch past 900 000 ms becomes `status: error` with a recorded reason and starts no further cases; a `running` batch older than the batch deadline does not block that agent's next run.
  Source: AC-27, AC-28, AC-29, AC-30, AC-31
- **R11** — On completion the batch's metrics are computed over every case it set out to cover, a `not_run` case counting in `cases_covered` and not in `cases_passed`; `cases_covered`, `cases_passed`, the three metrics, total cost, started-at and finished-at are all recorded; a metric with a zero denominator is null rather than zero; zero model requests are issued between the last case's response and completion; and total cost is null rather than a smaller sum when any executed case's cost is unavailable.
  Source: AC-32, AC-33, AC-34, AC-35, AC-36
- **R12** — Batch history is ordered started-at descending then batch id descending, and only the 50 most recent batches per agent are retained.
  Source: AC-37, AC-38
- **R13** — Comparing two batches of one agent returns, per metric, the earlier value, the later value and the signed change, plus both agent version numbers and both prompt snapshots; a change is null when either side is null; two batches of different agents are refused `422 cross_agent_compare`; two batches of the same agent version return a flag saying the configurations are identical.
  Source: AC-39, AC-40, AC-41, AC-42
- **R14** — Promoting a stored agent version writes that version's stored config onto the agent as a **new** version higher than every existing one, mutating no existing `agent_versions` row.
  Source: AC-43
- **R15** — The workspace dashboard returns one row per agent carrying the agent's name and model, its most recent batch's version, started-at, `cases_passed`, `cases_covered` and three metrics, plus a chronological trend over that agent's retained batches; an agent with no completed batch appears with null metrics and an empty trend; a metric lower than in the previous batch yields an alert naming the metric and the signed change; `Run all agents` creates exactly one batch per enabled agent holding at least one case and names the id and reason of every agent skipped; a named period includes only batches whose started-at falls inside it; and a batch whose agent has been deleted stays readable with its agent presented as unavailable.
  Source: AC-44, AC-45, AC-46, AC-47, AC-48, AC-49

**Client**

- **R16** — A decided finding's expanded card offers `Turn into eval case` beside `Accept`, `Dismiss`, `Learn` and `Reply to author`; on an undecided finding that control is present, `aria-disabled`, and its accessible name states that a decision is required first; activating it creates the case in one request carrying the finding id and no expectation type; a refusal renders its reason inline on that card while `Accept` and `Dismiss` stay operable.
  Source: AC-50, AC-51, AC-52, AC-53
- **R17** — The agent editor's tab strip carries `Evals` after `Context`; the tab renders four metric tiles — recall, precision, citation accuracy each with a signed change against the previous batch, and cases passed as `cases_passed / cases_covered`; every metric change carries the unit its value is displayed in (percentage points for a percentage); beneath the tiles a statement from the `eval` catalogue says scoring is mechanical — file match plus line-range overlap — with no model call in the scorer; and a link points at the eval dashboard.
  Source: AC-54, AC-55, AC-56, AC-57, AC-58
- **R18** — The case list renders per case its name, an expectation badge reading `MUST FIND` or `MUST NOT FLAG`, its last outcome as an icon **and** a word, expected and actual finding counts, and per-row run, edit and delete controls; a `must_not_flag` row reads `assert empty` in place of a severity and category tag; a never-executed row reads `never run`; a `not_run` row says so and names the reason, distinctly from a failure; an agent with no cases gets an empty state naming the accept-or-dismiss-then-turn-into-a-case next action; and while a batch of this agent runs, the tab shows its progress from the live stream in place of an enabled run-all control.
  Source: AC-59, AC-60, AC-61, AC-62, AC-63, AC-64
- **R19** — The case editor renders the case name, the stored input under an `Input` tab strip of `Diff`, `Files` and `PR meta`, and the expected output as JSON with a validity badge; while that text is not valid JSON both `Save` and `Run case` are unavailable behind an `invalid JSON` badge; a `must_not_flag` case is presented as negative — a leading banner naming the forbidden file and line range, and an expected-output column labelled as asserting no finding at that anchor; and a case with a recorded most-recent execution shows a strip stating that outcome, the expected and actual counts, the duration and the cost.
  Source: AC-65, AC-66, AC-67, AC-68
- **R20** — The sidebar's `SKILLS LAB` group carries an `Eval Dashboard` entry pointing at the eval route and the shell marks it active on any path under `/eval`; the dashboard renders one row per agent with name, model chip, last batch version, timestamp, `cases_passed / cases_covered` and the three metric percentages, each row navigating to that agent's eval page; a row for an agent with fewer than two completed batches omits the sparkline; and a recent-runs table across all agents renders one row per batch with the agent, timestamp, version, three metrics and pass count.
  Source: AC-69, AC-70, AC-71, AC-72
- **R21** — The per-agent page renders three metric cards with signed changes, a metric-trend chart with three named series and a recent-runs table with per-row selection; an alert strip naming the regressed metric and its change comes from the payload's `alert`, not from a client-side comparison; and `Compare` is enabled if and only if exactly two runs are selected, carrying the two-run precondition in its accessible name in every disabled state.
  Source: AC-73, AC-74, AC-75
- **R22** — The comparison modal renders four cards — recall, precision, citation and cost — each showing the earlier value, the later value and the signed change; a card whose change is null says the metric was not measured rather than rendering a zero change; where both batches recorded the same agent version the prompt-diff region states the prompt is unchanged rather than rendering an empty box; and promoting a version from the comparison shows the agent's resulting new version number, not the promoted one.
  Source: AC-76, AC-77, AC-78, AC-79
- **R23** — While any eval read is in flight the screen renders skeletons shaped like the rows or tiles that are coming; a failed eval read renders an error next to the region that failed, leaving the sidebar and breadcrumb rendered.
  Source: AC-80, AC-81

**reviewer-core**

- **R24** — The scorer is a pure function of its arguments: no network, filesystem, database, environment or clock access, no provider and no clock to inject, and two calls with identical inputs return deep-equal results.
  Source: AC-82
- **R25** — An actual finding covers an expected anchor when the two file paths are equal and their line ranges overlap; every range is normalised before comparison, taking the low bound as the smaller of start and end; and every line number is a new-side diff line number, the same side the citation-grounding gate indexes.
  Source: AC-83, AC-84, AC-85
- **R26** — A `must_find` anchor covered by at least one actual finding is one true positive however many findings cover it; a `must_find` anchor covered by none is a false negative; an actual finding covering a `must_not_flag` case's forbidden anchor is a false positive; and an actual finding in a `must_find` case that covers none of that case's expected anchors is a false positive.
  Source: AC-86, AC-87, AC-88, AC-89
- **R27** — Recall is true positives over true positives plus false negatives, precision is true positives over true positives plus false positives, both over the whole batch; citation accuracy is kept over kept plus dropped from the existing grounding gate's counts, aggregated over the batch's executed cases; and a metric whose denominator is zero is returned null.
  Source: AC-90, AC-91, AC-92, AC-93
- **R28** — A `must_find` case passes when at least one actual finding covers its anchor and fails otherwise; a `must_not_flag` case passes when no actual finding covers its forbidden anchor, irrespective of how many other findings that case's diff produced; and a case with no actual output is reported as neither passed nor failed while remaining in the covered count.
  Source: AC-94, AC-95, AC-96

**Repository**

- **R29** — `verify:l06` runs every gate regardless of an earlier failure and exits with the number that failed; it includes a gate that fails if the scorer's own module, or any module it imports, references a model provider, an HTTP client or a network call, scoped to import statements and run with `grep -a`; its Postgres-backed gates run only when explicitly asked, serially in a single fork; and it invokes each tool's binary directly, with no `pnpm run` or `npm run` anywhere in it.
  Source: AC-97, AC-98, AC-99, AC-100

## Constraints

Quoted here because the implementer sees this plan and nothing else.

**Do-not-touch and contract**

- `DDG-DNT-001` — CRITICAL. `server/src/vendor/shared/**` and `client/src/vendor/shared/**` are two hand-synced copies and change together or the types drift. The new contract file and both barrel lines land in **one** task (T1).
- `DDG-DNT-003` — CRITICAL. No existing contract symbol is reshaped or renamed. Every addition is a new symbol in a new file (spec N4).
- `DDG-DNT-002` — CRITICAL. `client/src/vendor/ui/**` is the vendored design system. The **one** permitted edit in this whole plan is `client/src/vendor/ui/nav.ts`, whose own doc comment carves itself out: *"This is ROUTE CONFIG, and it is the one thing in `vendor/ui` that has to change when the app gains a screen … Adding an entry is fine; changing how `NavItem` looks is not."* No primitive is restyled and no primitive gains a prop (spec N6).
- `DDG-DNT-004` — CRITICAL. `server/src/db/migrations/**` is generated. Edit `src/db/schema/eval.ts`, then generate.
- `DDG-DNT-005` — CRITICAL. No lockfile is touched. This plan adds no dependency to any package.
- **The client copy of `vendor/shared` is behind the server's.** Measured this run: `diff -rq` reports five differing files, and the client copy **lacks `AgentVersion` and `AgentVersionConfig`** (present in `server/src/vendor/shared/contracts/knowledge.ts`). No client file may import those two types. Everything the client needs about a version arrives inside `EvalComparison` and `EvalDashboardRow`.

**Wiring the compiler cannot see**

- `DDG-WIRE-001` — CRITICAL. `server/src/modules/index.ts` registers modules statically. A `modules/eval/` with no import line and no entry there mounts nowhere and 404s with no error.
- `DDG-WIRE-002` — CRITICAL. Relative ESM imports carry the `.js` extension. `tsc --noEmit` does not catch a missing one; it fails at runtime. `src/db/schema*` is the one named exception (54 extensionless imports live there and are loaded by drizzle-kit, not by the running ESM server).
- `DDG-WIRE-003` — CRITICAL. A `db/schema/**` change ships with its generated migration.
- `DDG-WIRE-004` — CRITICAL. A new port/adapter pair is bound in `server/src/platform/container.ts`, the only place allowed to name concrete classes.
- `DDG-WIRE-005` — CRITICAL. If an implementer's shell drops a scaffold `server/pnpm-workspace.yaml`, delete it — it contradicts "NOT a monorepo workspace" and must never be committed.
- `DDG-WIRE-007` — WARNING, and it does **not** bind here: `.github/workflows/server-unit.yml` and `server-integration.yml` already filter on `server/**` and `reviewer-core/**`, and no workflow runs `verify-l03.sh`, so `scripts/verify-l06.sh` is a local-only gate needing no workflow edit. Verified this run: `grep -rn 'verify-l03' .github/` returns nothing.

**Architecture**

- `DDG-ARCH-002` — CRITICAL. `reviewer-core` stays pure. Its only legitimate outward import is `src/vendor/shared`; the `core-stays-pure` depcruise rule is `severity: error` and forbids `^src/(?!vendor/shared)` and `node_modules/(postgres|drizzle-orm|octokit|fastify)/`. `reviewer-core/CLAUDE.md`: *"no DB, no GitHub, no filesystem, no `process.env`."*
- `DDG-ARCH-001` — WARNING. Routes stay thin: `modules/eval/routes.ts` declares a zod schema, calls the service, maps the result. No aggregate, no branching business logic, no query.
- **A feature module may not import any `node:` specifier, `node:crypto` included** — the `modules/<name>/` grep gates ban every `node:` import specifier, not only the filesystem one (`server/INSIGHTS.md`, 2026-08-20). `modules/repo-intel/pipeline/full.ts` calling `createHash` reads as a precedent and is not one: repo-intel is carved out in `.dependency-cruiser.cjs` as infrastructure reached only through `container.repoIntel`.
- **`modules-no-raw-sdk` is `severity: error`** and its list is `octokit|openai|@anthropic-ai/sdk|simple-git|@ast-grep/napi|dependency-cruiser|postgres|js-tiktoken`. `@devdigest/reviewer-core` is not on it — `modules/reviews/run-executor.ts:3` already imports `reviewPullRequest` from it, and `modules/intent/prompt.ts` and `modules/brief/prompt.ts` import `wrapUntrusted`. So the eval runner may import the engine directly.
- **`no-cross-module-internals` is a `warn` at a baseline of 1 edge, and `import type` does not exempt it** — a types-only import of a sibling's `types.ts` moved the count 22 → 24 once (`server/INSIGHTS.md`, 2026-08-14). The eval module imports **no** sibling module. Findings, diffs and agent versions arrive through `container.reviewRepo` (`findingContext`, `getPrFiles`, `getPull`, `getRepo`) and `container.agentsRepo`, which the composition root already exposes.
- **`depcruise` baseline, measured this run:** `0 errors, 22 warnings. 234 modules, 801 dependencies cruised.` The module count is the signal that new files were analysed at all — an unresolved file produces the same warning line as a clean one (`server/INSIGHTS.md`, 2026-08-20). Record the count.

**Security**

- `DDG-SEC-003` — CRITICAL. Every new route validates input with a zod schema declared on the route (`fastify-type-provider-zod`; never `Schema.parse(req.body)` inside a handler) and scopes every query it triggers by workspace. The spec's security budget: *"the agent lookup is the authorization check … No eval read is reachable by id alone."*
- `DDG-SEC-002` — CRITICAL. A stored diff fragment is untrusted foreign text replayed into a model prompt. It reaches the model through `reviewPullRequest`, which wraps it with the engine's existing `wrapUntrusted` and appends `INJECTION_GUARD` inside `assemblePrompt`. **This feature adds no second prompt assembly and no eval-specific parameter to the engine** — spec: *"if it behaved differently under evaluation, the harness would measure the harness."* Note the measured trap: `INJECTION_GUARD` is a module-private, non-exported const in `reviewer-core/src/prompt.ts` concatenated only inside `assemblePrompt`, so there is nothing to duplicate and nothing to re-implement (`server/INSIGHTS.md`, 2026-08-20).
- The SSE route carries `config: { rateLimit: false }`, as `modules/reviews/routes.ts` does for `/runs/:id/events` — one long-lived connection is not burst traffic, and `@fastify/rate-limit` is registered at `max: 120, timeWindow: '1 minute'`.

**Tests and gates**

- `DDG-TEST-001` — CRITICAL. A DB-backed test (anything importing `test/helpers/pg.ts`) is named `*.it.test.ts`; any other filename must be hermetic. That split is exactly what the two CI workflows filter on.
- `DDG-TEST-003` — WARNING. A changed seam owes a test at that seam. `/run-plan` does **not** dispatch `test-writer`; every test in `## Tests` is `Owner: implementer`.
- **No test file in `server/` is typechecked by any gate.** `tsconfig.json`'s include is `["src/**/*.ts"]`, vitest transpiles without typechecking, and `tsconfig.eslint.json` widens the include for ESLint's parser only. Measured this run: `tsc --noEmit -p tsconfig.eslint.json` reports exactly **16 errors across 6 files** (`test/adapters.test.ts`, `agents-versions.it.test.ts`, `conventions.it.test.ts`, `prompt-callers.test.ts`, `repo-intel-facade-degraded.test.ts`, `skills.it.test.ts`) — the documented baseline. `reviewer-core/tsconfig.json` has the same hole (`include: ["src/**/*.ts"]`) with a lint-only `tsconfig.eslint.json` beside it.
- **A whole-suite `vitest run` silently skips most `.it.test.ts` files even with Docker up** — measured `Test Files 25 passed | 5 skipped` while `vitest run .it.test --pool=forks --poolOptions.forks.singleFork` ran all eight files green. Read the `↓` lines, not the pass count (`server/INSIGHTS.md`, 2026-08-06).
- **`grep` without `-a` reports nothing on some files under `server/src/modules/`** — `src/modules/project-context/service.ts` and `src/modules/onboarding/service.ts` contain a literal NUL byte, and `grep` treats them as binary. Every grep-based Done-condition over that tree carries `-a`. And `grep` exits 1 when it matches nothing, which is the *passing* case: read the output, not `$?`.
- **`grep` and not `rg`.** This machine has no `rg` binary — `rg` resolves to a shell function the harness defines, so an `rg` gate works inside an agent's Bash tool and fails with `rg: command not found` in any script and in CI.
- **Scope a grep gate to import statements, not whole-file text.** Written the plain way, a doc-comment explaining why a module does not import Node's filesystem module returned six hits, and two implementers independently reworded prose and one wrote `String.prototype.match` where `.exec()` was natural, to satisfy a text search (`server/INSIGHTS.md`, 2026-08-19). AC-98 already states this constraint.
- **Run every binary directly out of `node_modules/.bin` and export `CI=true`.** `pnpm <script>` runs a pre-script dep-status check that shells out to `pnpm install`, which trips this repo's supply-chain policy (`[ERR_PNPM_IGNORED_BUILDS] … esbuild, protobufjs, ssh2`) and exits 1 before the script is reached; without a TTY it can try to purge `node_modules` (`server/INSIGHTS.md`, 2026-08-02 and 2026-08-04).
- **`drizzle-kit generate` always rewrites `migrations/meta/_journal.json`**, so a migration-shape gate phrased as "no `M` line" fails on a correct run. The precise formulation is **"no `M` line against a `.sql` file"** (`server/INSIGHTS.md`, 2026-08-19).
- **`drizzle-kit generate` blocks forever on an interactive rename prompt** when one migration both drops and adds columns in the same table, reading the answer straight from a TTY (`server/INSIGHTS.md`, 2026-08-06). This plan's migration is **ADD-only** — one new table plus new columns and indexes, no drops and no renames — so the prompt cannot arise. Keep it that way.
- **A feature can pass every gate and still `500` on its first real request, because nothing applies the migration it ships.** `CLAUDE.md` says migrations never run on boot, and no hermetic test can tell "schema shipped" from "schema applied": services take their repository through `ContainerOverrides`, so the suite proves the call shape against a fake and never touches Postgres. **Read the status code first: `404` means the module is not registered in `modules/index.ts`; `500` on a route that exists, right after a feature that adds a table, means the migration was never applied** (`server/INSIGHTS.md`, 2026-08-19).
- **A `200` on a new route is only evidence of registration if the `404` path is checked too.** An unregistered module and a registered one both answer `404` for a nonexistent id — but only the registered one answers with the service's own envelope, `{"error":{"code":"not_found",…}}`, rather than Fastify's route-not-found (`server/INSIGHTS.md`, 2026-08-20). That is AC-18's observable, and it is one extra `curl`.

**Server behaviour this feature depends on**

- **`StructuredRequest.timeoutMs` is silently ignored and `maxRetries` defaults to 2** — three attempts of up to 90 s each. The timeout is fixed when the OpenAI client is constructed (`timeout: opts.timeoutMs ?? 90_000`, a *constructor* option); nothing reads `req.timeoutMs` in `completeStructured` (`server/INSIGHTS.md`, 2026-08-06). This is why R9 requires the caller to own the deadline and pass `maxRetries: 0`. `ReviewInput.maxRetries` exists for exactly this ("Override the structured-output retry budget").
- **`JobRunner`'s timeout is a fixed 120 s and this batch's deadline is 15 minutes**, so the batch is **not** a background job. `JobRunner.enqueue` also returns a `done` promise that rejects when a job fails; the crash is fixed centrally now (a side-branch `done.catch`) but a batch that fails still needs its own row updated (`server/INSIGHTS.md`, 2026-08-06 and 2026-08-07). Tuning a batch size against a live provider does **not** converge — concurrency 4 and 5 each both fit and overran on different runs of the same repo and model, and a wave-level deadline made it worse by discarding good answers (2026-08-06). Per-call deadlines plus fixed bounded concurrency, and keep whatever answered.
- **Ordering a list on a non-unique column returns rows in physical heap order and an update moves one** — reported once as "the row I clicked moves down the list", and intermittent enough that "it stopped happening" is not evidence it is fixed. Any list a client renders in order needs a **total** order, and a regression test must assert the returned ids equal the *sorted* ids; asserting only "unchanged after an update" passes without the fix (`server/INSIGHTS.md`, 2026-08-06).
- **Grouping rows by agent needs a fallback key.** `agent_runs.agent_id` is nullable (`onDelete: 'set null'`) and `reviews.agent_id` carries no FK and no `notNull`, so keying a per-agent `Map` on the raw value collapses every agent-deleted row into one bucket and a cost sum drops all but one of them, with no error. Key on `agentId ?? 'row:' + row.id` (`server/INSIGHTS.md`, 2026-08-03). EC-25 names this hazard for R15.
- **A `Date` interpolated into a raw `sql` template throws at runtime and typechecks.** Drizzle binds a `Date` fine in `eq()`/`gte()` and in `.values()`, but postgres-js rejects it inside `` sql`… ${d} …` ``; bind `${d.toISOString()}::timestamptz` (`server/INSIGHTS.md`, 2026-08-05). The period filter (R15) is the place this would bite.
- **Drizzle 0.38's `count()` maps to a real `number`,** so a `GROUP BY` aggregate needs no bigint coercion; prefer `.groupBy()` in SQL over over-fetching and reducing in JS unless a per-group latest row is needed (`server/INSIGHTS.md`, 2026-08-03).
- **The seeded review carries `agentId: null`.** Measured this run: 40 reviews, 39 with an agent. That row is EC-1's real case and AC-7's fixture.
- **`LocalNoAuthProvider.currentWorkspace` memoises the workspace for the life of the process.** If the DB is re-seeded while the API runs, every list answers `[]` with no error; restart the API (`server/INSIGHTS.md`, 2026-08-06).

**Client behaviour this feature depends on**

- **Client imports from `@devdigest/shared` stay `import type` only.** The vendored barrel re-exports with ESM `.js` extensions webpack will not map back to `.ts`; a runtime-value import resolves under `tsc` **and** under `vitest` and then 500s **every route that transitively reaches it** under `next build`/`next dev`. It once broke 6 of 7 e2e flows while both unit suites stayed green. Runtime constants go in `client/src/lib/` — that is why `SEVERITY_LEVELS` lives in `src/lib/severity.ts` (`client/INSIGHTS.md`, 2026-08-03, plus its addendum: the rule is unchanged and still load-bearing). EC-35 restates it because this feature adds new symbols the client reads.
- **`client/vitest.config.ts` duplicates the tsconfig path aliases** (`@`, `@devdigest/shared`, `@devdigest/ui`). An alias added to one only typechecks and then fails at test runtime. This plan adds no alias.
- **`@testing-library/user-event` is NOT a dependency of `client`** — importing it fails at collect time, and adding it is a `package.json` + lockfile change. All existing test files use `fireEvent` / `.click()`; match them. There is also **no shared QueryClient test helper** (each file builds one inline), and the vendored `Skeleton` is a bare `div.skeleton` with no role or aria, so a loading state is asserted through `container.getElementsByClassName` (`client/INSIGHTS.md`, 2026-08-10).
- **jsdom dispatches no `click` for Enter on a focused native `<button>`.** For a keyboard-operability requirement, either assert the load-bearing half directly (`el.focus(); expect(el).toHaveFocus()` on a real tab-reachable element with an accessible name) and dispatch activation separately, or put the behaviour on an explicit `onKeyDown` and drive a genuine `keyDown` (`client/INSIGHTS.md`, 2026-08-19). R21's `Compare` selection flow is where this lands.
- **`getByRole(…, { name })` cannot match text containing consecutive spaces** — the accessible-name computation normalises whitespace (`client/INSIGHTS.md`, 2026-08-19).
- **A feature's copy in another feature's namespace fails silently in both directions.** The Intent Layer put its `card.*` block in `brief.json` and shipped a card titled "Brief not available yet." with every gate green: the keys resolve, so next-intl emits no missing-message warning. `src/i18n/request.ts` `readdirSync`s `messages/en/` and merges every file as `{ [basename]: … }`, so a namespace is one file and no shared edit (`client/INSIGHTS.md`, 2026-08-10). EC-36: the `eval` namespace owns the tab, the editor and the dashboard; the `Turn into eval case` label belongs to the **`prReview`** namespace it renders in.
- **A component composing a shared unit legitimately reads two namespaces, and its tests must provide both** — mounting with only one does not fail a test; next-intl renders the key path and logs `IntlError: MISSING_MESSAGE` to stderr (`client/INSIGHTS.md`, 2026-08-11).
- **`eslint` on a path under `src/vendor/` exits 0 while linting nothing**, emitting *"File ignored because of a matching ignore pattern"* as a warning among the output — so a Done-condition naming a vendor path records a green gate over an unlinted file. Assert the `nav.ts` change with `git diff --stat -- src/vendor/ui/` showing exactly one file instead (`client/INSIGHTS.md`, 2026-08-19).
- **Do not wrap a view in `<Suspense>`** because it reads `useSearchParams()`. Every route here that reads search params is dynamic (`ƒ`, because of `[repoId]`/`[id]`), so the hook is free; the boundary makes the server emit the fallback instead of the screen — a blank first paint that passed typecheck, `next build` and all 108 unit tests while e2e flows 04/05 failed on a black rectangle (`client/INSIGHTS.md`, 2026-08-04).
- **Never run `next build`.** It writes the same `client/.next` a running `next dev` owns and corrupts it, with `NEXT_PUBLIC_API_BASE` inlined at compile time (`client/INSIGHTS.md`, 2026-08-03; `gate.md` lists it as **never**).
- **`var(--bg)` is not a token.** `src/vendor/ui/styles.css` defines `--bg-primary`, `--bg-surface`, `--bg-elevated` and `--bg-hover`. An unknown custom property is not a CSS error — the declaration silently drops, and nothing catches it (`client/INSIGHTS.md`, 2026-08-06).
- **A mutation that omits an optional request field is a silently successful no-op** and every signal a UI trusts says it worked. Assert the *outgoing* body at the `fetch` boundary, which is why `src/lib/hooks/intent.test.tsx` stubs `fetch` rather than mocking `api`/`apiFetch` (`client/INSIGHTS.md`, 2026-08-11).
- **`apiFetch` sets `content-type: application/json` only when a body is actually sent** — a body-less POST otherwise trips Fastify's "Body cannot be empty when content-type is application/json".

**reviewer-core**

- **Anthropic models via OpenRouter reject a `json_schema` carrying numeric range keywords**, surfacing only as `400 Provider returned error`; `toJsonSchema`'s `stripNumericRangeKeywords` drops them on the wire and folds each bound into the description (`reviewer-core/INSIGHTS.md`, 2026-08-07). EC-34: the eval metric types are persistence and API shapes and are **never** used as a response format, and the scorer's return type is not model-facing either.
- **Editing `reviewer-core` changes the running server immediately** — no build step, no version bump. Everything public is re-exported from `src/index.ts`; a symbol not in the barrel is not part of the API.

## Skills the implementer must load

All eleven are listed; each is either assigned to files or marked `n/a` with a reason.

| Files | Skill | Why |
|---|---|---|
| `server/src/modules/eval/**`, `server/src/platform/container.ts`, `server/src/modules/agents/{routes,service,repository}.ts` | `onion-architecture` | route → service → repository placement, the `readonly diffParser` call-signature port and its container binding, `OA-INFRA-001` (a query has nowhere else to live), `OA-APP-001` (a service importing an adapter is the blind spot `depcruise` cannot express), `OA-DEEP-002` (a port whose signature carries a Drizzle Row is the data layer renamed) |
| `server/src/modules/eval/routes.ts`, `server/src/modules/agents/routes.ts` | `fastify-best-practices` | schema-on-route via `fastify-type-provider-zod`, the SSE generator shape and `config: { rateLimit: false }`, error mapping through `platform/errors.ts`, `app.inject` for the route tests — read `rules/routes.md`, `rules/schemas.md`, `rules/error-handling.md`, `rules/testing.md` |
| `server/src/db/schema/eval.ts`, `server/src/modules/eval/repository.ts` | `drizzle-orm-patterns` | new table + added columns, `$inferSelect`/`$inferInsert`, the transaction boundary owned by the service, `.groupBy()` aggregates, generate-then-migrate — read `references/schema-definition.md`, `references/migrations.md`, `references/queries-joins-aggregations.md` |
| `server/src/db/schema/eval.ts` | `postgresql-table-design` | `timestamptz` not `timestamp`, `text` not `varchar(n)`, `doublePrecision` for a 0–1 metric, `NOT NULL` where semantically required, and the rule that **PostgreSQL does not auto-index FK columns** — every FK and every ordering key in R3/R12 needs a manual index |
| `server/src/vendor/shared/contracts/eval-batch.ts`, `client/src/vendor/shared/contracts/eval-batch.ts`, `server/src/modules/eval/schemas.ts`, `reviewer-core/src/eval/score.ts` | `zod` | `type-use-z-infer` and `type-export-schemas-and-types` (export the schema and the inferred type, as every neighbour in `contracts/` does), `schema-use-enums` for the five new enums, `object-discriminated-unions` for the outcome/reason pair, `schema-use-unknown-not-any` for the anchor riding inside `expected_output`, `parse-use-safeparse` at the jsonb read boundary — **every boundary parses, it never casts; an `as` on a boundary already shipped `$NaN` to the client** |
| `server/src/modules/eval/{routes,runner,service}.ts` | `security` | the `agent lookup is the authorization check` rule (A01: deny by default, ownership checked, never reachable by id alone), the stored diff as attacker-controlled text replayed into a prompt (ASI01/ASI09 — it is wrapped as data by the engine and never re-assembled here), the SSE endpoint as a long-lived unauthenticated surface, and A10 fail-closed on the batch's own error path. Trace the data flow before flagging: `req.params.agentId` is attacker-controlled, `container.config` is not |
| every changed `*.ts` / `*.tsx` | `typescript-expert` | `EvalCaseOutcome`/`EvalNotRunReason` as a discriminated union with an exhaustive `switch` and a `never` default; no `any` and no `as` at the jsonb or HTTP boundary; explicit return types on the scorer's public API; `noUncheckedIndexedAccess` is on in all three packages, so every array index is `T \| undefined` |
| `client/src/app/eval/**`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**`, `client/src/lib/eval.ts`, `client/src/lib/hooks/eval.ts` | `frontend-ui-architecture` | law 3 (route files are thin — 7–17 lines, `params` awaited, one view rendered), the colocated-feature-unit shape, law 2 (promote on the second consumer, never in anticipation — a helper used by one view stays private), law 5 (no `utils` bucket: `src/lib/eval.ts`, not `src/lib/utils.ts`), and the placement table's "app-wide runtime constant" row, which is where the period options must live |
| `client/src/app/eval/page.tsx`, `client/src/app/eval/[agentId]/page.tsx` | `next-best-practices` | `file-conventions.md` for the route files, `async-patterns.md` for awaited `params` (Next 15), `suspense-boundaries.md` for **why no boundary goes here**, `rsc-boundaries.md` for keeping the `"use client"` boundary at the view rather than deeper |
| `client/src/app/eval/**/_components/**`, `.../EvalsTab/**`, `.../FindingCard/**`, `.../FindingsPanel/FindingsPanel.tsx` | `react-best-practices` | Derive-don't-store (the selected-run pair and the JSON-validity flag are derived, never mirrored into `useState` + `useEffect`), no `useEffect` for event handling, no `renderThing()` render factories, stable list keys (never an index over a re-orderable list), `{count && …}` vs `{count > 0 && …}` for a zero pass count, `aria-label` on icon-only controls, and the a11y rows the spec's own budget repeats — every status carries a word, not only a colour. Read `examples.md` |
| `client/src/**/*.test.tsx` (six files, listed in `## Tests`) | `react-testing-library` | query priority (`getByRole` first, `getByTestId` last), `queryBy` for asserting absence, `findBy`/`waitFor` for async, fewer and longer flow tests over many one-assertion tests, mocking at the `fetch` boundary only — **and this package has no `user-event`, so `fireEvent` is the local dialect** |

## Waves

Multi-agent mode. Two implementers per wave at most; never two in one package, and never `reviewer-core` beside `server`.

- **Wave 1:** T1 — the contract file and both barrels. Alone, because it is the only task touching both `vendor/shared` copies and everything downstream typechecks against them.
- **Wave 2:** T2 (`reviewer-core`), T3 (`client`).
- **Wave 3:** T4 (`server`), T5 (`client`).
- **Wave 4:** T6 (`server`), T7 (`client`).
- **Wave 5:** T8 (`server`), T9 (`client`).
- **Wave 6:** T10 (`server`), T11 (`client`).
- **Wave 7:** T12 — `scripts/verify-l06.sh` and `server/package.json`. Alone; it gates everything before it.

Single-agent mode: one pass, `T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12`.

## Tasks

### T1 — The contract symbols, in both `vendor/shared` copies
Satisfies: R1, R2, R3, R6, R11, R13, R15, R19, R24, R27
Depends-on: —
Owned paths: `server/src/vendor/shared/contracts/eval-batch.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/contracts/eval-batch.ts`, `client/src/vendor/shared/index.ts`
Forbidden: every other file under either `vendor/shared/`, in particular `contracts/eval-ci.ts`, `contracts/knowledge.ts`, `contracts/findings.ts` and `adapters.ts` — **no existing symbol is reshaped, renamed or removed** (N4, `DDG-DNT-003`)
Change: one **new** file, `contracts/eval-batch.ts`, added to both copies **byte-identically**, and one `export * from './contracts/eval-batch.js';` line added to each `index.ts` after the existing `eval-ci` line. Seventeen new symbols, each exported as both the zod schema and the inferred type, matching the house shape of every neighbour in `contracts/`:

`EvalExpectation` (`must_find` | `must_not_flag`) · `EvalAnchor` (file, low_line, high_line — new-side) · `EvalCaseOutcome` (`passed` | `failed` | `not_run`) · `EvalNotRunReason` (`deadline`, `provider_error`, `diff_unparseable`, `not_scorable`, `cancelled`) · `EvalRefusalReason` (`review_has_no_agent`, `finding_has_no_decision`, `duplicate_source_finding`, `conflicting_anchor`, `case_limit_reached`, `diff_too_large`, `anchor_not_in_diff`, `cross_agent_compare`, `batch_already_running`) · `EvalAgentCase` (the shipped `EvalCase` fields plus expectation, anchors, `source_finding_id`, `edited`, and a nullable last-execution block carrying outcome, not-run reason, expected and actual counts) · `EvalCaseSave` (the PUT body: name, input diff, expectation, anchors, expected output) · `EvalBatchStatus` (`running` | `complete` | `error`) · `EvalBatch` (id, workspace, nullable `agent_id`, nullable `agent_name`, `agent_version`, `system_prompt_snapshot`, `model_snapshot`, status, nullable label, started-at, nullable finished-at, nullable `cases_covered`/`cases_passed`, three nullable metrics, nullable `cost_usd`, nullable error) · `EvalBatchCaseResult` (case id, case name, outcome, nullable reason, expected and actual counts, kept and dropped counts, nullable duration, nullable cost) · `EvalMetrics` (three nullable metrics plus `true_positives`, `false_negatives`, `false_positives`) · `EvalComparison` (both batch ids, both version numbers, both prompt snapshots, `same_config`, and per metric — recall, precision, citation accuracy **and** cost — an earlier value, a later value and a nullable signed change) · `EvalBatchTrendPoint` (started-at, batch id, version, three **nullable** metrics, nullable pass rate, nullable cost) · `EvalDashboardRow` (agent id nullable, agent name nullable, model, nullable last-batch block of version/started-at/counts/metrics, a `EvalBatchTrendPoint[]` trend, nullable `alert`, `cases_total`) · `EvalWorkspaceDashboard` (period, `EvalDashboardRow[]`, and a cross-agent `recent_batches: EvalBatch[]`) · `EvalRunAllResult` (`created: EvalBatch[]`, `skipped: { agent_id, reason }[]`) · `EvalPeriod` (`7d` | `30d` | `90d` | `all`).

Two shape rules, both load-bearing. **No numeric range keyword** (`.min`/`.max`) on any metric field in this file — the shipped `EvalRun` and `EvalDashboard` carry them, and an Anthropic route via OpenRouter rejects a JSON schema containing them with only `400 Provider returned error` to show for it; these types are never a response format and omitting the bounds keeps that true even if someone later reaches for one. And **every metric and count that can be undefined is `.nullable()`**, not optional — R11 and R27 distinguish "we could not measure recall" from "recall is 0%", and an absent key cannot carry that distinction through a jsonb round-trip.
Skill: `zod`, `typescript-expert`
Invariant: `DDG-DNT-001` (both copies in this one task), `DDG-DNT-003` (new file, no reshape), `DDG-WIRE-002` (the barrel line carries `.js`)
Acceptance: both files exist and are byte-identical; both barrels export the new file; `EvalOwnerKind` still carries `skill` **and** `agent`, and nothing removes the unused `skill` member (N1); no symbol in `contracts/eval-ci.ts` or `contracts/knowledge.ts` differs from `HEAD`
Done-condition, all four green:
```sh
diff server/src/vendor/shared/contracts/eval-batch.ts \
     client/src/vendor/shared/contracts/eval-batch.ts   # 0 lines = pass
git diff --name-only -- server/src/vendor/shared client/src/vendor/shared
  # exactly 4 paths, and neither eval-ci.ts nor knowledge.ts among them
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd client && CI=true ./node_modules/.bin/tsc --noEmit
```
Red flags: if a criterion seems to need an existing symbol widened, that is a `Status: blocked`, not a quiet edit — say which symbol and stop. And `client/src/vendor/shared` is behind the server's copy in five files today; do not "fix" that drift while here.

### T2 — The mechanical scorer, in `reviewer-core`
Satisfies: R24, R25, R26, R27, R28
Depends-on: T1
Owned paths: `reviewer-core/src/eval/score.ts`, `reviewer-core/src/index.ts`, `reviewer-core/test/eval-score.test.ts`
Forbidden: `reviewer-core/src/grounding.ts`, `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/**`, `reviewer-core/src/llm/**`, `reviewer-core/src/output/**` — the engine and the grounding gate are **relied upon and unchanged** (spec `## Contracts`); also `reviewer-core/package.json` and `package-lock.json`
Change: one pure module exposing a scorer that takes an array of per-case inputs — each carrying the case id, its `EvalExpectation`, its `EvalAnchor[]`, the case's actual findings (or an explicit "no output" marker), and that case's kept/dropped citation counts — and returns per-case outcomes plus an `EvalMetrics` for the batch. Add both the function and its types to `src/index.ts`; a symbol not in the barrel is not part of the API.

**The import rule is a requirement, not style:** `score.ts` imports **only** `import type { … } from '@devdigest/shared'` and nothing else — no relative import, no value import, no `zod` runtime use. That is what makes AC-98's transitive gate (T12) checkable by reading one file's import lines instead of walking a graph.

Range normalisation is shared logic in spirit with `grounding.ts`'s `rangeIntersects` (which already does `Math.min`/`Math.max` on start and end); do **not** import it — it is not exported from the barrel and `grounding.ts` is forbidden here. Re-derive the two-line helper inside `score.ts` and pin the agreement with a test instead (below), which is what AC-85's `Verify: analysis` becomes.
Skill: `typescript-expert`, `zod` (for `z.infer` of the contract types the signature uses), `onion-architecture` (`DDG-ARCH-002`, core purity)
Invariant: `DDG-ARCH-002` (CRITICAL — `core-stays-pure` is a depcruise `error`), `DDG-WIRE-002` (the barrel's `./eval/score.js`), `DDG-TEST-003`
Acceptance: the scorer takes no provider, no clock and no config; two calls with identical inputs are deep-equal; `src/index.ts` exports it; `grep -a "^import" reviewer-core/src/eval/score.ts` lists exactly one line and it is a type-only import of `@devdigest/shared`
Done-condition:
```sh
cd reviewer-core && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd reviewer-core && CI=true ./node_modules/.bin/vitest run --passWithNoTests eval-score
cd reviewer-core && CI=true ./node_modules/.bin/eslint src/eval/score.ts src/index.ts
# DDG-ARCH-002, from server/ because the gate cruises both trees:
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src
#   → 0 errors; warnings must stay at 22; module count must RISE from 234
# DDG-WIRE-002 over this package (no db/schema here, so no last exclusion):
cd reviewer-core && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src | grep -v "\.js'"
#   → 0 lines = pass. grep exits 1 on no match; read the output, not $?.
```
Red flags: `reviewer-core/tsconfig.json` includes `src/**/*.ts` only, so `test/eval-score.test.ts` is **not** typechecked by the gate above — a real `error TS` can sit in it while vitest is fully green. Check it with `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` before declaring done. If the tally arithmetic seems to need a model call, a heuristic or a fuzzy match, stop: N9 excludes an LLM judge outright and AC-82/AC-98 make the absence checkable.

### T3 — Client copy, runtime constants and type re-exports
Satisfies: R17, R18, R19, R20, R21, R22, R23, R16
Depends-on: T1
Owned paths: `client/messages/en/eval.json`, `client/messages/en/prReview.json`, `client/src/lib/eval.ts`, `client/src/lib/types.ts`
Forbidden: every other `client/messages/en/*.json` — a feature's copy in another feature's namespace fails silently in both directions; also `client/src/lib/severity.ts`, `client/src/vendor/**`, `client/package.json`
Change: extend the **existing** `eval` namespace (Q1: "No new namespace and no shared edit") with the keys this feature's screens need and the shipped catalogue lacks — the missing third input tab (`caseEditor.tabs.files`, which today has only `diff` and `prMeta`), the mechanical-scoring sentence (R17), the `not run` label and its reason wording (Q5), an empty state that names the accept-or-dismiss-then-turn-into-a-case step (R18 — today's `evalsTab.emptyCases` does not name it), the expectation badges, the compare-modal copy including "not measured" and "prompt unchanged", the `Compare` precondition, the period-filter labels, and the alert-strip wording. Extend the **`prReview`** namespace with the `Turn into eval case` label, its disabled-state accessible name, and one message per `EvalRefusalReason` member (EC-36: that label belongs to the findings namespace it renders in, not to `eval`). `prReview.finding` already carries `learn` and `replyToAuthor`.

`client/src/lib/eval.ts` holds every **runtime** value: the period option list, the metric key order, the expectation-to-badge mapping, the percentage-point formatter. It imports **no** value from `@devdigest/shared` — only `import type`. `client/src/lib/types.ts` gains `export type { … } from "@devdigest/shared"` for the new symbols, following the file's own stated pattern.
Skill: `frontend-ui-architecture` (law 5: a named module, never a `utils` bucket; the placement table's constants rows), `typescript-expert`
Invariant: `DDG-DOC-002` (a doc or catalogue naming a path names a real one), EC-35 (type-only imports)
Acceptance: `eval.json` and `prReview.json` parse; no other catalogue changed; `src/lib/eval.ts` contains no non-type import of `@devdigest/shared`
Done-condition:
```sh
cd client && node -e "for (const f of ['eval','prReview']) JSON.parse(require('fs').readFileSync('messages/en/'+f+'.json','utf8'))"
cd client && git diff --name-only -- messages/  # exactly 2 paths
cd client && grep -n "@devdigest/shared" src/lib/eval.ts | grep -v "import type"  # 0 lines = pass
cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/eslint src/lib/eval.ts src/lib/types.ts
```
Red flags: `rg 'useTranslations("<ns>")'` returning exactly one caller that is not that namespace's feature is the tell for a misplaced key — but there is no `rg` binary here, so use `grep -arn 'useTranslations("eval")' src/`.

### T4 — The `eval_batches` table, the added columns, and the applied migration
Satisfies: R1, R3, R6, R11, R12, R15
Depends-on: T1
Owned paths: `server/src/db/schema/eval.ts`, `server/src/db/migrations/` (**generated output only** — the new `.sql` plus `meta/`)
Forbidden: hand-editing any file under `server/src/db/migrations/` (`DDG-DNT-004`), every other file under `server/src/db/schema/`, `server/src/db/schema.ts` (the barrel already re-exports `./schema/eval`, so it needs no edit), `server/src/db/seed.ts`, `server/drizzle.config.ts`
Change: three declarations in `src/db/schema/eval.ts`, all **additive**.

`evalBatches` — a new `eval_batches` table: `id` uuid pk default random; `workspace_id` uuid notNull FK `workspaces` cascade; `agent_id` uuid **nullable** with `onDelete: 'set null'`, matching `agent_runs.agent_id` so deleting an agent leaves the batch readable (R15/AC-49) rather than deleting the history; `agent_version` integer notNull; `system_prompt_snapshot` text notNull and `model_snapshot` text notNull (R6 — a version row is deleted with its agent, and a compare view rendering "the prompt that produced this" from a row that may be gone is a comparison that can start lying); `status` text enum `running|complete|error` notNull; `label` text nullable (Q7: unset unless a caller supplies one); `started_at` timestamptz notNull default now; `finished_at` timestamptz nullable; `cases_covered` and `cases_passed` integer nullable; `recall`, `precision`, `citation_accuracy` doublePrecision nullable; `true_positives`, `false_negatives`, `false_positives` integer nullable; `cost_usd` doublePrecision nullable; `error` text nullable.

`evalCases` gains: `expectation` text enum `must_find|must_not_flag` (a first-class field per P2 — the UI filters and counts by it); `source_finding_id` uuid nullable **with no foreign key**, matching the `reviews.agent_id` precedent, so deleting a finding neither deletes the case nor blanks the only trace of where its expectation came from (Q4: provenance survives); `edited` boolean notNull default false (Q4: the case is marked as edited); `created_at` timestamptz notNull default now.

`evalRuns` gains: `batch_id` uuid nullable FK `eval_batches` `onDelete: 'cascade'` (D5 — the shipped table has no batch identity, so "compare two runs" and "which prompt produced this" are not expressible without it); `outcome` text enum `passed|failed|not_run` nullable; `not_run_reason` text enum with the five `EvalNotRunReason` members, nullable; `expected_count`, `actual_count`, `kept_count`, `dropped_count` integer nullable.

Indexes — **PostgreSQL does not auto-index FK columns**, and every ordering key in R3/R12 is a read path: `eval_cases(workspace_id, owner_kind, owner_id)`, `eval_cases(source_finding_id)` (R2's duplicate check), `eval_cases(owner_id, name, id)` (R3's total order), `eval_batches(agent_id, started_at desc, id desc)` (R12's total order and the retention scan), `eval_batches(workspace_id, started_at desc)` (R15's cross-agent recent list), `eval_runs(batch_id)`, `eval_runs(case_id, ran_at desc)` (R3's most-recent-execution read).
Skill: `drizzle-orm-patterns`, `postgresql-table-design`
Invariant: `DDG-WIRE-003` (CRITICAL — a schema change ships with its generated migration), `DDG-DNT-004` (CRITICAL — migrations are generated, never hand-edited)
Acceptance: one new `.sql` migration; the migration contains only `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` and `CREATE INDEX` — **no `DROP` and no rename**; `information_schema` reports `eval_batches` present after the apply
Done-condition, in this order:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/drizzle-kit generate
git status --short -- server/src/db/migrations | grep '\.sql'
#   → exactly one 'A' line and NO 'M' line against a .sql file.
#   meta/_journal.json and the snapshot ARE expected to show 'M' — drizzle-kit
#   rewrites the journal on every generate (server/INSIGHTS.md, 2026-08-19).
grep -acE "DROP (COLUMN|TABLE)" server/src/db/migrations/00*_*.sql | tail -1   # the new file: 0
cd server && CI=true ./node_modules/.bin/tsx src/db/migrate.ts
cd server && node --input-type=module -e "
import 'dotenv/config'; import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const t = await sql\`select table_name from information_schema.tables
  where table_name in ('eval_cases','eval_runs','eval_batches') order by table_name\`;
const c = await sql\`select table_name, column_name from information_schema.columns
  where (table_name='eval_cases' and column_name in ('expectation','source_finding_id','edited'))
     or (table_name='eval_runs'  and column_name in ('batch_id','outcome','not_run_reason'))
  order by 1,2\`;
console.log(t.map(x=>x.table_name).join(','));
console.log(c.map(x=>x.table_name+'.'+x.column_name).join(','));
await sql.end();"
#   → 'eval_batches,eval_cases,eval_runs' and all six columns.
#   Measured before this task: the same query printed 'eval_cases,eval_runs'.
```
Red flags: if `drizzle-kit generate` asks *"Is X column in Y table created or renamed from another column?"* it will **block forever** — it reads the answer from a TTY and piping newlines does nothing. That prompt can only appear if a drop crept in; remove the drop and split it into a second migration. If `pnpm db:generate` is used instead of the binary and dies with `[ERR_PNPM_IGNORED_BUILDS]`, that is the supply-chain pre-script, not drizzle — and check for a scaffold `server/pnpm-workspace.yaml` and delete it (`DDG-WIRE-005`).

### T5 — Client data hooks
Satisfies: R16, R17, R18, R19, R20, R21, R22, R23
Depends-on: T1, T3
Owned paths: `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/index.ts`, `client/src/lib/hooks/eval.test.tsx`
Forbidden: every other file under `client/src/lib/hooks/`, `client/src/lib/api.ts`, `client/src/vendor/**`
Change: one hook module against the endpoint table in `## Contracts & wiring`, going through `apiFetch` — **never `fetch` in a component**, and `ApiError` carries `status`/`code` so R16's inline refusal can branch on the reason. Reads: workspace dashboard, per-agent dashboard, an agent's case set, an agent's batch history, one batch with its case results, a comparison. Writes: create a case from a finding, save a case, delete a case, start a batch (whole set or one case), run all agents, promote a version. Plus one subscription hook for the batch event stream (`EventSource` against the SSE route), used by R18's live progress.

Every import of the new contract types is `import type`. The period options and the percentage-point formatter come from `client/src/lib/eval.ts` (T3), never from `@devdigest/shared`.
Skill: `frontend-ui-architecture` (the placement table's "data read/write" row: a hook, never a component body), `react-best-practices` (data fetching in custom hooks; loading/error/empty handled by the container), `react-testing-library`, `typescript-expert`
Invariant: EC-35 (type-only imports of the contract), `DDG-TEST-003`
Acceptance: `apiFetch` is the only network call; the create-case mutation sends `{ finding_id }` and **no** expectation type (R16/AC-52); the barrel re-exports the new hooks
Done-condition:
```sh
cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/vitest run hooks/eval
cd client && CI=true ./node_modules/.bin/eslint src/lib/hooks/eval.ts src/lib/hooks/index.ts src/lib/hooks/eval.test.tsx
cd client && grep -n "@devdigest/shared" src/lib/hooks/eval.ts | grep -v "import type"  # 0 lines = pass
```
Red flags: **stub `fetch`, not `api`/`apiFetch`.** A mutation that omits an optional field is a silently successful no-op and every signal a UI trusts says it worked; only asserting the outgoing body at the `fetch` boundary sees it, and stubbing `fetch` also keeps `apiFetch`'s conditional `content-type` inside the code path under test (`src/lib/hooks/intent.test.tsx` is the shape to copy). There is no shared QueryClient helper — build one inline, as `AgentCard.test.tsx` and `PRRow.test.tsx` each do.

### T6 — Server repository, constants and pure helpers
Satisfies: R1, R2, R3, R4, R11, R12, R15
Depends-on: T4
Owned paths: `server/src/modules/eval/constants.ts`, `server/src/modules/eval/types.ts`, `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/repository.ts`, `server/test/eval-helpers.test.ts`, `server/test/eval-order.it.test.ts`
Forbidden: every other `server/src/modules/**` file, `server/src/adapters/**`, `server/src/platform/**`, `server/src/db/**`
Change: the persistence and pure-arithmetic half of the module.

`constants.ts` — every figure from the spec's `## Non-functional`, each with the reason beside it: `CASE_LIMIT = 50`, `DIFF_MAX_BYTES = 65_536`, `CASE_DEADLINE_MS = 120_000`, `CASE_CONCURRENCY = 3`, `BATCH_DEADLINE_MS = 900_000`, `HEARTBEAT_MS = 15_000`, `BATCH_RETENTION = 50`, `DEFAULT_PERIOD = '30d'`.

`types.ts` — the module's **consumer-declared** interfaces, so nothing imports a sibling module and the container satisfies each structurally with no `implements`: `DiffParser` (`(raw: string) => UnifiedDiff`), `EvalFindingSource` (the narrow view of `container.reviewRepo` this module reads — `findingContext`, `getPrFiles`, `getPull`, `getRepo`), `EvalAgentSource` (the narrow view of `container.agentsRepo` — `get`, `getVersion`, `list`), and `Evals` (the service interface the container exposes so `ContainerOverrides.eval` can carry a fake). **Declare the fields you read, not the whole type** — a types-only import of a sibling's `types.ts` is a real `no-cross-module-internals` violation (measured 22 → 24), and a port whose signature carries a Drizzle Row has moved the schema into the contract (`OA-DEEP-002`), so map Row → DTO in `helpers.ts` and keep Row types out of every signature in `types.ts`.

`helpers.ts` — pure functions: `normaliseAnchor` (low = `Math.min(start, end)`, high = `Math.max`), `anchorsOverlap` (same file path **and** overlapping ranges — the same predicate the scorer uses, and the one R2's `conflicting_anchor` check needs), `diffFragmentFor` (select the finding's own file out of the PR's patches and assemble the one-file unified diff, the shape `diffFromPrFiles` already uses: `diff --git`, `---`, `+++`, then the patch), `diffByteLength`, `periodStart` (returns a `Date`), and `toEvalAgentCase` / `toEvalBatch` / `toEvalBatchCaseResult` Row→DTO mappers.

`repository.ts` — **every** query, and the only file here allowed to touch `db/schema` and `drizzle-orm` (`OA-INFRA-001`). Case CRUD scoped by workspace; the set read with its most-recent-execution join ordered `asc(name), asc(id)`; the duplicate-source-finding lookup; the set-size count; the anchor-conflict lookup; batch insert/update; the history read ordered `desc(started_at), desc(id)`; the retention delete keeping `BATCH_RETENTION` per agent; the dashboard reads; the trend read. Repositories return rows or domain values, never a leaked query builder, and the **service** owns any transaction boundary — this file opens no `db.transaction` of its own.
Skill: `onion-architecture`, `drizzle-orm-patterns`, `typescript-expert`, `zod` (parse, never cast, on any `jsonb` read back — an `as` on a boundary already shipped `$NaN` to a client here)
Invariant: `DDG-WIRE-002` (CRITICAL — every relative import carries `.js`), `DDG-TEST-001` (CRITICAL — the DB-backed file is named `*.it.test.ts`), `DDG-TEST-003`
Acceptance: no `node:` specifier anywhere under `modules/eval/`; no raw SDK import; no sibling-module import; `expected_output` is `safeParse`d, never cast; every ordering has a unique tiebreaker
Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' eval-helpers \
  > /tmp/t6.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t6.txt
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src | tail -3
#   → 0 errors, warnings still 22, module count RISEN from 234
cd server && grep -arnE "^import .* from 'node:" src/modules/eval/   # 0 lines = pass
cd server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \
  | grep -v "\.js'" | grep -v '^src/db/schema'                      # 0 lines = pass
cd server && CI=true ./node_modules/.bin/vitest run --pool=forks \
  --poolOptions.forks.singleFork eval-order.it > /tmp/t6it.txt 2>&1; echo "rc=$?"; tail -20 /tmp/t6it.txt
#   → read the ↓ lines, not the pass count: a skipped file is not a green one.
```
Red flags: a `Date` interpolated into a raw `sql` template typechecks and then throws `The "string" argument must be of type string … Received an instance of Date`, and Fastify's handler swallows it into a generic `500 internal_error` — bind `${d.toISOString()}::timestamptz`. The order test must assert the returned ids equal the **sorted** ids; asserting only "unchanged after an update" passes without the fix. And `grep` without `-a` reports nothing on two existing files under `src/modules/`, so the `-a` above is not decoration.

### T7 — The `Turn into eval case` finding action
Satisfies: R16
Depends-on: T3, T5
Owned paths: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`, `.../FindingCard/styles.ts`, `.../FindingCard/constants.ts`, `.../FindingCard/FindingCard.test.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`, `.../FindingsPanel/FindingsPanel.test.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx`

> **AMENDED mid-run, 2026-08-23, by the orchestrator.** The last two paths were added after the
> first T7 dispatch came back `partial`. `FindingsPanel` cannot gain its first React Query hook
> without them: both files mount it, both mock only `lib/hooks/reviews`, and neither provides a
> `QueryClientProvider`, so `useCreateEvalCase` throws `No QueryClient set` and crashes 16
> previously-green tests while `tsc --noEmit` stays clean. Measured, not predicted — the first
> dispatch wrote the wiring, ran it, saw `16 failed | 10 passed` with 17 occurrences of that
> error, and reverted rather than leave the suite red. No other task in this plan owned either
> file, so the original Owned paths could not finish T7. Each file needs one addition: a
> `vi.mock` of the eval hooks beside the `reviews` mock it already carries, or a provider in its
> render helper.
Forbidden: `client/src/vendor/**`, `client/src/lib/hooks/**`, `client/messages/**`, every other `_components/` folder under `pulls/[number]/`
Change: the expanded card's action row today renders exactly two controls — `Accept` and `Dismiss` (`FindingCard.tsx`, the `s.actions` block). Add `Turn into eval case`, plus `Learn` and `Reply to author` as **present but unwired** controls, because AC-50's observable is five actions while N3 keeps those two unimplemented (see `## Open questions & recommendations` Q1 — this is the plan's default). On a finding carrying neither decision the eval control is present, `aria-disabled`, and its accessible name states the precondition, taken from the `prReview` catalogue. `FindingsPanel.tsx` supplies the handler, as it already does for `onAction` at line 134, and renders the refusal message inline on that card without disabling `Accept` or `Dismiss`.
Skill: `react-best-practices` (`aria-label` on an icon-only control; a word beside every state, not colour alone; no derived state in `useState`), `frontend-ui-architecture` (the unit's own `styles.ts` and `constants.ts`; nothing promoted until a second consumer), `react-testing-library`
Invariant: `DDG-UI-001` (WARNING — the diff changes what a route renders; gates cannot see a blank first paint, so it needs a look in the running app), `DDG-TEST-003`
Acceptance: a decided finding's card renders five actions; an undecided one renders the eval control `aria-disabled` with the precondition in its accessible name; activating it issues **one** request carrying the finding id and no expectation type; a refusal renders inline with `Accept` and `Dismiss` still operable
Done-condition:
```sh
cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/vitest run FindingCard FindingsPanel
cd client && CI=true ./node_modules/.bin/eslint \
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingCard" \
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel"
```
Red flags: no `user-event` in this package — use `fireEvent`/`.click()`, as all 21 existing test files do. `getByRole(…, { name })` normalises consecutive spaces, so do not assert an accessible name that embeds one. And the existing `FindingCard` scroll effect needs `Element.prototype.scrollIntoView`, which `src/test/setup.ts` already shims — do not add a per-file stub.

### T8 — The batch service and runner
Satisfies: R2, R4, R6, R7, R9, R10, R11, R12, R13, R15
Depends-on: T2, T6
Owned paths: `server/src/modules/eval/service.ts`, `server/src/modules/eval/runner.ts`, `server/test/eval-service.test.ts`, `server/test/eval-runner.test.ts`
Forbidden: `server/src/modules/eval/repository.ts` (T6's, read it and call it), every other `server/src/modules/**` file, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/**`
Change: the application ring.

`service.ts` — case creation with all six refusals in R2 mapped to `ValidationError` (`422`) except the duplicate, which is a `409` carrying the existing case's id; case save with the `anchor_not_in_diff` check; case delete; batch creation (snapshot the version, prompt and model once, at creation, and never re-read them); the staleness rule that lets a `running` batch older than `BATCH_DEADLINE_MS` be superseded while a fresher one refuses with `batch_already_running`; history; comparison including the null-change and `same_config` rules and the `cross_agent_compare` refusal; the dashboards with the period filter; and `Run all agents`, which skips a disabled agent and an agent with no cases and **names each skip with its reason** (Q8). The service owns the transaction boundary wherever two writes must land together — a service awaiting two repository calls in sequence has written a two-statement transaction with no transaction, and the failure only shows when the second throws.

`runner.ts` — batch execution. **Not a `JobRunner` job:** its timeout is a fixed 120 s and this batch's deadline is 15 minutes. Fire it detached and attach a `.catch` that records the failure **on the batch row** (status `error`, reason), because a batch that fails needs its own row updated and not merely to survive. Execute at most `CASE_CONCURRENCY` cases at once; per case, parse the stored diff (no files ⇒ `not_run` / `diff_unparseable` with **zero** model calls), then race `reviewPullRequest` against a `CASE_DEADLINE_MS` timer the runner owns, passing `maxRetries: 0` — `StructuredRequest.timeoutMs` is silently ignored and `maxRetries` defaults to 2. Publish one event per outcome on `container.runBus`, keyed on the batch id, plus a `HEARTBEAT_MS` heartbeat while nothing has resolved, and call `runBus.complete(batchId)` at the end. Feed the scorer once, after the last case, and persist the batch's metrics — **no model request between the last case's response and completion**. A missing per-case cost makes the batch's total cost null, never a smaller sum.

The engine is reached exactly as `run-executor.ts` reaches it: `reviewPullRequest` from `@devdigest/reviewer-core`, with the provider from `container.llm(provider)`. **The engine gains no eval-specific parameter and no eval-specific branch.** Nothing here creates a `pull_requests`, `reviews`, `findings` or `agent_runs` row, and nothing resolves a clone.
Skill: `onion-architecture`, `security`, `typescript-expert`, `zod`
Invariant: `DDG-SEC-002` (CRITICAL — the stored diff reaches the model through the engine's existing wrapper and there is no second assembly here), `DDG-ARCH-001` (WARNING — none of this logic may drift into `routes.ts`), `DDG-TEST-003`
Acceptance: a fake provider recording in-flight calls never observes a fourth; every `reviewPullRequest` call carries `maxRetries: 0`; running a batch leaves the `reviews`, `findings` and `agent_runs` row counts unchanged; a four-case batch with two passes, one failure and one `not_run` reads `cases_passed: 2, cases_covered: 4`; an all-`not_run` batch records three null metrics
Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  eval-service eval-runner > /tmp/t8.txt 2>&1; echo "rc=$?"; tail -20 /tmp/t8.txt
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src | tail -3      # 0 errors, 22 warnings
cd server && grep -an "maxRetries" src/modules/eval/runner.ts   # every hit reads 0
cd server && grep -an "container.jobs\|jobs.enqueue" src/modules/eval/  # 0 lines = pass
cd server && grep -arnE "^import .* from 'node:" src/modules/eval/      # 0 lines = pass
```
Red flags: **prove the negatives with a fake whose every unused port method throws.** A fake whose default method body is `unreachable(name)` turns an absence into a failing test that names the offending call, where an assertion over the *result* can only say the answer looked right — that is how `test/project-context-effective.test.ts` pinned "this path reads no bytes and resolves no clone", and it is the only honest way to assert R7. Mutation-verify: insert one forbidden call and confirm a test turns red. If a case's cost sum looks like it should skip the missing entries, remember that shape produced a PR list reporting `$0.00064` of `$0.0051`.

### T9 — The `Evals` tab and the case editor
Satisfies: R17, R18, R19, R23
Depends-on: T3, T5
Owned paths: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `.../AgentEditor/AgentEditor.tsx`, `.../AgentEditor/AgentEditor.test.tsx`, `.../AgentEditor/_components/EvalsTab/**` (new folder, including a nested `_components/CaseEditorModal/`)
Forbidden: `.../AgentEditor/_components/{ConfigTab,SkillsTab,ContextTab}/**`, `client/src/vendor/**`, `client/messages/**`, `client/src/lib/**`
Change: `TABS` in `constants.ts` gains one entry, `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }`, placed **after** `context`. The label key already exists in `messages/en/agents.json` (`editor.tabs.evals: "Evals"`, sitting between `context` and `stats`). `VALID_TABS` is derived from `TABS`, so the `?tab=` gate follows for free — the file's own comment says the two used to be hand-synced in different files. `AgentEditor.tsx` gains one early return for the new tab, in the shape the file already uses.

`EvalsTab/` is a colocated unit — `EvalsTab.tsx`, `index.ts`, `styles.ts`, `constants.ts`, `helpers.ts`, `EvalsTab.test.tsx` — rendering the four tiles, the mechanical-scoring statement, the dashboard link, the case list and the empty state, and swapping the run-all control for live progress while a batch runs. `CaseEditorModal/` is a nested unit built on the existing `Modal` primitive; EC-7 calls the negative case's presentation a modal, which is why the editor is a modal rather than a route (see `## Assumptions`). Charts and tiles come from the existing `MetricCard`, `Sparkline`, `BarRow` and `ProgressBar` in `src/vendor/ui/charts/` and the existing `Badge`, `Skeleton`, `EmptyState`, `ErrorState`, `Tabs`, `Modal` — **no primitive is restyled and none gains a prop.** Where one surface needs a trimmed `Badge`, `Badge` spreads `...style` last over its own defaults, so the override belongs in this unit's `styles.ts` as a named member with a comment (`VerdictBanner`'s `s.countBadge` is the precedent) — and note the escape hatch is per-component: `style` is a prop on `Badge` but **not** on `SeverityBadge` or `CategoryTag` in the same file.

The three denominators are settled by Q3 and must not disagree on one screen: the tile and the pass badge both read `cases_passed / cases_covered` from the most recent **completed** batch, and the case-count chip reads the set's current size. The gap between them is meaningful — a case added after a batch is in the set but was never covered by it.
Skill: `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `typescript-expert`
Invariant: `DDG-DNT-002` (CRITICAL — nothing under `client/src/vendor/ui/` is touched by this task), `DDG-UI-001` (WARNING), `DDG-TEST-003`
Acceptance: the tab strip reads Config, Skills, Context, Evals; four tiles render and the fourth reads `17/20` for a batch of those counts; a metric shown as `82%` renders its change as `4pt`, never `0.04`; a passing row and a failing row are distinguishable with colour removed; a zero-case agent gets the empty state naming the accept/dismiss step; typing a trailing comma in the expected output flips the badge to `invalid JSON` and disables both `Save` and `Run case`
Done-condition:
```sh
cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/vitest run AgentEditor EvalsTab CaseEditorModal
cd client && CI=true ./node_modules/.bin/eslint "src/app/agents/[id]/_components/AgentEditor"
cd client && git diff --name-only -- src/vendor/   # 0 lines = pass for this task
```
Red flags: `AgentEditor` takes `tab`/`onTab` as **props** while `SkillEditor` reads `?tab=` itself — a test copied from the skill editor does not work here. Query the tab strip **by role**, because a tab label can collide with body text. A component composing a shared unit legitimately reads two namespaces (`eval` and `agents` here); mount with both, or next-intl renders the key path and logs `IntlError: MISSING_MESSAGE` to stderr while the test stays green. The vendored `Skeleton` has no role or aria, so R23's loading assertion goes through `container.getElementsByClassName`.

### T10 — Routes, module registration, container wiring and the promotion endpoint
Satisfies: R1, R2, R3, R4, R5, R6, R8, R13, R14, R15
Depends-on: T8
Owned paths: `server/src/modules/eval/schemas.ts`, `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/modules/agents/routes.ts`, `server/src/modules/agents/service.ts`, `server/test/eval-routes.test.ts`, `server/test/agents-promote.test.ts`
Forbidden: `server/src/modules/eval/{service,runner,repository,helpers,constants,types}.ts` (earlier tasks'), `server/src/modules/agents/repository.ts` (its `update` already bumps the version and snapshots the config — reuse it, do not reshape it), `server/src/app.ts`, `server/src/adapters/**`
Change: three things.

**Transport.** `schemas.ts` holds the zod request/response schemas; `routes.ts` declares them on the route (`params`/`body`/`querystring`), calls the service and maps the result — no logic, no query, no SDK. Every route resolves its agent inside the caller's workspace first and throws `NotFoundError` otherwise, so an out-of-workspace id answers `404` with the service's own envelope. The SSE route carries `config: { rateLimit: false }` and bridges `container.runBus` to an async generator exactly as `modules/reviews/routes.ts` does for `/runs/:id/events` — `RunBus` already replays its buffer to a late subscriber and `onDone` already fires immediately for a completed run, which is what makes R8's replay-then-close work without new machinery. The period query param is validated against `EvalPeriod` and defaults to `30d`.

**Wiring.** One import line and one entry in `server/src/modules/index.ts` — a module with no entry there mounts nowhere and 404s with no error. In `platform/container.ts`: `get eval(): Evals` with a `ContainerOverrides.eval` field so tests inject a fake, and `readonly diffParser = (raw: string): UnifiedDiff => parseUnifiedDiff(raw)` as an arrow property, following the `readonly featureModel` and `readonly fileRole` precedents in that file — the container is the one ring allowed to name a concrete thing, and this keeps `modules/eval/` from importing `src/adapters/git/diff-parser.js` itself.

**Promotion.** `POST /agents/:id/versions/:version/promote` lands in the **agents** module, not in eval: `AgentsRepository.update` already bumps the version and snapshots the new config into `agent_versions`, so promotion is "read version N's `config_json`, feed it back through the existing update path", and the result is a new higher version with no existing row mutated. Reimplementing that bump inside eval would duplicate the snapshot logic and is the kind of second copy that drifts.
Skill: `fastify-best-practices`, `onion-architecture`, `zod`, `security`, `typescript-expert`
Invariant: `DDG-WIRE-001` (CRITICAL), `DDG-WIRE-004` (CRITICAL), `DDG-SEC-003` (CRITICAL), `DDG-ARCH-001` (WARNING), `DDG-WIRE-002` (CRITICAL), `DDG-TEST-003`
Acceptance: `routes.ts` contains no `db`/`drizzle` import and no aggregate; every route declares a zod schema; `modules/index.ts` names `eval`; the container exposes `eval` and `diffParser`; promoting v6 while v7 is current leaves the agent's config equal to v6's and its current version at v8, with no `agent_versions` row mutated
Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  > /tmp/t10.txt 2>&1; echo "rc=$?"; tail -20 /tmp/t10.txt
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src | tail -3      # 0 errors, 22 warnings
# DDG-WIRE-001 — any UNREGISTERED: line is a module that mounts nowhere:
cd server && for m in $(ls -d src/modules/*/ | xargs -n1 basename | grep -v '^_'); do
  [ -f "src/modules/$m/routes.ts" ] || continue
  grep -q "'\./$m/routes.js'" src/modules/index.ts || echo "UNREGISTERED: $m"
done
# DDG-WIRE-002 — 0 lines = pass:
cd server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \
  | grep -v "\.js'" | grep -v '^src/db/schema'
# Against the running API on :3001 — the status code IS the diagnosis:
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/eval/dashboard          # expect 200
curl -s localhost:3001/eval/agents/00000000-0000-0000-0000-000000000000/cases   # expect the
#   service envelope {"error":{"code":"not_found",…}}, NOT Fastify's route-not-found.
#   404 on the first curl ⇒ the module is not registered (modules/index.ts).
#   500 on the first curl ⇒ the migration was never applied (T4) — re-run
#   ./node_modules/.bin/tsx src/db/migrate.ts and the information_schema query.
```
Red flags: a `200` alone is not evidence of registration — an unregistered module and a registered one both `404` for a nonexistent id, and only the registered one answers with the service's own envelope, which is why the second `curl` is there. If a route needs a value the service does not expose, add a service method; do not reach into the repository from `routes.ts` (`routes-no-data-access` is a `warn` at 4 files and this task must not make it 5). If the promotion route seems to want its own bump-and-snapshot, re-read `AgentsRepository.update` first.

### T11 — The `/eval` dashboard, the per-agent page, the compare modal and the nav entry
Satisfies: R20, R21, R22, R23
Depends-on: T3, T5
Owned paths: `client/src/app/eval/page.tsx`, `client/src/app/eval/_components/**` (new), `client/src/app/eval/[agentId]/page.tsx`, `client/src/app/eval/[agentId]/_components/**` (new), `client/src/vendor/ui/nav.ts`
Forbidden: everything else under `client/src/vendor/**` — `nav.ts` is the single carve-out and its own doc comment says so; also `client/messages/**`, `client/src/lib/**`, `client/src/components/app-shell/**` (`activeKeyFor` **already** maps any path under `/eval` to the key `eval` — verified at `src/components/app-shell/helpers.ts:44`; it needs no edit)
Change: two thin route entries in the house shape — `await params`, render one view from `_components/`, nothing else, and **no `<Suspense>` wrapper** (both routes are dynamic, so the hook is free and a boundary would make the server emit the fallback instead of the screen). Two colocated views: the workspace dashboard (agent rows, sparkline omitted below two completed batches, the cross-agent recent-runs table, the period filter, `Run all agents`) and the per-agent page (three metric cards, a three-series `LineChart` — whose y-axis already defaults to 0.6–1.0, the range these metrics live in — a selectable recent-runs table, the alert strip read from the payload, and the compare modal with its four cards, its null-change wording, its prompt-diff region and its promote control). Each view owns its loading skeletons and its inline error, shaped like the rows and tiles that are coming, with the shell still rendered — a segment-level `error.tsx` cannot do that because it replaces the segment, and this repo deliberately has none.

`nav.ts` gains **one** entry in the `SKILLS LAB` group — `{ key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval", gKey: "e" }` — plus its matching `SHORTCUTS` row. `g` + `e` is free (`p o x s a c ,` are taken). The label is also in `messages/en/shell.json` as `nav.eval: "Eval Dashboard"`. Nothing else in that file moves, and no `NavItem` styling is touched.
Skill: `next-best-practices`, `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `typescript-expert`
Invariant: `DDG-DNT-002` (CRITICAL — exactly one file under `src/vendor/` changes), `DDG-UI-001` (WARNING), `DDG-TEST-003`
Acceptance: the sidebar entry renders in `SKILLS LAB` and the shell marks it active under `/eval`; activating a dashboard row lands on that agent's page; a one-batch agent's row has no sparkline element; `Compare` is `aria-disabled` at zero, one and three selections with the two-run requirement in its accessible name in each; a null change renders "not measured", not a zero; two runs of one version render the prompt-unchanged sentence and no diff body
Done-condition:
```sh
cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/vitest run EvalDashboardView AgentEvalView
cd client && CI=true ./node_modules/.bin/eslint src/app/eval
#   NOTE: do NOT add src/vendor/ui/nav.ts to that eslint invocation — the config
#   ignores src/vendor/**, so eslint exits 0 having linted nothing and the green
#   reads as coverage. Assert the vendor change this way instead:
cd client && git diff --stat -- src/vendor/   # exactly one file: ui/nav.ts
```
Red flags: **never run `next build`** — it writes the same `client/.next` a running `next dev` owns and corrupts it, and `NEXT_PUBLIC_API_BASE` is inlined at compile time. `AppShell` mounts cleanly in jsdom with only `vi.mock("next/navigation")`, a `QueryClient` and the `shell` namespace, which is what lets R23's "the rest of the screen is still usable" be asserted against the real sidebar rather than a faked shell — but note a repo name or a number appears **twice** in a real shell (switcher + breadcrumb), so `getByText` on either throws "found multiple elements". Under fake timers a TanStack Query refetch commits its data one render after the timer fires: the call count is the honest signal, the rendered payload lags it by one commit. And `var(--bg)` is not a token — name `--bg-primary`.

### T12 — `verify:l06`
Satisfies: R29
Depends-on: T2, T10, T11
Owned paths: `scripts/verify-l06.sh`, `server/package.json`
Forbidden: `scripts/verify-l03.sh` (the model to copy, not to edit), `scripts/e2e.sh`, `server/pnpm-lock.yaml`, `client/package.json`, `.github/workflows/**`
Change: a bash script modelled line-for-line on `scripts/verify-l03.sh` — the same `gate <name> <workdir> <command...>` function that logs, records `PASS`/`FAIL` into `RESULTS`, increments `FAILED`, **runs every gate even after one fails**, and exits with the count. Same flags: `--server`, `--client`, `--core`, `--with-db`, `-h`. Two script entries in `server/package.json` beside `verify:l03`: `"verify:l06": "bash ../scripts/verify-l06.sh --server"` and `"verify:l06:db": "bash ../scripts/verify-l06.sh --server --with-db"`. There is **no root `package.json`** and no workspace file, so it cannot be a root script; `verify:l03` sits here for the same reason.

Gates, all invoking `./node_modules/.bin/<tool>` directly — **no `pnpm run` and no `npm run` anywhere in the file**, because pnpm's pre-script dependency check shells out to `pnpm install`, trips this repo's supply-chain policy and kills the run before the gate starts:

- `core · typecheck` — `reviewer-core`, `tsc --noEmit -p tsconfig.json`
- `core · scorer tests` — `reviewer-core`, `vitest run --passWithNoTests eval-score`
- **`core · the scorer makes no model call`** — the AC-98 gate, mechanical and scoped to **import statements**, run with `grep -a` because two of this package's siblings contain a NUL byte and a plain `grep` reports nothing on them. Two assertions: every `from '…'` in `src/eval/score.ts` resolves to `@devdigest/shared` (so the transitive set is `zod` and nothing else), and no import line in that file matches `openai|openrouter|anthropic|llm|provider|fetch|http|node:`. Fail on any hit.
- `server · typecheck` — `tsc --noEmit -p tsconfig.json`
- `server · typecheck (L06 test files)` — the `verify-l03.sh` shape: run `tsc --noEmit -p tsconfig.eslint.json`, print the total, and fail only on lines matching `^test/(eval|agents-promote)`. The tree carries a documented baseline of **16** errors in six unrelated files (measured this run), and a gate red on arrival is a gate nobody reads.
- `server · eslint` — `eslint .`
- `server · dependency-cruiser` — `depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src`
- `server · eval tests` — `vitest run --exclude '**/*.it.test.ts' eval agents-promote`
- `server · ESM extensions` and `server · module registered` — the two `grep`/`for`-loop gates from `gate.md` Part 1, verbatim
- `client · typecheck` — `tsc --noEmit`
- `client · eslint` — `eslint .`
- `client · L06 component tests` — `vitest run EvalsTab CaseEditorModal EvalDashboardView AgentEvalView FindingCard FindingsPanel AgentEditor hooks/eval`
- Behind `--with-db` only, and **serially in a single fork**: `vitest run --pool=forks --poolOptions.forks.singleFork eval-order.it`. Opt-in because it needs Docker, and serial because a mixed `vitest run` silently skips most `.it.test.ts` files even with Docker up — read the `↓` lines, not the pass count.
Skill: `typescript-expert` (the only one that binds: this is a shell script plus a `package.json` script pair; no product code is added)
Invariant: `DDG-DOC-002` (WARNING — every path and script the header names is real), `DDG-DNT-005` (CRITICAL — `package.json` changes, the lockfile does not)
Acceptance: `bash scripts/verify-l06.sh --help` prints usage and exits 0; `grep -c 'pnpm run\|npm run' scripts/verify-l06.sh` is 0; a full run on a clean tree reports every gate and exits 0; with a provider import added to `score.ts` the no-model-call gate turns red and the script still runs every later gate
Done-condition:
```sh
bash -n scripts/verify-l06.sh                                  # syntax
grep -acE "pnpm run|npm run" scripts/verify-l06.sh              # 0 = pass
bash scripts/verify-l06.sh -h                                   # usage, exit 0
bash scripts/verify-l06.sh > /tmp/l06.txt 2>&1; echo "rc=$?"; tail -30 /tmp/l06.txt
#   → rc=0 and one PASS line per gate.
node -e "const s=require('./server/package.json').scripts;
  if(!s['verify:l06']||!s['verify:l06:db'])process.exit(1)"
git diff --name-only -- server/pnpm-lock.yaml                   # 0 lines = pass
```
Red flags: two zsh traps make a gate report the wrong result and both look like the gate's own output — `${PIPESTATUS[0]}` expands to **empty** in zsh, so `tsc | tail; echo rc=${PIPESTATUS[0]}` prints a blank rc and a failure reads as "no error"; and zsh does not word-split an unquoted variable, so `eslint $CHANGED` passes the whole list as one argument and exits 2 with *"No files matching the pattern"*, which reads as a lint failure but means nothing ran. The script's shebang is `bash`, which avoids both, but do not test it by pasting fragments into a zsh prompt. Verify AC-97 by deliberately breaking two gates and confirming the exit code is `2` and both are reported.

## Contracts & wiring

**`vendor/shared` — agreed, and recorded in the spec's `## Contracts`.** One new file, `contracts/eval-batch.ts`, added byte-identically to both copies with one barrel line each, in T1. No existing symbol is reshaped (N4). If any criterion turns out to need an existing symbol widened, that is a `Status: blocked` and a conversation, not a quiet edit — both copies move together or the types drift.

**Four symbols beyond the spec's enumerated list, and why.** The spec's `## Contracts` names eleven new symbols and says `EvalDashboard` is "already the dashboard payload". Verified this run, it is not sufficient for AC-44/45/46/48/71/72: `EvalDashboard.current.recall`, `.precision` and `.citation_accuracy` are `z.number()` — **not nullable** — so AC-45's "null metrics" cannot be expressed; the type is a single-owner aggregate with no agent name, no model and no per-agent array, so AC-44's "one row per agent" cannot be expressed; `EvalTrendPoint`'s three metrics are likewise `z.number()`, so a batch with a null metric (AC-34) cannot appear on a trend; and `EvalRunRecord` is one row per **case execution**, so AC-72's per-**batch** recent-runs table cannot be built from it. T1 therefore also adds `EvalBatchTrendPoint`, `EvalDashboardRow`, `EvalWorkspaceDashboard` and `EvalRunAllResult` (plus `EvalCaseSave` and `EvalPeriod`, which the spec's list also omits and AC-15/AC-48 need). All are **new** symbols in the same new file, so this stays inside the agreed shape; it is flagged because it exceeds what the spec enumerated. See `## Open questions & recommendations` R2.

**`server/src/platform/container.ts`** — two additions in T10: `get eval(): Evals` with a matching `ContainerOverrides.eval` so tests inject a fake, and `readonly diffParser` as an arrow property wrapping `parseUnifiedDiff`. Note a correction to the spec: `parseUnifiedDiff` is listed under "Relied upon and unchanged, in `reviewer-core`", but it actually lives at **`server/src/adapters/git/diff-parser.ts`** (re-exported from `src/adapters/index.ts`). The container is the one ring allowed to name it, which is what keeps `modules/eval/` off `src/adapters/**`.

**`server/src/modules/index.ts`** — one import line and one registry entry, in T10.

**`server/src/modules/agents/`** — `routes.ts` and `service.ts` gain the promotion endpoint in T10, reusing `AgentsRepository.update`'s existing bump-and-snapshot. `repository.ts` is untouched.

**Migrations** — one ADD-only migration generated from `src/db/schema/eval.ts` in T4, then **applied**. `src/db/migrations/` is never hand-edited.

**`client/src/vendor/ui/nav.ts`** — one entry plus its shortcut row, in T11. The rest of `client/src/vendor/**` is untouched.

**`client/src/components/app-shell/helpers.ts`** — **no change needed.** `activeKeyFor` already returns `"eval"` for any path under `/eval` (line 44).

**The endpoint table.** Both sides of the wire are written by different implementers in different waves, so the paths are fixed here rather than negotiated. Every path is workspace-scoped; every read of an agent resolves it inside the caller's workspace first and answers `404` otherwise.

| Method | Path | Body / query | Response | Serves |
|---|---|---|---|---|
| POST | `/eval/cases` | `{ finding_id }` | `EvalAgentCase` | R1, R2, R16 |
| GET | `/eval/agents/:agentId/cases` | — | `EvalAgentCase[]` | R3, R5 |
| PUT | `/eval/cases/:caseId` | `EvalCaseSave` | `EvalAgentCase` | R4 |
| DELETE | `/eval/cases/:caseId` | — | `{ ok: true }` | R4 |
| POST | `/eval/agents/:agentId/batches` | `{ label?, case_id? }` | `EvalBatch` (`running`) | R6, R10, R19 |
| GET | `/eval/batches/:batchId` | — | `{ batch: EvalBatch, cases: EvalBatchCaseResult[] }` | R11 |
| GET | `/eval/batches/:batchId/events` | — | SSE | R8, R18 |
| GET | `/eval/agents/:agentId/batches` | `?period=` | `EvalBatch[]` | R12, R15 |
| GET | `/eval/agents/:agentId/dashboard` | `?period=` | `EvalDashboardRow` | R15, R21 |
| GET | `/eval/compare` | `?a=&b=` | `EvalComparison` | R13, R22 |
| GET | `/eval/dashboard` | `?period=` | `EvalWorkspaceDashboard` | R15, R20 |
| POST | `/eval/dashboard/runs` | — | `EvalRunAllResult` | R15 |
| POST | `/agents/:id/versions/:version/promote` | — | the updated agent | R14, R22 |

`?period=` accepts `7d` | `30d` | `90d` | `all` and defaults to `30d` (Q6; `all` is bounded in practice by the 50-batch retention cap).

## Tests

Every row is `Owner: implementer` — `/run-plan` dispatches no `test-writer`, and `DDG-TEST-003` is raised at Phase 7 of `/pr-self-review` whether or not anyone wrote the test.

| Test | Owner | Why |
|---|---|---|
| `reviewer-core/test/eval-score.test.ts` | `implementer` (T2) | The single most test-worthy seam in this feature and the only one that is pure: plain unit tests over hand-written arrays, no fixtures, no database, no provider. Cover at minimum — file equality; overlap; non-overlap on the same file (`src/a.ts:1-9` against an anchor of `12-20`); **inverted ranges**, because the `Finding` contract does not guarantee `start_line ≤ end_line` and the live table holds five such rows, measured this run (`src/modules/notifications/repo.ts:105-30`, `.../routes.ts:36-20`, `.../service.ts:52-0`, `server/src/modules/reviews/repository/pull.repo.ts:108-9`); both false-positive classes (a finding at a `must_not_flag` anchor, and an extra finding in a `must_find` case covering no expected anchor); one anchor covered twice yielding one true positive; a zero denominator yielding **null** and not zero; a `not_run` case staying in the denominator while appearing in neither tally; and a `must_not_flag` case passing while its diff also produced a real unrelated critical finding. One more test pins AC-85: build one diff, run `groundFindings` and the scorer over the same finding, and assert they agree about whether it is on the diff's new side — that is what makes "the two gates cannot disagree" checkable rather than asserted |
| `server/test/eval-helpers.test.ts` | `implementer` (T6) | Hermetic and pure: anchor normalisation, the overlap predicate behind `conflicting_anchor` (AC-10's own examples — `:72-75` against `:72-75` and against `:70-73` conflict, `:80-84` in the same file does not), the one-file diff fragment assembly, the 64 KB boundary, and `periodStart` |
| `server/test/eval-order.it.test.ts` | `implementer` (T6) | The **only** DB-backed file in this plan, and it has to be: ordering on a non-unique column returns rows in physical heap order and an update moves one, which no fake reproduces. Asserts that the case list's returned ids equal the **sorted** ids and stay so after a row is updated (AC-14), the same for batch history (AC-37), and the 50-per-agent retention cap (AC-38). `.it.test.ts` is mandatory — `DDG-TEST-001`, and it is what the two CI workflows filter on |
| `server/test/eval-service.test.ts` | `implementer` (T8) | All six creation refusals with their codes and reasons and no row written, the duplicate returning the first case's id, the comparison rules (null change, `same_config`, `cross_agent_compare`), the staleness window that unblocks an orphaned `running` batch, and `Run all agents` naming each skip. Injects a fake repository through the consumer-declared interface in `modules/eval/types.ts` |
| `server/test/eval-runner.test.ts` | `implementer` (T8) | A fake provider recording in-flight calls never observes a fourth (AC-25); every call carries `maxRetries: 0`; the three `not_run` reasons, with the fake recording **zero** calls for `diff_unparseable`; metrics over cases covered (`2/4`, never `2/3`); all-null metrics on an all-`not_run` batch; null cost when one case's cost is missing; and the call count unchanged by metric computation (AC-35). Use a fake whose every unused port method throws, so "no `reviews`, `findings` or `agent_runs` row was written and no clone resolved" is a failing test that names the offending call rather than an assertion about a result |
| `server/test/eval-routes.test.ts` | `implementer` (T10) | `app.inject` over every route: schema rejection, the `404` service envelope for an out-of-workspace agent id (AC-18), and the SSE replay-then-close path for a completed batch (AC-24). Fake service through `ContainerOverrides.eval` |
| `server/test/agents-promote.test.ts` | `implementer` (T10) | Promoting v6 while v7 is current leaves the config equal to v6's and the current version at v8, with no existing `agent_versions` row mutated (AC-43) |
| `client/src/lib/hooks/eval.test.tsx` | `implementer` (T5) | Stubs `fetch` and asserts the **outgoing** request: the create-case body is `{ finding_id }` with no expectation type (AC-52), and the period param is sent. A mutation that omits a field is a silently successful no-op and only the request boundary sees it |
| `client/…/_components/FindingCard/FindingCard.test.tsx` | `implementer` (T7) | Extends the existing file: five actions on a decided card, the `aria-disabled` control with its precondition in the accessible name on an undecided one, and the inline refusal leaving `Accept`/`Dismiss` operable |
| `client/…/AgentEditor/AgentEditor.test.tsx` | `implementer` (T9) | Extends the existing file: the tab strip reads Config, Skills, Context, Evals, queried **by role** |
| `client/…/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` | `implementer` (T9) | Four tiles with the fourth reading `17/20`; the change rendered as `4pt`; the mechanical-scoring sentence read from the imported catalogue rather than a literal; a passing and a failing row distinguishable with colour removed; `never run`; `not run` with its reason and not the failure icon; the empty state naming the accept/dismiss step; and the run-all control disabled with progress advancing as events arrive. Includes the case-editor modal's `invalid JSON` gate and the negative-case banner |
| `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx` | `implementer` (T11) | Agent rows including one with null metrics; no sparkline element on a one-batch agent; the recent-runs table's row count; a row activating navigation; skeletons during the read (via `container.getElementsByClassName`, because the vendored `Skeleton` has no role); and the inline error with the real sidebar and breadcrumb still rendered |
| `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx` | `implementer` (T11) | Three regions mount; the alert strip's text comes from the payload; `Compare` `aria-disabled` at zero, one and three selections with the precondition in its accessible name each time; the four compare cards; "not measured" for a null change; the prompt-unchanged sentence with no diff body; and promotion showing v8 |

No test filename in `server/` contains `.it.` except `eval-order.it.test.ts` — the hermetic CI lane selects everything else and would fail without Docker, while the integration lane would never select a misnamed file.

## Verification

Run from inside each package, with `CI=true` exported. Never `pnpm run <script>`.

```sh
cd reviewer-core && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd reviewer-core && CI=true ./node_modules/.bin/vitest run --passWithNoTests
cd reviewer-core && CI=true ./node_modules/.bin/eslint .

cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/eslint .
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  > /tmp/v.txt 2>&1; echo "rc=$?"; tail -15 /tmp/v.txt

cd client && CI=true ./node_modules/.bin/tsc --noEmit
cd client && CI=true ./node_modules/.bin/eslint .
cd client && CI=true ./node_modules/.bin/vitest run
```

The two invariants no tool here catches, from `gate.md` Part 1 — both CRITICAL, both invisible to `tsc --noEmit`, and the Done-condition of every task that adds a relative import or a module:

```sh
# DDG-WIRE-002 — 0 lines = pass. grep exits 1 on no match; read the output, not $?.
cd server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \
  | grep -v "\.js'" | grep -v '^src/db/schema'

# DDG-WIRE-001 — any UNREGISTERED: line is a module that mounts nowhere.
cd server && for m in $(ls -d src/modules/*/ | xargs -n1 basename | grep -v '^_'); do
  [ -f "src/modules/$m/routes.ts" ] || continue
  grep -q "'\./$m/routes.js'" src/modules/index.ts || echo "UNREGISTERED: $m"
done
```

Run the first from `reviewer-core/` too, dropping the last `grep -v` (it has no `db/schema`).

Write these with `grep`, never `rg`: there is no `rg` binary on this machine — it is a shell function the harness provides — so an `rg` command in a Done-condition fails the moment anything runs it outside an agent's Bash tool.

Not part of this plan: `next build` (**never** — it corrupts a running `next dev`'s `.next`), `../scripts/e2e.sh` (Docker stack, and no browser flow was requested), and `vitest run .it.test` beyond `eval-order.it`, which is opt-in behind `verify:l06:db`.

Baselines measured this run, so a moved number is visible: `depcruise` = `0 errors, 22 warnings. 234 modules, 801 dependencies cruised.` `tsc --noEmit -p server/tsconfig.eslint.json` = exactly **16** errors across six unrelated test files.

## Parent-run checks

Commands, not a dispatch — no file for an implementer to own. Run by the orchestrator after wave 7. They are not optional: the hermetic suite cannot tell a shipped schema from an applied one, and this is the only place the feature is exercised against the running stack.

1. **The migration was applied, not merely shipped.** Fixes belong to T4.
```sh
cd server && node --input-type=module -e "
import 'dotenv/config'; import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
console.log((await sql\`select table_name from information_schema.tables
  where table_name in ('eval_cases','eval_runs','eval_batches') order by table_name\`)
  .map(x=>x.table_name).join(','));
await sql.end();"
# expect: eval_batches,eval_cases,eval_runs
# Measured before this plan ran: eval_cases,eval_runs
```
2. **The module is registered and the handler runs.** `404` ⇒ T10's registration; `500` ⇒ T4's migration.
```sh
curl -s -o /dev/null -w 'dashboard %{http_code}\n' localhost:3001/eval/dashboard   # 200
curl -s localhost:3001/eval/agents/00000000-0000-0000-0000-000000000000/cases
#   expect {"error":{"code":"not_found",…}} — the service envelope, not Fastify's
```
3. **A real case from a real decision.** The demo set exists: measured this run, 8 accepted and 4 dismissed findings, **all** on `General Reviewer` (`9db0ce97-d81a-4419-b00e-6ad94d4c77b1`). One accepted finding to use is `2acbb986-b2ac-4484-a34d-20dbda1b834a` (`src/adapters/webhooks.ts:2-8`). Fixes belong to T8 or T10.
```sh
curl -s -X POST localhost:3001/eval/cases -H 'content-type: application/json' \
  -d '{"finding_id":"2acbb986-b2ac-4484-a34d-20dbda1b834a"}'
#   expect expectation "must_find", owner_id 9db0ce97-…, an anchor of 2–8,
#   source_finding_id echoed, and input_diff parsing to exactly one file
#   whose path is src/adapters/webhooks.ts.
curl -s -X POST localhost:3001/eval/cases -H 'content-type: application/json' \
  -d '{"finding_id":"2acbb986-b2ac-4484-a34d-20dbda1b834a"}'
#   the SECOND call: expect 409 carrying the first case's id, and one row only.
```
4. **The refusal that only real data produces (AC-7).** The seeded review carries `agent_id: null` — measured: 40 reviews, 39 with an agent. Take a finding on that review and expect `422 review_has_no_agent` with no row written.
5. **The screens render.** `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/eval` → 200 (it is 404 today). Then look at `/eval`, `/eval/<agentId>` and an agent's `Evals` tab in the running app at `http://localhost:3000` — **not** `127.0.0.1`, because `server/src/app.ts` registers cors with `origin: [config.webOrigin]`, a literal built as `http://localhost:${WEB_PORT}`, and the wrong host makes every hook fail with the app's own full-screen error. `DDG-UI-001` is a WARNING on every task that changes what a route renders precisely because no gate can see a blank first paint.
6. **`verify:l06` is whole.** `bash scripts/verify-l06.sh` → exit 0, one `PASS` line per gate.

## Non-goals

Each is something a reader will otherwise assume is included; the spec's own `## Goals / Non-goals` is the authority and this restates the ones that shape the task list.

- **No skill-owned case sets.** `EvalOwnerKind` keeps both `skill` and `agent`; the `skill` half stays unused and **nothing removes the enum member** (N1).
- **No change to the accept/dismiss mechanism.** `findings.accepted_at`, `findings.dismissed_at` and `POST /findings/:id/(accept|dismiss)` are read by this feature and unchanged by it. The decisions are the dataset; changing how they are made would change the dataset under the harness (N2).
- **`Learn` and `Reply to author` stay unwired.** T7 renders them so AC-50's five actions exist; neither gains a handler (N3, and see Q1).
- **No existing contract symbol is reshaped.** Every addition is a new symbol in a new file, in both copies, in one task (N4).
- **No hand-edited migration** (N5).
- **No vendored-design-system change beyond `nav.ts`.** No primitive is restyled and no primitive gains a prop (N6).
- **No `Stats` and no `CI` agent-editor tab.** The strip gains `Evals` only (N7).
- **No CI integration of eval runs.** No workflow runs the set, no gate blocks a merge on a metric, and `ci_runs` is neither read nor written (N8). Consequently `scripts/verify-l06.sh` is a local-only gate and no `.github/workflows/*.yml` changes.
- **No LLM judge.** Excluded, not deferred (N9). AC-82/AC-98 make its absence mechanically checkable.
- **No reviving the pull request a case came from.** A case stores a diff fragment and an anchor; re-running never creates a review, a finding or an `agent_runs` row (N10).
- **No case-editor route.** The editor is a modal (EC-7 calls it one). `eval.json`'s `page.crumbNewCase` and `page.crumbEvalCase` keys therefore stay unused, like the rest of the catalogue's later-lesson keys.
- **No backfill.** `eval_cases` and `eval_runs` are empty and the new columns arrive nullable; nothing populates history.
- **No second pagination surface.** The 50-batch retention cap bounds the trend query and the history table, which is why `period=all` is not an unbounded query.

## Assumptions

- **The case editor is a modal inside the `Evals` tab,** not a route. EC-7 describes "the negative-case modal", the `Modal` primitive exists and is used everywhere, and no criterion names a route. The catalogue's `page.crumbNewCase` / `page.crumbEvalCase` keys, which imply a route, stay unused.
- **`FlaskConical` is the sidebar icon and `g` `e` the shortcut.** `nav.ts` requires an `IconName` and `FlaskConical` exists in `src/vendor/ui/icons.tsx`; `e` is the only unused letter among the group's conventions (`p o x s a c ,` are taken). No criterion names either.
- **The `Evals` tab goes last in the strip,** after `Context`. AC-54's observable reads "Config, Skills, Context, Evals, Stats, CI", but N7 keeps `Stats` and `CI` out of scope and they do not exist — "after `Context`" is the only part of that ordering this plan can satisfy. See Q2.
- **`source_finding_id` carries no foreign key,** matching the `reviews.agent_id` precedent, so deleting a review (and its findings) neither deletes the case nor blanks its provenance. `eval_batches.agent_id` **does** carry `onDelete: 'set null'`, matching `agent_runs.agent_id`, which is what makes AC-49's "agent presented as unavailable" reachable — and which is why every grouping by agent needs the `agentId ?? 'row:' + id` fallback key.
- **The new metric fields carry no zod numeric range keywords.** The shipped `EvalRun` and `EvalDashboard` do, and EC-34 records that such a schema breaks as an LLM response format against certain providers. These types are never a response format; omitting the bounds keeps that true if someone later reaches for one.
- **`Run all agents` is a POST that returns immediately** with the created batches and the skips, then each batch progresses on its own event stream. No criterion says otherwise and R6 already requires the single-agent case to acknowledge before the first case runs.
- **The batch event stream is SSE over `container.runBus`,** keyed on the batch id, using the shape `modules/reviews/routes.ts` already uses for `/runs/:id/events`. `RunEventKind` (`info` | `tool` | `result` | `error`) is reused with structured `data`, so no contract change is needed for the wire events.

## Open questions & recommendations

**Questions** — each with the default this plan already uses, so a non-answer costs nothing.

1. **Does AC-50's "five actions" require rendering `Learn` and `Reply to author`?** AC-50's observable is *"the card for a decided finding renders five actions"*, while N3 says those two *"stay unimplemented"*. Today the card renders two. Default, used by T7: render all five, with `Learn` and `Reply to author` present, `aria-disabled` and unwired, using the `prReview.finding.learn` and `.replyToAuthor` labels that already exist. The alternative reading — render only three and treat AC-50's count as describing the design mock rather than the requirement — changes T7's acceptance and one test, nothing else.
2. **AC-54's observable names `Stats` and `CI`, which N7 excludes.** The observable *"the strip reads Config, Skills, Context, Evals, Stats, CI, in that order"* cannot hold while those two tabs do not exist. Default, used by T9: the strip reads Config, Skills, Context, Evals, and the criterion is read as "Evals sits after Context". Answering differently would mean adding two tabs this plan deliberately does not build.
3. **Is a disabled agent's `Run all agents` skip reason distinct from a no-cases skip?** Q8 resolves that disabled agents are skipped and named; AC-47's observable only demonstrates the no-cases case. Default: two distinct reasons on `EvalRunAllResult.skipped[].reason` — `agent_disabled` and `no_cases` — because a reader cannot otherwise tell a disabled agent from an empty one, which is the same distinction EC-32 insists on for the dashboard. Note the live data: all five agents are currently **enabled**, so the disabled branch has no natural fixture and needs a hermetic one.
4. **Should `eval_runs` rows from a superseded batch be pruned with their batch?** AC-38 retains 50 batches per agent; nothing says what happens to the per-case rows of a dropped batch. Default, used by T4: `eval_runs.batch_id` is `onDelete: 'cascade'`, so a retention delete takes its case rows with it. The alternative — orphaned `eval_runs` rows surviving their batch — would grow unbounded and serve no read this plan builds.

**Recommendations** — advice, not requirements. The plan above follows the requirements as given.

1. **The spec's `## Contracts` is short by six symbols, and the gap is load-bearing rather than cosmetic.** Verified against both copies this run: `EvalDashboard.current`'s three metrics and `EvalTrendPoint`'s three metrics are `z.number()` and cannot be null, `EvalDashboard` has no agent name, no model, no version and no per-agent array, and `EvalRunRecord` is per-case where AC-72 needs per-batch. So the sentence *"`EvalDashboard` — **already the dashboard payload**"* is not accurate for AC-44/45/46/48/71/72, and the enumerated eleven new symbols do not cover AC-15's save payload or AC-48's period either. This plan adds six (`EvalCaseSave`, `EvalPeriod`, `EvalBatchTrendPoint`, `EvalDashboardRow`, `EvalWorkspaceDashboard`, `EvalRunAllResult`) inside the same agreed new file, which is a `how` decision within the recorded agreement — but the spec's own contract table should be brought up to what ships. That is `doc-writer`'s job after the fact, not a task here.
2. **Two locators in the spec point at the wrong package.** `parseUnifiedDiff` is listed under *"Relied upon and unchanged, in `reviewer-core`"* and actually lives at `server/src/adapters/git/diff-parser.ts`; and the eval feature's `groundFindings`/`groundingSummary` reach the server through `src/platform/grounding.ts`, which re-exports them. Neither changes the design — the plan routes the parser through a container-satisfied call signature — but a reader following the spec will look in the wrong tree. Worth one line in the spec.
3. **The spec's starting-state paragraph is now out of date, and in the direction that matters.** It says the workspace holds *"zero accepted and zero dismissed"* findings, so *"an agent with no cases is the **first** state every user sees"*. Measured this run: 122 findings, **8 accepted and 4 dismissed**, all on `General Reviewer`. The dataset exists, which is what makes `## Parent-run checks` 3 and 4 possible — and it means the empty state (AC-63) is no longer the first thing a demo shows. The requirement is unchanged; the framing is stale.
4. **AC-56 is the criterion most likely to be satisfied narrowly and still fail.** It says *"every metric change **this feature** renders"* carries its unit. The compare modal, the per-agent cards, the Evals tab tiles and the dashboard rows are four separate units built in two tasks by two implementers, and EC-30 records that the design itself draws `↓ 0.02` in one place and `▼ 2pt` in another. The formatter in `client/src/lib/eval.ts` (T3) is the single point that makes this hold; a second, local formatter in any unit is how the two conventions end up on one screen. Consider making "no unit formats a delta itself" an explicit acceptance line on T9 and T11 if a reviewer wants a mechanical hook for it.
5. **AC-25's `Verify: analysis` and AC-26's `Verify: inspection` are both cheaply testable,** and this plan tests them (a fake counting in-flight calls; a grep for `maxRetries`). Where a criterion says analysis or inspection but a test exists, the test is worth more — `verify:l06` records it either way.
