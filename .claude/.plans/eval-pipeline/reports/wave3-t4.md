# Implementation report — Eval Pipeline (SPEC-04) / T4

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 2 files changed (1 hand-written, 1 generated), 2 files added (both generated), nothing committed. The two apply-the-migration steps were withheld from this task by the dispatch and did not run.

## Coverage

- INSIGHTS server: entries supplied verbatim in the brief, taken as read — 6 relevant (2026-08-19 — `drizzle-kit generate` always rewrites `migrations/meta/_journal.json`, so the gate is "no `M` line **against a `.sql` file**"; 2026-08-06 — `drizzle-kit generate` blocks forever on an interactive rename prompt when one migration both drops and adds in a table; 2026-08-02 / 2026-08-04 — a `pnpm <script>` pre-script shells out to `pnpm install` and dies on `[ERR_PNPM_IGNORED_BUILDS]`; 2026-08-19 — a feature can pass every gate and still `500`, because nothing applies the migration it ships; 2026-08-06 — ordering on a non-unique column returns rows in physical heap order and an update moves one; 2026-08-03 — Drizzle 0.38's `count()` maps to a real `number`). The supplied set named every hazard my Owned paths touch, including all three generation traps, so I did not open the file.
- INSIGHTS client: 0 relevant (supplied). INSIGHTS reviewer-core: 0 relevant (supplied). INSIGHTS e2e / mcp-server / evals: 0 relevant (supplied). No file in any of those packages was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `drizzle-orm-patterns` | preloaded | `server/src/db/schema/eval.ts` (+ `references/schema-definition.md`, `references/migrations.md`) |
| `postgresql-table-design` | preloaded | `server/src/db/schema/eval.ts` |
| `onion-architecture` | preloaded | `server/src/db/schema/eval.ts` — infrastructure ring; verified with the `depcruise` gate |
| `typescript-expert` | preloaded | `server/src/db/schema/eval.ts` |

Matches the plan's routing table for T4 (`drizzle-orm-patterns`, `postgresql-table-design`): yes, plus `onion-architecture` and `typescript-expert`, whose rows match a `server/src/**` `*.ts` file. The `zod`, `security` and `fastify-best-practices` rows did not match: the file declares no zod schema, handles no input, and is not a route. All eleven skills were present in context; none needed the `Skill` tool.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/db/schema/eval.ts` | T4 | yes | new `evalBatches` table (20 columns); `evalCases` +4 columns +3 indexes; `evalRuns` +7 columns +2 indexes; imports gain `index`, `./_shared`, `./agents` |
| `server/src/db/migrations/0020_short_the_anarchist.sql` | T4 | yes | **generated** by `./node_modules/.bin/drizzle-kit generate`, not hand-edited |
| `server/src/db/migrations/meta/0020_snapshot.json` | T4 | yes | **generated** |
| `server/src/db/migrations/meta/_journal.json` | T4 | yes | **generated** — rewritten on every `generate`, one entry appended |

Every column, enum member, nullability decision and all seven indexes come from T4's `Change:` block verbatim. `eval_batches.agent_id` is nullable with `ON DELETE SET NULL`; `eval_cases.source_finding_id` is nullable with **no** FK; `eval_runs.batch_id` is nullable with `ON DELETE CASCADE`. The three ordering indexes each carry a unique tiebreaker (`…, id desc` on `eval_batches`; `owner_id, name, id` on `eval_cases`).

Not changed, and verified untouched by `git diff --name-only`: `server/src/db/schema.ts`, `server/src/db/seed.ts`, `server/drizzle.config.ts`, `server/pnpm-workspace.yaml`, `server/pnpm-lock.yaml`, every other file under `server/src/db/schema/`. `server/pnpm-workspace.yaml` is tracked (`git ls-files` confirms) and its own header declares itself a settings file — left in place, per the dispatch.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| One new `.sql` migration | T4 | yes — `0020_short_the_anarchist.sql`, exactly one new `.sql` |
| Only `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX` — no `DROP`, no rename | T4 | yes — 1 `CREATE TABLE`, 11 `ADD COLUMN`, 3 `ADD CONSTRAINT` (FK), 7 `CREATE INDEX`; `grep -acE "DROP (COLUMN\|TABLE)"` on the new file = `0`; no rename prompt appeared |
| `information_schema` reports `eval_batches` present after the apply | T4 | not checked — the apply is withheld from this task by the dispatch |
| R1 (case provenance, anchors, owner) | T4 | yes — `expectation`, `source_finding_id`, `edited`, `created_at` on `eval_cases`; `owner_kind`/`owner_id` already shipped |
| R3 (set read in a total order, with most-recent execution) | T4 | yes — `eval_cases_owner_name_idx` (`owner_id, name, id`) and `eval_runs_case_ran_idx` (`case_id, ran_at desc`) |
| R6 (batch records version + prompt/model snapshot) | T4 | yes — `agent_version` notNull, `system_prompt_snapshot` notNull, `model_snapshot` notNull |
| R11 (metrics, counts, cost, timestamps; null ≠ zero) | T4 | yes — `cases_covered`/`cases_passed`, three `doublePrecision` metrics, the three tallies, `cost_usd`, `started_at` notNull / `finished_at` nullable, `error` — every metric and count nullable |
| R12 (history order, 50-batch retention) | T4 | yes — `eval_batches_agent_started_idx` (`agent_id, started_at desc, id desc`) serves both the order and the retention scan; `eval_runs.batch_id` cascades so a retention delete takes its case rows |
| R15 (cross-agent dashboard, agent-deleted batches readable) | T4 | yes — `eval_batches_workspace_started_idx`; `agent_id` nullable with `set null` |

## Deviations from the plan

- **Index names.** T4 named each index by its **columns**, not its identifier. I chose `eval_cases_owner_idx`, `eval_cases_source_finding_idx`, `eval_cases_owner_name_idx`, `eval_batches_agent_started_idx`, `eval_batches_workspace_started_idx`, `eval_runs_batch_idx`, `eval_runs_case_ran_idx` — the `<table>_<purpose>_idx` convention every neighbour uses (`reviews_pr_kind_created_idx`, `agent_runs_agent_idx`). Column lists are exactly as specified.
- **Index-callback style.** `drizzle-orm-patterns`' `references/schema-definition.md` shows the array form `(table) => [ index(…) ]`; all 12 existing schema files here use the object form `(t) => ({ name: index(…) })`, and I matched them. The repo convention wins over the general skill; both forms are supported by drizzle-orm 0.38.4 and the generated SQL is identical.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck (before first edit) | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — baseline clean, so no failure below is pre-existing |
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| server | migration generate | `./node_modules/.bin/drizzle-kit generate` (binary directly, `CI=true`, stdin `/dev/null`) | pass — `45 tables`, `eval_batches 20 columns 2 indexes 2 fks`, `eval_cases 14 columns 3 indexes`, `eval_runs 17 columns 2 indexes`; no interactive prompt |
| server | migration shape — one new `.sql`, no `M` against a `.sql` | `git status --short -- server/src/db/migrations \| grep '\.sql'` | pass — exactly one line, `?? …/0020_short_the_anarchist.sql`. It reads `??` rather than the plan's `A` only because nothing is staged and I do not run `git add`; the substance holds — one new `.sql`, and no `M` against any `.sql`. `meta/_journal.json` shows `M` and `meta/0020_snapshot.json` shows `??`, both expected |
| server | no `DROP` in the new migration | `grep -acE "DROP (COLUMN\|TABLE)" server/src/db/migrations/00*_*.sql \| tail -1` | pass — `…/0020_short_the_anarchist.sql:0` |
| server | lint | `./node_modules/.bin/eslint "src/db/schema/eval.ts"` | pass |
| server | onion (`depcruise`) | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings. 236 modules, 808 dependencies cruised.` Warnings held at the plan's baseline of 22; module count risen 234 → 236 (T2's scorer), so the new files were analysed |
| server | ESM extensions (`DDG-WIRE-002`) | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines. My two new relative imports (`./_shared`, `./agents`) are extensionless and sit inside the documented `src/db/schema*` exemption, matching all 54 neighbours |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 56 files, 741 tests passed, 0 failed, no `pre-existing` failure |
| server | apply the migration | `./node_modules/.bin/tsx src/db/migrate.ts` | gate did not run — withheld from this task by the dispatch |
| server | `information_schema` verification | the `node --input-type=module` query in T4's Done-condition | gate did not run — withheld from this task by the dispatch |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not requested; T4 has no test row |
| client | — | — | gate did not run — no client file was touched (another implementer owns `client/` this wave) |
| reviewer-core | — | — | gate did not run — no `reviewer-core` file was touched |

`DDG-WIRE-001` (static module registration) was not run: this diff adds no module under `src/modules/`.

## Not done

- `not checked` — whether `eval_batches` exists in the running development database. The apply and its `information_schema` query are the dispatch's, not mine.
- `absent` — no test file. T4 has no row in the plan's `## Tests`; the ordering and retention behaviour these indexes serve is `eval-order.it.test.ts`, owned by T6.
- `absent` — `evalBatches` is **not** listed in the `schema` object exported from `server/src/db/schema.ts`. That file is on my forbidden list, and the omission is harmless as things stand (see below).

## For the parent

- **`server/src/db/schema.ts` needs no edit for generation, and I confirm it — but with one caveat.** `export * from './schema/eval'` is what `drizzle-kit` reads, and it picked up `eval_batches` (the generate output lists it). The `schema` object below the re-exports, however, is passed to `drizzle(sql, { schema })` in `src/db/client.ts` and does **not** list `evalBatches`. That object only types the relational query API (`db.query.*`), and `grep -rn "db\.query\." src/` returns nothing — every repository uses the query builder. So T6 is unaffected as long as it stays with `db.select().from(evalBatches)`. If T6 reaches for `db.query.evalBatches`, that is a `schema.ts` edit nobody in this plan owns.
- **`eval_cases.expectation` is nullable at the database level, deliberately, and T6's Row → DTO mapper must supply the contract value.** T4's `Change:` block marks `edited` and `created_at` as `notNull` and says nothing about `expectation`; the plan's `## Non-goals` independently states "the new columns arrive nullable; nothing populates history". Both readings agree, so I did not add `.notNull()`. But `EvalAgentCase.expectation` in `server/src/vendor/shared/contracts/eval-batch.ts` is **not** nullable, so the repository has a real null to resolve when it maps a row. Worth naming explicitly to T6's implementer rather than leaving it to be rediscovered at the boundary.
- Candidate for `server/INSIGHTS.md`: on a clean, unstaged tree, T4's own migration-shape gate cannot produce the `A` line it predicts — `git status --short` reports a newly generated migration as `??`, and `A` only appears after a `git add` that an implementer is forbidden to run. The check that actually holds on an implementer's tree is "exactly one `.sql` line, and it is not `M`". Evidence: `git status --short -- server/src/db/migrations | grep '\.sql'` → `?? server/src/db/migrations/0020_short_the_anarchist.sql`.
- The migration is shipped, not applied. Per `server/INSIGHTS.md` (2026-08-19), a `500` on a new eval route later in the plan means exactly this step is still outstanding — the two withheld commands are the fix, and they are yours.
- `specs/eval-pipeline.md` was not read or edited; nothing in this diff contradicts an acceptance criterion I can observe from a schema file alone.
- `plan-verifier` has not been run, and neither have the remaining waves. Nothing was committed, staged, or pushed; no PR was opened.
