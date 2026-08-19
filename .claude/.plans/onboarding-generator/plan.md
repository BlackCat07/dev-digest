<!--
Stage 2 of the SDD pipeline for SPEC-02 (Onboarding Generator).
Written by `implementation-planner` on 2026-08-19 against specs/onboarding-generator.md
at commit e2cd58c. Execution mode: multi-agent, 6 waves. The three questions the
planner raised were answered by the parent before dispatch and are recorded as
decisions below.
-->

# Implementation Plan — Onboarding Generator (SPEC-02)

**Goal:** A developer who has never seen a repository can open one screen and read a five-part tour of it — architecture, critical paths, how to run it locally, a ranked reading path, and first tasks — generated from that repository's own index with exactly one structured model call, labelled honestly when the index or the model could not deliver, and priced in the log.

**Execution mode:** **multi-agent — 6 waves, 10 tasks.** Decided by the parent before dispatch. See `## Execution mode` for the single-agent alternative, which is kept as documentation.

As of `e2cd58c` (`L05-spec-driven-development`), **worktree dirty** — two untracked files, `HOME-TASK05.md` and `PROMPT.md`. Neither is in any task's Owned paths and nothing this plan touches is currently modified.

## Scope

Packages in: `server`, `client`.

Packages out, with the reason:
- `reviewer-core` — **N2 forbids any change.** `parseWithRepair`, `toJsonSchema` and `wrapUntrusted` are relied upon unchanged. It gets verification rows in `## Tests`, not tasks.
- `e2e` — no browser flow requested; `../scripts/e2e.sh` needs Docker and its default `:5433` collides with a second local Postgres.
- `mcp-server` — no new tool requested; it is an HTTP client of the API and is deliberately absent from `modules/index.ts`.

## Where this dispatch and the tree disagree

Every fact in the dispatch checked out. Five things the dispatch left open, where the tree decides, and each changes a task:

1. **The `onboarding` table cannot carry the contract, and a migration is required.** It is `repo_id uuid PK · json jsonb NOT NULL · generated_at timestamptz NOT NULL DEFAULT now()` (`server/src/db/schema/context.ts:120`, `migrations/0000_init.sql:205`). The contract wants a status, a reason, a generation state, an indexed SHA, files indexed/skipped, and five provenance figures. The tree's own precedent for exactly this record shape is `pr_intent` (`server/src/db/schema/reviews.ts:139-179`): parent-keyed PK, `jsonb` for the payload arrays, and **real columns** for `status`, `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `derived_at`, `error`. T2 follows it. `## Applying the migration` is the step that owes.
2. **`getCriticalPaths` already satisfies AC-7 exactly, and needs no argument.** `CRITICAL_PATH_ROOTS = 5` and `BFS_DEPTH = 2` (`repo-intel/service.ts:880`, `repo-intel/constants.ts`), chains of ≥2 paths, deduplicated, each path distinct within its chain. AC-7's "at most five chains, each of two or three paths" is the shipped behaviour. T6 calls it and adds no logic.
3. **Endpoint facts have no facade read.** `RepoIntelRepository.getFileFacts` exists (`repo-intel/repository.ts:565`) but `RepoIntel` (`repo-intel/types.ts:206-241`) exposes no `getFileFacts`, and the onboarding module may not import a sibling's repository (`no-cross-module-internals`; `import type` does not exempt it — `server/INSIGHTS.md`, 2026-08-14). N11 says endpoint facts feed the architecture section, so T4 adds one facade method.
4. **AC-8's membership oracle already exists and is not `getTopFilesByRank`.** That read is junk-filtered and capped, so it cannot confirm the test file EC-27 is about. `RepoIntel.getFileRank(repoId, paths)` returns a row per path found in `file_rank`, which is written for every indexed file — so "is this path in the index" is one call with the claimed paths. This also disposes of EC-14 for free: an absolute or outside path is simply not in `file_rank`.
5. **AC-38 forces a change to `client/src/components/mermaid-diagram/MermaidDiagram.tsx`.** It returns `null` on an invalid diagram (`:59`) and exposes no callback, so a caller cannot render "the diagram is unavailable" in its place. Pre-validating in the screen cannot substitute: EC-12's unquoted `/` in a node label passes the component's own `MERMAID_RE` and fails `mermaid.parse`. T5 adds one optional `fallback` prop. That file is `src/components/`, **not** `vendor/ui` — it is not a do-not-touch zone.

And one thing the tree decides in the dispatch's favour: **`ConfinedRepoDocReader.list` cannot find a command source.** Its `isCandidate` is hard-coded to `*.md` under a root plus any `INSIGHTS.md` (`confined-doc.ts:304-307`). T4 parameterises it.

## Requirements (verified)

Every requirement is an acceptance criterion of an approved spec. The `AC-n` id is the `Source:` in every case, and **no requirement here is invented** — there is no `assumed default — confirm` row in this plan, because `specs/onboarding-generator.md` was promoted to `approved` by a human on 2026-08-19 with an empty `## Open questions`. The implementer must read the spec for the exact wording of any AC in a task's `Satisfies:`; what follows is the plan-level grouping plus the facts each group turns on.

**Server — AC-1 … AC-30** · Source: `specs/onboarding-generator.md`, `## Acceptance criteria (EARS)`, server block.

- **Read (AC-1, AC-2, AC-19, AC-26, AC-27, AC-29)** — five sections in the contract's fixed order `architecture, critical_paths, run_locally, reading_path, first_tasks`; a never-generated repository answers `200` with no sections and generation state `never_generated`; `status` is `ok | partial | degraded` and every index-side reason is one of `flag_off | index_failed | index_partial | repo_too_large | index_missing`; the tour reports itself stale when the index's SHA has advanced past the one it recorded; a read makes zero model calls and zero database writes; the workspace-scoped repository lookup happens before any index read or clone path resolution.
- **Generation control (AC-3, AC-4, AC-28)** — `202` with a job identifier, returned without holding the request open; a second generation while one runs is refused rather than started; a success replaces the single stored tour.
- **The deterministic layer (AC-5, AC-6, AC-7, AC-20, AC-21, AC-22)** — the reading path is ordered by the index's `rank` (`pagerank × (1 + hotness)`, and `hotness` is `0` today — N6) and excludes test/spec/declaration/migration/tool-config paths; critical paths are the index's dependency chains, five seeds, at most two hops; every run-locally command comes from a `package.json` script, a `Makefile` target or a `docker-compose*.yml` service, names the file it was read from, and **nothing is ever executed**.
- **The one model call (AC-9, AC-10, AC-11, AC-14, AC-23, AC-24)** — exactly one `completeStructured`; at most two provider round-trips; a 75 000 ms deadline the generation survives; the workspace's `onboarding` feature-model choice with the registry default as fallback; every repository-derived fact wrapped as untrusted data in the **user** message, and no repository-derived text anywhere in the system message.
- **Honesty (AC-8, AC-15, AC-16, AC-17, AC-18, AC-30)** — every repository path a stored tour names exists in that repository's index; a failed, timed-out or schema-rejected call stores the deterministic skeleton with a reason distinguishing which; no index means `degraded / index_missing` **and** zero model calls; a partial index still produces five sections labelled `partial / index_partial`; over-cap items are discarded whole.
- **Observability (AC-12, AC-13, AC-25)** — model identifier, round-trip count, input and output tokens and USD cost recorded against the tour and emitted as one log line; the indexed commit SHA recorded.

**Client — AC-31 … AC-47** · Source: same spec, client block.

- **Shell (AC-31, AC-32)** — an `Onboarding Tour` entry in the `WORKSPACE` group between `Pull Requests` and `Project Context`; the add-a-repository screen at `/onboarding` must stop marking it active.
- **States (AC-33, AC-34, AC-41, AC-42, AC-43, AC-44)** — one empty state offering generation; a running state with the rest of the shell navigable; a stale/partial notice **above** sections that still render; a degraded skeleton under a notice naming the cause; an unrecognised reason renders the generic sentence, never the enum literal or a message-key path; a failed request renders inline with the shell intact.
- **Content (AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-45, AC-46, AC-47)** — five sections in server order, each reachable from an on-this-page rail; markdown bodies rendered with headings, lists and fenced code; a diagram rendered as a diagram, and an inline notice in its place when it cannot be; a copy control that places the command's exact text on the clipboard; files-generated-from and age beside the title, from the tour's own recorded values; every control keyboard-operable with an accessible name; `Share link` copies this screen's URL and nothing else; `Open` goes to the file on the repository host at the SHA the tour records, in a new tab.

## Execution mode

- **Recommended, and what the dispatch answered — multi-agent, 6 waves.** Two tasks share a wave only when their Owned paths are disjoint **and** they sit in different packages: two implementers running `tsc --noEmit` over one package read each other's half-written files. The contract (T1) is settled in wave 1 alone because it is the one task that must write four hand-synced files identically across both packages.
- **Single-agent alternative — one pass, `T1 → T2 → T4 → T6 → T8 → T3 → T5 → T7 → T9 → T10`.** Same Owned paths, same Done-conditions, no parallelism. In this mode T3 could be folded into T10 (its three edits — the nav entry, the active-key fix and the message namespace — exist as a separate task only so the client half of waves 2–5 has work that does not wait on the server), and T9 could be folded into T10 for the same reason. Nothing else changes.
- **The question for the human, before dispatch:** multi-agent or single-agent? Default if unanswered: **multi-agent** — the dispatch already chose it and the two packages' halves never read each other's files.

## Constraints

Quoted in full, because the implementer sees this plan and nothing else.

**Do-not-touch, and what the approved spec authorises anyway**

- `DDG-DNT-001` — CRITICAL. `server/src/vendor/shared/**` and `client/src/vendor/shared/**` are two hand-synced copies and **change together or the types drift**. T1 owns both, in one task, on purpose. Verified this run: the two `index.ts` barrels are byte-identical today.
- `DDG-DNT-003` — CRITICAL. A contract change **adds a new file**; it never reshapes an existing symbol. `Onboarding`, `OnboardingSection` and `OnboardingLink` at `contracts/knowledge.ts:28-47` are **read-only** in this plan. The spec is explicit: *"They are deliberately untouched; they are not a cleanup item and no task should remove them."* The new names were chosen not to collide — `OnboardingTourSection`, not `OnboardingSection` — and the existing `OnboardingLink` is **reused by import**, the way `contracts/blast.ts` imports `ChangedSymbol`/`DownstreamImpact` from `contracts/brief.js`.
- `DDG-DNT-002` — CRITICAL. `client/src/vendor/ui/**` is the vendored design system. The **only** permitted edit in this plan is one item appended to `NAV[0].items` in `client/src/vendor/ui/nav.ts` (plus, optionally, its `SHORTCUTS` row), under that file's own written carve-out at lines 22–32: *"This is ROUTE CONFIG… Adding an entry is fine; changing how `NavItem` looks is not."* `Sidebar.tsx` imports `NAV` directly with no prop and no override hook, so there is no app-level way to add a nav entry. In particular `src/vendor/ui/primitives/Markdown.tsx` is **not** touched.
- `DDG-DNT-004` — CRITICAL. `server/src/db/migrations/**` is generated. Edit `src/db/schema/`, then `./node_modules/.bin/drizzle-kit generate`. Never hand-edit a migration.
- `DDG-DNT-005` — CRITICAL. No lockfile is edited and **no new dependency is added in any package**. This binds T6 concretely: `server/package.json` has **no YAML parser** (verified — deps are `@anthropic-ai/sdk, @ast-grep/napi, @fastify/*, @vscode/ripgrep, dependency-cruiser, dotenv, drizzle-orm, fastify, fastify-sse-v2, fastify-type-provider-zod, graphology, graphology-metrics, js-tiktoken, octokit, openai, p-queue, postgres, simple-git, zod`), so `docker-compose*.yml` service names come from a bounded line scan, never from a parse.

**Wiring**

- `DDG-WIRE-001` — CRITICAL. A new `server/src/modules/<name>/` with no entry in `server/src/modules/index.ts` mounts nowhere and 404s with no error.
- `DDG-WIRE-002` — CRITICAL. Every relative import in `server/` carries the `.js` extension. `tsc --noEmit` does not catch a missing one; it fails at runtime. `src/db/schema*` is the one exception — those files use extensionless imports on purpose (drizzle-kit loads them, not the ESM server) and are excluded from the grep.
- `DDG-WIRE-003` — CRITICAL. A `db/schema/**` change ships with its generated migration.
- `DDG-WIRE-004` — CRITICAL. A new service is bound in `server/src/platform/container.ts`, the only place allowed to name concrete classes, with a `ContainerOverrides` field so tests can inject a fake.

**Architecture**

- `DDG-ARCH-001` — WARNING. Routes stay thin: Zod schema on the route → `getContext` → one service call → return. No branching business logic in `routes.ts`.
- `DDG-ARCH-002` — CRITICAL. `reviewer-core` stays pure. Nothing in this plan touches it (N2).
- `no-cross-module-internals` (`.dependency-cruiser.cjs:92`) — the onboarding module must **not** import `modules/repo-intel/*`, `modules/blast/*`, `modules/conventions/*`, `modules/repos/*` or `modules/settings/repository.ts`, and **`import type` does not exempt it**: a types-only import of a sibling's `types.ts` took the warning count 22 → 24, attributed to `blast` (`server/INSIGHTS.md`, 2026-08-14). The sanctioned routes are `container.repoIntel` (the facade), `container.git`, `container.llm`, `container.jobs`, `modules/_shared/*`, and — for the feature-model choice — a **consumer-declared resolver signature the container satisfies structurally**. **Corrected by the cross-model review, and this is the one correction that changes an instruction:** an earlier draft of this bullet said `resolveFeatureModel` is "already consumed cross-module by `modules/intent`". It is not. `modules/intent` declares `FeatureModelResolver` in its own `sources.ts:156`, holds it as `deps.featureModel` (`sources.ts:188`) and calls `this.deps.featureModel(...)` (`service.ts:141`) — it imports nothing from `modules/settings/`. The composition root satisfies that call signature with an arrow property (`platform/container.ts:238-244`, `readonly featureModel = (workspaceId, id) => resolveFeatureModel(this.db, workspaceId, id)`), and `server/INSIGHTS.md` (2026-08-10) records that arrangement as *the fix that removed the edge*, not as an example of one being tolerated. The module that still imports `resolveFeatureModel` directly is `modules/conventions/service.ts:17` — a pre-existing accepted warning, **not a pattern to copy**. `modules/onboarding` follows `intent`: it declares the resolver in its own narrow-deps interface and imports nothing from `modules/settings/`.
- `application-no-db-schema` / `routes-no-data-access` — only `modules/onboarding/repository.ts` may import `db/schema` and `drizzle-orm`. **Both rules are `warn` severity, not `error`, and the tree carries pre-existing violations of them.** So a non-empty `depcruise` report is not by itself this task's failure — which is exactly why every Done-condition in this plan says "no **new** errors or warnings". Read the report's attribution before treating a line as yours; inheriting someone else's warning and "fixing" it is scope this plan does not authorise.
- `adapters-are-leaves` — `src/adapters/**` imports nothing from `src/modules/**`. Everything the confined walk is bounded by arrives as a **parameter**; that is the rule `confined-doc.ts` already states in its own doc-comment at lines 42–45.
- `modules-no-raw-sdk` **does not list `node:fs`** — a feature module reading the disk passes the architecture gate while reporting clean (`server/INSIGHTS.md`, 2026-08-10; measured, 4 files across 3 modules, `depcruise` 0 errors). **No `node:fs` import may appear anywhere under `server/src/modules/onboarding/`.** And `GitClient.readFile` is not the escape hatch: it joins and reads in one step, which drops the post-`realpath` re-check that is the only defence against a symlink escaping the clone.

**Security**

- `DDG-SEC-002` — CRITICAL. Repository-derived text reaching a model stays inside `<untrusted>…</untrusted>`, via `wrapUntrusted` from `server/src/platform/prompt.js`. Two specifics for this feature: the `INJECTION_GUARD` that `reviewer-core/src/prompt.ts` appends is on the **review** path and is not appended here — `src/prompts/onboarding.system.md:11-12` carries its own untrusted-data clause, and duplicating a guard is the mistake `server/INSIGHTS.md` (2026-08-05) records for the `skills` slot. And the wrapping must be in the **user** message only: a wrapped block placed in the system message satisfies AC-23 and is still the failure AC-24 exists to prevent.
- `DDG-SEC-003` — CRITICAL. Every new route validates input with a Zod contract schema declared **on the route** (`fastify-type-provider-zod`; never `Schema.parse(req.body)` in a handler — `server/CLAUDE.md`) and scopes every query it triggers by workspace.
- Reads of the clone are path-confined with the prefix re-checked after symlink resolution. `ConfinedRepoDocReader.resolve` (`confined-doc.ts:218-240`) is the **only** place that decision is made and nothing may reimplement it.

**Prior findings that bind specific tasks**

- `server/INSIGHTS.md`, 2026-08-06 — **`StructuredRequest.timeoutMs` is silently ignored and `maxRetries` defaults to 2, i.e. three attempts.** The timeout is fixed when the OpenAI client is constructed. So AC-10 and AC-11 each need their own mechanism and **neither alone bounds anything**: `maxRetries: 1` gives at most two round-trips, and a `Promise.race` against a 75 000 ms deadline is what bounds wall-clock. `modules/intent/service.ts:147-172` is the shape to copy verbatim, including folding the rejection into the resolved value so the loser of the race can never become an unhandled rejection.
- `server/INSIGHTS.md`, 2026-08-06 — **`JobRunner.enqueue`'s `done` rejects when the job fails.** It is now centrally crash-safe (2026-08-07), but a per-caller `void job.done.catch(...)` is still wanted for bookkeeping — `ConventionsService.requestScan` (`conventions/service.ts:200-208`) writes the failure onto its own row from there. And any `running` state needs a **staleness window**, or a process that died mid-generation blocks every future generation of that repository forever with no cure a user of the screen has (EC-18).
- `server/INSIGHTS.md`, 2026-08-06 — `drizzle-kit generate` **blocks forever on an interactive rename prompt** when one migration both drops and adds columns; it reads the answer from a TTY and piping newlines does nothing. T2 adds columns and drops nothing, so it should not fire; if it does, **stop and report** — do not wait.
- `server/INSIGHTS.md`, 2026-08-19 — **`drizzle-kit generate` ALWAYS rewrites `migrations/meta/_journal.json`**, so a Done-condition phrased as "no `M` line" can never pass. The precise formulation is **"no `M` line against a `.sql` file"**; the snapshot and the journal are expected to move.
- `server/INSIGHTS.md`, 2026-08-19 — **a feature can pass every gate and still 500 on its first real request, because nothing applies the migration it ships.** `500` on a route that exists, right after a feature that adds a table, means the migration was never applied. See `## Applying the migration`.
- `server/INSIGHTS.md`, 2026-08-02 / 2026-08-19 — **a `jsonb` column read back by a cast rather than a parse arrives with keys absent, not null**, and a `.nullish()` contract field is `string | null | undefined`. The stored tour body is **`safeParse`d** on the way out, never `as`-cast (EC-28).
- `server/INSIGHTS.md`, 2026-08-10 — **no test file in `server/` is typechecked by any gate** (`tsconfig.json`'s `include` is `["src/**/*.ts"]`). `tsconfig.eslint.json` widens it for ESLint's parser only.
- `server/INSIGHTS.md`, 2026-08-02 / 2026-08-04 — `pnpm <script>` can die before the script runs, and without a TTY can try to purge `node_modules`. **Run the binaries from `./node_modules/.bin/` directly, always.** In zsh, `${PIPESTATUS[0]}` expands to **empty** (redirect to a file and read `$?` on the next statement) and an unquoted variable is **not word-split**, so `eslint $CHANGED` passes one argument and exits 2 with `No files matching the pattern` — an exit code that reads as a lint failure but means nothing ran. **List eslint paths literally.**
- `reviewer-core/INSIGHTS.md`, 2026-08-07 — **Anthropic via OpenRouter rejects a JSON schema carrying numeric range keywords.** `toJsonSchema` now strips them and `parseWithRepair` re-validates against the original Zod schema. Two consequences for the model-facing draft schema in T8: it is safe from that failure, and `parseWithRepair`'s reprompt **is** the one repair round-trip AC-10 budgets for.
- `server/src/modules/conventions/schemas.ts` — two constraints `zodResponseFormat` imposes on any model-facing schema, stated in the file: **no `.optional()`** (strict mode requires every property in `required` — use `.nullable()`), and **no array `.min()`/`.max()`** (not expressible, so they would not constrain the model and would only burn a reprompt). Bounds are stated in the prompt and enforced in code — which is exactly what AC-30 requires anyway.
- `client/INSIGHTS.md`, 2026-08-05 — **`<Markdown>` from `@devdigest/ui` is inline-only**: `p`, `strong`, `code`, `a` and nothing else, so a document-shaped body collapses into a wall of text. Teaching the primitive headings is the wrong fix; `vendor/ui` is extend-by-new-file.
- `client/INSIGHTS.md`, 2026-08-10 — **`@testing-library/user-event` is NOT a dependency of this package**; importing it fails at collect time. Every test file here uses `fireEvent` / `.click()`. There is **no shared QueryClient test helper**, and the vendored `Skeleton` is a bare `div.skeleton` with no role or aria.
- `client/INSIGHTS.md`, 2026-08-19 — **jsdom dispatches no `click` for Enter on a focused native `<button>`.** A keyboard-operability requirement (AC-45) is asserted as tab-reachability plus an accessible name, with activation demonstrated — the spec's own AC-45 says exactly this. Where there is no native keyboard equivalent, put the behaviour on an explicit `onKeyDown`.
- `client/INSIGHTS.md`, 2026-08-19 — **`AppShell` mounts cleanly in jsdom with only `vi.mock("next/navigation")`, a `QueryClient` and the `shell` namespace**, which is what makes "the rest of the screen is still usable" (AC-34, AC-44) assertable against the real sidebar rather than a faked shell.
- `client/INSIGHTS.md`, 2026-08-03 — **client imports of `@devdigest/shared` must stay `import type`.** A runtime value import produces `Module not found: Can't resolve './contracts/*.js'` under `next build` / `next dev` as a **500 on every route that transitively imports it**, while `tsc --noEmit` and `vitest` both stay green. Runtime constants go in `src/lib/`.
- `client/INSIGHTS.md`, 2026-08-10 — a feature's copy goes in its **own** i18n namespace; `src/i18n/request.ts` `readdirSync`s `messages/en/` and merges every file as `{ [basename]: … }`. `onboarding.json` already exists — T3 owns it for the whole feature.
- `client/INSIGHTS.md`, 2026-08-11 — a component composing a shared unit legitimately reads **two** namespaces and its tests must provide both, or `next-intl` renders the key path and logs `IntlError: MISSING_MESSAGE` into stderr while the test stays green.
- `client/INSIGHTS.md`, 2026-08-14 / 2026-08-06 — an undefined CSS custom property **silently drops**. Only tokens actually declared in `src/vendor/ui/styles.css` exist — there is no `--bg` and no `--text-tertiary`.
- `client/INSIGHTS.md`, 2026-08-03 — running `next build` while a `next dev` server is up corrupts that dev server. **`next build` is never run** (`gate.md`).
- `client/CLAUDE.md` — do **not** wrap a view in `<Suspense>` because it reads `useSearchParams()`; every route here is dynamic and the boundary makes the server emit the fallback instead of the screen. And `vitest.config.ts` duplicates the tsconfig path aliases; this plan adds none.

**Verified facts a task depends on**

- `RepoIntel` facade methods this feature uses, all shipped: `getIndexState(repoId)` — *always* works, synthesising `degraded / no_data` when there is no row (`service.ts:190-206`); `getTopFilesByRank(repoId, n, {exclude})` — rank DESC, over-fetching 10×, `isJunkPath` dropping tests/configs/declarations/migrations (`:813`); `getCriticalPaths(repoId)` (`:837`); `getRepoMap(repoId, budget?)` — cached per commit, default budget `DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500` (`:572`); `getFileRank(repoId, paths)` (`:592`). Every array-returning method returns `[]` when `repoIntelEnabled` is false, and the status is then observable through `getIndexState` — the facade's documented degraded contract (`repo-intel/types.ts:16-22`).
- `IndexState` carries `status: 'full' | 'partial' | 'degraded' | 'failed'`, `filesIndexed`, `filesSkipped`, `lastIndexedSha`, `reason?: string`, `degraded?`, `degradedReason?: DegradedReason` where `DegradedReason = 'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data'` (`repo-intel/types.ts:24-50`).
- **AC-19's mapping already exists and must be copied, not imported.** `toReason` (`modules/blast/service.ts:86-99`) maps `DegradedReason` → the contract's five, with `no_data` and anything unknown falling to `index_missing`; `statusOf` (`:356-363`) maps `degraded → 'degraded'`, `'partial' → 'partial'`, `'full' → 'ok'`, and an absent status to `'partial'` rather than asserting completeness. Importing either is a `no-cross-module-internals` violation; the onboarding module writes its own with the same table and the same fallbacks.
- `MAX_INDEXED_FILES = 5000`, `INDEXER_VERSION = 3`, `BFS_DEPTH = 2`, `EXCLUDED_DIRS = ['node_modules','dist','build','coverage','.next','out','vendor','.git']` (`repo-intel/constants.ts`). `EXCLUDED_DIRS` does **not** name `.pnpm-store`, which a real demo repository committed (`server/INSIGHTS.md`, 2026-08-06) — the onboarding module writes its own list including it, rather than importing repo-intel's.
- `FEATURE_MODELS[0]` is `{ id: 'onboarding', label: 'Onboarding Tour', description: 'Writes the per-repo onboarding tour.', defaultProvider: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash' }` (`contracts/platform.ts:44-51`), and `'onboarding'` is in the `FeatureModelId` enum. **No registry change is needed anywhere** — the client's third copy at `client/src/lib/feature-models.ts:15` already carries it too.
- `resolveFeatureModel(db, workspaceId, id)` → `{ provider, model }` (`modules/settings/feature-models.ts`) takes a `Db`, never the container. **A feature module does not import it.** The container already exposes it as a call signature — `readonly featureModel = (workspaceId: string, id: FeatureModelId) => Promise<FeatureModelChoice>` (`platform/container.ts:238-244`) — and `modules/intent` consumes exactly that through its own `FeatureModelResolver` interface (`intent/sources.ts:156`, `:188`; called at `intent/service.ts:141`). That is the shape T6 and T8 copy.
- `StructuredResult<T>` carries `data, model, tokensIn, tokensOut, costUsd, raw, attempts` (`vendor/shared/adapters.ts:72-80`) — AC-12 needs no new port field.
- `MockLLMProvider` (`adapters/mocks.ts:58-105`) records every call on `.calls`, looks its fixture up by `req.schemaName` via `structuredBySchema`, `safeParse`s it against the request's schema and **throws** when it fails, and always returns `attempts: 1`. It cannot hang and it cannot report a second attempt, so AC-11 and AC-10 need locally-declared fakes in the test file rather than a change to `mocks.ts`.
- `JobRunner`: `register(kind, handler)`, `enqueue(workspaceId, kind, payload) → { id, done }`, hard timeout `120_000` ms (`platform/jobs.ts:41`). Registration happens once at boot from the module's `routes.ts`, on a locally-constructed service — the runner keeps the handler closure, so that is equivalent to a container-held one (`conventions/routes.ts:35-39`, `repo-intel/routes.ts:24-30`).
- The 202-with-a-job-id shape is `repo-intel/routes.ts:43-65`: enqueue inside a `try`, `reply.code(202)`, return `{ status: 'accepted', jobId }` or `{ status: 'accepted', degraded: true, reason: 'no_handler' }`.
- Error classes (`platform/errors.ts`): `NotFoundError` → 404 `not_found`, `ValidationError` → **422** `validation_error`, `ExternalServiceError` → 502, `ConfigError` → 500. There is **no** `ConflictError`. `ConventionsService.requestScan` refuses a concurrent scan with `ValidationError` (`conventions/service.ts:185`). See Q1.
- Per-route rate limiting is `config: { rateLimit: { max, timeWindow } }` on the route, layered under the global `max: 120, timeWindow: '1 minute'` registered at `app.ts:96`; `settings/routes.ts:45` is the precedent.
- Prompt template loading and rendering: `loadTemplate` reads from `src/prompts/` with a per-process cache and `renderTemplate` substitutes `{{name}}`, replacing an unmatched placeholder with the **empty string** rather than leaving it in place (`conventions/prompt.ts:25-47`). Both are `conventions`-module-private; the onboarding module writes its own equivalents rather than importing them.
- `src/prompts/onboarding.system.md` exists, takes `{{sections}}` and `{{language}}`, and carries mermaid rules, grounding rules and an untrusted-data clause. It also carries **two** clauses about a `routes_and_apis` section that N11 removes from the feature — line 8 (the diagram allowance) and line 23 (the formatting bullet). The Mermaid-rules block does **not** name it and is not part of that edit. See Assumption 6.
- Client: `githubBlobUrl(repoFullName, sha, file, startLine?, endLine?)` exists at `client/src/lib/github-urls.ts:24` and is exactly AC-47's link. `useActiveRepo()` (`client/src/lib/repo-context.tsx:67`) supplies the repos list, from which `full_name` comes.
- Client: `activeKeyFor` (`client/src/components/app-shell/helpers.ts:26-40`) is a first-match-wins ladder; its `pathname.includes("/onboarding")` line is EC-25, and `src/app/onboarding/page.tsx` is the add-a-repository screen. Its **only** consumer is `components/app-shell/hooks/useShellContext.ts:63`, and it has no test today.
- Client: `MermaidDiagram` already validates with `mermaid.parse({ suppressErrors: true })` before rendering, because mermaid otherwise injects a "Syntax error" bomb graphic into the DOM instead of throwing. Its only consumers are `BlastRadiusCard.tsx:285` and that file's test mock.
- Client: `DocumentMarkdown` (`app/repos/[repoId]/context/_components/DocumentMarkdown/`) renders headings, lists, fenced code and tables via `react-markdown` + `remark-gfm`, and refuses a `javascript:` href. Its **only** importer is `DocPreview.tsx:20`. Its own doc-comment, lines 15–20, writes the rule this plan follows: *"If a third consumer appears, the promotion target is `src/components/`, not either feature."*
- Client polling precedent for a running job: `src/lib/hooks/conventions.ts:38`, a function-form `refetchInterval` keyed on the query's own data.

## Skills the implementer must load

All eleven, each assigned to files or marked `n/a` with a reason. A skill missing from this table is indistinguishable from one that was forgotten.

| Files | Skill | Why |
|---|---|---|
| `server/src/modules/onboarding/**`, `server/src/modules/repo-intel/{service,types}.ts`, `server/src/adapters/git/confined-doc.ts`, `server/src/platform/container.ts` | `onion-architecture` | route → service → repository placement; the walk is filesystem work and belongs in the adapters ring; the container is the only place allowed to name a concrete class; the module reaches no sibling module |
| `server/src/modules/onboarding/routes.ts` | `fastify-best-practices` | schema-on-route, plugin encapsulation, the 202 shape, per-route `config.rateLimit`, error mapping through the shared handler |
| `server/src/db/schema/context.ts`, `server/src/modules/onboarding/repository.ts` | `drizzle-orm-patterns` | the column additions, `$type` on the jsonb payload, the single-row upsert, `db:generate` |
| `server/src/db/schema/context.ts` | `postgresql-table-design` | `timestamptz` not `timestamp`, `double precision` for cost and `integer` for token counts, `NOT NULL` + non-volatile defaults so the `ALTER TABLE` does not rewrite, and text-with-`enum` rather than a Postgres enum type |
| `server/src/vendor/shared/contracts/onboarding.ts`, `client/src/vendor/shared/contracts/onboarding.ts`, `server/src/modules/onboarding/{schemas,routes,repository}.ts` | `zod` | the eight new contract schemas with `z.infer` beside each; the model-facing draft schema under `zodResponseFormat`'s no-`.optional()` / no-array-bounds rules; `safeParse` on the jsonb read; a discriminated status/reason vocabulary |
| `server/src/modules/onboarding/**`, `server/src/adapters/git/confined-doc.ts` | `security` | `repoId` is user input reaching an index read and a clone path; the workspace lookup is the authorization check; repository text reaches a model; the output is a command a user is invited to paste into a shell |
| every changed `*.ts` / `*.tsx` in both packages | `typescript-expert` | no `any` at a boundary; the generation result is a discriminated union; `strict` is already on; `import type` at the client's shared-contract boundary |
| `client/src/app/repos/[repoId]/onboarding/**`, `client/src/components/document-markdown/**`, `client/src/lib/{onboarding.ts,hooks/onboarding.ts}` | `frontend-ui-architecture` | colocated feature units under their barrels; promotion on the second consumer to the nearest common ancestor (`DocumentMarkdown`); a runtime helper two subtrees need lives in `src/lib/`; the route entry stays thin |
| `client/src/app/repos/[repoId]/onboarding/page.tsx` | `next-best-practices` | awaited `params`, thin route entry, **no** `<Suspense>` wrapper, no per-segment `loading.tsx` or `error.tsx` |
| all changed `client/src/**/*.tsx` | `react-best-practices` | derive-don't-store for the rail's active section and every notice branch; no `fetch` in a component; `aria-label` on icon-only copy controls; early returns for the loading/empty/running/error/degraded states rather than nested ternaries; `key` on section rows from `kind`, never an index |
| `client/src/**/*.test.tsx`, `client/src/**/*.test.ts`, `server/test/onboarding-*.test.ts` | `react-testing-library` | query priority (`getByRole` first), one flow test per unit, mocking at the boundary — **but `userEvent` is unavailable in this package, so `fireEvent` is the local rule**. Binds `test-writer` primarily, and T5 for the one existing test file it moves |

## Waves

Two tasks share a wave only when their Owned paths are disjoint **and** they sit in different packages.

- **Wave 1** — T1 *(both packages — alone by necessity: it is the one task that writes four hand-synced files identically)*
- **Wave 2** — T2 *(server)* ‖ T3 *(client)*
- **Wave 3** — T4 *(server)* ‖ T5 *(client)*
- **Wave 4** — T6 *(server)* ‖ T7 *(client)*
- **Wave 5** — T8 *(server)* ‖ T9 *(client)*
- **Wave 6** — T10 *(client)*

Single-agent mode: one pass, `T1 → T2 → T4 → T6 → T8 → T3 → T5 → T7 → T9 → T10`.

## Tasks

Repo root is `/Users/krasymyr.tretiak/Work/dev-digest`. Paths below are relative to it; every command is absolute.

---

### T1 — The eight new contract types, in both hand-synced copies

**Satisfies:** AC-1 (enabling), AC-2 (enabling), AC-12 (enabling), AC-19 (enabling), AC-21 (enabling), AC-25 (enabling), AC-26 (enabling), AC-30 (enabling), AC-40 (enabling) — every one, because this task defines types and enforces no behaviour; `T8` completes all nine. The qualifier matters to the `AC → task → test` matrix `plan-verifier` walks: without it a type definition reads as the criterion's owner.
**Depends-on:** —
**Owned paths:** `server/src/vendor/shared/contracts/onboarding.ts` (new), `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/contracts/onboarding.ts` (new), `client/src/vendor/shared/index.ts`
**Forbidden:** every other file under `server/src/vendor/shared/**` and `client/src/vendor/shared/**` — in particular `contracts/knowledge.ts` (`Onboarding`, `OnboardingSection`, `OnboardingLink`) and `contracts/platform.ts` (`FeatureModelId`, `FEATURE_MODELS`, `SettingsKnown`), all of which this feature **consumes unchanged**. Also `client/src/vendor/ui/**`, `client/src/lib/feature-models.ts`, any lockfile.

**Change.** Add one new contract file, identically, to both copies, plus one `export * from './contracts/onboarding.js';` line to both barrels and one entry in each barrel's header doc-comment matching the existing `contracts/project-context` entry. Nothing existing is edited or renamed. Read `server/src/vendor/shared/contracts/prior-prs.ts` and `contracts/blast.ts` first — the second is the closest precedent, because it reuses two symbols from a neighbouring contract file by import rather than redeclaring them, which is exactly what `OnboardingLink` needs here.

The file defines, as Zod schemas with `z.infer` types exported beside each, in the spec's `## Contracts` order:

- `OnboardingSectionKind` — the five kinds, as a `z.enum`, in the fixed order `architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks`. This enum is AC-1's contract: the screen's order is the contract's, not the model's.
- `OnboardingStatus` — `ok | partial | degraded`, the same three `BlastStatus` uses.
- `OnboardingReason` — the index-side five (`flag_off`, `index_failed`, `index_partial`, `repo_too_large`, `index_missing`) **plus** this feature's own four (`model_failed`, `model_timeout`, `model_invalid`, `no_commands_declared`). Document that the first five are `BlastReason`'s set minus `no_changed_files`, and that they are deliberately spelled the same so two features never tell a user "the index is incomplete" in two vocabularies (AC-19).
- `OnboardingCommand` — the command text, the repo-relative file it was declared in, and its ordinal.
- `OnboardingPathNote` — a repository path and a one-line reason. This is the row shape both `critical_paths` and `reading_path` render.
- `OnboardingTask` — a title, a repository path or directory, and a complexity of `low | medium | high`.
- `OnboardingTourSection` — a kind, a title, a markdown body, a **nullable** mermaid diagram, up to four links (reusing `OnboardingLink` imported from `./knowledge.js`), and the per-kind item arrays above.
- `OnboardingTour` — the ordered sections, `status`, `reason` (nullable), the generation state (`never_generated | running | ready`), `generated_at` (nullable), `indexed_sha` (nullable), `stale`, `files_indexed`, `files_skipped`, and the generation's `model`, round-trip count, `tokens_in`, `tokens_out` and `cost_usd` (all nullable).

Field names are **snake_case**, matching every neighbouring contract (`indexed_sha`, `caller_count`, `full_name`). Nothing here carries a numeric `.min()`/`.max()`: `reviewer-core/INSIGHTS.md` (2026-08-07) records that a range keyword in a shared contract broke reviews on Anthropic-via-OpenRouter, and this document is served over HTTP where the bound buys nothing.

**Skill:** `zod`, `typescript-expert`
**Invariant:** `DDG-DNT-001` (both copies move together), `DDG-DNT-003` (new file, never a reshape), `DDG-WIRE-002` (the barrel line carries `.js`)

**Acceptance.** All eight types exist in both copies. `Onboarding`, `OnboardingSection`, `OnboardingLink`, `FeatureModelId`, `FEATURE_MODELS` and `SettingsKnown` are byte-unchanged. The two new contract files are **byte-identical to each other**, and so are the two barrels.

**Done-condition:**
```sh
diff -u /Users/krasymyr.tretiak/Work/dev-digest/server/src/vendor/shared/contracts/onboarding.ts \
        /Users/krasymyr.tretiak/Work/dev-digest/client/src/vendor/shared/contracts/onboarding.ts
diff -u /Users/krasymyr.tretiak/Work/dev-digest/server/src/vendor/shared/index.ts \
        /Users/krasymyr.tretiak/Work/dev-digest/client/src/vendor/shared/index.ts
# 0 lines of output from each = pass

cd /Users/krasymyr.tretiak/Work/dev-digest/server && git diff --stat -- src/vendor/shared/contracts/knowledge.ts src/vendor/shared/contracts/platform.ts
# 0 lines = pass

cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t1.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t1.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src | grep -v "\.js'" | grep -v '^src/db/schema'
# 0 lines = pass; grep exits 1 on no match — read the output, not $?
```

**Red flags.** If satisfying an AC appears to need a change to an **existing** symbol in either copy, that is `Status: blocked` and a human decision — stop and report, do not edit. Do not add anything to `FeatureModelId` or `FEATURE_MODELS`: the `onboarding` entry is already there in all three places and this feature is its first consumer.

---

### T2 — The `onboarding` table's provenance columns, and their migration

**Satisfies:** AC-12 (enabling), AC-25 (enabling), AC-28 (enabling), AC-40 (enabling) — this task adds columns; `T8` writes and reads them.
**Depends-on:** T1
**Owned paths:** `server/src/db/schema/context.ts` (the `onboarding` table only), `server/src/db/migrations/**` (generated output only)
**Forbidden:** hand-editing any file under `server/src/db/migrations/`; every other table in `src/db/schema/context.ts` (`code_chunks`, `symbols`, `references` — do not touch them); every other file under `src/db/schema/`; `src/vendor/shared/**`; any lockfile.

**Change.** Extend the existing `onboarding` table — `repo_id uuid PK → repos.id ON DELETE cascade`, `json jsonb NOT NULL`, `generated_at timestamptz NOT NULL DEFAULT now()` — with the provenance the contract needs, mirroring `pr_intent` (`src/db/schema/reviews.ts:139-179`) column for column where the two overlap. **Nothing existing is altered or dropped**; the three current columns keep their types, their nullability and their defaults.

Added columns, each with a one-line comment saying what reads it:

- `state` — `text({ enum: ['running', 'ready'] })`, NOT NULL, default `'ready'`. `never_generated` is the **absence of a row** and is deliberately not a value here (AC-2).
- `status` — `text({ enum: ['ok', 'partial', 'degraded'] })`, NOT NULL, default `'degraded'`.
- `reason` — `text`, nullable. Deliberately **not** a DB enum: `OnboardingReason` is the authority and validates on the way out, and a DB enum would need a migration every time a reason is added. `pr_intent.status` uses a text enum because it is a lifecycle; this is a vocabulary.
- `indexed_sha` — `text`, nullable (AC-25, AC-26).
- `files_indexed`, `files_skipped` — `integer`, NOT NULL, default `0` (AC-40).
- `provider`, `model` — `text`, nullable.
- `attempts` — `integer`, nullable. **This is the column no existing table in this server has** (AC-12) — neither `convention_scans` nor `pr_intent` nor `agent_runs` records a provider round-trip count.
- `tokens_in`, `tokens_out` — `integer`, nullable.
- `cost_usd` — `doublePrecision`, nullable. Copy `pr_intent`'s comment: null means no price is known for the model, which is **not** the same as a free call (`0`).
- `started_at` — `timestamptz`, nullable. The staleness window for EC-18 reads it.
- `error` — `text`, nullable. The free-text failure message; `reason` is the machine-readable half.

Give `json` a `$type<{ sections: OnboardingTourSection[] }>()` with a **type-only** import of the contract, matching `reviews.ts:13`'s comment — *"Type-only: erased before drizzle-kit's bundler ever resolves it, so the `@devdigest/shared` path alias never has to survive migration generation."* Note in the column comment that `$type` is a cast and the repository still `safeParse`s the value on read (EC-28).

Every added column is either nullable or has a **non-volatile** default, so the `ALTER TABLE` does not rewrite the table. No new index: `repo_id` is the primary key and is already indexed, and every read of this table is by that key.

Then generate the migration.

**Skill:** `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert`
**Invariant:** `DDG-WIRE-003` (a schema change ships its migration), `DDG-DNT-004` (migrations are generated, never hand-edited)

**Acceptance.** `onboarding` carries the fourteen added columns plus the three it had. Exactly one new `.sql` file appears under `src/db/migrations/`, containing only `ALTER TABLE "onboarding" ADD COLUMN` statements — no `DROP`, no `ALTER COLUMN`, and no statement naming any other table.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/drizzle-kit generate
cd /Users/krasymyr.tretiak/Work/dev-digest/server && git status --short src/db/migrations/
# exactly one new '??' .sql file, and NO 'M' line against a .sql file.
# `meta/_journal.json` and the snapshot WILL show as 'M' — that is every generate,
# not a hand-edit (server/INSIGHTS.md, 2026-08-19).
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -c 'DROP\|ALTER COLUMN' "$(ls -t src/db/migrations/*.sql | head -1)"
# 0 = pass

# The column set itself. Nothing else measures it: `tsc` only sees a column the code
# REFERENCES, so a column silently omitted from the schema — or added under a typo'd
# name — passes every other check in this block and surfaces as a runtime error weeks
# later. Assert the count and then each name.
cd /Users/krasymyr.tretiak/Work/dev-digest/server && SQL="$(ls -t src/db/migrations/*.sql | head -1)" && \
  grep -c 'ADD COLUMN' "$SQL"
# 14 = pass

cd /Users/krasymyr.tretiak/Work/dev-digest/server && SQL="$(ls -t src/db/migrations/*.sql | head -1)" && \
  for c in state status reason indexed_sha files_indexed files_skipped provider model \
           attempts tokens_in tokens_out cost_usd started_at error; do
    grep -q "\"$c\"" "$SQL" || echo "MISSING COLUMN: $c"
  done
# no MISSING COLUMN: line = pass

cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/eslint src/db/schema/context.ts
```

**Red flags.** If `drizzle-kit generate` asks `Is <col> column in <table> created or renamed from another column?` it will **block forever** — it reads that answer from a TTY and piping newlines does nothing (`server/INSIGHTS.md`, 2026-08-06). This task adds columns and drops nothing, so it should not fire; if it does, kill the process, report it, and split the change rather than waiting. Do **not** run `db:migrate` — applying the migration is `## Applying the migration`'s step, not this task's. Do not add a Postgres `enum` type for `status` or `state`: every enum in this schema is a `text` column with a Drizzle `enum` constraint, and a real type would need its own migration to extend.

---

### T3 — The nav entry, the active-key fix, and the feature's message namespace

**Satisfies:** AC-31, AC-32, AC-38 (enabling), AC-33 (enabling), AC-41 (enabling), AC-42 (enabling), AC-43 (enabling)
**Depends-on:** T1 — the namespace needs one message key per `OnboardingReason` value (AC-43), and that enum is T1's. Wave 1 already precedes wave 2, so this changes no ordering; it makes the declared dependency true.
**Owned paths:** `client/src/vendor/ui/nav.ts` (**one appended `NAV` item and one `SHORTCUTS` row only**), `client/src/components/app-shell/helpers.ts` (`activeKeyFor` only), `client/messages/en/onboarding.json`
**Forbidden:** every other file under `client/src/vendor/ui/**` — in particular `Sidebar.tsx`, `primitives/Markdown.tsx` and `styles.css`; `client/messages/en/shell.json` (the `nav.onboarding-tour` label is **already there** and needs no edit); every other message namespace; `client/src/components/app-shell/AppShell.tsx` and its `hooks/`; `client/src/vendor/shared/**`.

**Change.** Three edits, each small and each with a written reason.

1. **`NAV`** — insert one item into the `WORKSPACE` group **between** `pulls` and `context` (AC-31): `key: "onboarding-tour"`, `label: "Onboarding Tour"`, an existing `IconName` — **`Compass` and `BookOpen` do not exist**; the registry is `Icon` in `client/src/vendor/ui/icons.tsx` and `IconName = keyof typeof Icon`. Plausible members that **are** exported: `Workflow` (closest to the design's node-graph glyph), `Boxes`, `ListChecks`, `Map` is **not** among them. Pick one and verify it before writing —, `href: "/repos/:repoId/onboarding"`, `gKey: "o"`. Add the matching `{ keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" }` row to `SHORTCUTS`, positioned like the others. This enters a do-not-touch zone under that file's own carve-out at lines 22–32; nothing else in the file changes and no primitive is restyled. The `key` **must** be `onboarding-tour` — `shell.json`'s `nav.onboarding-tour` label and `activeKeyFor`'s return value both already spell it that way.
2. **`activeKeyFor`** — EC-25. Today `pathname.includes("/onboarding")` returns `onboarding-tour` for `/onboarding`, which is the **add-a-repository** screen (`src/app/onboarding/page.tsx`), so that screen already highlights the wrong sidebar entry. Replace that clause with one that matches only the repo-scoped route — a `/^\/repos\/[^/]+\/onboarding/` test — leaving the ladder's first-match-wins order and every other clause untouched. `/onboarding` must then fall through to the ladder's `return ""` (no entry active), which is correct: adding a repository is not a WORKSPACE screen.
3. **`messages/en/onboarding.json`** — **T3 owns this file for the whole feature**, so no later task edits it. It already carries `title`, `sections`, `sectionCount`, `regenerate`, `regenerating`, `unknownError`, `generate.*` and `loadError.title`. Keep those keys and add everything T9 and T10 will read. Two of the existing values change:
   - `generate.body` currently names *"overview, architecture, key modules, getting started, and conventions & gotchas"* — a **different** five sections from the design's. EC-26 was resolved on 2026-08-19 with *"the design wins"*, so reword it to name `architecture`, `critical paths`, `run locally`, `reading path` and `first tasks`. This is a real edit, not a no-op.
   - Everything else is additive. Add, at minimum: the five section titles' fallbacks; the on-this-page rail label; the running state; the notice copy for `stale`, `partial` and `degraded` (AC-41, AC-42); **one message per `OnboardingReason` value plus a generic fallback sentence** (AC-43 — the generic one is what an unrecognised reason renders, so it must read as a complete sentence and never as an enum literal); the "generated from N files · M ago" caption (AC-40); the copy-command control's accessible name and its copied confirmation (AC-39); **the diagram-unavailable notice T9 passes as `MermaidDiagram`'s `fallback` (AC-38)** — T9 renders it and is forbidden from adding a key, so it must exist here or that task is blocked on a one-word edit; `Share link` and its confirmation (AC-46); the `Open` control's accessible name (AC-47); the three complexity words `low`/`medium`/`high` (a11y: a badge is a word plus its level, never colour alone); and the inline-error copy (AC-44).

**Skill:** `frontend-ui-architecture`, `next-best-practices`, `typescript-expert`
**Invariant:** `DDG-DNT-002` (the `vendor/ui` carve-out, and only it), `DDG-UI-001` (this changes what the shell renders on two routes — worth a look in the running app)

**Acceptance.** The sidebar's `WORKSPACE` group renders `Pull Requests`, `Onboarding Tour`, `Project Context` in that order. `activeKeyFor("/onboarding")` does **not** return `"onboarding-tour"`; `activeKeyFor("/repos/abc/onboarding")` does. Every key T9 and T10 read exists in `onboarding.json`, and `generate.body` names the design's five sections. `git diff --stat -- client/src/vendor/ui/` shows exactly one file.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t3.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t3.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/eslint src/vendor/ui/nav.ts src/components/app-shell/helpers.ts
cd /Users/krasymyr.tretiak/Work/dev-digest/client && git diff --stat -- src/vendor/ui/
# exactly one file (nav.ts) = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/client && node -e "JSON.parse(require('fs').readFileSync('messages/en/onboarding.json','utf8')); console.log('json ok')"
```

**Red flags.** Do not invent an icon name — read `client/src/vendor/ui/icons` and use one that is exported, or the sidebar renders nothing where the icon should be and no gate sees it. Do not add the entry to any group other than `WORKSPACE`: the design's breadcrumb is `acme/payments-api › Onboarding Tour` and `WORKSPACE` is the repository-scoped group (N1). Do not touch `shell.json`; putting this feature's copy into another namespace is the failure `client/INSIGHTS.md` (2026-08-10) records, and the nav label it needs is already there.

---

### T4 — Widen the two existing read seams: file facts on the facade, a match predicate on the walk

**Satisfies:** AC-20, AC-21 (enabling), and the architecture section's endpoint facts (N11)
**Depends-on:** —
**Owned paths:** `server/src/modules/repo-intel/types.ts` (the `RepoIntel` interface only), `server/src/modules/repo-intel/service.ts` (one new method only), `server/src/adapters/git/confined-doc.ts`
**Forbidden:** every other file under `server/src/modules/repo-intel/` — in particular `repository.ts`, `constants.ts`, `pipeline/**` and `routes.ts`; `server/src/vendor/shared/adapters.ts` (adding a method to the `GitClient` port is exactly what that file's doc-comment and `DDG-DNT-001`/`003` forbid); `server/src/modules/project-context/**`; `server/src/modules/**` from inside the adapter (`adapters-are-leaves`); any lockfile.

**Change.** Two additive widenings of plumbing this feature needs and neither of which it may reimplement.

1. **`RepoIntel.getFileFacts(repoId, paths)`** — declare it on the interface in `types.ts` under the existing `// --- Reads ---` block and implement it in `service.ts` as a thin delegate to `this.repo.getFileFacts(repoId, paths)` (`repo-intel/repository.ts:565`), returning `IndexerFileFactsRow` rows — the field is **`filePath`**, not `file` (`repo-intel/repository.ts:99`: `{ filePath: string; endpoints: string[]; crons: string[] }`). Follow `getFileRank` (`service.ts:592-596`) line for line, including its two guards: return `[]` when `repoIntelEnabled` is false and when `paths` is empty. That empty-array-when-degraded shape is the facade's documented degraded contract (`types.ts:16-22`) and the status stays observable through `getIndexState`. Why this belongs here rather than in the onboarding module: the module may not import a sibling's repository, and `import type` does not exempt it (`server/INSIGHTS.md`, 2026-08-14, measured 22 → 24 warnings). Say so in the method's doc-comment, and name the consumer.
2. **An optional `match` predicate on `RepoDocWalkOptions`** — `confined-doc.ts`'s walk hard-codes its candidate rule to `*.md` under a root plus any `INSIGHTS.md` (`isCandidate`, lines 304-307), so it cannot find a `package.json`, a `Makefile` or a `docker-compose*.yml`. Add `match?: (name: string, rel: string) => boolean` to `RepoDocWalkOptions` and have `isCandidate` use it when supplied. **When it is absent the current rule applies verbatim**, so `modules/project-context` is behaviour-identical and its existing `test/project-context-walk.test.ts` must still pass untouched. This is the shape the file's own doc-comment already prescribes at lines 42–45: *"Everything the walk is bounded by… arrives as a PARAMETER. `src/adapters/**` must import nothing from `src/modules/**`, so the caller owns those values."* Extend that paragraph to cover the predicate. Nothing else in the file moves — in particular `resolve` is not touched, not extracted and not reordered, because it is the single place confinement is decided for both `read` and `list`.

**Skill:** `onion-architecture`, `security`, `typescript-expert`
**Invariant:** `DDG-ARCH-003` (a capability two rings share is a port/adapter, not module code), `DDG-WIRE-002`, `DDG-DNT-001` (the `GitClient` port is **not** widened)

**Acceptance.** `container.repoIntel.getFileFacts(repoId, paths)` returns one row per path that has facts, `[]` for an empty `paths` and `[]` with the flag off. A `list` call with no `match` returns exactly what it returns today; a `list` call whose `match` accepts `package.json` returns every `package.json` outside the excluded directories, each still resolved through `resolve` so a symlinked escape is omitted and unread. `depcruise` reports **no new** errors or warnings.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' > /tmp/t4.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t4.txt
# test/project-context-walk.test.ts must still be green and unmodified:
cd /Users/krasymyr.tretiak/Work/dev-digest/server && git diff --stat -- test/
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/eslint src/modules/repo-intel/types.ts src/modules/repo-intel/service.ts src/adapters/git/confined-doc.ts
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src | grep -v "\.js'" | grep -v '^src/db/schema'
# 0 lines = pass
```

**Red flags.** Do **not** change `list`'s default behaviour, and do not move `ALWAYS_MATCHED_FILENAME` into the option: Project Context's any-depth root rule was corrected on 2026-08-19 after measuring 17 documents returned where 25 exist, and its test pins both halves. If the predicate seems to want the excluded-directory set too, it already has it — `excludedDirs` is an existing option and the walk prunes before the predicate is ever reached.

---

### T5 — Promote the document renderer, and give the diagram a fallback

**Satisfies:** AC-36, AC-38 (enabling), AC-37 (enabling)
**Depends-on:** —
**Owned paths:** `client/src/components/document-markdown/**` (new: `DocumentMarkdown.tsx`, `styles.ts`, `index.ts`, `DocumentMarkdown.test.tsx` — all **moved**, not rewritten), `client/src/app/repos/[repoId]/context/_components/DocumentMarkdown/**` (removed), `client/src/app/repos/[repoId]/context/_components/DocPreview/DocPreview.tsx` (the import line only), `client/src/components/mermaid-diagram/MermaidDiagram.tsx`
**Forbidden:** `client/src/vendor/ui/**`; `client/src/app/skills/_components/SkillBody/**` (a near-sibling with different needs — leave it alone); every other file under `client/src/app/repos/[repoId]/context/`, including `DocPreview/styles.ts` and `ContextView`; `client/src/app/repos/[repoId]/pulls/**` (the `MermaidDiagram` consumer — its call site must keep compiling unchanged); any lockfile.

**Change.** Two edits to shared client chrome, both making an existing unit reusable rather than duplicating it.

1. **Move `DocumentMarkdown` to `client/src/components/document-markdown/`.** Onboarding is the third consumer of a document renderer (`SkillBody`, Project Context's `DocumentMarkdown`, and now the tour's section bodies), and the component's own doc-comment writes the rule at lines 15–20: *"If a third consumer appears, the promotion target is `src/components/`, not either feature."* Sibling route subtrees never import each other, so the alternative is a fourth copy. Move the four files verbatim — the component body, its styles, its barrel and its test — changing **only** what the move requires: the doc-comment's "this feature ships its own renderer" sentence becomes an accurate statement of its new home and its two consumers, and `DocPreview.tsx:20`'s `from "../DocumentMarkdown"` becomes the `@/components/document-markdown` barrel. Do not restyle it, do not add a component mapping, and do not change its `javascript:` href guard.
2. **Add one optional `fallback?: React.ReactNode` prop to `MermaidDiagram`**, rendered in place of the current `return null` when `state === "invalid"`. Default `null`, so `BlastRadiusCard.tsx:285` and its test mock are unaffected. This is what AC-38 needs and it cannot be done from outside: the component swallows both failure modes — a string that does not match `MERMAID_RE`, and one that `mermaid.parse` rejects — and a caller pre-validating with its own copy of the regex would still miss EC-12's unquoted `/` in a node label, which passes the regex and fails the parse. Record that reasoning in the prop's doc-comment. This file is `src/components/`, cross-cutting chrome, **not** a `vendor/ui` primitive.

**Skill:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `typescript-expert`
**Invariant:** `DDG-UI-002` (a unit two route subtrees need lives in the shallowest folder both can reach), `DDG-DNT-002` (this is **not** `vendor/ui` — do not "fix" `Markdown.tsx` instead)

**Acceptance.** `client/src/app/repos/[repoId]/context/_components/DocumentMarkdown/` no longer exists; `client/src/components/document-markdown/` does, with the moved test still passing unchanged in substance. The Project Context screen renders exactly as before. `<MermaidDiagram chart="not a diagram" fallback={<p>unavailable</p>} />` renders the fallback; `<MermaidDiagram chart="not a diagram" />` renders nothing, as today.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t5.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t5.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && grep -rn "context/_components/DocumentMarkdown\|\.\./DocumentMarkdown" src/
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/eslint src/components/document-markdown/DocumentMarkdown.tsx src/components/document-markdown/styles.ts src/components/document-markdown/index.ts src/components/document-markdown/DocumentMarkdown.test.tsx src/components/mermaid-diagram/MermaidDiagram.tsx src/app/repos/[repoId]/context/_components/DocPreview/DocPreview.tsx
```

**Red flags.** This is a **move**, not a rewrite: if the diff of `DocumentMarkdown.tsx` shows anything beyond the doc-comment and the barrel path, you have changed behaviour a shipped screen depends on. `DocPreview/styles.ts:12` documents a deliberate background relationship with this renderer's fenced blocks — do not "tidy" it while you are in the folder. And do not add `@testing-library/user-event` for the moved test; it is not a dependency here and adding it is a `package.json` + lockfile change.

---

### T6 — The deterministic layer: facts, ranked paths, chains, and declared commands

**Satisfies:** AC-5, AC-6, AC-7, AC-16, AC-18, AC-19, AC-20, AC-21, AC-22
**Depends-on:** T1, T4
**Owned paths:** `server/src/modules/onboarding/constants.ts` (new), `server/src/modules/onboarding/types.ts` (new), `server/src/modules/onboarding/facts.ts` (new), `server/src/modules/onboarding/commands.ts` (new)
**Forbidden:** every other path under `server/src/modules/onboarding/` (T8 owns `service.ts`, `repository.ts`, `routes.ts`, `prompt.ts`, `schemas.ts`); `server/src/modules/**` other than this module; `server/src/adapters/**` (T4 owns the walk); `server/src/db/**`; `server/src/vendor/shared/**`; **any `node:fs` import anywhere in this module**; any lockfile.

**Change.** The half of the feature that runs before any model call, written as pure functions plus two injected reads, so it is testable with no database and no provider.

`constants.ts` carries, each with a one-line reason:
- the five section kinds in AC-1's fixed order, and their deterministic English titles (N12 — English is a constant, not a setting);
- input caps: `MAX_PROMPT_PATHS = 200`, `MAX_ENDPOINT_FACTS = 40`, `MAX_DECLARED_COMMANDS = 60`, `MAX_PROMPT_TOKENS = 12_000`, and the repo-map budget left at the facade's `DEFAULT_REPO_MAP_TOKEN_BUDGET` default of 1500 by passing no argument;
- output caps: `MAX_CRITICAL_ROWS = 8`, `MAX_READING_ENTRIES = 10`, `MAX_FIRST_TASKS = 6`, `MAX_LINKS_PER_SECTION = 4`, `MAX_BODY_CHARS = 4000`;
- call bounds: `TOUR_CALL_DEADLINE_MS = 75_000` and `TOUR_MAX_RETRIES = 1`. Write out why both exist: `timeoutMs` on the request is silently ignored and `maxRetries` defaults to 2 (three attempts), so the race bounds wall-clock and `maxRetries: 1` bounds round-trips at AC-10's ceiling of two — one call plus at most one `parseWithRepair` reprompt;
- `TOUR_STALE_AFTER_MS = 5 * 60_000` — a row still `running` after this is treated as abandoned (EC-18), mirroring `SCAN_STALE_AFTER_MS`;
- the excluded directory names for the command walk: repo-intel's eight (`node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, `.git`) **plus `.pnpm-store`**, written out here rather than imported — importing repo-intel's would be a cross-module edge and its list does not name `.pnpm-store`, which a real demo repository committed;
- `ONBOARDING_FEATURE_MODEL = 'onboarding'`, `ONBOARDING_JOB_KIND = 'onboarding-generate'`, `ONBOARDING_SCHEMA_NAME = 'OnboardingDraft'` (load-bearing: `MockLLMProvider.structuredBySchema` keys its fixtures on it), and `TOUR_LANGUAGE = 'English'` (EC-23 — the template's renderer leaves an unmatched placeholder as the empty string, so this constant is what stops the model being asked to write in nothing).

`types.ts` declares the fact bundle and, following the `blast` precedent (`modules/blast/types.ts` / `IndexBlastFacts`), **the narrow view of the facade this module reads** — `getIndexState`, `getTopFilesByRank`, `getCriticalPaths`, `getRepoMap`, `getFileRank`, `getFileFacts` — so the module names no type from `modules/repo-intel/`. A `Container` satisfies it structurally.

It also declares **the feature-model resolver as a call signature**, `(workspaceId: string, id: FeatureModelId) => Promise<FeatureModelChoice>`, copying `FeatureModelResolver` from `intent/sources.ts:156`. T8 consumes it as `deps.featureModel` and the container satisfies it structurally with the arrow property it already exposes (`platform/container.ts:238-244`). Declaring it here rather than importing `resolveFeatureModel` in `service.ts` is what keeps `modules/onboarding` free of any `modules/settings/` edge — see `## Constraints → Architecture`, where an earlier draft of this plan had it wrong.

`facts.ts` collects, from the facade only:
- the index state, mapped to `{ status, reason }` with a local copy of the blast table — `degraded → 'degraded'`, `'partial' → 'partial'`, `'full' → 'ok'`, absent → `'partial'`; and `flag_off | index_failed | index_partial | repo_too_large` passed through with **everything else, including `no_data`, falling to `index_missing`** (AC-16, AC-18, AC-19). Copy `blast/service.ts:86-99` and `:356-363` by hand; importing them is a cross-module violation.
- the ranked reading path: `getTopFilesByRank(repoId, MAX_PROMPT_PATHS)`. That read is already rank DESC and already drops tests, specs, declarations, migrations and tool configs, so AC-5 and AC-6 are satisfied by calling it and adding nothing. Do not re-sort and do not add a second filter.
- the critical chains: `getCriticalPaths(repoId)`, unchanged — five seeds and two hops are the shipped constants, and AC-7 is that behaviour (EC-4's edgeless repository returns `[]`, which is a value, not an error).
- the repo map: `getRepoMap(repoId)`, whose degraded form is an empty text and a reason.
- the endpoint and cron facts: `getFileFacts(repoId, <the ranked paths>)`, capped at `MAX_ENDPOINT_FACTS`.

`commands.ts` derives AC-20's commands, and **only** from the three declared sources. Read them through the injected confined reader — `list` with a `match` predicate to find them, then `read` for each, both path-confined with the prefix re-checked after symlink resolution. The predicate accepts `package.json`, `Makefile`/`makefile`/`GNUmakefile`, and any filename matching `docker-compose*.yml`/`*.yaml`, anywhere outside the excluded directories. For each source:
- **`package.json`** — `JSON.parse` inside a `try`, read `scripts`, and emit the **invocation** (`npm run <name>`, or `pnpm run <name>`/`yarn <name>` when the sibling lockfile says so — Assumption 3), never the script body. EC-7's monorepo yields several `package.json` files; each command carries its own declaring path, which is what makes conflicting sets readable rather than merged.
- **`Makefile`** — a line-anchored scan for `^([A-Za-z0-9_.-]+):` that is not a pattern rule or a `.PHONY` line, emitting `make <target>`.
- **`docker-compose*.yml`** — **there is no YAML parser in this package and none may be added** (`DDG-DNT-005`; verified against `server/package.json`). A bounded line scan of the `services:` block's immediate children (two-space-indented `^  ([A-Za-z0-9_.-]+):` until the next zero-indent key) yields the service names, emitting `docker compose -f <path> up <service>`.
- A README is **never** a source (AC-20). No prose, no fenced block, no heading.
- Every command carries its declaring repo-relative path (AC-21) and its ordinal. The list is capped at `MAX_DECLARED_COMMANDS`, deterministically ordered (source path ascending, then declaration order), and **nothing is ever executed** (AC-22).

**Skill:** `onion-architecture`, `security`, `zod`, `typescript-expert`
**Invariant:** `DDG-SEC-003` (the confinement is the adapter's and is not reimplemented), `DDG-WIRE-002`, `no-cross-module-internals`

**Acceptance.** For a fixture facade whose ranks are `0.9`, `0.5`, `0.1` on paths that sort alphabetically in the opposite order, the reading path comes back rank-first. A fixture whose two highest-ranked paths are `src/a.test.ts` and `vitest.config.ts` yields neither. Chains number at most five, each of two or three distinct paths. For a clone whose README suggests `curl … | sh` and whose `package.json` declares a `dev` script, the commands carry `dev` and not the README line, and each names its declaring file. A clone with no `package.json`, no `Makefile` and no compose file yields an empty command list (EC-8), which the caller labels `no_commands_declared`. A repository with no index state row produces `status: 'degraded'`, `reason: 'index_missing'`. Nothing in this module reaches a process-spawning call.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' > /tmp/t6.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t6.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rn "node:fs" src/modules/onboarding/
# 0 lines = pass  (AC-22 and the modules-no-raw-sdk blind spot)
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rnE "child_process|execFile|spawn\(|exec\(" src/modules/onboarding/
# 0 lines = pass  (AC-22, Verify: analysis)
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rn "modules/repo-intel\|modules/blast\|modules/conventions\|modules/repos/" src/modules/onboarding/
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/eslint src/modules/onboarding/constants.ts src/modules/onboarding/types.ts src/modules/onboarding/facts.ts src/modules/onboarding/commands.ts
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src | grep -v "\.js'" | grep -v '^src/db/schema'
# 0 lines = pass
```

**Red flags.** Do not add a YAML dependency, and do not "improve" the compose scan into a general parser — a bounded scan of the `services:` block is the whole requirement, and the service name is all AC-20 needs. Do not reach for `container.repoIntel.getConventionSamples`: it is a one-line alias of `getTopFilesByRank` and calling the alias reads as if this feature shares the conventions extractor's sample. If a chain from `getCriticalPaths` looks wrong, that is not this task's to fix — AC-7 is written against the shipped behaviour and changing the indexer is N6-adjacent scope.

---

### T7 — Client data layer for the tour

**Satisfies:** AC-34, AC-40, AC-43, AC-44, AC-47 (enabling)
**Depends-on:** T1
**Owned paths:** `client/src/lib/hooks/onboarding.ts` (new), `client/src/lib/hooks/index.ts` (one export line), `client/src/lib/onboarding.ts` (new)
**Forbidden:** `client/src/vendor/shared/**`, `client/src/vendor/ui/**`, `client/src/lib/api.ts` (do **not** "simplify" its conditional `content-type` — a body-less POST otherwise trips Fastify's *"Body cannot be empty when content-type is application/json"*), `client/src/lib/github-urls.ts` (reuse `githubBlobUrl`; it needs no change), `client/messages/**` (T3 owns the namespace), every other hooks module, any lockfile.

**Change.** A hooks module in the house style (`src/lib/hooks/conventions.ts` and `project-context.ts` are the templates):

- `useOnboardingTour(repoId)` — `GET /repos/:id/onboarding`, keyed `["onboarding", repoId]`, `enabled: !!repoId`. A **function-form `refetchInterval`** that polls while `query.state.data?.generation_state === "running"` and returns `false` otherwise — the shape `conventions.ts:38` already uses, and what makes AC-34's running state clear itself without the screen owning a timer.
- `useGenerateOnboarding(repoId)` — `POST /repos/:id/onboarding/generate` with **no body**, invalidating `["onboarding", repoId]` on success. Note in the doc-comment that `api.post` sends no `content-type` when there is no body, and that this is deliberate.

Every `@devdigest/shared` import in this file is **`import type`**. A runtime value import from that barrel resolves under `tsc` and under vitest and then 500s every route that transitively reaches it under `next build` (`client/INSIGHTS.md`, 2026-08-03).

`client/src/lib/onboarding.ts` holds the **runtime** constants and pure helpers more than one unit needs, because runtime constants may never come from `@devdigest/shared`:
- the reason → message-key map, with an explicit **fallback to the generic key for any value not in the map** (AC-43 — this is the whole of that criterion, and it must be a lookup with a default, not a `switch` that falls through to the raw value);
- the notice level a `{ status, stale }` pair implies (`stale`, `partial`, `degraded`, or none) — AC-41, AC-42;
- the "generated from N files, M ago" formatting, reading the tour's **own** `files_indexed` / `files_skipped` / `generated_at` and never the current index state (AC-40). Reuse `src/lib/format.ts` for the relative time if it already has one; do not write a second formatter.
- the `Open` href helper: `githubBlobUrl(full_name, tour.indexed_sha, path)`, returning `null` when `indexed_sha` is null so the caller renders no broken link (AC-47, Assumption 8).

**Skill:** `frontend-ui-architecture`, `react-best-practices`, `typescript-expert`, `zod`
**Invariant:** `DDG-UI-002` (a helper more than one unit needs lives in `src/lib/`, not a unit's `helpers.ts`)

**Acceptance.** The tour query polls while the payload says `running` and stops when it does not. The generate mutation issues a body-less POST to `/repos/{id}/onboarding/generate` and invalidates the tour key. An unrecognised reason string resolves to the generic message key. The age and file counts come from the tour's own recorded fields. Every `@devdigest/shared` import in both new files is `import type`.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t7.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t7.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && grep -n 'from "@devdigest/shared"' src/lib/hooks/onboarding.ts src/lib/onboarding.ts | grep -v "import type"
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/eslint src/lib/hooks/onboarding.ts src/lib/hooks/index.ts src/lib/onboarding.ts
```

**Red flags.** Do not add a second `fetch` path: `src/lib/api.ts` is the only place `fetch` is called in this package. Do not put the reason map in a component's `helpers.ts` — T9 and T10 both read it, and a unit's `helpers.ts` is unit-private under the barrel convention. `client/src/lib/hooks/intent.test.tsx` is the precedent for asserting the **outgoing request** by stubbing `fetch` rather than mocking `api`, which is the only shape that catches a mutation silently omitting a field — the `test-writer` stage will need it.

---

### T8 — The `onboarding` server module: one call, grounded, priced, and wired

**Satisfies:** AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30
**Depends-on:** T1, T2, T4, T6
**Owned paths:** `server/src/modules/onboarding/{routes,service,repository,prompt,schemas}.ts` (all new), `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/prompts/onboarding.system.md`
**Forbidden:** `server/src/modules/onboarding/{constants,types,facts,commands}.ts` (T6 owns them — read them, extend `constants.ts` only if a value is genuinely missing and say so in the report); every other module under `server/src/modules/`; `server/src/db/schema/**` and `server/src/db/migrations/**`; `server/src/adapters/**` including `mocks.ts`; `server/src/vendor/shared/**`; `server/src/platform/errors.ts`; `reviewer-core/**`; **any `node:fs` import**; any lockfile.

**Change.** The feature slice in the house shape — `routes.ts` → `service.ts` → `repository.ts` — with `modules/conventions/` as the closest structural precedent and `modules/intent/service.ts` as the precedent for the bounded call.

**`repository.ts`** is the only file allowed to touch `db/schema` + `drizzle-orm`. It owns: resolving a repository by `(workspaceId, repoId)` by querying `t.repos` **directly** (never by importing `ReposRepository`), returning `owner`, `name`, `fullName`; reading the single `onboarding` row by `repo_id`; marking a generation `running` (setting `state`, `started_at`, and inserting a placeholder body when no row exists — `json` is `NOT NULL` with no default, so the insert supplies `{"sections":[]}`); and the single-row upsert that replaces the tour (AC-28 — the table is keyed by repository and holds no history). **The stored body is `safeParse`d on every read**, never `as`-cast: a `jsonb` column read back by a cast arrives with keys absent, not null (EC-28, `server/INSIGHTS.md` 2026-08-02 and 2026-08-19), and a parse failure degrades to no sections with a reason rather than reaching the client.

**`schemas.ts`** is the model-facing draft schema — `OnboardingDraft` — kept deliberately apart from `@devdigest/shared`, exactly as `conventions/schemas.ts` explains: this is what the model **returns**, unverified, and `OnboardingTour` is what survives grounding and the caps. Two constraints `zodResponseFormat` imposes, both stated in that file and both binding here: **no `.optional()`** (use `.nullable()` — the diagram field especially), and **no array `.min()`/`.max()`** (bounds are stated in the prompt and enforced in code, which AC-30 requires anyway). No numeric ranges either.

**`prompt.ts`** owns template loading, rendering and message assembly. Copy `conventions/prompt.ts`'s cached `loadTemplate` and `renderTemplate` shapes rather than importing them (cross-module). The system message is `renderTemplate(onboarding.system.md, { sections: <the five kinds and their titles>, language: TOUR_LANGUAGE })` **and nothing else** — no path, no file name, no repo map, no command (AC-24). Every fact block goes in the **user** message, each wrapped with `wrapUntrusted` from `platform/prompt.js` (AC-23): the ranked paths, the chains, the endpoint facts, the repo map, and the declared commands. The wrapper escapes any attempt to close it, so a file whose contents include `</untrusted>` cannot break out (EC-9); do **not** add pattern matching for hostile phrasing — matching one phrasing only ever catches one phrasing, and the template already carries its own clause. Do **not** append `INJECTION_GUARD`: that is `reviewer-core`'s, on the review path, and duplicating a guard is the mistake `server/INSIGHTS.md` (2026-08-05) records. Finally, measure the assembled user message with `container.tokenizer.count` and, if it exceeds `MAX_PROMPT_TOKENS`, trim the ranked-path block from its tail (lowest rank first) until it fits — commands, chains and the repo map are never dropped, because each is either the only source of a section or already budgeted.

**`src/prompts/onboarding.system.md`** — remove the **two** clauses naming `routes_and_apis`, leaving the `architecture` half of each intact. Verified by the cross-model review and re-checked: `grep -n routes_and_apis` returns exactly two lines — **line 8**, the diagram allowance (`…sections, else null`), and **line 23**, the formatting bullet (`In \`routes_and_apis\`: present grouped bullet lists…`). An earlier draft of this plan said three and named "the mermaid rule's mention" as the third; **there is no third.** The Mermaid-rules block never names `routes_and_apis` — it is generic quoting, line-break and fence guidance, it still governs the surviving `architecture` diagram, and it must not be touched. N11 removed that section from the feature and the endpoint facts feed `architecture` instead; an instruction about a section that is not in `{{sections}}` invites the model to emit a sixth one that the contract then drops. Change nothing else in the file — its untrusted-data clause, its grounding rules and its mermaid rules are all load-bearing (EC-12, EC-13, AC-8).

**`service.ts`** owns the orchestration:

- **Read** (`getTour`) — resolve the repository within the workspace **first** (AC-29), before any index read and before any clone path is resolved; a foreign repository is `NotFoundError`. No row → `200` with no sections, `generation_state: 'never_generated'` (AC-2). A row → the parsed sections, its recorded status/reason/provenance, and `stale` computed by comparing the row's `indexed_sha` against `getIndexState(repoId).lastIndexedSha` (AC-26). A `running` row whose `started_at` is older than `TOUR_STALE_AFTER_MS` reports as not running, so a dead worker cannot brick the screen (EC-18). **Zero model calls and zero writes on this path** (AC-27) — no upsert, no `touch`, no `jobs.enqueue`.
- **Request** (`requestGeneration`) — resolve the repository, refuse when a generation is already running for it (AC-4, see Q1), mark the row `running`, enqueue `ONBOARDING_JOB_KIND` and return the job id without waiting (AC-3). Attach `void job.done.catch(...)` to write the failure onto the row, following `conventions/service.ts:200-208`.
- **Run** (the job handler, registered once from `routes.ts` at boot the way `conventions/routes.ts:35-39` does it) — collect the facts (T6). **If the index state maps to `degraded`, store the deterministic skeleton with that reason and return before any provider is constructed** (AC-16 **and** AC-17 — these are separate criteria because they fail independently: a correct status with a wasted call is the expensive half, and no status assertion can see it). Otherwise resolve the model through the **injected resolver** — `this.deps.featureModel(workspaceId, ONBOARDING_FEATURE_MODEL)` (AC-14), where `featureModel` is the `FeatureModelResolver`-shaped call signature declared in this module's own `types.ts` (T6 owns that file) and satisfied structurally by the container's existing `featureModel` property (`platform/container.ts:238-244`). **Do not import `resolveFeatureModel` from `modules/settings/feature-models.ts`** — that is the cross-module edge `modules/intent` was refactored to remove (`server/INSIGHTS.md`, 2026-08-10), and `modules/conventions/service.ts:17` still carrying it is an accepted pre-existing warning rather than a precedent. Then build the messages, and issue **exactly one** `completeStructured` with `maxRetries: TOUR_MAX_RETRIES` and no `timeoutMs`, raced against `deadline(TOUR_CALL_DEADLINE_MS)` — copying `intent/service.ts:147-172` including the `.then(ok, err)` fold that keeps the race's loser from becoming an unhandled rejection. Three failures, three reasons, one skeleton each and never an HTTP error (AC-15): a throw → `model_failed`, the race lost → `model_timeout`, a payload the schema rejects → `model_invalid`.
- **Grounding and caps**, in this order (AC-8, AC-30). Collect every repository path the model named — in links, critical-path rows, reading-path rows and first tasks — and confirm each against the index with `container.repoIntel.getFileRank(repoId, claimedPaths)`: a path with no row is dropped and the rest of its section is kept. This is also EC-14's whole answer, since an absolute or outside path is never in `file_rank`, and EC-27's, since `file_rank` holds test files even though `getTopFilesByRank` filters them out. A first task naming a **directory** is confirmed by prefix against the paths the tour was built from (Assumption 7). Then assemble the five sections in the contract's fixed order — a kind the model omitted gets its deterministic skeleton section, a kind it invented is discarded (AC-1) — and apply the output caps by keeping the first items **in the order returned** and discarding the excess whole, never truncating an item (AC-30). De-duplicate reading-path entries and first-task titles (EC-16). An empty command list stores `run_locally` with reason `no_commands_declared` (EC-8).
- **Persistence and observability** — one upsert carrying the sections, status, reason, `indexed_sha` from the index state at generation time (AC-25), `files_indexed`/`files_skipped`, and `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd` from the `StructuredResult` (AC-12). Then **one** log line carrying the repository, the model, the round-trip count, the token counts and the cost (AC-13) — one line with all five figures, not five lines. The logger arrives as an optional pino-shaped dependency, declared the way `IntentWarnLogger` is (`intent/service.ts:41-48`) and passed as `app.log` when `routes.ts` constructs the service at boot; the service invents no sink of its own.
- **The repository disappearing mid-generation is an ordinary completion, not a failure** (EC-21). `onboarding.repo_id` is `ON DELETE cascade`, so deleting the repository while a job runs takes the `running` row with it — and then **both** write paths are broken at once: the completion upsert violates the foreign key, and the `void job.done.catch(...)` bookkeeping T8 borrows from `conventions/service.ts:200-208` tries to write a failure onto a row that no longer exists. So the handler re-reads the repository before it persists, and when it is gone it **returns silently**: no upsert, no error row, nothing logged as a failure, no rethrow. A user deleted the repository; that is not a defect and it must not surface as one. Note that a bare `try/catch` around the upsert is *not* equivalent — it would swallow a genuine constraint violation with the same shrug. Check for the row's absence, and let every other database error propagate to the existing failure path.

**`routes.ts`** is transport only, with `getContext(container, req)` as the **first** statement of every handler and `IdParams` from `_shared/schemas.js` on `params`:
- `GET /repos/:id/onboarding` → `OnboardingTour`, with `config: { rateLimit: { max: 60, timeWindow: '1 minute' } }`.
- `POST /repos/:id/onboarding/generate` → `reply.code(202)` and `{ status: 'accepted', jobId }`, with `config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: … } }` keyed on the repository id so the cap is per repository as `## Non-functional` states (Assumption 4). The 202-with-degraded-fallback shape is `repo-intel/routes.ts:43-65`.

Then register the module: one import and one entry in `server/src/modules/index.ts`, and one lazy getter plus a `ContainerOverrides` field in `server/src/platform/container.ts`, following the `projectContext` and `priorPrs` entries.

**Skill:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`, `drizzle-orm-patterns`, `typescript-expert`
**Invariant:** `DDG-WIRE-001` (register statically or it 404s with no error), `DDG-WIRE-002`, `DDG-WIRE-004` (bind in the container), `DDG-SEC-002` (untrusted wrapping, in the user message, once), `DDG-SEC-003` (contract schema on the route + workspace scoping), `DDG-ARCH-001` (routes stay thin)

**Acceptance.** A freshly imported repository answers `200` with no sections and `never_generated`, not `404`. Two generation requests in flight produce one `202` and one refusal, and the injected provider records exactly one `completeStructured` call. A repository with no index state row answers `degraded / index_missing` and the provider records **zero** calls. A provider that throws, one that never resolves, and one returning `{}` produce three stored tours with `model_failed`, `model_timeout` and `model_invalid` and no HTTP error. A model response naming `src/does-not-exist.ts` has that item dropped and the rest of its section stored. A response with twenty first tasks stores six whole tasks. The recorded `attempts` is never above 2. The system message the provider records is the rendered template and nothing else; every fact block in the user message sits inside `<untrusted …>` delimiters. A hundred reads leave the provider's call list empty and `generated_at` unchanged. Two generations leave exactly one row for that repository. A generation whose repository is deleted before it completes finishes **silently** — no upsert, no error row, nothing logged as a failure, and no rethrow out of the job handler (EC-21). `depcruise` reports **no new** errors or warnings attributable to `modules/onboarding`.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' > /tmp/t8.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t8.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/server && for m in $(ls -d src/modules/*/ | xargs -n1 basename | grep -v '^_'); do
  [ -f "src/modules/$m/routes.ts" ] || continue
  ident=$(grep -oE "^import ([A-Za-z0-9_]+) from '\./$m/routes\.js'" src/modules/index.ts | awk '{print $2}')
  [ -n "$ident" ] || { echo "NOT IMPORTED: $m"; continue; }
  grep -qE "^  $ident,?$" src/modules/index.ts || echo "IMPORTED BUT NOT IN REGISTRY: $m"
done
# any NOT IMPORTED / IMPORTED BUT NOT IN REGISTRY line = fail.
# Two checks, because they are two different failures. The registry is a
# `Record<string, FastifyPluginAsync>` of BARE IDENTIFIERS — the quoted path
# `'./onboarding/routes.js'` appears ONLY on the import line. So testing for the
# path alone passes a module that is imported and then left out of the object,
# which is exactly the DDG-WIRE-001 failure (mounts nowhere, 404s with no error).
# `no-unused-vars` would probably also catch the orphaned import, but "probably"
# is not what a CRITICAL invariant's check should rest on.
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src | grep -v "\.js'" | grep -v '^src/db/schema'
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rn "node:fs" src/modules/onboarding/; grep -rnE "child_process|execFile|spawn\(|exec\(" src/modules/onboarding/
# 0 lines from each = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rn "drizzle-orm\|db/schema" src/modules/onboarding/ | grep -v "src/modules/onboarding/repository.ts"
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -c "completeStructured" src/modules/onboarding/service.ts
# 1 = a smoke check only: it proves ONE CALL SITE, not one call. A call site inside a
# loop or a retry wrapper passes this and still violates AC-9. It is kept because a
# SECOND call site is the likeliest way AC-9 breaks and this catches that for free.
# The behavioural proof of AC-9 is `MockLLMProvider.calls`, asserted in
# server/test/onboarding-service.test.ts (see `## Tests`) — that file, not this grep,
# is what plan-verifier should cite for AC-9.

cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -rn "modules/settings" src/modules/onboarding/
# 0 lines = pass. The feature-model choice arrives through the injected resolver;
# importing `resolveFeatureModel` directly is the cross-module edge (see Constraints).
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/eslint src/modules/onboarding/routes.ts src/modules/onboarding/service.ts src/modules/onboarding/repository.ts src/modules/onboarding/prompt.ts src/modules/onboarding/schemas.ts src/modules/index.ts src/platform/container.ts
cd /Users/krasymyr.tretiak/Work/dev-digest/reviewer-core && git diff --stat -- .
# 0 lines = pass (N2: reviewer-core is unchanged)
```

**Red flags.** If a query wants `ReposRepository`, write the narrow `t.repos` query in this module's own repository — importing a sibling's internal is a `depcruise` warning that `import type` does **not** exempt. If `maxRetries: 0` looks tempting for safety, it is wrong here: AC-10's ceiling is **two** round-trips precisely because one with no repair at all wastes a whole generation whenever a model returns a nearly-valid payload — and `parseWithRepair`'s reprompt is that second trip. If a test appears to need a live Postgres it belongs in an `*.it.test.ts`, and Docker is not authorised on this run — build against injected fakes through `ContainerOverrides` (`server/CLAUDE.md`). Do not extend `src/adapters/mocks.ts` to make `MockLLMProvider` hang or fail: declare the throwing, hanging and schema-violating providers locally in the test file, since the shipped mock always resolves with `attempts: 1`. Do not run `db:migrate`.

---

### T9 — The tour section card

**Satisfies:** AC-35, AC-36, AC-37, AC-38, AC-39, AC-45, AC-47
**Depends-on:** T1, T3, T5
**Owned paths:** `client/src/app/repos/[repoId]/onboarding/_components/TourSection/**` (new: `TourSection.tsx`, `index.ts`, `styles.ts`, and, if the card genuinely needs them, `helpers.ts` / `constants.ts` and a nested `_components/`)
**Forbidden:** `client/src/app/repos/[repoId]/onboarding/page.tsx` and `_components/OnboardingView/**` (T10 owns them); `client/messages/**` (T3 owns the namespace — read it, do not add to it); `client/src/components/**` (T5 owns the two shared units — import them through their barrels); `client/src/lib/**` (T7 owns it); `client/src/vendor/**`; any lockfile.

**Change.** One colocated feature unit rendering a single `OnboardingTourSection`, taking everything it needs as props and fetching nothing (`client/CLAUDE.md`: never call `fetch` in a component). It renders, in this order:

- the section's heading, with a stable `id` derived from its `kind` so the rail in T10 can target it (AC-35);
- the markdown `body` through `DocumentMarkdown` from `@/components/document-markdown` — headings, lists and fenced code blocks (AC-36). This is the whole reason that component was promoted in T5; do not reach for `<Markdown>` from `@devdigest/ui`, which maps `p`/`strong`/`code`/`a` and would collapse a document-shaped body into one wall of text;
- the `diagram`, when present, through `MermaidDiagram` with a `fallback` naming the diagram as unavailable — so an invalid diagram leaves the body and links rendered with an inline notice in its place and **no thrown render** (AC-37, AC-38, EC-12). Treat an empty string as absent (EC-13);
- the per-kind items: `run_locally`'s commands each with its declaring path and a copy control that writes the command's **exact** text to the clipboard (AC-39, and nothing is executed); `critical_paths` and `reading_path` rows as `OnboardingPathNote`s, each with an `Open` control linking to the file on the repository host at the tour's recorded SHA, in a new tab with `rel="noreferrer noopener"` (AC-47) and absent when there is no SHA; `first_tasks` with a complexity badge that is a **word plus its level**, never colour alone;
- up to four links.

Every control carries an accessible name and is a real focusable element — an icon-only copy button needs an `aria-label` from the catalogue, and a row action must be a `<button>` or an `<a>`, never a `div` with an `onClick` (AC-45). Where a behaviour has no native keyboard equivalent, put it on an explicit `onKeyDown`: jsdom synthesizes no click for Enter on a focused native button and this package has no `user-event`, so that choice is both the assertable one and the accessible one (`client/INSIGHTS.md`, 2026-08-19).

Styling is `styles.ts` exporting a `const s` of `CSSProperties` built from CSS custom properties. Only tokens actually declared in `src/vendor/ui/styles.css` exist — there is no `--bg` and no `--text-tertiary`, and an undefined custom property silently drops. Long single-line commands and deep paths must wrap or scroll rather than overflow their row (EC-15).

**Skill:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`
**Invariant:** `DDG-UI-001` (this is new rendering — worth a look in the running app), `DDG-DNT-002` (`vendor/ui` is not touched)

**Acceptance.** A body containing `## Heading`, `- item` and a fenced block renders a heading element, a list element and a code block, visually distinct from body text. A section carrying a valid diagram string reaches the diagram renderer rather than printing it as text; an invalid one leaves the body and links rendered with an inline notice where the diagram would be. A copy control places the command string on the clipboard verbatim, including any trailing comment, and nothing is executed. Every `Open` target carries the tour's recorded SHA rather than a branch name. Every control is tab-reachable and has an accessible name.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t9.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t9.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && grep -rn "vendor/ui/primitives/Markdown\|useQuery\|fetch(" "src/app/repos/[repoId]/onboarding/_components/TourSection/"
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/eslint "src/app/repos/[repoId]/onboarding/_components/TourSection/TourSection.tsx" "src/app/repos/[repoId]/onboarding/_components/TourSection/index.ts" "src/app/repos/[repoId]/onboarding/_components/TourSection/styles.ts"
```

**Red flags.** Do not add a key to `messages/en/onboarding.json` — T3 owns it and wrote every key this card needs; if one is genuinely missing, report it rather than editing the file, because T10 reads the same namespace and two writers means a lost edit. Do not write a second `chars → tokens` or `github.com` URL helper; `githubBlobUrl` is in `src/lib/github-urls.ts`. `navigator.clipboard` does not exist in jsdom — the copy call must be guarded so the component does not throw in a test environment, and the `test-writer` stage will stub it.

---

### T10 — The Onboarding Tour screen and its route entry

**Satisfies:** AC-33, AC-34, AC-35, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46
**Depends-on:** T3, T7, T9
**Owned paths:** `client/src/app/repos/[repoId]/onboarding/page.tsx` (new), `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/**` (new)
**Forbidden:** `client/src/app/repos/[repoId]/onboarding/_components/TourSection/**` (T9 owns it — import through its barrel); `client/messages/**`; `client/src/lib/**`; `client/src/components/**`; `client/src/vendor/**`; every other route under `client/src/app/`; any lockfile.

**Change.** A thin route entry that awaits `params` and renders one view, matching `client/src/app/repos/[repoId]/context/page.tsx` in shape — **no `"use client"` on the entry** (the view carries the boundary), **no `<Suspense>` wrapper**, no `loading.tsx`, no per-segment `error.tsx`.

`OnboardingView` is a colocated feature unit (`<Name>/{<Name>.tsx, index.ts, styles.ts, …}`, imported through its barrel) that reads `useOnboardingTour` / `useGenerateOnboarding` from T7 and renders, as **early returns** rather than nested ternaries:

- a skeleton while loading (the vendored `Skeleton` is a bare `div.skeleton` with no role or aria);
- an inline error, on this screen, when the request fails — with the sidebar and breadcrumb still in the tree (AC-44). `AppShell` mounts cleanly in jsdom with only `vi.mock("next/navigation")`, a `QueryClient` and the `shell` namespace, so that promise is assertable against the real shell (`client/INSIGHTS.md`, 2026-08-19);
- **one** empty state offering generation when the state is `never_generated` — and **not** five empty section cards (AC-33), reading T3's reworded `generate.body`;
- a running indicator while the state is `running`, with the shell still navigable (AC-34). Nothing here owns a timer; the hook's `refetchInterval` clears the state;
- otherwise the tour: a header carrying the title, the files-generated-from and age caption from the tour's own recorded values (AC-40), a `Regenerate` control, a `Share link` control that copies `window.location.href` and nothing else (AC-46 — no token, no alternate host, no expiring parameter, and no request leaves the browser), a notice **above** the sections when the tour is stale, partial or degraded, naming the reason through T7's map with its generic fallback (AC-41, AC-42, AC-43), an on-this-page rail with one link per section resolving to that section's heading id, and the five `TourSection` cards **in the order the server returned them** (AC-35) — never re-sorted client-side, because the order is the contract's.

Every control on the screen is keyboard-operable with an accessible name (AC-45).

**Skill:** `next-best-practices`, `frontend-ui-architecture`, `react-best-practices`, `typescript-expert`
**Invariant:** `DDG-UI-001` (a new route — a blank first paint is invisible to every gate; look at it with `/run`)

**Acceptance.** With no tour, one empty state renders and five empty section cards do not. While running, the running indicator renders and the sidebar links are still present and clickable in the same tree. With a tour, five section headings render in server order and the rail carries five links that resolve to them. A stale or partial tour shows the notice **and** all five sections at once. A degraded tour shows the skeleton's sections under a notice naming the cause, with copy that does not read as a complete tour. An unknown reason renders the generic sentence, not an enum literal and not a message-key path. A failed request renders the error inside the screen with the shell intact. `Share link` writes this screen's URL to the clipboard.

**Done-condition:**
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run > /tmp/t10.txt 2>&1; echo "rc=$?"; tail -15 /tmp/t10.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && grep -rn "Suspense\|fetch(" "src/app/repos/[repoId]/onboarding/page.tsx" "src/app/repos/[repoId]/onboarding/_components/OnboardingView/"
# 0 lines = pass
cd /Users/krasymyr.tretiak/Work/dev-digest/client && wc -l "src/app/repos/[repoId]/onboarding/page.tsx"
# 7-17 lines, matching every other route entry
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/eslint "src/app/repos/[repoId]/onboarding/page.tsx" "src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.tsx" "src/app/repos/[repoId]/onboarding/_components/OnboardingView/index.ts" "src/app/repos/[repoId]/onboarding/_components/OnboardingView/styles.ts"
```

**Red flags.** Do not add a `<Suspense fallback={null}>` around the view: that rule applies to statically prerendered routes, every route here is dynamic because of `[repoId]`, and the boundary makes the server emit the fallback **instead of** the screen — a blank first paint that typecheck, `next build` and the unit suite all stayed green through once already (`client/INSIGHTS.md`, 2026-08-04). Do not re-sort the sections. Do not add keys to the message namespace. `navigator.clipboard` is absent in jsdom — guard the share call.

## Contracts & wiring

- **`vendor/shared` — a change IS needed, and it is the loudest item in this plan.** Eight **new** types are required, as one new file added identically to `server/src/vendor/shared/contracts/` and `client/src/vendor/shared/contracts/`, plus one barrel line and one doc-comment line in each. That is four files across two do-not-touch zones. Root `CLAUDE.md` permits it only *"when a change is agreed… extend with a new file rather than reshaping an existing symbol"*, and `specs/onboarding-generator.md` `## Contracts` is that agreement, in writing, approved by a human on 2026-08-19 — including OQ-14, which records that the rule was answered by the repository rather than by a product decision. T1 owns all four files and no other task may touch them. **`Onboarding`, `OnboardingSection` and `OnboardingLink` are deliberately untouched and are not a cleanup item.** If any task finds it needs an existing symbol reshaped, that is `Status: blocked` — a human decision, not a quiet edit.
- **`client/src/vendor/ui/nav.ts` — one item appended.** A third do-not-touch zone, entered under that file's own written carve-out at lines 22–32. `Sidebar.tsx` imports `NAV` directly with no prop and no override hook, so there is no app-level way to add a nav entry. T3 owns it, and its Done-condition asserts exactly one changed file under `src/vendor/ui/`.
- **`FeatureModelId`, `FEATURE_MODELS` and `client/src/lib/feature-models.ts` are untouched.** The registry lives in three places that must change together (`client/INSIGHTS.md`, 2026-08-06) — and all three already carry the `onboarding` entry with an OpenRouter default, which is the only kind Settings → Feature Models can ever write back. This feature is its first consumer, and inherits an untested code path in `resolveFeatureModel` (`server/INSIGHTS.md`, 2026-08-06, on the identical situation for `conventions`).
- **`SettingsKnown` is not extended.** `sync_to_folder` already exists on it and this feature does not act on it (N4). It stays unread, exactly as today.
- **`server/src/modules/index.ts`** — one import and one registry entry, in T8. Without it the module mounts nowhere and both client hooks 404 with no error (`DDG-WIRE-001`).
- **`server/src/platform/container.ts`** — one lazy getter and one `ContainerOverrides` field, in T8, following the `projectContext` entry. This is what lets the `test-writer` stage inject a fake without a database.
- **The `GitClient` port is not widened.** T4 extends the existing `ConfinedRepoDocReader` adapter, which the container already exposes as `container.repoDocs`, and the consuming module declares the shape it needs structurally — the arrangement `modules/intent` and `modules/project-context` both already use.
- **Migrations** — generated from `src/db/schema/` in T2. `src/db/migrations/` is never hand-edited, and no task runs `db:migrate`. See the next section.

## Applying the migration

**This is a step, not a task, and no implementer performs it.** It needs a live Postgres, which no hermetic gate has — and that is exactly why it is written down. `server/INSIGHTS.md` (2026-08-19) records the failure this closes: Project Context shipped `0017_*.sql`, `DDG-WIRE-003` was satisfied, `/pr-self-review` recorded a clean verdict, and the screen answered `500 internal_error` the moment it was opened, because **no hermetic test can tell "schema shipped" from "schema applied"** — services take their repository through `ContainerOverrides`, so the suite proves the call shape against a fake and never touches Postgres.

After the waves, before the feature is exercised in the running app:

```sh
# 1. The docker-compose Postgres must be up (migrations never run on boot).
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsx src/db/migrate.ts

# 2. Confirm the columns exist, by query rather than by reading code:
#    select column_name from information_schema.columns where table_name = 'onboarding';
#    → expect repo_id, json, generated_at plus the fourteen T2 adds.
```

Read the status code first if the screen misbehaves: **`404` means the module is not registered in `modules/index.ts`; `500` on a route that exists, right after a feature that adds columns, means the migration was never applied.**

## Tests

Every row carries an `Owner`, and it is one of two words. `test-writer` means the path belongs to that agent's dispatch, which runs **after** the implementer waves, and **no implementer may create or edit it**. `implementer` appears exactly once, for a test file that is *moved*, not authored.

Every row is hermetic: **no `*.it.test.ts` and no `e2e` flow appears anywhere**, because Docker is not authorised on this run. A server test filename must **not** contain `.it.` — `.github/workflows/server-unit.yml` and `server-integration.yml` filter on exactly that substring, so a misnamed file lands in the hermetic lane and fails there (`DDG-TEST-001`).

| Test | Owner | Covers | Why |
|---|---|---|---|
| `client/src/components/document-markdown/DocumentMarkdown.test.tsx` | `implementer` (T5) | — | **Moved, not written.** The existing Project Context test travels with the component; only its import path may change |
| `server/test/onboarding-facts.test.ts` | `test-writer` | AC-5, AC-6, AC-7, AC-16, AC-18, AC-19 | pure functions plus a fixture facade; the rank-vs-alphabetical fixture AC-5 names, the junk-filter fixture AC-6 names, and the `DegradedReason → OnboardingReason` table |
| `server/test/onboarding-commands.test.ts` | `test-writer` | AC-20, AC-21, AC-22 | a `mkdtemp` fixture clone in the shape `test/project-context-walk.test.ts` and `test/indexer-walk.test.ts` already use; the README-suggests-`curl`-and-`package.json`-declares-`dev` case, EC-7's monorepo, EC-8's empty case, and the confinement pair — an escaping symlink omitted **and** an in-clone symlink still found (`server/INSIGHTS.md`, 2026-08-19: a negative-only assertion is satisfied by a blanket skip) |
| `server/test/onboarding-service.test.ts` | `test-writer` | AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-14, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, **EC-21** | service against fakes injected through `ContainerOverrides`; `MockLLMProvider.calls` counts provider calls — **this is AC-9's real proof, not T8's `grep`**; a hundred reads leaving `generated_at` unchanged; the twenty-first-tasks-becomes-six-whole-tasks case; and **EC-21** — a repository-gone-mid-generation fake completes silently, writing nothing and logging no failure, which is asserted by the write fake recording zero calls rather than by the absence of a throw |
| `server/test/onboarding-degraded.test.ts` | `test-writer` | AC-10, AC-11, AC-15, AC-16, AC-17 | the three failure providers — throwing, never-resolving, `{}`-returning — declared **locally in the file**, because the shipped `MockLLMProvider` always resolves with `attempts: 1` and cannot express any of them. Also the zero-calls-when-unindexed assertion, which no status assertion can see |
| `server/test/onboarding-prompt.test.ts` | `test-writer` | AC-13, AC-23, AC-24 | asserts the recorded messages: every fact block inside `<untrusted …>`, the system message equal to the rendered template and nothing else, and one log line carrying all five figures |
| `client/src/components/app-shell/helpers.test.ts` | `test-writer` | AC-32 | new file; `activeKeyFor("/onboarding")` and `activeKeyFor("/repos/x/onboarding")`. There is no test on this helper today |
| `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.test.tsx` | `test-writer` | AC-31, AC-33, AC-34, AC-35, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46 | one flow test per state; mounts the real `AppShell` for AC-34/AC-44's "the shell stays navigable"; `fireEvent`, not `userEvent`; `navigator.clipboard` stubbed for AC-46 |
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/TourSection.test.tsx` | `test-writer` | AC-35, AC-36, AC-37, AC-38, AC-39, AC-45, AC-47 | `## H` + `- a` + a fenced block render a heading, a list item and a code block; a valid diagram reaches the (mocked) diagram renderer and an invalid one leaves the body rendered with a notice; the clipboard receives the command verbatim; the `Open` href carries the tour's SHA |
| `client/src/lib/hooks/onboarding.test.tsx` | `test-writer` | AC-34, AC-43 | stubs `fetch`, not `api`/`apiFetch` — the `intent.test.tsx` precedent, and the only shape that catches a mutation silently omitting a field; asserts the poll starts and stops on `generation_state` |
| `server/test/prompt-*.test.ts` — **existing, unchanged** | — | N2 (verification row) | `reviewer-core`'s `parseWithRepair`, `toJsonSchema` and `wrapUntrusted` are relied upon and untouched; the proof is `git diff --stat -- reviewer-core/` plus that package's own gates |

Two ACs are not `Verify: test` and are discharged without one: **AC-13** is `Verify: demonstration` (generate a tour and read the single log line — the `onboarding-prompt` row above asserts the shape, not the demonstration), **AC-22** is `Verify: analysis` (the two `grep` Done-conditions on T6 and T8), and **AC-19** is `Verify: inspection` (the vocabulary, read against `contracts/blast.ts`). **AC-45** is `Verify: demonstration` for activation and asserted for reachability, exactly as the spec's own criterion states.

## Verification

Run from inside each package. **Never `pnpm run <script>`** — pnpm's pre-script dep-status check shells out to `pnpm install`, trips this repo's supply-chain policy, and without a TTY can try to purge `node_modules` (`server/INSIGHTS.md`, 2026-08-02 / 2026-08-04). Export `CI=true` for non-TTY invocations.

```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  > /tmp/v-server.txt 2>&1; echo "rc=$?"; tail -15 /tmp/v-server.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/tsc --noEmit
cd /Users/krasymyr.tretiak/Work/dev-digest/client && ./node_modules/.bin/vitest run \
  > /tmp/v-client.txt 2>&1; echo "rc=$?"; tail -15 /tmp/v-client.txt
cd /Users/krasymyr.tretiak/Work/dev-digest/reviewer-core && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/krasymyr.tretiak/Work/dev-digest/reviewer-core && ./node_modules/.bin/vitest run --passWithNoTests
```

After the `test-writer` stage adds files under `server/test/`, one more — because **no test file in `server/` is typechecked by any gate** (`tsconfig.json`'s `include` is `["src/**/*.ts"]`), and a test can carry a real `error TS` while `vitest` is fully green (`server/INSIGHTS.md`, 2026-08-10 and 2026-08-19):

```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json 2>&1 | grep "^test/onboarding" | wc -l
# 0 = pass. This config carries pre-existing errors in OTHER test files; filter to this
# feature's own rather than comparing a whole-project count that drifts.
```

Two more, from `gate.md` Part 1 (*Two invariants no tool here catches*). Use them as the Done-condition of any task that adds a relative import or a module — they are the only check for two CRITICALs `tsc --noEmit` cannot see:

```sh
# DDG-WIRE-002 — 0 lines = pass. grep exits 1 on no match; read the output, not $?.
cd /Users/krasymyr.tretiak/Work/dev-digest/server && grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \
  | grep -v "\.js'" | grep -v '^src/db/schema'

# DDG-WIRE-001 — a module that mounts nowhere. TWO checks, because the import and the
# registry entry are two separate edits and the second is the one people forget: the
# registry holds BARE IDENTIFIERS, so the quoted path exists only on the import line.
cd /Users/krasymyr.tretiak/Work/dev-digest/server && for m in $(ls -d src/modules/*/ | xargs -n1 basename | grep -v '^_'); do
  [ -f "src/modules/$m/routes.ts" ] || continue
  ident=$(grep -oE "^import ([A-Za-z0-9_]+) from '\./$m/routes\.js'" src/modules/index.ts | awk '{print $2}')
  [ -n "$ident" ] || { echo "NOT IMPORTED: $m"; continue; }
  grep -qE "^  $ident,?$" src/modules/index.ts || echo "IMPORTED BUT NOT IN REGISTRY: $m"
done
```

Write these into a Done-condition with `grep`, never `rg`: there is **no `rg` binary on this machine** — it is a shell function the harness provides — so an `rg` command fails the moment anything runs it outside an agent's Bash tool, in a script, or in CI. The `-a` is load-bearing: two `.ts` files in `server/src` contain a literal NUL byte, and without it `grep` prints "Binary file … matches" and shows no lines, silently scanning two real source files fewer than it claims.

For `eslint`, **list the changed paths literally**. zsh does not word-split an unquoted variable, so `eslint $CHANGED` passes one argument and exits 2 with `No files matching the pattern` — an exit code that reads as a lint failure but means nothing ran.

Not part of this plan and not to be run: `./node_modules/.bin/vitest run .it.test` (needs Docker), `CI=true ../scripts/e2e.sh` (needs Docker; its default `:5433` collides with a second local Postgres and exits 125 before a single flow), and `next build` (it writes the same `client/.next` a running `next dev` owns and corrupts it).

## Non-goals

Restated from the spec's `## Goals / Non-goals` so a later reader does not "fix" a deliberate omission. Each is a decision, not a scheduling gap.

- **N1** No onboarding to DevDigest itself. The tour is about the **repository under review**; the table is keyed by `repo_id` and the entry sits in the repository-scoped `WORKSPACE` group.
- **N2** **No change to `reviewer-core`.** `parseWithRepair`, `toJsonSchema` and `wrapUntrusted` are relied upon and unchanged.
- **N3** No more than one structured model call per generation. No file-selection pass, no per-section call, no map-reduce.
- **N4** **Nothing is written into the repository.** The tour lives in the database only, and `sync_to_folder` stays unread — the clone is `git reset --hard`'d by the next resync and the `GitClient` port has no write method at all.
- **N5** No automatic or scheduled regeneration. A tour is generated when a person asks for it.
- **N6** **`hotness` stays `0`.** The reading path is ordered by `rank`, which *is* `pagerank × (1 + hotness)` by definition; its recency half is inert today. Switching it on means deepening the clone or adding a commit-history pass — an **indexing-pipeline** change, out of scope.
- **N7** No per-user, per-branch or per-PR tour. One tour per repository, shared across the workspace, so a regeneration replaces what a colleague was reading.
- **N8** No tour history or versions. A generation replaces the stored tour.
- **N9** No file viewer inside DevDigest. `Open` links out.
- **N10** **Nothing is executed** — not a command this system derived, not a command the model returned.
- **N11** No `routes_and_apis` section. The endpoint facts feed `architecture` instead.
- **N12** No translation. English, filled as a constant, with no picker.
- **N13** No cost or usage screen. The call count and cost are recorded and logged; putting them on the tour screen is a proposal.
- **N14** No shared or public tour link. `Share link` copies this screen's URL and nothing else.
- Additionally, and not from the spec: **no new dependency in any package**, **no `.it.test.ts` and no e2e flow on this run** (Docker is not authorised), and **no change to the indexing pipeline** — `INDEXER_VERSION` is not bumped, so no reindex is triggered.

## Assumptions

Everything below is a decision an implementer would otherwise make silently and differently. None of them is a requirement, and none of them is an AC.

1. **Module directory `onboarding`, registry key `onboarding`, routes `/repos/:id/onboarding` and `/repos/:id/onboarding/generate`.** The route shape follows `/repos/:id/conventions` + `/repos/:id/conventions/scan`: a tour is a property of a repository. The client route is `/repos/[repoId]/onboarding`, which is what makes T3's active-key fix necessary and sufficient.
2. **The stored body stays in the existing `json` column; only provenance becomes columns.** Sections are a document read whole; status, state and the five figures are queried and updated independently. This is `pr_intent`'s split exactly.
3. **A command is the invocation, not the script body.** `npm run <name>` (or `pnpm run <name>` / `yarn <name>` when a sibling `pnpm-lock.yaml` / `yarn.lock` says so), `make <target>`, `docker compose -f <path> up <service>`. Showing the invocation rather than a `package.json` script's body keeps EC-10's risk to what the repository itself declares behind a name the reader can look up, and AC-21's declaring path is what lets them.
4. **Rate limits are per-route `config.rateLimit`**, layered under the global `max: 120, timeWindow: '1 minute'`: the read at `60/minute`, the generate at `5/hour` with a `keyGenerator` on the repository id so the cap is per repository as `## Non-functional` states. The plugin keys on IP by default, which would not express "per repository".
5. **The model-facing schema is named `OnboardingDraft`**, kept in `modules/onboarding/schemas.ts` and deliberately distinct from the contract's `OnboardingTour` — the same separation `ConventionExtraction` keeps from `ExtractedConvention`, and for the same reason: one is what the model claimed, the other is what survived. `ONBOARDING_SCHEMA_NAME` must equal it verbatim, because `MockLLMProvider.structuredBySchema` keys its fixtures on that string and a mismatch silently falls back to the generic fixture instead of erroring.
6. **`src/prompts/onboarding.system.md` loses its two `routes_and_apis` clauses (lines 8 and 23) and nothing else.** N11 removed that section; an instruction about a section absent from `{{sections}}` invites a sixth section the contract then drops. Cheap to revert if you would rather the template stay byte-frozen.
7. **A first task naming a directory is confirmed by prefix** against the paths the tour was built from (the ranked sample, the chains, the endpoint-fact files and the command sources), because `file_rank` holds files and not directories. A file-shaped path is confirmed exactly, via `getFileRank`. The limitation: a directory outside the fact set is dropped even if it exists in the repository. Widening this would need a facade read of every indexed path, which is a second `getRankedPaths(repoId, 100_000)` per generation.
8. **`Open` does not render when the tour has no recorded SHA.** A degraded tour generated with no index has none, and a link to a branch would contradict AC-47's whole point.
9. **The generation logger is an optional pino-shaped dependency, passed as `app.log` when `routes.ts` constructs the service at boot** — the `IntentWarnLogger` shape. The service invents no sink of its own, because that would put a second one next to the caller's.
10. **The `regenerate` / `regenerating` / `unknownError` keys already in `onboarding.json` are kept and used** rather than renamed; only `generate.body` changes wording, because EC-26 makes it untrue.

## Open questions & recommendations

**Decided before dispatch.** The spec's own `## Open questions` is empty — all fourteen were resolved on 2026-08-19 and it was approved by a human. The three items below are gaps **this plan** found while mapping the spec onto the tree; each was answered by the parent before any implementer ran, and each is now a decision the tasks above are written against.

1. **AC-4's refusal carries 422, via `ValidationError`.** There is no `ConflictError` in `server/src/platform/errors.ts`, and the one existing "already running" refusal in this server is `ConventionsService.requestScan`'s `ValidationError`, which is **422**. **No `ConflictError` is added and `server/src/platform/errors.ts` stays untouched.** AC-4's observable says "one accepted response and one conflict" — *conflict* there is descriptive, not an HTTP status, so 422 satisfies it. A cross-model reviewer reading 422-for-a-conflict as a defect should read this line: it is the repository's own precedent, chosen over inventing an error class no other module uses. The client hook may still branch on `ApiError.status`; 422 is the value it will see.
2. **One `Regenerate` control, always enabled — including on a degraded tour.** AC-42 requires the degraded skeleton under a notice naming the cause; nothing says the regenerate control must differ. A degraded tour is exactly the case a user wants to retry, and disabling it after a `model_timeout` would strand them. T10 renders one control in every state.
3. **The `g o` keyboard shortcut is added**, as T3 already describes — `gKey: "o"` on the `NAV` item plus its `SHORTCUTS` row, following what `context` did with `g x`. Two lines, inside the same `vendor/ui/nav.ts` carve-out T3 is already entering.

**Recommendations** — advice, not requirements. The plan above follows the spec as written.

- **`getCriticalPaths` seeds from unfiltered ranks, and the reading path does not.** `getTopFilesByRank` applies `isJunkPath`; `getCriticalPaths` takes `ranked.slice(0, 5)` raw (`repo-intel/service.ts:853`). So a repository whose highest-ranked file is a config can produce a critical-path chain rooted at one, while EC-5's junk filter empties the reading path for the same repository — two sections disagreeing about what a real source file is, which is the very drift AC-6's *"reusing it is what keeps two features from disagreeing"* exists to prevent. This is **existing behaviour and out of this feature's scope**; AC-7 is written against it deliberately. Worth one line in `repo-intel`'s own backlog rather than a change here, because filtering the seeds would change Blast Radius's neighbourhood too.
- **`MockLLMProvider` cannot express three of this feature's five call outcomes**, and three test files will each declare their own throwing / hanging / schema-violating provider. That duplication is fine for one feature and starts to smell at two. If a second feature needs the same, the right move is `structuredThrows` / `structuredHangs` options on `adapters/mocks.ts`, in a task of its own where the diff is reviewable — not folded into a feature's test file. Not planned here.
- **`server/INSIGHTS.md` (2026-08-10) records that `resolveInRoot` in `conventions/verifier.ts` is a second, ungated copy of clone-path confinement.** This feature adds a **fourth** consumer of the one real adapter and does not add a fifth copy — but it also does not retire the `conventions` one, and that remains a security-relevant rule living in two places with a gate over neither. A one-task cleanup worth scheduling on its own.
- **Consider dispatching `plan-verifier` against T1 alone before waves 2–6 start.** It is the one task whose mistake propagates to every consumer in both packages, and the only one that writes four hand-synced files. Every later task's Done-condition would then be measuring against a contract that has already been checked. Cheap; say the word.

**One inaccuracy in the spec itself, found by the cross-model fact-check.** `specs/onboarding-generator.md`'s **EC-23** describes `renderTemplate` as *leaving* an unmatched `{{placeholder}}` in place. It does not — `modules/conventions/prompt.ts` replaces an unmatched placeholder with the **empty string**, which is why `TOUR_LANGUAGE` is a constant rather than an optional. The plan and the constant are right; the spec's parenthetical is wrong. It changes no acceptance criterion and blocks nothing, so it is a `doc-writer` amendment when the feature lands and `Status` moves to `implemented` — not a reason to reopen the spec now.

## Coverage

- **INSIGHTS server: 34 entries, 14 relevant** — 2026-08-06 (`StructuredRequest.timeoutMs` silently ignored, `maxRetries` defaults to 2 = three attempts, so a deadline race and an explicit retry count are BOTH required); 2026-08-06 (a discarded `job.done` killed the process; any `running` state needs a staleness window or a dead worker bricks the entity); 2026-08-06 (`drizzle-kit generate` blocks forever on an interactive rename prompt); 2026-08-06 (the conventions extractor was pre-wired in four places none of which mention the feature name — the exact shape this feature repeats, and the source of `getConventionSamples` being a one-line alias); 2026-08-19 (`drizzle-kit generate` ALWAYS rewrites `meta/_journal.json`, so "no `M` line" can never pass); 2026-08-19 (a feature can pass every gate and 500 on its first request because nothing applies its migration — the source of `## Applying the migration`); 2026-08-02 and 2026-08-19 (a jsonb column read by a cast arrives with keys absent; a `.nullish()` field is three states); 2026-08-10 (`modules-no-raw-sdk` does not list `node:fs`, and `GitClient.readFile` cannot express the post-`realpath` re-check); 2026-08-10 (no test file in this package is typechecked by any gate); 2026-08-14 (`import type` does not exempt a cross-module import — measured 22 → 24 warnings); 2026-08-10 (a helper taking the whole `Container` puts every caller into a cycle with the DI root — why `resolveFeatureModel` takes a `Db`); 2026-08-19 (a directory walk that skips every symlink passes the escape test for the wrong reason — the confinement test needs its pair); 2026-08-19 (an AC whose observable omits a case makes that case invisible downstream); 2026-08-02 / 2026-08-04 (`pnpm <script>` dies before the script runs; zsh's `PIPESTATUS` and word-splitting traps).
- **INSIGHTS client: 20 entries, 10 relevant** — 2026-08-05 (`<Markdown>` is inline-only, so a feature that renders a document ships its own renderer); 2026-08-10 (no `user-event`, no shared QueryClient helper, `Skeleton` has no role or aria, and a feature's copy goes in its own namespace); 2026-08-19 (jsdom synthesizes no click for Enter on a focused button — how AC-45 is actually asserted); 2026-08-19 (`AppShell` mounts cleanly with only `next/navigation` mocked, a `QueryClient` and the `shell` namespace — how AC-34 and AC-44 are asserted against the real shell); 2026-08-03 (client imports of `@devdigest/shared` must stay `import type`, or a 500 on every route while both suites stay green); 2026-08-03 (`next build` beside a running `next dev` corrupts it); 2026-08-04 (a `<Suspense>` boundary for `useSearchParams` shipped a blank first paint); 2026-08-06 and 2026-08-14 (an undefined CSS custom property silently drops — there is no `--bg`); 2026-08-06 (Feature Models can only write `provider: "openrouter"`, and the registry lives in three places); 2026-08-11 (a component composing a shared unit reads two namespaces and its tests must provide both).
- **INSIGHTS reviewer-core: 1 entry, 1 relevant** — 2026-08-07 (Anthropic via OpenRouter rejects numeric range keywords in a JSON schema; `toJsonSchema` strips them and `parseWithRepair` re-validates and reprompts — which is the repair round-trip AC-10 budgets for).
- Requirements: **47 ACs restated as plan-level groups, 0 invented, 0 marked `assumed default — confirm`** — every requirement is an approved AC of `specs/onboarding-generator.md` (`SPEC-02`, `approved`, `e2cd58c`). All 47 are covered: 45 by tasks, and AC-13 / AC-45 additionally by the demonstrations their own criteria specify.
- Gaps raised: 3 questions, 4 recommendations, 10 assumptions, 5 corrections where the tree and the dispatch's open items disagreed.
- Read in full this run: 28 files. Not opened: `e2e/`, `mcp-server/`, `.github/workflows/` beyond `server-unit.yml`'s path filter — all out of scope.

## Grounded in

`specs/onboarding-generator.md` (`SPEC-02`, `approved`), root `CLAUDE.md`, `server/CLAUDE.md`, `client/CLAUDE.md`, `reviewer-core/CLAUDE.md`, `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`, `.claude/skills/pr-self-review/routing.md`, `.claude/skills/pr-self-review/gate.md`, `.claude/.plans/project-context/plan.md` (shape only), `server/src/db/schema/context.ts`, `server/src/db/schema/reviews.ts`, `server/src/db/schema/knowledge.ts`, `server/src/db/migrations/0000_init.sql`, `server/src/vendor/shared/contracts/knowledge.ts`, `server/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/contracts/blast.ts`, `server/src/vendor/shared/adapters.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/index.ts`, `server/src/modules/index.ts`, `server/src/modules/repo-intel/service.ts`, `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/repository.ts`, `server/src/modules/repo-intel/constants.ts`, `server/src/modules/repo-intel/routes.ts`, `server/src/modules/conventions/{service,routes,constants,prompt,schemas}.ts`, `server/src/modules/intent/service.ts`, `server/src/modules/blast/service.ts`, `server/src/modules/_shared/{context,schemas}.ts`, `server/src/adapters/git/confined-doc.ts`, `server/src/adapters/mocks.ts`, `server/src/platform/{container,errors,jobs,prompt}.ts`, `server/src/prompts/onboarding.system.md`, `server/.dependency-cruiser.cjs`, `server/package.json`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`, `client/src/components/mermaid-diagram/MermaidDiagram.tsx`, `client/src/app/repos/[repoId]/context/_components/DocumentMarkdown/DocumentMarkdown.tsx`, `client/src/lib/github-urls.ts`, `client/src/lib/hooks/project-context.ts`, `client/src/lib/repo-context.tsx`, `client/messages/en/onboarding.json`, `client/messages/en/shell.json`, `client/src/app/onboarding/page.tsx`, `.github/workflows/server-unit.yml`.

## Cross-model review

Reviewed on 2026-08-19 by two independent Sonnet dispatches against a plan written by
Opus — one on acceptance-criterion coverage, wave independence and Done-condition
honesty, one fact-checking every claim the plan makes about this codebase.

Every premise below was **re-verified against the tree before the edit was written**;
where a column says `taken from reviewer`, the finding is a judgement about this document
rather than a claim about a file, so there was nothing to re-run.

| # | Finding | Severity | Verified how | What changed here |
|---|---|---|---|---|
| A | `resolveFeatureModel` is **not** consumed cross-module by `modules/intent` — that module declares `FeatureModelResolver` (`intent/sources.ts:156`) and calls an injected `deps.featureModel` (`service.ts:141`); the container satisfies the signature at `container.ts:238-244`. The module still importing it directly is `modules/conventions/service.ts:17`, an accepted pre-existing warning. | **CRITICAL** | re-verified — `grep -rn feature-models server/src/modules/` | Constraints bullet rewritten; the `## Verified facts` entry rewritten; **T8's instruction changed** from a direct `resolveFeatureModel(...)` call to the injected resolver, with the resolver added to T6's `types.ts`; new Done-condition `grep -rn "modules/settings" src/modules/onboarding/` → 0. As written before, T8 would have failed its own `depcruise` acceptance bar. |
| J | **EC-21 unhandled.** `onboarding.repo_id` is `ON DELETE cascade`, so a repository deleted mid-generation takes the `running` row with it — breaking both the completion upsert *and* the `job.done.catch` bookkeeping that would record the failure. No task, no test. | **WARNING** | re-verified — cascade confirmed in `db/schema/context.ts` | New bullet in T8's `service.ts`: re-read the repository before persisting, return silently when gone, and **do not** wrap the upsert in a blanket `try/catch` (that would swallow real constraint violations too). Added to T8's `Acceptance` and to the `onboarding-service` row in `## Tests`. |
| B | The onboarding system prompt names `routes_and_apis` in **two** clauses, not three. | WARNING | re-verified — `grep -n routes_and_apis` → lines 8, 23 | Corrected in T8, in `## Verified facts` and in Assumption 6, each naming the two real lines, plus an explicit warning that the Mermaid-rules block does not mention it and must not be touched — it still governs the surviving `architecture` diagram. |
| C | Neither `Compass` nor `BookOpen` exists in the `IconName` union. | WARNING | re-verified — `grep` → no match in `client/src/vendor/ui/icons.tsx` | T3 now says so outright and names members that **do** exist (`Workflow`, `Boxes`, `ListChecks`), keeping the verify-before-writing instruction. |
| I | The module-registration check matched the **import line only**, so a module imported and then omitted from the `modules` record passed it — precisely the `DDG-WIRE-001` failure it exists to catch. | WARNING | re-verified — the registry holds bare identifiers; **the replacement was executed against the real tree and reports clean on all 15 modules** | Both copies (T8's Done-condition and `## Verification`) replaced with a two-stage check: resolve the imported identifier, then require its membership in the record. |
| G | Nothing measured T2's own column set — `tsc` only sees a column the code references. | WARNING | taken from reviewer | T2 gains two Done-conditions over the generated `.sql`: `ADD COLUMN` count = 14, and a per-name loop printing `MISSING COLUMN:`. |
| H | `grep -c completeStructured` = 1 proves one call **site**, not one call; a call inside a loop passes. | WARNING | taken from reviewer | Kept (a second call site is the likeliest break and this catches it free) but relabelled as a smoke check, pointing at `MockLLMProvider.calls` in `onboarding-service.test.ts` as AC-9's real proof. `## Tests` now says so too. |
| E | T3 declared `Depends-on: —` while needing T1's `OnboardingReason` enum for its message keys. | WARNING | taken from reviewer | `Depends-on: T1`, with the reason. Changes no wave ordering — it makes the declaration true. |
| F | T3's key list omitted the diagram-unavailable string that T9 must pass as `MermaidDiagram`'s `fallback`, while T9 is forbidden from adding keys. | WARNING | taken from reviewer | Added to T3's enumerated list, tagged AC-38. |
| D | T4 described `getFileFacts` as returning `{ file, ... }`. | SUGGESTION | re-verified — `IndexerFileFactsRow` at `repo-intel/repository.ts:99` | Corrected to `filePath`. |
| K | `(enabling)` was used on T4/T5/T7 but not on T1/T2/T3, whose contributions are the same kind. | SUGGESTION | taken from reviewer | Markers added to all three. No AC removed from any `Satisfies` line — the matrix `plan-verifier` walks now distinguishes the task that defines a type from the task that satisfies the criterion. |
| L | `application-no-db-schema` / `routes-no-data-access` read as hard gates; both are `warn` with pre-existing drift. And the **spec's own EC-23** misdescribes `renderTemplate`, which replaces an unmatched placeholder with the empty string rather than leaving it. | SUGGESTION | re-verified — `renderTemplate` in `modules/conventions/prompt.ts` | The Architecture bullet now says the severity and warns against adopting inherited warnings; the EC-23 inaccuracy is recorded under the recommendations as a `doc-writer` amendment for when the feature lands, not a blocker. |

**Checked and needing no change** — recorded because a review that lists only faults
misrepresents what was examined:

- **Every one of the ~40 `path:line` citations spot-checked was confirmed exact**, across both reviewers and both packages — `repo-intel` (`:813`, `:837`, `:592`, `:572`), `confined-doc.ts` (`:304-307`, `:218-240`, `:42-45`), `blast/service.ts` (`:86-99`, `:356-363`), `intent/service.ts` (`:147-172`), `platform/jobs.ts:41`, `platform/errors.ts` (404/422/502/500, no `ConflictError`), `MermaidDiagram.tsx:59`, `DocPreview.tsx:20`, `github-urls.ts:24`, `hooks/conventions.ts:38`, `app.ts:96`, `settings/routes.ts:45`. Every named constant matched its value (`MAX_INDEXED_FILES=5000`, `BFS_DEPTH=2`, `INDEXER_VERSION=3`, `CRITICAL_PATH_ROOTS=5`, `EXCLUDED_DIRS` at 8 entries with no `.pnpm-store`). All nine gate binaries exist at the paths given. The two `vendor/shared/index.ts` barrels `diff` clean today, as claimed.
- **The three "discharged without a test" claims match the spec's own `Verify:` hints exactly** — AC-13 `demonstration`, AC-22 `analysis`, AC-19 `inspection` — and AC-45's split is quoted from the spec's own criterion. No mismatch between plan and spec was found here.
- **All 47 acceptance criteria are claimed by at least one task**; there is no open row. Waves 2–5 are each exactly one server task and one client task, so the plan's own disjointness rule holds by construction, and no same-wave Owned-path overlap exists.
- Two SUGGESTION-level greps were left as they are: T6's `node:fs` check is labelled AC-22 when it is really the `modules-no-raw-sdk` blind spot (the AC-22 check is the `child_process|execFile|spawn\(|exec\(` line directly below it, correctly labelled), and that pattern would miss an `exec` alias imported under a different local name. Neither changes what an implementer does.

**Not covered by either review:** no Done-condition was executed against a deliberately
broken implementation (no code exists yet), so every grep verdict above is static
reasoning about the pattern plus, for the registration check, one run against the
current clean tree. The dated `INSIGHTS.md` citations were spot-checked rather than
re-verified line for line.
