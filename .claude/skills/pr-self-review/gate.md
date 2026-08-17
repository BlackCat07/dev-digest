# Gates, verdict, and the block

Everything deterministic: the checks that run, the file they produce, and what
stops a merge. No judgement here — that lives in `SKILL.md`.

## Part 1 — Package gates

Run these **only** for packages that appear in the scope, and **before** any
judgement work. They are the cheapest, least arguable findings available.

### Why the binaries, not the scripts

Call `./node_modules/.bin/<tool>` directly and export `CI=true`. Not style:
`pnpm <script>` runs a pre-script dep-status check that shells out to
`pnpm install`, which trips this repo's supply-chain policy and can exit 1 before
the script is reached; without a TTY it can try to purge `node_modules`
(`server/INSIGHTS.md`, 2026-08-02 and 2026-08-04). `CI=true` is what lets
non-TTY invocations proceed.

### Pre-flight (≈5 s)

| Check | Command | If it fails |
|---|---|---|
| Base is current | `git fetch --quiet origin main` | say the base may be stale; never silently review the wrong diff |
| Deps present | `test -d <pkg>/node_modules` | that package's gates are **`gate did not run`**, not a pass |
| pnpm major matches | `pnpm -v` vs `packageManager` in `client/package.json`, `server/package.json` | expect churn and dep-check aborts; report it |

### `server/` (pnpm), from `server/`

| Gate | Command | Failure → |
|---|---|---|
| typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | **CRITICAL** `tsc:<code>` |
| lint | `./node_modules/.bin/eslint <changed files>` | WARNING `eslint:<rule>` |
| onion boundary | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | `error` → **CRITICAL**; `warn` → WARNING |
| unit tests | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | **CRITICAL** |
| integration | `./node_modules/.bin/vitest run .it.test` | **only on request** — needs Docker |

### `client/` (pnpm), from `client/`

| Gate | Command | Failure → |
|---|---|---|
| typecheck | `./node_modules/.bin/tsc --noEmit` | **CRITICAL** |
| lint | `./node_modules/.bin/eslint <changed files>` | WARNING — `react-hooks/exhaustive-deps` is the rule `tsc` cannot replace |
| unit tests | `./node_modules/.bin/vitest run` | **CRITICAL** |
| `next build` | — | **never.** It writes the same `client/.next` as a running `next dev` and corrupts it, with `NEXT_PUBLIC_API_BASE` inlined at compile time (`client/INSIGHTS.md`, 2026-08-03) |

### `reviewer-core/` and `e2e/` (npm), from the package

| Gate | Command | Failure → |
|---|---|---|
| typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | **CRITICAL** |
| lint | `./node_modules/.bin/eslint <changed files>` | WARNING |
| tests (`reviewer-core`) | `./node_modules/.bin/vitest run --passWithNoTests` | **CRITICAL** |
| browser flows (`e2e`) | `CI=true ./scripts/e2e.sh` | **only on request.** Full docker stack; its default `:5433` collides with a second local Postgres and exits 125 before a single flow (`e2e/INSIGHTS.md`, 2026-08-04) |

`server` type-checks `../reviewer-core/src` through a tsconfig alias, so a
`reviewer-core/` change runs the **server** gates too — exactly as
`.github/workflows/server-unit.yml` encodes in its path filter.

### `mcp-server/` (npm), from `mcp-server/`

| Gate | Command | Failure → |
|---|---|---|
| typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | **CRITICAL** |
| typecheck (tests) | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | **CRITICAL** |
| lint | `./node_modules/.bin/eslint .` | WARNING |
| unit tests | `./node_modules/.bin/vitest run` | **CRITICAL** |

Two gates, not one, because this package deliberately type-checks its **tests** as
well — `tsconfig.json` covers `src/**` only, and `tsconfig.eslint.json` widens the
include specifically so the hole `server/INSIGHTS.md` (2026-08-10) records cannot
reopen here. `npm run typecheck` runs both; the split above is for reporting which
one failed. Lint runs over the whole package rather than the changed files, because
`no-console` and the `process.stdout` restriction are what keep the JSON-RPC channel
clean and a single stray call anywhere breaks the transport.

This package aliases `@devdigest/shared` onto `server/src/vendor/shared` at
type-check time, so a change under that directory runs the **mcp-server** gates too
— exactly as `.github/workflows/mcp-server.yml` encodes in its path filter.

### Capturing the result (the shell here is zsh)

Three traps, all measured here, all of which silently manufacture a "pass":

- **`${PIPESTATUS[0]}` is empty in zsh.** Piping a gate into `tail` and reading
  it yields a blank rc. Redirect to a file and read `$?` on the next statement:
  `tsc --noEmit -p tsconfig.json > /tmp/tsc.txt 2>&1; echo "rc=$?"`.
- **zsh does not word-split an unquoted variable.** `eslint $CHANGED` passes the
  whole list as **one** argument and exits 2 with *"No files matching the
  pattern"* — not a lint failure. List the paths literally, or use `xargs`.
- **`-nt` differs by shell** — nanoseconds in zsh, whole seconds in macOS bash
  3.2. Never decide freshness with it; that is what `scripts/diff-hash.sh` is
  for.

### Scoping and pre-existing debt

- **Lint runs on changed files only**, which makes it inherently about this diff.
- **typecheck and depcruise are whole-package.** They are green on `main` by CI
  construction, so a failure is normally yours. Failing only in files **outside**
  the scope ⇒ report `pre-existing (not from this diff)` and do **not** block.
- Need certainty? Re-run that one gate on the base commit in a throwaway
  `git worktree` and compare. Never check out a base inside the working tree — it
  disturbs running dev servers.

### Three words, not two

`pass` / `fail` / **`gate did not run`**. A timeout, a missing `node_modules`, an
absent Docker daemon, `exit 125` — all the third. Calling those a pass is how a
green verdict comes to mean nothing.

### What gates cannot tell you

Green gates are not correctness. Wrapping a screen in
`<Suspense fallback={null}>` once shipped a blank first paint here while
typecheck, `next build` and all 108 client unit tests stayed green
(`client/INSIGHTS.md`, 2026-08-04). When the diff changes what a route renders,
report `DDG-UI-001` — *needs a look in the running app* (`/run`) — rather than
implying static analysis covered it.

## Part 2 — The verdict file

`.claude/.pr-self-review/verdict.json` is the only thing the gate reads. Write it
**last**, after `report.md`.

```sh
mkdir -p .claude/.pr-self-review
cat > .claude/.pr-self-review/verdict.json <<JSON
{
  "verdict": "request_changes",
  "diff_hash": "$(.claude/skills/pr-self-review/scripts/diff-hash.sh)",
  "base_sha": "$(.claude/skills/pr-self-review/scripts/diff-hash.sh base)",
  "findings_by_severity": { "CRITICAL": 1, "WARNING": 2, "SUGGESTION": 0 },
  "checked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "override": null
}
JSON
```

- **Never compute the hash by hand or inline.** Call `scripts/diff-hash.sh` —
  the gate recomputes with the same script, and a second copy of that formula is
  the one way these two halves can drift.
- The counts must match the report.
- `override` is `null`, or the author's reason as a **non-empty string**.

Check whether a stored verdict still stands:

```sh
[ "$(.claude/skills/pr-self-review/scripts/diff-hash.sh)" = "<diff_hash from the file>" ]
```

## Part 3 — The block

`scripts/check-gate.sh` runs as a `PreToolUse` hook on Bash
(`.claude/settings.json`) and denies `gh pr create` / `gh pr merge` when the
verdict is **missing**, **stale**, or **`request_changes`**. In that order —
staleness is checked before the override, so overriding once does not license
every later edit.

| Verdict | When | Gate |
|---|---|---|
| `request_changes` | ≥ 1 CRITICAL | **blocks** |
| `comment` | only WARNING / SUGGESTION | allows |
| `approve` | empty findings list | allows |

**Override** — explicit, recorded, never silent, and only on the author's clear
instruction. Set `"override"` to their reason and put the same reason in the
report.

**What it cannot do:** stop the Merge button on github.com, or `--no-verify`. A
local gate is a seatbelt, not a lock. Real enforcement is branch protection plus
a CI job, deliberately out of scope — CI cannot see the uncommitted half of the
diff, which is the half this skill exists for.

**Do not run a partial review and record a verdict anyway.** A verdict from a run
that skipped the routed pass is exactly the false green the whole design is
against.

## Part 4 — Report format

Fields are `Finding` in `server/src/vendor/shared/contracts/findings.ts` —
same severities, same categories, same verdicts, so a self-review could later be
fed to DevDigest itself without a translation layer.

| Field | Notes |
|---|---|
| `severity` | `CRITICAL` / `WARNING` / `SUGGESTION` — nothing else |
| `category` | `bug` / `security` / `perf` / `style` / `test` |
| `kind` | usually `finding`; `secret_leak` for `DDG-SEC-001` |
| `file`, `start_line`, `end_line` | must intersect a changed hunk |
| `title` | one line: the defect, not the fix |
| `rationale` | the mechanism — which input, what goes wrong |
| `suggestion` | optional; the smallest change that fixes it |
| `confidence` | 0–1; below ~0.6 it is not a CRITICAL |
| `rule` | `DDG-*` from `routing.md`, or the tool's own id |
| `source` | which skill or gate raised it |

CRITICAL additionally requires a `failure_scenario` (concrete input → concrete
wrong outcome) and a one-line `how_to_check`. Cannot write both? It is a WARNING.

Save to `.claude/.pr-self-review/report.md`, in this order:

```md
# PR self-review — <branch> vs <base-ref>

**Verdict: request_changes** — 1 CRITICAL, 2 WARNING, 1 SUGGESTION

Scope: 12 files in the PR (base b9eac24) + 3 uncommitted, not pushed yet.

## CRITICAL — blocks merge

### 1. Settings route reads the DB directly `[depcruise:routes-no-data-access]`
`server/src/modules/settings/routes.ts:41-58` · category `bug` · confidence 0.9
· source: onion-architecture + arch gate

The handler builds a Drizzle query inline, so the transport ring depends on
`db/schema`. The service already exposes `listModels()`.

- **Failure scenario:** any change to the `settings` row shape now breaks the
  route as well as the repository, and the route cannot be unit-tested with no DB.
- **How to check:** `cd server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src`
- **Suggestion:** move the query into `settings/repository.ts`, call it from
  `service.ts`.

## WARNING

- **Route renders differently, unverified statically** `[DDG-UI-001]` —
  `client/src/app/repos/[repoId]/pulls/page.tsx:12`. The screen gained an early
  return; green typecheck and unit tests cannot show a blank first paint. Look at
  it with `/run`.

## SUGGESTION

- `client/src/lib/format.ts:8` — the new formatter duplicates `formatCost`.

## Coverage

- Reviewed 12/12 changed files. Skipped by rule: 2 (`pnpm-lock.yaml`,
  `db/migrations/0011_*.sql`). Nothing sampled or truncated.
- Routed skills: onion-architecture, fastify-best-practices, zod,
  frontend-ui-architecture, engineering-insights.
- Unrouted: none.
- Delegated, not run: generic bug hunt → `/code-review`.

## Gates

| Package | typecheck | lint | arch | tests |
|---|---|---|---|---|
| server | pass | pass | **fail** (1 error) | pass |
| client | pass | pass | — | pass |

## Suppressions active

- `DDG-ARCH-002` in `reviewer-core/src/llm/openrouter.ts` — "SDK types only, no
  runtime import" (author).
```

Five rules for the prose:

1. **Verdict first.** The reader wants to know if they are blocked.
2. **The title states the defect**, not the fix.
3. **No hedging in a CRITICAL.** "Might", "could potentially", "if not already
   handled elsewhere" is WARNING language by definition.
4. **The coverage block is not optional** — files skipped by rule, anything
   sampled, anything delegated, gates that did not run. Omitting it reads as
   "everything was checked".
5. **Empty is a good report.** `approve`, zero findings, and a coverage block.
   Do not pad it.
