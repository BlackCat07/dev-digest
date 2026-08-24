# Implementation report — SPEC-03 PR Brief / T3

**Status: complete.**

Reported by the agent as of `34cb66e`; the run's actual base is `06d7488` — see the parent's
note at the end. 1 file changed, 2 added (one of them generated bookkeeping), nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 6 relevant (2026-08-19 — `drizzle-kit generate` always rewrites `migrations/meta/_journal.json`, so the gate is "no `M` line against a `.sql` file"; 2026-08-06 — `drizzle-kit generate` blocks forever on an interactive rename prompt when one migration both drops and adds in the same table; 2026-08-02 — `pnpm <script>` dies before the script runs, use `./node_modules/.bin/<tool>`; 2026-08-10 — no gate typechecks `server/test/`, 16 errors across 6 test files is the recorded baseline; 2026-08-19 — a migration shipped is not a migration applied, `500` on a route that exists is the tell; 2026-08-02 — a jsonb read back by cast rather than parse arrives with keys absent, not null).

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `drizzle-orm-patterns` | preloaded (+ `references/schema-definition.md`, `references/migrations.md` read) | `server/src/db/schema/reviews.ts` |
| `postgresql-table-design` | preloaded | `server/src/db/schema/reviews.ts` |
| `typescript-expert` | preloaded | `server/src/db/schema/reviews.ts` |
| `onion-architecture` | preloaded | `server/src/db/schema/reviews.ts` (infrastructure ring; no module or adapter edge added) |

Matches the plan's routing table: yes, plus `onion-architecture`, whose row matches `server/src/**` and which the plan did not name for T3.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/db/schema/reviews.ts` | T3 | yes | `pr_brief` gains the 15 columns T3 names; `json` gains `$type<StoredBriefBody>()`; new exported type `StoredBriefBody`; the existing type-only `@devdigest/shared` import gains `PrRiskBrief` |
| `server/src/db/migrations/0019_misty_terrax.sql` | T3 | generated | `./node_modules/.bin/drizzle-kit generate`, not hand-edited — 15 `ALTER TABLE "pr_brief" ADD COLUMN` statements and nothing else |
| `server/src/db/migrations/meta/0019_snapshot.json` | T3 | generated | same run, drizzle-kit bookkeeping |
| `server/src/db/migrations/meta/_journal.json` | T3 | generated | same run; the expected `M` line against a non-`.sql` file |

The four confirmations the dispatch asked for, all confirmed rather than changed:

- `head_sha`, `cache_key`, `attempts` are nullable on both sides — `.nullable()` in `server/src/vendor/shared/contracts/pr-brief.ts`, and `cache_key text` / `head_sha text` / `attempts integer` with no `.notNull()` in the schema. The generated SQL shows no `NOT NULL` on those three.
- The `state` column keeps two members (`['running','done']`) against the contract's three-member `BriefGenerationState`. Not harmonised; the asymmetry is now stated in the table's doc-comment ("`never_generated` is the ABSENCE of a row … That asymmetry is deliberate").
- `json` keeps a `$type<…>()` **cast**, and its doc-comment says so explicitly and names `safeParse` on the way out as the repository's job (T9).
- No `CHECK` constraint was hand-added for either `text({ enum })` column — drizzle emitted none, and the doc-comment repeats the warning `reviews.kind` and `pr_intent.status` already carry.

One thing worth flagging for T9, because the plan named a symbol that did not exist: `StoredBriefBody` appears nowhere in the tree, and `server/src/modules/brief/types.ts` (where a module-owned type would live) is T9's. I declared it in my own owned file, derived from the contract so it cannot drift:

```ts
export type StoredBriefBody = Pick<
  PrRiskBrief,
  'what' | 'why' | 'risks' | 'review_focus' | 'diff_stats' | 'sources'
>;
```

`db/schema.ts` re-exports `./schema/reviews` with `export *`, so T9's `repository.ts` can import it from `db/schema` like any table. The six fields are exactly the `PrRiskBrief` fields no column carries; the doc-comment enumerates which fields are columns and which are derived on read, so T9 does not have to re-derive that split.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 | T3 | yes — `cache_key` and `head_sha` exist and are nullable, so a read can compare a stored key against a computed one; the read behaviour itself is T9/T13 |
| R2 | T3 | yes — the key has a column to be stored in; the nine-value digest is computed in T11 |
| R4 | T3 | yes — `state` (`running`/`done`) plus `started_at` are the two columns the single-statement claim and the 5-minute staleness window read; the claim is T9 |
| R16 | T3 | yes — `provider`, `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd`, `status`, `reason`, `risk_level`, `generated_at`, `error` all present; `sources` stays in the payload |

T3's own three acceptance clauses: exactly one new `0019_*.sql` — yes (`git status` counts 1); it contains only `ALTER TABLE "pr_brief" ADD COLUMN` — yes (the exclusion grep prints 0 lines); no hand-added `CHECK` — yes.

## Deviations from the plan

- **T3** — `StoredBriefBody` is declared in `server/src/db/schema/reviews.ts` because the plan required the cast but no task creates the symbol, and the only alternative file (`modules/brief/types.ts`) is T9's. Mechanical: it is a `Pick` of the contract type the plan already fixed, in a file T3 owns, reachable through the existing `db/schema` barrel. Nothing another task reasoned about changes shape.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0, 0 errors |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/db/schema/reviews.ts"` | pass — rc=0 |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings)`, the baseline unchanged |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 49 files, 618 passed, 0 failed |
| server | migration generate | `CI=true ./node_modules/.bin/drizzle-kit generate < /dev/null` | pass — rc=0, no interactive prompt, `0019_misty_terrax.sql` |
| server | migration shape (no `M` against a `.sql`) | `git status --short -- src/db/migrations \| grep -E '^ ?M .*\.sql$'` | pass — 0 lines; the only `M` is `meta/_journal.json`, expected |
| server | migration shape (exactly one new `.sql`) | `git status --short --untracked-files=all -- src/db/migrations \| grep -cE '^\?\? .*\.sql$'` | pass — 1 |
| server | migration shape (additive only) | `grep -viE '^\s*$\|^--\|ALTER TABLE "pr_brief" ADD COLUMN' src/db/migrations/0019_*.sql` | pass — 0 lines |
| server | `DDG-WIRE-002` (ESM `.js`) | the `gate.md` grep | pass — 0 lines |
| server | `DDG-WIRE-001` (module registration) | the `gate.md` loop | pass — 0 `UNREGISTERED:` lines |
| server | typecheck incl. `test/` | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | `pre-existing` — 16 errors across 6 test files (`adapters`, `agents-versions.it`, `conventions.it`, `prompt-callers`, `repo-intel-facade-degraded`, `skills.it`), exactly the count and file set `server/INSIGHTS.md` (2026-08-10) records. No test file references `pr_brief`; not touched |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, explicitly not authorised |
| client | — | — | gate did not run — no client file was touched (T4 is another implementer's) |

## Not done

- `not checked` — `client/`. No client file is in T3's Owned paths, so I read no `client/INSIGHTS.md` and ran no client gate; `client/messages/en/prBrief.json` in the working tree is the other wave-3 implementer's.
- `absent` — no test ships with T3. The plan's `## Tests` table has no row for T3, and a generated migration has no behaviour a hermetic test can reach.
- `not checked` — the migration is **not applied**. That is T15's, in wave 11, deliberately.

## For the parent

- The migration ships but is not applied, and `server/INSIGHTS.md` (2026-08-19) records exactly what that costs if T15 is skipped: every gate green, `/pr-self-review` clean, and `500 internal_error` on the first real request. `0019_misty_terrax.sql` is the file T15 must land.
- `StoredBriefBody` now lives in `server/src/db/schema/reviews.ts` and is re-exported by `db/schema`. T9's dispatch should say so, because T9's `Owned paths` include `types.ts` and an implementer told to give `json` a body type will otherwise declare a second one there — and a module-side copy is exactly the drift the `Pick` was chosen to prevent.
- `specs/pr-brief.md` was not read or edited by me; T3 names no acceptance criterion I could contradict at the schema level, and EC-25's "`pr_id` + `json` and nothing else" is the *starting* state T3 widens, not a criterion the change breaks.
- `plan-verifier` has not been run. That is the next step after the wave and it is not mine.

---

## Parent's notes on this report

**The `StoredBriefBody` deviation is accepted, and the warning attached to it is the valuable
part.** The plan required `json` to carry a `$type<StoredBriefBody>()` cast and no task created
that symbol — a real gap in the plan, not in the work. Declaring it as a `Pick` of the contract
type, in a file T3 owns and which `db/schema` already re-exports, is the narrowest fix available
and cannot drift from the contract. **Carried into T9's dispatch verbatim**, because T9 owns
`modules/brief/types.ts` and an implementer told to give the payload a body type will otherwise
declare a second one there — which is precisely the drift the `Pick` was chosen to prevent.

**The report's `As of` SHA is wrong and the work is not.** It says `34cb66e`, the tip before
this feature's four commits; the run's base is `06d7488`. Nothing in the diff depends on it —
every gate figure matches the baseline this run has held since wave 1 — but it is a provenance
claim, so it is corrected here rather than reproduced silently.
