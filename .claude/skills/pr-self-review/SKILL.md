---
name: pr-self-review
description: "Reviews all open local changes before a pull request is opened, and blocks the merge on any CRITICAL finding. Use when about to open a PR (`gh pr create`), when asked to self-review / pre-PR check / \"is this ready to push\", or on /pr-self-review. Scopes the real diff (committed + staged + unstaged + untracked) against origin/main, routes each changed file to the skills that own it — UI skills on UI files, backend architecture skills on backend files — runs this repo's own gates (typecheck, eslint, dependency-cruiser, unit tests), checks the project invariants a linter cannot see (do-not-touch zones, static module registration, ESM extensions, contract drift, schema-without-migration), and records a verdict the merge gate reads. NOT for reviewing an already-open GitHub PR (use /review)."
version: "1.0.0"
allowed-tools: Read, Grep, Glob, Bash, Skill, Write
---

# PR Self Review

The last check before the work leaves this machine. It answers one question —
**would I be embarrassed if a reviewer saw this?** — about the diff that is
actually about to be pushed, not about the repo in general.

Three properties make it worth running:

1. **It routes.** Every changed file is matched to the skills that own it, so a
   `client/` diff is judged by the frontend skills and a `server/` diff by the
   backend architecture skills. Nothing is judged by a rubric that does not apply
   to it, and no package is reviewed just because it exists.
2. **It is grounded.** Deterministic gates run first; every judgement finding
   cites a line inside a real diff hunk.
3. **It blocks.** One CRITICAL ⇒ `request_changes` ⇒ the `gh pr create` gate
   refuses until the finding is fixed or explicitly overridden.

## The four files

| File | Holds |
|---|---|
| `SKILL.md` | the procedure and the judgement rules |
| [routing.md](routing.md) | changed path → owning skills, and the `DDG-*` invariants |
| [gate.md](gate.md) | package gates, the verdict file, the block, the report format |
| `scripts/diff-hash.sh` | the one definition of "the open changes" — the fingerprint a verdict is pinned to |
| `scripts/check-gate.sh` | the `PreToolUse` hook that denies `gh pr create` / `gh pr merge` |

## Two entry points

| How | When |
|---|---|
| `/pr-self-review [base-ref]` | manually, any time; default base is `origin/main` |
| the gate on `gh pr create` / `gh pr merge` | automatically — it denies the command until a **fresh** non-blocking verdict exists |

The gate never runs the review. It refuses to let a PR out without one. That
split is deliberate: a skill fires when the model judges it relevant, which
cannot be guaranteed, so enforcement lives in the hook and judgement lives here.

## What this skill does not do

Delegate rather than duplicate, and say so in the report.

| Concern | Owner |
|---|---|
| Generic bug hunting in the working diff | `/code-review` |
| Deep security audit | `/security-review` |
| Reuse / simplification / dead code | `/simplify` |
| Reviewing an **already-open** GitHub PR | `/review` |
| **This skill** | routing, this repo's invariants, the gates, the verdict |

It also **never edits source.** It writes only inside
`.claude/.pr-self-review/`. Fixing is a separate step the author asks for after
reading the report.

## Procedure

### 0 — Scope the real diff

```sh
BASE=$(git merge-base HEAD origin/main)     # or the ref given as the argument
git diff --name-status "$BASE"...HEAD       # committed — these are in the PR
git diff --name-status HEAD                 # staged + unstaged
git ls-files --others --exclude-standard    # untracked
```

Three sets, three commands, kept apart. `origin/main` missing → fall back to
`main` and say which base was used.

**Report the split, never merge it.** Worktree and untracked files are *not* in
the PR yet. A verdict that silently reviewed 3 files the reviewer will never see
is a false green — say `12 files in the PR + 3 uncommitted (not pushed yet)`.

Empty scope → say so and stop.

### 1 — Classify and route

Map every path with [routing.md](routing.md) Part 1 → the package, the file
class, the owning skills.

- A package with no changed files is not reviewed. That is the point.
- A path no row covers goes in the report as `unrouted` and is reviewed against
  the nearest package `CLAUDE.md`. Never silently skipped.
- Docs-only diff → skip the code gates, keep the doc checks.

### 2 — Read the journals first

For each package in scope, load `<package>/INSIGHTS.md` **in full** via the
`engineering-insights` skill and emit its one-line receipt before any finding. An
entry that contradicts the diff is itself a finding.

### 3 — Gates (deterministic, first)

Run the gates for the packages in scope per [gate.md](gate.md) Part 1. Cheap,
objective, and first — judging code that does not compile is wasted effort.

A gate that could not run is reported as **`gate did not run`**, never as a pass.

### 4 — Skill-routed review

For each routed skill: load it, check **only the changed hunks** against its
rules. Architecture and placement skills before stylistic ones — a misplaced file
makes nits about its contents moot.

### 5 — Project invariants

Walk [routing.md](routing.md) Part 2: do-not-touch zones, static module
registration, ESM extensions, contract drift, schema-without-migration,
`INSIGHTS.md` append-only. A linter sees none of them.

### 6 — Filter for precision

The bar already set for the product's own reviewers in
`docs/agent-prompts/general-reviewer.md`, plus one extra rule because this
verdict blocks a merge:

- Only what **this diff** introduced or worsened.
- Every finding cites a line **inside a changed hunk**.
- Every CRITICAL carries a `failure_scenario` — a concrete input and the concrete
  wrong outcome — and a one-line "how to check". **No scenario ⇒ downgrade to
  WARNING.** Not "might be", not "if this isn't handled elsewhere".
- One root cause = one finding, in the deepest layer that owns it. Two skills
  noticing the same thing is not two findings.
- Nothing found → empty list and `approve`. Never invent a finding to look
  thorough; that is the failure mode that gets this skill switched off.

### 7 — Report and record

Write `report.md`, then the verdict — both per [gate.md](gate.md), in that order,
because the verdict must be the last thing the run touches.

```sh
.claude/skills/pr-self-review/scripts/diff-hash.sh    # the value verdict.json pins
```

Never compute that hash any other way. `scripts/check-gate.sh` recomputes it with
the same script; a second copy of the formula is the one way the two halves can
drift.

## Severity and verdict

Exactly the project's own vocabulary — `Severity` and `Verdict` in
`server/src/vendor/shared/contracts/findings.ts`. No second scale.

| Severity | Meaning | Blocks? |
|---|---|---|
| `CRITICAL` | security breach, data loss, wrong results, crash, or a broken contract callers depend on | **yes** |
| `WARNING` | a real problem worth fixing that does not block | no |
| `SUGGESTION` | a nit; safe to merge without it | no |

`request_changes` ⇔ ≥ 1 CRITICAL · `comment` ⇔ only WARNING/SUGGESTION ·
`approve` ⇔ empty findings list.

## Rule IDs and suppression

Every finding carries an ID so it can be suppressed, counted, and deleted when it
turns out to be noise: `DDG-<AREA>-<NNN>` from [routing.md](routing.md) Part 2,
or the tool's own identifier for a gate failure.

Suppression requires a reason and is always listed in the report:

```ts
// pr-self-review: allow DDG-ARCH-002 — SDK types only, no runtime import
```

No reason, no suppression — an unexplained one is itself a WARNING
(`DDG-DOC-003`).

## Fast path

Re-running an unchanged tree is wasted work. The stored verdict still stands when
the hash matches:

```sh
.claude/skills/pr-self-review/scripts/diff-hash.sh   # compare with diff_hash in verdict.json
```

Match ⇒ report the stored verdict and stop. For a mid-work sanity check, gates
and invariants (steps 3 and 5) are the fast subset — say in the report that the
routed pass was skipped, and **record no verdict for a partial run**.

## Provenance and limits

**Authored in this repo**, so it has no upstream and does not belong in
`skills-lock.json` (that file pins vendored skills by hash). Same status as
`engineering-insights`, `onion-architecture`, `frontend-ui-architecture`.

What is deliberately **reused rather than invented**: the severity scale and
"CRITICAL is the only level that blocks" from
`docs/agent-prompts/general-reviewer.md`; `Finding` / `Severity` /
`FindingCategory` / `FindingKind` / `Verdict` from the shared contracts;
citation grounding from that same contract; the gate commands and the
unit/integration split from `TESTING.md` and `.github/workflows/*`; and the list
of commands that are unsafe to run locally from the four `INSIGHTS.md` journals.
A private severity scale or finding schema would have been the fastest way to
make this skill useless — two vocabularies drift, then neither is trusted.

Known limits:

- **The skill cannot guarantee it fires** — hence the hook.
- **A local gate is a seatbelt, not a lock.** It cannot stop the Merge button on
  github.com or `--no-verify`. Branch protection plus CI is the real thing, and
  deliberately out of scope: CI cannot see the uncommitted half of the diff,
  which is the half this skill exists for.
- **`typecheck` and `depcruise` cannot be scoped to changed files**; `gate.md`
  says how to report a failure that is not yours.
- **Judgement findings are model output.** The `failure_scenario` requirement
  makes a false block expensive to produce, not impossible.
- **No evals yet.** The first one to write is the negative case: a small, clean
  diff must come back `approve` with an empty list. A skill that always finds
  something to block gets switched off within a week, and then it protects
  nothing. Follow the hand-scored rubric convention in
  `../engineering-insights/evals/`.
