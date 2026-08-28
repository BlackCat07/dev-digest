---
name: dependency-checker
description: "Full dependency audit of this repo — every package's external dependencies and the internal edges between the six workspace packages, measured, drawn as a diagram, weighed in bytes, and closed with a prioritised action list. Use on /dependency-checker, on \"audit our dependencies\", \"what are we shipping\", \"why is node_modules so big\", \"do we still use X\", \"are our versions consistent\", before adding or removing a dependency, before a bundle-size or install-time investigation, or when a security advisory names a package. Produces a fixed six-section report (Method, Map, Inventory, Weight, Risks, Priorities) with a P0/P1/P2 list where every item carries evidence, effort, impact, the exact command and the exact verification. Read-only: it never installs, never edits a package.json and never touches a lockfile. NOT for judging which ring a file belongs to or which way an internal import may point (that is onion-architecture for the backend, frontend-ui-architecture for the client), NOT for reviewing a diff (pr-self-review), NOT for a general security audit (security)."
version: "1.0.0"
allowed-tools: Read, Grep, Glob, Bash, Write
---

# Dependency Checker

Answers four questions about this repository, in this order, and refuses to answer
the fourth without the first three:

1. **What do we depend on?** — every external package, per workspace package, by type.
2. **How is it wired?** — the internal edges between our own six packages.
3. **What does it weigh?** — bytes on disk, transitive count, who pays for it.
4. **What should we do about it?** — a prioritised list, each item with evidence.

The measuring is done by [`scripts/scan.mjs`](scripts/scan.mjs), which only counts
things. The judging is yours, and this file constrains it.

Provenance and the reasoning behind the design: [README.md](README.md).

## Scope boundary — read this first

| Question | Owner |
|---|---|
| Which **external** packages do we depend on, at what weight and risk | **this skill** |
| Which **internal** edges exist between our six packages | **this skill** (inventory only) |
| Whether an internal import points the *wrong way* between rings | `onion-architecture` (backend), `frontend-ui-architecture` (client) |
| Whether a **diff** is fit to merge | `pr-self-review` |
| Whether a package has an exploitable flaw beyond its advisory record | `security` |

This skill reports the graph. It does not rule on layering — when a cross-package
edge looks wrong, say so as an observation and name the skill that owns the verdict.

## Hard rules

- **Read-only.** Never run `pnpm install`, `npm install`, `pnpm add`, `npm uninstall`
  or anything else that writes. The report *recommends* commands; a human runs them.
- **Never touch a lockfile.** The root `CLAUDE.md` lists all five as never-hand-edit.
  A dependency change is a `package.json` edit followed by *that package's own*
  package manager regenerating its lockfile — and it is out of this skill's scope.
- **Never recommend a removal on the scanner's signal alone.** `unusedCandidates` is
  a candidate list, not a verdict. See [Step 4](#step-4--verify-every-removal-candidate).
- **Every number in the report comes from a command you actually ran.** No estimated
  sizes, no remembered version numbers, no "roughly". If something could not be
  measured, it goes in the report's *Not measured* line rather than being guessed.

## The repository this runs on

Six workspace packages, **not** a monorepo workspace — each has its own
`package.json` and its own lockfile, and cross-package code is shared through
tsconfig path aliases rather than through the dependency graph. Mixed managers:

| Package | Manager | Notes |
|---|---|---|
| `client/` | pnpm | the only one that ships code to a browser |
| `server/` | pnpm | owns `.dependency-cruiser.cjs` and the `lint:arch` gate |
| `evals/` | pnpm | |
| `reviewer-core/` | npm | pure engine, consumed by `server/` as **source**, not as a built package |
| `e2e/` | npm | |
| `mcp-server/` | npm | HTTP client of the API; deliberately not a server module |

**Two traps a naive scan falls into**, both confirmed on this tree:

- `server/clones/` holds foreign repositories DevDigest has cloned in order to review
  them — **including a complete second copy of dev-digest itself**. It is gitignored.
- `client/.next/` ships its own `package.json`.

A `find . -name package.json -not -path '*/node_modules/*'` returns **six packages
that are not ours**. `scan.mjs` hard-codes the six real ones for exactly this reason;
if you scan by hand, exclude both paths explicitly.

## Procedure

### Step 1 — measure

```bash
node .claude/skills/dependency-checker/scripts/scan.mjs --out /tmp/deps.json
```

Whole repo, about 2 seconds, no network. Useful flags: `--pkg server,client` to
narrow, `--no-sizes` to skip the disk walk.

The output is facts only — see [metrics.md](metrics.md) for what each field means
and, more importantly, **how each one is measured and where it misleads**. Read that
before quoting a number.

Node stdlib only, on purpose: `jq` is not installed on this machine, and giving the
scanner a dependency would mean touching a lockfile. Keep it dependency-free.

### Step 2 — advisories (needs network)

```bash
cd server && pnpm audit --json      # pnpm packages: client, server, evals
cd e2e    && npm  audit --json      # npm packages:  reviewer-core, e2e, mcp-server
```

Run per package — there is no workspace root to audit from. The `"dev": true` field
on each finding is load-bearing: a critical advisory in a build tool is not the same
risk as one in a runtime dependency, and the priority rubric below treats them
differently. If the network is unavailable, say so in *Not measured* and continue —
the other five sections do not depend on it.

### Step 3 — internal edges

The cross-package edges are tsconfig `paths` aliases, not dependencies, so no
dependency tool sees them. `scan.mjs` reports them per package under `aliases`
(`crossPackage: true` marks one that leaves the package). Cross-check the direction
against the source:

```bash
grep -rn "@devdigest/" server/src client/src reviewer-core/src --include=*.ts --include=*.tsx -l
```

Note the two hand-synced copies of `vendor/shared/` — `server/src/vendor/shared/`
and `client/src/vendor/shared/`. They are a **duplicated contract that no dependency
graph shows as shared**, and they are do-not-touch. Report drift between them as a
risk; never propose deduplicating them into a package.

### Step 4 — verify every removal candidate

Three candidates in `server/` looked identical to the scanner. All three were
checked; all three got a different answer. This is the reason the step exists.

| Candidate | Verdict | Why the scanner could not tell |
|---|---|---|
| `@fastify/autoload` | **genuinely unused** — remove | Zero references in `src/`. Modules are registered statically in `src/modules/index.ts`; the root `CLAUDE.md` says so outright. |
| `@vscode/ripgrep` | **used — keep** | `src/adapters/codeindex/ripgrep.ts:33` loads it as `await import(/* @vite-ignore */ '@vscode/ripgrep' as string)`. A specifier cast to `string` is invisible to every static scanner, including this one. |
| `testcontainers` | **redundant, low value to remove** | Only `@testcontainers/postgresql` is imported (`test/helpers/pg.ts:1`), and that package already depends on `testcontainers@^10.28.0`. Dropping the direct entry works but hands the version pin to the child. |

So, for each candidate, before it may appear as a removal recommendation:

1. `grep -ran '<name>' <pkg>/src <pkg>/test` — **`-a` is required.** Two of this
   repo's own source files contain a NUL byte and `grep` silently treats them as
   binary, reporting nothing (`server/INSIGHTS.md`, 2026-08-19). A search for a
   forbidden thing coming back clean because the file was never read is the
   dangerous direction of failure.
2. Check dynamic and non-literal imports: `grep -ran "import(" <pkg>/src`.
3. Check config files, `scripts`, Dockerfiles and CI workflows by name.
4. Check whether another dependency needs it as a peer.

If all four come back empty, it is a real candidate. Otherwise it is not — and the
report says which check saved it, because that sentence is what stops the next
person re-proposing the same removal.

### Step 5 — write the report

Exactly the six sections in [report-format.md](report-format.md), in that order.
Follow the template literally; its shape is the deliverable.

### Step 6 — record what was learned

If the audit turned up something non-obvious and file-grounded — a dependency loaded
in a way no scanner sees, a manager quirk, a measurement that lies — append it to
the touched package's `INSIGHTS.md` via the `engineering-insights` skill.
Append-only, and never duplicate what is already there.

## Prioritisation rubric

Every item in the final section carries a priority, and the priority is derived from
this table rather than from how interesting the finding is. **Weight alone is never a
P0** — a 290 MB dev-time install is an annoyance; a dependency that resolves only by
accident is a broken build waiting for a clean checkout.

| | Definition | Examples |
|---|---|---|
| **P0** | Breaks, or ships a known flaw, or is one clean install away from breaking | Imported but not declared (works today only through hoisting — a linker change breaks it); a non-`dev` advisory at high or critical; a runtime dependency sitting in `devDependencies`; version drift on a package with a **runtime** contract, not just types |
| **P1** | Real cost, no incident yet | A genuinely unused runtime dependency, verified by Step 4; two major versions of one runtime library reachable from the same bundle; a heavy dependency used in exactly one place where a lighter one is a drop-in; a `dev: true` advisory at critical |
| **P2** | Worth doing when the file is open anyway | Drift on dev/toolchain-only packages; dev-only install weight; a single-use utility package; a missing `@types/*` |

Each item states, in this order and on one line each:

- **Evidence** — `path:line`, or the command and its output. Not a summary of one.
- **Effort** — S (one line), M (one package), L (touches several packages or the contract).
- **Impact** — the number it moves, measured, not adjectival. "install −49 MB", not "much lighter".
- **Command** — exactly what a human should run, in the right package directory.
- **Verify** — the gate that proves it worked: `pnpm typecheck`, `pnpm test`,
  `pnpm lint:arch`, `pnpm build`. Name a real script from that package's `package.json`.

An item that cannot fill all five lines is not ready to be recommended. Put it under
*Open questions* instead.

## Known false positives

The scanner already suppresses these; do not re-introduce them by hand-reading the JSON.

- **Toolchain dependencies** (`typescript`, `eslint`, `tsx`, `vitest`) are never
  imported — they are invoked by a script. Suppressed via `referencedInConfig` and `hasBin`.
- **`@types/*`** are consumed by `tsc` through `node_modules/@types` with no import
  anywhere. Always suppressed.
- **Framework runtimes** (`react-dom`, `tslib`, `sharp`, …) are loaded by the
  framework, not by your code. Flagged `frameworkRuntime`, never a removal candidate.
- **Source quoted inside a string.** This repo embeds whole files in prompt templates
  and eval fixtures, so a loose scan reports `react` imported by `server/` and
  `fastify` by `evals/`. The undeclared check uses a line-anchored regex over
  non-test files only, which is why it currently reports nothing on a clean tree.
  **If it ever reports something, treat it as real** — that check is tuned to be quiet.
