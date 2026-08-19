---
name: run-plan
description: "Executes an Implementation Plan that already exists — implementer waves, plan verification, boundary review, a bounded fix loop, docs, and a recorded /pr-self-review verdict. Use on /run-plan, on the phrases \"run the plan\" / \"execute the plan\" / \"implement the plan at <path>\", or when handed a plan at `.claude/.plans/<feature>/plan.md` (or any path) and told to build it. Starts at the plan and never earlier: writing the spec is `/spec-creator` run by hand, turning it into a plan is `implementation-planner` run by hand, and both are deliberately outside this skill so their cost and their two human decisions stay visible. Validates the plan before it dispatches anything, runs each wave concurrently on disjoint Owned paths, re-runs every Done-condition itself before spending a reviewer dispatch, and ends at a verdict — it commits nothing and opens no PR. NOT for writing or amending a spec (spec-creator), NOT for producing a plan (implementation-planner), NOT for reviewing an already-open GitHub PR (use /review), NOT for a pre-PR check on work already written (that is /pr-self-review on its own)."
version: "2.0.0"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, Agent, AskUserQuestion, Skill
---

# Run Plan

Takes a plan and produces a green, reviewed, documented diff with a recorded
verdict. Everything upstream of the plan is run by hand, on purpose.

**Why the two upstream agents are not here.** `spec-creator` and
`implementation-planner` each end in a decision only a human can make — approving
acceptance criteria, and choosing the execution mode — and each costs a large
dispatch on its own (`implementation-planner`'s measured floor is 130k tokens for a
*trivial* single-package plan). Folding them into a runner buys nothing but hides
both: the cost, and the moment where a human was supposed to read something. So
this skill starts where the ambiguity is already closed.

```
       run by hand                            /run-plan 
┌──────────────────────────┐   ┌───────────────────────────────────────────┐
│ spec-creator             │   │ 0 validate the plan                       │
│   ↓  human: draft→approved│──►│ 1 implementer × wave      (opus)          │
│ implementation-planner   │   │ 2 Done-conditions, re-run by me           │
│   ↓  human: exec mode    │   │ 3 plan-verifier ‖ architecture-reviewer   │
│ plan.md                  │   │                            (both sonnet)  │
└──────────────────────────┘   │ 4 fix loop  ≤ max-fix, or no progress     │
                               │ 5 doc-writer              (sonnet)        │
                               │ 6 /engineering-insights                   │
                               │ 7 /pr-self-review → verdict               │
                               └───────────────────────────────────────────┘
                                        the human opens the PR
```

## The three files

| File | Holds |
|---|---|
| `SKILL.md` | the phases, the plan validation, the dispatch templates |
| [remediation.md](remediation.md) | the finding → fix-plan mechanism, triage, the loop and its two exits |
| [README.md](README.md) | why this shape, what was deliberately left out, what is unverified |

## Entry point

```
/run-plan plan:<path> [mode:multi|single] [max-fix:N] [spec:<path>] [flags]
/run-plan <feature-slug>            → plan is .claude/.plans/<feature>/plan.md
```

Both argument styles are accepted and mean the same thing: `key:value` tokens, or
`--flag value`. Any path works — a plan is a plan.

| Argument | Effect | Default |
|---|---|---|
| `plan:<path>` / first positional | the plan to execute | `.claude/.plans/<slug>/plan.md` |
| `spec:<path>` / `--spec` | the spec the plan's `R<n>` cite, for the `AC-n` cross-check | inferred from the plan's `Source:` fields |
| `mode:multi\|single` / `--mode` | **overrides** the plan's answered execution mode for this run | whatever the plan says |
| `max-fix:<n>` / `--max-fix` | fix rounds before escalating | `2` |
| `--from <phase>` | resume an interrupted run | `0` |
| `--no-docs` | skip Phase 5 (`doc-writer`) | off |
| `--no-review` | skip Phase 3 entirely — gates only | off |
| `--dry-run` | validate the plan, print the waves, the dispatch count and the budget; dispatch nothing | off |

`mode:` is an **override, not an answer.** The plan already carries the human's
choice; passing `mode:single` against a `multi-agent` plan says *run it linearly
tonight anyway*, and it is recorded in the report as an override. It does **not**
substitute for an unanswered mode — a plan still carrying
`EXECUTION MODE: unanswered` stops at Phase 0, because that token means nobody
chose, and choosing on their behalf is the one thing this skill must not do.

### When to invoke

- `/run-plan plan:.claude/.plans/<feature>/plan.md` — optionally `mode:single`,
  `max-fix:3`.
- The phrases **"run the plan"**, **"execute the plan"**, **"implement the plan at
  `<path>`"**, **"build it per the plan"**.
- **Not** on "implement feature X" with no plan in sight. That is
  `implementation-planner`, by hand, first — and this skill would stop at Phase 0
  anyway.

## What is switched off right now, and what that costs

Two deliberate cuts, both for cost, both recorded here so nobody reads them as
oversights:

- **`test-writer` is not dispatched.** It was Phase 5 of the previous design and it
  is gone from this one.
- **`architecture-reviewer` and `plan-verifier` run `sonnet`**, not `opus`.

**The test cut moves an obligation, it does not remove one.** `DDG-TEST-003` — a
changed seam owes a test at that seam — is still real, and `/pr-self-review` will
raise it as a finding at Phase 7 whether or not anyone wrote the test. So the tests
have to arrive some other way, and there is exactly one that costs nothing extra:

> **Put the test rows in the plan with `Owner: implementer`.** The implementer
> already holds `Write`, already holds `react-testing-library` among its eleven
> injected skills, and is already inside the file it is testing. A test written in
> that dispatch is free; a test written in a `test-writer` dispatch costs another
> agent run.

Phase 0 checks for this and warns when the plan has a seam and no test row. What you
must not do is let the cut become "no tests" — that is not a saving, it is a
`request_changes` at Phase 7 plus the same work later.

## Phase 0 — Validate the plan. Never skip this.

No dispatch, all cheap, and it is the phase that pays for itself: every one of these
is a failure an implementer would otherwise hit thirty minutes in.

```sh
git rev-parse --short HEAD; git status --short          # pin the tree
rg -n 'EXECUTION MODE: unanswered' <plan>              # must be EMPTY
rg -n '^### T[0-9]|Owned paths:|Done-condition:' <plan>  # counts must match
rg -n '^\*\*Status:\*\*|^Status:' <spec>               # approved, not draft
for p in client server reviewer-core e2e mcp-server; do test -d $p/node_modules \
  && echo "$p deps ok" || echo "$p: gates will be 'gate did not run'"; done
```

Stop and ask, dispatching nothing, when:

| Check | Why it stops the run |
|---|---|
| `EXECUTION MODE: unanswered` still in the plan | the human never chose the mode. Waves are scheduled against that answer |
| a task has no `Owned paths` or no `Done-condition` | the implementer will refuse it — `# Cannot implement — no executable plan` — and it will be right |
| the spec's `Status` is `draft` | planning from a draft is normal, **building** from one is not. An explicit human override is the only way past |
| the spec's `Status` is `implemented` | that spec describes a shipped feature. Either the slug is wrong or this change needs its own spec |
| two tasks in one wave share a path, or sit in the same package | a lost edit, or two implementers reading each other's half-written files |
| an `R<n>` appears in no task's `Satisfies` | the plan does not build one of its own requirements |
| the tree is dirty with unrelated work | every reviewer downstream scopes "the diff", and unrelated changes get reviewed as part of this feature |

**Know what this validation actually is.** Reading a plan is **LLM parsing of
markdown fields** — `Owned paths:`, `Depends-on:`, `Satisfies:`, `Done-condition:`,
the `## Waves` list. There is no schema and no parser. Two consequences:

- **A plan that follows `implementation-planner`'s template parses reliably; one
  that improvises does not.** If the plan came from anywhere other than that agent,
  read it yourself before Phase 1 rather than trusting a field scan.
- **A field you cannot parse is a stop, never a guess.** An Owned-paths line you
  read as three paths when it meant four schedules an implementer to edit a file
  another one owns, and nothing downstream catches it. Ask.

**Settle the questions before you dispatch. You are the only one who can ask.**
No agent in `.claude/agents/` can reach a human — the harness refuses
`AskUserQuestion` inside a subagent (measured 2026-08-18) — so every question an
implementer, verifier or reviewer would have asked becomes a **default it invented
and recorded quietly**, if it records it at all. You hold the tool. Before Phase 1:

- Re-read the plan's `## Open questions & recommendations` and `## Assumptions`, and
  `rg -n 'assumed default — confirm|NEEDS CLARIFICATION|BLOCKING' <plan> <spec>`.
- Ask, in one round, anything whose answer changes **a contract, a threshold, or the
  shape of the deliverable**. One round costs seconds; the same gap discovered
  inside a dispatch costs that dispatch — reckon 70–90k tokens and half an hour per
  implementer, per the budget below.
- Anything that does not meet that bar is not worth a round trip: let the agent take
  the plan's stated default, and note it in the run report.

Then print the run plan — waves, dispatch count, and the budget below — and write
`run.md`. On `--dry-run`, stop here.

**Budget, so it can be refused before it is spent.** Measured 2026-08-10:
`implementer` costs ≈67k tokens before its first edit (eleven injected skill bodies
plus the in-scope `INSIGHTS.md` in full), and a `sonnet` reviewer is a fraction of an
`opus` one but not free. Reckon **≈70–90k per implementer dispatch**, and multiply by
the waves. A three-wave feature with one fix round is a few hundred thousand tokens
and most of half an hour. A 3-minute `running` status is not a hang.

## Phase 1 — `implementer`, wave by wave

Dispatch **one message per wave, one `Agent` call per task group**, so a wave runs
concurrently instead of becoming a queue.

```
Implement <T1, T2> of the Implementation Plan at <plan path> — read it in full
first; that file is the plan.

Wave <n> of <m>. Your Owned paths are the ones those tasks name and nothing else.
Other implementers are working in this wave on: <their packages>. Do not touch
their paths.

Test rows in the plan's ## Tests whose Owner is implementer ARE yours and ship with
the code — test-writer is not being dispatched on this run.

Docker is not authorised: no *.it.test.ts, no e2e.
Leave the work uncommitted. 'gate did not run' is a fine result; an invented green
gate is the worst thing you can report.
```

Per report: save it verbatim to `reports/`, then —

- `# Cannot implement — no executable plan` → the **plan** is at fault. Phase 0
  should have caught it; fix the plan by hand rather than arguing with the agent.
- `Status: blocked` on a task → **do not retry.** It is blocked because the fix
  needs something another person reasoned about. Ledger: `escalated`.
- A `## Deviations` entry on every task means the plan was underspecified — a line
  in the report, and an `INSIGHTS` candidate.
- Keep every `## For the parent` for Phase 6.
- **Never start the next wave before every report in this one is in.**

## Phase 2 — Re-run the Done-conditions yourself

Between the last wave and the first reviewer, run every task's Done-condition
**yourself**, verbatim from the plan, from the directory it names. This is a handful
of `Bash` calls and it is the highest-leverage phase in the skill:

- A red Done-condition means the diff is about to change. Dispatching a reviewer now
  buys a review of code that will not survive — go straight to
  [remediation.md](remediation.md) instead and save the dispatch entirely.
- A green sweep is what makes it safe to run both reviewers **in parallel** in
  Phase 3.

Redirect and tail; do not pour output into context:

```sh
cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/tsc.txt 2>&1; echo "rc=$?"; tail -5 /tmp/tsc.txt
cd server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' > /tmp/v.txt 2>&1; echo "rc=$?"; tail -15 /tmp/v.txt
```

Plus the two invariants no tool here catches, from
[`../pr-self-review/gate.md`](../pr-self-review/gate.md) Part 1, whenever the diff
added a relative import or a module — take them **verbatim**, `grep -arnE` and the
`src/modules/*/` loop. They are the only check for two CRITICALs `tsc` cannot see.

This is not verification and does not replace Phase 3. It is a fail-fast filter:
you are answering *is this diff stable enough to be worth reviewing*, not *is the
plan met*.

## Phase 3 — `plan-verifier` ‖ `architecture-reviewer`

**Both read-only, both `sonnet`, both dispatched in one message** when Phase 2 came
back green. Read-only means they cannot collide on a path, and the staleness risk
that would otherwise argue for running them in sequence is what Phase 2 just
retired: nothing is about to change the diff underneath them.

**Sequential instead — verifier first — when Phase 2 was not clean**, or when a
task came back `blocked`. Then the diff *is* about to change, and a boundary review
of code that is being rewritten is a dispatch thrown away.

Skip the pair entirely on `--no-review`, and say so in the report.

```
# plan-verifier
Verify the finished implementation against the plan at <plan path> — read it in
full; that file is the plan.

The spec its requirements cite: <spec path>. A requirement whose Source is an AC-n
is checked against that criterion's text, not only against the plan's wording.

The diff is uncommitted. Docker is not authorised. Implementation reports:
<paths>.

I re-ran every Done-condition myself before dispatching you and they were green —
run them again anyway, verbatim, exactly as the plan wrote them. Two independent
runs is the point; agreeing with me is not evidence.
```

```
# architecture-reviewer
Review the boundaries of the open diff for <feature>.

Scope: committed on this branch + uncommitted + untracked. Report the split.
Read the current depcruise baseline out of onion-architecture/enforcement.md before
attributing any warning to this diff.
Findings only, no verdict — /pr-self-review owns that and runs after you.
```

**Check the verifier's arithmetic before you believe it.** It runs on `sonnet` and
its documented failure mode is a fluent summary that reads like verification: the
two headline counts must add up to the plan's item count, every `R<n>` and `T<n>`
must have its own row in the plan's order, and every `yes` must carry a locator or
command output. Counts that do not add up ⇒ re-dispatch, not interpretation. This
costs you ten seconds and it is why that tier is acceptable.

Then normalise every finding into the ledger and go to
[remediation.md](remediation.md).

## Phase 4 — The fix loop

Fully in [remediation.md](remediation.md). Its shape in one paragraph: normalise
each finding to an id, triage it into `mechanical` / `structural` / `spec-level` /
`accepted`, convert the mechanical ones into a small real plan at
`fix-<round>.md`, dispatch an `implementer` against it, re-run the proving
commands, and re-review **only the changed files**. Two exits — the round budget
(`--max-fix`, default 2) and **no progress** (a round that changed nothing the
reviewers can see). Everything that survives is `escalated`, with what it needs and
what it blocks.

## Phase 5 — `doc-writer`

`sonnet`, skipped on `--no-docs`. The only agent that may flip a spec's
`approved → implemented`, and the reason a full run owes this phase: without it the
spec still describes an intention, and the next person to amend it is reading a file
about a feature that shipped differently.

```
Bring <spec path> up to what shipped, and flip its Status from approved to
implemented.

The diff is uncommitted. Implementation reports: <paths>. Deviations that changed
observable behaviour: <list, or none>.

Write the lower half — Data, States, Implementation, History. Do not touch the
acceptance criteria: they were agreed, and a criterion the code contradicts belongs
under `## For the parent`, not in an edit.
```

Every diagram comes back `not checked` — this agent cannot render one. If a diagram
matters, check it at <https://mermaid.live/> yourself before the verdict.

## Phase 6 — `/engineering-insights`

**The last thing that writes a tracked file, and that ordering is not negotiable.**
An `INSIGHTS.md` append changes the tree fingerprint, so running it after Phase 7
makes the verdict stale and the `gh pr create` hook denies the push.

Gather the `## For the parent` candidates from every report, deduplicate against
the journal, invoke the skill. Nothing substantial ⇒ write nothing; that is a valid
outcome. The candidates worth most from a run like this are about the system, not
the feature: a Done-condition that could not prove its own task, a deviation every
implementer had to make, a finding a gate could have caught instead.

## Phase 7 — `/pr-self-review`

**Pre:** confirm nothing else will write —
`git status --short --untracked-files=all`, compared against what the reports claim.
A changed file no report mentions is a finding of its own.

Invoke the skill. It routes every changed file, runs the package gates and the
`DDG-*` invariants, writes `report.md` then `verdict.json`.

**Tell it what Phase 3 already covered, so the boundaries are not judged twice.**
`architecture-reviewer` and `/pr-self-review`'s backend-architecture routing walk
the same ground — `depcruise`, the onion rings, `DDG-WIRE-*`, `DDG-ARCH-*`,
`DDG-DNT-*` — and a second model pass over the same rules on the same diff produces
the same findings at full price. Pass the arch review's report path and its scope,
and let the skill **cite** it instead of re-deriving it.

Two conditions on that, and both matter:

- **Only when the diff has not moved.** Compare
  `.claude/skills/pr-self-review/scripts/diff-hash.sh` now against its value when
  the arch review ran; if they differ — a fix round landed in between — the review
  is stale and the skill re-derives from scratch.
- **The verdict is still `/pr-self-review`'s alone**, and it must record what it
  reused, in `## Coverage`, as *cited, not re-run*. Its own rule stands: a verdict
  from a run that skipped the routed pass is the false green the whole design is
  against. Citing a fresh, evidence-carrying review by another agent is not
  skipping; silently assuming it is.

The deterministic tools stay unconditional — `depcruise` costs two seconds and is
not what this dedup is about. What is deduplicated is the **model pass**.

**Do not hand-fix a CRITICAL here.** It goes through remediation like any other
finding — one more round, or `escalated` if the budget is spent. A verdict recorded
against a diff you then edited is stale by construction.

The run ends. Print the verdict and one next step: the human reviews and opens the
PR.

## What this skill never does

- Writes no source, no test, no spec, no doc. Only `.claude/.plans/<feature>/`,
  which is gitignored — and that is load-bearing: `diff-hash.sh` hashes untracked
  content, so a visible run directory would make every verdict stale.
- Writes no plan and amends none. A bad plan is a stop, not a repair.
- Never edits a spec's `Status:` line. `doc-writer` flips `approved → implemented`;
  the promotion into `approved` is a human's and happens before this skill runs.
- Never appends to an `INSIGHTS.md` itself — Phase 6 invokes the skill that owns the
  anchored append. A `Write` there destroys the file (`DDG-DOC-001`).
- Commits nothing, pushes nothing, opens no PR.

## The run directory

```
.claude/.plans/<feature>/
  run.md          phase table · finding ledger · dispatch log — written at every boundary
  plan.md         the plan (usually already here, from the manual planner run)
  fix-1.md        remediation round 1
  reports/        every agent report, verbatim, one file per dispatch
```

`run.md` is what `--from` reads. Read it **first** on every invocation: a second
`/run-plan` on the same feature is a resume, not a restart.

## Recognising a stop

Four agents can answer a bad dispatch with a clarification artefact instead of
doing the work. **Relay it verbatim and stop that phase** — never summarise one,
never re-dispatch on a guess.

| First line | Agent | Usually means |
|---|---|---|
| `# Cannot implement — no executable plan` | `implementer` | the plan, or a fix plan you wrote, has a task with no Owned paths or no Done-condition |
| `# Cannot verify — no plan or no diff` | `plan-verifier` | you passed a summary instead of the plan path |
| `# Clarification needed — no architecture review performed` | `architecture-reviewer` | no diff, no area, or a false premise |
| `# Cannot document — nothing implemented to document` | `doc-writer` | Phase 5 ran too early |

## The run report

```md
# Run plan — <feature>

**Status: complete | partial | blocked.**
<N> dispatches · <M> fix rounds · verdict `<approve|comment|request_changes>`.

As of `<sha>` (`<branch>`); nothing committed.

## What was built
One paragraph: what a user can do that they could not before.

## Phases
| Phase | Agent | Model | Result | Artefact |
Every phase, skipped ones included, with the reason.

## Requirements
| R<n> | Verdict | Method | Evidence |
Copied from the verifier, one row each. No merged rows.

## Finding ledger
| ID | Source | Severity | Bucket | Rounds | Status | Where |
No `open` rows.

## Escalated — needs a human
Numbered: what it needs, what it blocks, what happens if it is declined.

## Switched off on this run
`test-writer` not dispatched · tests owned by <implementer | nobody> ·
`architecture-reviewer` and `plan-verifier` on `sonnet`. Say what that cost.

## Not done
`absent` / `not checked`, per item.

## Next step
One sentence.
```

## Grounded in

[`../../agents/README.md`](../../agents/README.md) (the chain, the handoff-by-file
rule, the model decisions and the known limits this skill covers); the five agent
files it dispatches; [`../pr-self-review/gate.md`](../pr-self-review/gate.md) (the
gates, the two invariant checks, the verdict file, the freshness rule);
`../pr-self-review/scripts/diff-hash.sh` (what makes a verdict stale, hence the
write order); root `CLAUDE.md` (`DDG-DOC-005`, the do-not-touch zones, the session
protocol); `docs/specs-convention.md` (the `Status` lifecycle). Cost figures
measured 2026-08-10.
