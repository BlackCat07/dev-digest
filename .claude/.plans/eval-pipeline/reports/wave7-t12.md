# Implementation report — eval-pipeline / T12

**Status: complete.**

1 file changed, 1 added, nothing committed.

> **Orchestrator note.** Header named `b65d2da` / `L06-evals-and-plan-verifier` — the third
> dispatch in a row to make this slip. Tree verified: `L06-homework` at `b35fe9b`.

## Coverage

- INSIGHTS server: supplied verbatim in the dispatch and in the plan's `## Constraints`; taken as read, file not opened. Relevant: 2026-08-02/08-04 (a `pnpm <script>` pre-script shells out to `pnpm install` and trips `[ERR_PNPM_IGNORED_BUILDS]`), 2026-08-06 (a mixed `vitest run` silently skips most `.it.test.ts`), 2026-08-19 (`grep` without `-a` reports nothing on NUL-carrying `*.ts`; scope a grep gate to import statements, not whole-file text), 2026-08-10 (no test file in `server/` is typechecked by any gate). INSIGHTS reviewer-core / client / e2e: supplied, nothing further binds a shell script and a `scripts` block. Additionally supplied and used: the `reviewer-core` `tsconfig.eslint.json` baseline of 4 errors, which the plan omits.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `typescript-expert` | preloaded | `scripts/verify-l06.sh`, `server/package.json` (the only skill whose row matches: no product code, no `*.ts` authored) |

Matches the plan's routing table: yes — the plan names `typescript-expert` alone for T12.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `scripts/verify-l06.sh` | T12 | yes | new, executable. `gate <name> <workdir> <command...>` copied in shape from `verify-l03.sh`; 15 gates across `reviewer-core`, `server`, `client`, plus one behind `--with-db`; flags `--server`, `--client`, `--core`, `--with-db`, `-h`; exits with the count of failures |
| `server/package.json` | T12 | yes | two script entries beside `verify:l03`: `verify:l06`, `verify:l06:db`. No dependency change, lockfile untouched |

Temporary, sanctioned, reverted: `reviewer-core/src/eval/score.ts` was mutated twice to prove the AC-98 gate fails, then restored. `cmp` against a pre-mutation copy reports identical; the file is untracked (T2's new uncommitted file), so `cmp` is the load-bearing check, not `git diff`.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R29 / AC-97 — every gate runs after a failure; exit is the failure count | T12 | yes — two deliberate breaks: 3 failures → `rc=3` with all 12 gates reported; 2 failures → `rc=2` with all 5 core gates reported |
| R29 / AC-98 — the scorer references no provider / HTTP client / network call, scoped to import statements, `grep -a` | T12 | yes — `core · the scorer makes no model call`; two assertions, both proven to fire |
| R29 / AC-99 — Postgres-backed gates only on request, serially in a single fork | T12 | yes — wired; `gate did not run` (Docker not authorised) |
| R29 / AC-100 — every tool invoked as `./node_modules/.bin/<tool>`, no `pnpm run` / `npm run` | T12 | yes — `grep -acE "pnpm run\|npm run"` is `0` |

The AC-98 gate, as built: it reads every statement head *and* every `from '…'` clause of `reviewer-core/src/eval/score.ts` (so a multi-line import cannot hide its target on a continuation line), then asserts (1) every `from '…'` is `'@devdigest/shared'` and (2) no such line matches `openai|openrouter|anthropic|llm|provider|fetch|http|node:`. `grep -a` throughout; the passing case is empty output, so the gate reads output, never `$?`. It inspects 7 statement lines today (1 import, 6 exports) and reports `no model provider, HTTP client or network import. Scoring is arithmetic.`

**Measured during the deliberate break: `server · dependency-cruiser` stayed GREEN with a provider type-import sitting in `score.ts`** — an intra-package edge `core-stays-pure` does not express. The AC-98 gate was the only thing that saw it, alongside `tsc`.

## Deviations from the plan

- **Added `core · typecheck (L06 test files)`**, which the plan's gate list omits — the same filtered shape as the server one, failing only on `^test/eval-score`, printing the total and naming **4** as the known baseline (`test/run.test.ts` × `TS7006`, `test/structured.test.ts` × 3 `TS18048`). Unfiltered it would be red on arrival. Sanctioned by the dispatch.
- **Added `core · ESM extensions`.** `gate.md` Part 1 says to run the `DDG-WIRE-002` grep from `reviewer-core/` too, dropping the last `grep -v`; the plan listed the gate under `server` only. Verbatim otherwise, and green on arrival.
- **The three selector flags are additive rather than mutually exclusive.** With three groups instead of two, `verify-l03.sh`'s "each selector zeroes the other" pattern makes `--core --server` run nothing. First selector clears all, then each adds. Verified: `--server --with-db` (the exact argv of `verify:l06:db`) → server only, DB on; `--core --server` → both, client skipped; `--bogus` → exit 2, as in `verify-l03.sh`.
- Renamed the AC-98 gate's own count line to `import/export statement line(s) inspected` after the first run printed `7 import statement line(s)` for a file with one import. Label only.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| repo | syntax | `bash -n scripts/verify-l06.sh` | pass |
| repo | no `pnpm run` / `npm run` | `grep -acE "pnpm run\|npm run" scripts/verify-l06.sh` | pass — `0` |
| repo | usage | `bash scripts/verify-l06.sh -h` | pass — usage printed, exit 0 |
| repo | full run | `CI=true bash scripts/verify-l06.sh` | pass — `rc=0`, 15 gates, all `PASS` |
| repo | script entries | `node -e "…require('./server/package.json').scripts…"` | pass |
| repo | lockfile untouched | `git diff --name-only -- server/pnpm-lock.yaml` | pass — 0 lines |
| repo | AC-97, break one gate | `--core --server` with a provider import in `score.ts` | pass — `rc=3`; `core · the scorer makes no model call` red, `core · typecheck` and `server · typecheck` red as collateral, **all 12 gates reported** |
| repo | AC-97, break exactly two | `--core` with an extensionless provider import | pass — `rc=2`; `the scorer makes no model call` + `core · ESM extensions` red, other 3 green, both reported |
| repo | `--with-db` wiring | parse harness + static read | pass — flag reaches `vitest run --pool=forks --poolOptions.forks.singleFork eval-order.it`; `server/test/eval-order.it.test.ts` exists |
| server | integration (`eval-order.it`) | `vitest run --pool=forks --poolOptions.forks.singleFork eval-order.it` | gate did not run — needs Docker, not authorised |

Inside the full run, the numbers the script prints, all matching the dispatch's measured baselines: `reviewer-core` test typecheck **4**; scorer tests **1 file, 13 tests**; `server` test typecheck **16**; `eslint` 0 errors / 43 warnings; `depcruise` **0 errors, 22 warnings, 244 modules, 849 dependencies**; `server · eval tests` **5 files, 94 tests**; `client · L06 component tests` **10 files, 82 tests**. No pre-existing failure was encountered.

## Not done

- `gate did not run` — the `--with-db` half. Docker is not authorised; the flag is wired and asserted, the test was not executed.
- `not checked` — the whole `server` (61 files / 835 tests), `client` (54/455) and `reviewer-core` (6/58) suites. The script selects L06's files by name, as `verify-l03.sh` does.
- `not checked` — the e2e flows and the running app.
- `absent` — no workflow edit. `DDG-WIRE-007`: no workflow runs `verify-l03.sh` and none should run this.

## For the parent

- The script is `bash`-shebanged and both zsh traps were confirmed live rather than assumed: while checking the flag parse from an interactive `zsh` loop, `bash $S $a` passed `"--server --with-db"` as **one** argument and printed `unknown flag: --server --with-db`. Re-run under `bash -c`, the same call parses correctly. Anyone testing a fragment of this script from a zsh prompt will get that false negative.
- Candidate for `reviewer-core/INSIGHTS.md`: `reviewer-core/tsconfig.eslint.json` carries a baseline of **4** `error TS` across `test/run.test.ts` (1 × `TS7006`) and `test/structured.test.ts` (3 × `TS18048`) — the same include-hole `server` has, and the number a filtered gate there must quote. It is not currently recorded anywhere; `server/INSIGHTS.md` records only the server's 16.
- Candidate for `server/INSIGHTS.md`: `depcruise`'s `core-stays-pure` rule stayed green with `import type { LLMProvider } from '../llm/openrouter.js'` at the top of `score.ts` — an intra-package edge inside `reviewer-core` is not a violation the rule can express, so the AC-98 import grep is the only gate that catches a provider reaching the scorer.
- `verify:l06` runs the **server** half only, matching `verify:l03`'s precedent; the core and client halves need `bash scripts/verify-l06.sh` (or `--core` / `--client`) from the repo root, because there is no root `package.json` to hang them on.
- The parent's own Phase 2 checks (migration applied, `/eval/dashboard`, the `404` envelope, the browser screens, `eval-order.it`) are unrun by me and remain the next step, as does `/pr-self-review`.
