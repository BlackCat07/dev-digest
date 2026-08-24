# Stage 3 — wave 2 — T2: the `onboarding` table's provenance columns, and their migration

**Status: complete.**

As of `a64a1b0` (`L05-spec-driven-development`); 1 file changed, 2 added (one of them generated), 1 generated file modified. Nothing committed — the work is left uncommitted in the worktree.

## Coverage

- INSIGHTS server: 51 entries, 5 relevant (2026-08-06 — `drizzle-kit generate` blocks forever on an interactive rename prompt when one migration both drops and adds columns; 2026-08-19 — `drizzle-kit generate` ALWAYS rewrites `migrations/meta/_journal.json`, so the check is "no `M` line against a `.sql` file"; 2026-08-02 — `pnpm <script>` can die before the script runs, use `./node_modules/.bin/`; 2026-08-04 — zsh does not word-split an unquoted variable and `${PIPESTATUS[0]}` is empty; 2026-08-19 — a feature can pass every gate and still 500 because nothing applies the migration it ships, which is why `db:migrate` is a post-wave step and was not run).
- INSIGHTS client: not read — no client file is in T2's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `drizzle-orm-patterns` | preloaded (+ `references/schema-definition.md`, `references/migrations.md`) | `server/src/db/schema/context.ts` |
| `postgresql-table-design` | preloaded (whole skill) | `server/src/db/schema/context.ts`, `server/src/db/migrations/0018_wide_morbius.sql` |
| `typescript-expert` | preloaded | `server/src/db/schema/context.ts` |
| `onion-architecture` | preloaded | `server/src/db/schema/context.ts` — infrastructure ring; the type-only import of the ports ring points inward |

Matches T2's row in the plan's `## Skills the implementer must load`: yes (`drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert`), plus `onion-architecture`, whose row matches any `server/src/**` file.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/db/schema/context.ts` | T2 | yes | `onboarding` table only: 14 added columns, `$type<{ sections: OnboardingTourSection[] }>()` on `json` via a type-only `@devdigest/shared` import, `doublePrecision` added to the pg-core import list, and a table doc-comment mirroring `pr_intent`. `code_chunks`, `symbols`, `references` untouched. |
| `server/src/db/migrations/0018_wide_morbius.sql` | T2 | generated | `./node_modules/.bin/drizzle-kit generate` — 14 `ALTER TABLE "onboarding" ADD COLUMN`, nothing else. Not hand-edited. |
| `server/src/db/migrations/meta/0018_snapshot.json` | T2 | generated | same generate |
| `server/src/db/migrations/meta/_journal.json` | T2 | generated | same generate — every generate rewrites it (`server/INSIGHTS.md`, 2026-08-19) |

Columns added, all 14 nullable or with a non-volatile default, so the `ALTER TABLE` does not rewrite: `state` (`text` enum `running|ready`, NOT NULL, default `'ready'`), `status` (`text` enum `ok|partial|degraded`, NOT NULL, default `'degraded'`), `reason`, `indexed_sha`, `files_indexed`/`files_skipped` (`integer`, NOT NULL, default `0`), `provider`, `model`, `attempts`, `tokens_in`, `tokens_out` (`integer`, nullable), `cost_usd` (`double precision`, nullable), `started_at` (`timestamp with time zone`, nullable), `error`. No new index — `repo_id` is the PK. No Postgres `enum` type.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-12 (enabling) — provenance columns `provider`, `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd` | T2 | yes |
| AC-25 (enabling) — `indexed_sha` | T2 | yes |
| AC-28 (enabling) — `state`, `started_at` for the single stored tour and its running window | T2 | yes |
| AC-40 (enabling) — `files_indexed`, `files_skipped` | T2 | yes |

Task-level Acceptance from the plan: `onboarding` carries the 14 added columns plus the 3 it had — yes. Exactly one new `.sql` file, containing only `ALTER TABLE "onboarding" ADD COLUMN` — yes; no `DROP`, no `ALTER COLUMN`, no statement naming another table.

## Deviations from the plan

- **T2** — the plan asked for "a one-line comment saying what reads it" per column. Three pairs whose readers are identical share one comment (`files_indexed`/`files_skipped`, `provider`/`model`, `tokens_in`/`tokens_out`), and a table-level doc-comment carries the four facts that apply to the whole table (no index, `never_generated` is the absence of a row, `text(..., { enum })` emits a plain column, non-volatile defaults). This mirrors `pr_intent` (`reviews.ts:139-179`), which the task says to follow column for column. No column is uncommented and nothing about the emitted SQL changes.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0, no output |
| server | migration generate | `./node_modules/.bin/drizzle-kit generate` | pass — rc=0, `[✓] Your SQL migration file ➜ src/db/migrations/0018_wide_morbius.sql`. The interactive rename prompt did **not** fire. |
| server | migration shape | `git status --short src/db/migrations/` | pass — `?? 0018_wide_morbius.sql`, `?? meta/0018_snapshot.json`, `M meta/_journal.json`. No `M` line against a `.sql` file. |
| server | no DROP / ALTER COLUMN | `grep -c 'DROP\|ALTER COLUMN' "$(ls -t src/db/migrations/*.sql \| head -1)"` | pass — `0` |
| server | ADD COLUMN count | `SQL="$(ls -t src/db/migrations/*.sql \| head -1)" && grep -c 'ADD COLUMN' "$SQL"` | pass — `14` |
| server | per-column names | the 14-name `for c in … grep -q` loop | pass — no `MISSING COLUMN:` line |
| server | lint | `./node_modules/.bin/eslint src/db/schema/context.ts` | pass — rc=0, no output |
| server | onion (depcruise) | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings`, 212 modules. 22 is the pre-existing baseline recorded in `server/INSIGHTS.md` (2026-08-10/08-14); no new error and no new warning. |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 44 files, 563 tests, 0 failures |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | `DDG-WIRE-001` | the `for m in $(ls -d src/modules/*/ …)` loop from `gate.md` | pass — no `UNREGISTERED:` line |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not requested |
| client | — | — | gate did not run — no client file was touched (T3 owns the client half of this wave) |

## Not done

- `not checked` — the migration is **not applied**. `./node_modules/.bin/tsx src/db/migrate.ts` is the plan's `## Applying the migration` step, explicitly not an implementer's; `db:migrate` was not run and no Postgres was contacted.
- `not checked` — the server integration suite and the e2e flows. Both need Docker and neither was requested.
- `absent` — no repository, service or route reads the new columns yet; T8 writes and reads them.

## For the parent

- `client/src/vendor/ui/nav.ts` shows as `M` in the shared worktree. That is T3's concurrent wave-2 edit, not T2's; T2 touched nothing under `client/`.
- The generated migration is `0018_wide_morbius.sql`. Per `server/INSIGHTS.md` (2026-08-19), a hermetic gate cannot tell "schema shipped" from "schema applied" — the post-wave `tsx src/db/migrate.ts` step is still owed before the screen is opened, or the first real request will answer `500`.
- `plan-verifier` has not been run; it comes before `test-writer` and the review agents.

---

**Parent's independent re-run of T2's Done-conditions:** latest migration is `0018_wide_morbius.sql`; `ADD COLUMN` count 14; `DROP|ALTER COLUMN` count 0; the only table named in the file is `"onboarding"`; `git status src/db/migrations/` shows two `??` files and an `M` only on `meta/_journal.json`; `tsc --noEmit` clean.

**And, after all six waves, the parent performed the plan's `## Applying the migration` step** — `./node_modules/.bin/tsx src/db/migrate.ts`, then confirmed by querying `information_schema` rather than by reading code: the `onboarding` table now has **17 columns**, and all fourteen of T2's are present in the live database.
