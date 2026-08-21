# Remediation — closing the loop on a finding

Three sources produce findings: `plan-verifier` and `architecture-reviewer`
(Phase 3), and `/pr-self-review` (Phase 7). None of the three can fix anything —
the two agents are read-only by allowlist, and the skill only records a verdict. So
a run that stops at "the reviewer said X" has produced a transcript, not a change.

`test-writer` is **not** a source on this configuration, because it is not
dispatched. A missing test therefore surfaces later and louder, as a
`/pr-self-review` finding at Phase 7 — which is a finding like any other and comes
through here. The cheaper route is a plan whose `## Tests` rows carry
`Owner: implementer`; see `SKILL.md`.

**This is where most of a real run is spent, and it is the part a straight-line
pipeline gets wrong.**

## Why a finding is not a task

`implementer` refuses a bare list of review comments, and it is right to:

> **Return a refusal and stop, editing nothing, if:** a task has no Owned paths,
> or no Done-condition. *You cannot bound what you may edit, or know when you are
> finished.*

Hand it `AR-1: the route reads the DB directly` and you get
`# Cannot implement — no executable plan`. A finding says *what is wrong*; a task
says *what must become true, where, and which command proves it*. Converting one
into the other is this file's whole subject, and it is the parent's job because
the parent is the only participant that has read both the finding and the plan.

## Step 1 — Normalise every finding

Whatever the source, write it into the ledger in one shape. The ids are stable for
the whole run and they are what the report, the fix plan and the re-review all
refer to.

| Field | From `architecture-reviewer` | From `plan-verifier` | From `/pr-self-review` |
|---|---|---|---|
| id | `AR-<n>` | `PV-<R3>` / `PV-<T2>` | `PR-<n>` |
| severity | its own `CRITICAL` / `WARNING` / `SUGGESTION` | `no` ⇒ CRITICAL, `partial` ⇒ WARNING, failed Done-condition ⇒ CRITICAL | its own, matching `verdict.json` |
| where | `path:line`, inside a changed hunk | the locator, or "where you looked" | `file` + `start_line`, inside a changed hunk |
| claim | the rule violated, quoted | the requirement text | its `title` + `rationale` |
| proof | its `failure_scenario` + `how_to_check` | the command output or the locator | its `failure_scenario` + `how_to_check` |

Two things not to normalise away:

- **`yes (differently)` is not a finding.** It is a met requirement with a
  substitute. Read the one-sentence equivalence argument; if it convinces you, the
  row is closed, and if it does not, the honest verdict was `partial` — re-dispatch
  the verifier on that item rather than inventing a finding.
- **A `WARNING` on known drift is not a finding either.** The eighteen-odd tracked
  `depcruise` warnings and the two encoded `pathNot` exceptions are on a burn-down
  list. If the reviewer reported one anyway, its `## Known drift not reported`
  section was stale — record it as `accepted` with that reason.

## Step 2 — Triage. Four buckets, and the test for each

Every finding goes in **exactly one**. Getting this wrong is the expensive mistake:
a structural finding routed as mechanical produces an implementer that quietly
redesigns, and that is the largest failure mode the whole agent set is built
against.

| Bucket | The test | Action |
|---|---|---|
| **mechanical** | the fix lives inside files a task already owned; it needs no contract, column, migration, port or DI change; and the rule to follow is named in the finding | write a fix plan (Step 3) and dispatch `implementer` |
| **structural** | the fix needs a `vendor/shared` field, a schema or index change, a new port bound in `platform/container.ts`, a file outside every task's Owned paths, or a different design | back to `implementation-planner` with the finding text. It owns *how*. **Never** let this skill invent the approach |
| **spec-level** | the finding says the code contradicts an `AC`, or that an `AC` was wrong, missing or unbuildable | a human decision. `spec-creator` amends the spec if it is still `draft`/`approved`; otherwise it is a conversation. No implementer touches it |
| **accepted** | pre-existing debt, known drift, or a `SUGGESTION` you consciously decline | no dispatch. A reason in the ledger, and a line in the report |

Two heuristics that resolve most ambiguity:

- **If the fix would change something another agent already reasoned about, it is
  structural.** The implementer's own blocked-vs-adapt line is the same line, and
  it exists because a redesign made inside a fix round is reviewed by nobody.
- **If you cannot name the command that proves the fix, it is not mechanical.** A
  fix with no Done-condition is a guess with a diff attached.

## Step 3 — The fix plan

A remediation plan is a real Implementation Plan, just small. Write it to
`.claude/.plans/<feature>/fix-<round>.md` and dispatch against the path, exactly as
in Phase 1. The implementer cannot tell it from any other plan, which is the point.

**Group by root cause and by file, not by finding.** Two findings in one file are
one task — two tasks at one path in one wave is a lost edit, and the reviewer's own
rule is that one root cause is one finding reported in the deepest layer that owns
it.

```md
# Implementation Plan — <feature> / remediation round 1

**Goal:** clear the findings the reviewers raised against the round-0 diff. No new
behaviour, no new files beyond the ones named.

**Execution mode:** single-agent — the findings sit in one package.

As of `<sha>` (`<branch>`), worktree dirty.

## Requirements (verified)

- **R1** — the settings route no longer reaches the database directly; the
  behaviour of `GET /settings/models` is unchanged.
  Source: `AR-1`, architecture-reviewer, CRITICAL, confidence 0.9,
  `server/src/modules/settings/routes.ts:41-58`
- **R2** — `R3` of the original plan is met: the response is sorted by confidence.
  Source: `PV-R3`, plan-verifier, verdict `no`

## Constraints

- `DDG-ARCH-001` — routes stay thin; data access lives behind a repository.
- Quoted from `server/INSIGHTS.md` (2026-08-06): a list the client renders in order
  needs a **total** order — `desc(confidence), asc(createdAt), asc(id)` — because
  conventions tie constantly and an UPDATE moves a tied row.
- **No scope beyond the findings.** Anything you notice and do not fix goes in
  `## For the parent`.

## Skills the implementer must load

| Files | Skill | Why |
|---|---|---|
| `server/src/modules/settings/**` | `onion-architecture` | the ring the query may live in |
| `server/src/modules/settings/routes.ts` | `fastify-best-practices` | schema-on-route, error shape |
| all changed `*.ts` | `typescript-expert` | no `any` at the boundary |

## Tasks

### F1 — Move the settings query behind the repository
Satisfies: R1 (`AR-1`)
Depends-on: —
Owned paths: `server/src/modules/settings/routes.ts`,
`server/src/modules/settings/service.ts`, `server/src/modules/settings/repository.ts`
Forbidden: `server/src/vendor/shared/**`, `server/src/db/**`, any lockfile
Change: the handler calls the service; the service calls a repository method that
holds the Drizzle query. Same response, same status codes.
Skill: `onion-architecture`, `fastify-best-practices`
Acceptance: `depcruise` reports 0 errors, and `GET /settings/models` returns the
same payload shape the existing test asserts
Done-condition: `cd server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src`
→ 0 errors, **and** `./node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0 errors,
**and** `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' > /tmp/v.txt 2>&1; echo "rc=$?"; tail -15 /tmp/v.txt`
→ rc=0
Red flags: if the fix wants a new port or a `container.ts` binding, that is
Status: blocked — the finding was triaged wrong and I need to re-plan it

### F2 — <one task per root cause>

## Non-goals

- No refactor of the neighbouring modules, however similar the shape.
- No new test beyond the one that proves `R2` — the fix round is not where a
  feature's missing coverage gets written.

## Verification
<the same commands the Phase 2 sweep runs>
```

Three rules for a fix plan, each of which stops a real failure:

1. **The Done-condition must be the command that proves *this* finding is gone**,
   not just a green suite. `AR-1` is proved by `depcruise`, `PV-R3` by the test
   that asserts the order, `TW-2` by that test passing. A fix plan whose only
   Done-condition is `vitest run` cannot distinguish fixed from untouched.
2. **`Forbidden` is not optional here.** A fix round is exactly when scope creeps,
   because the implementer is looking at code it already wrote.
3. **Never paste the reviewer's suggested code into the task.** A finding's
   `suggestion` field is the smallest change *it* imagined; the task says what must
   become true. Supplying the patch leaves the implementer copying blindly or
   diverging quietly.

## Step 4 — The loop, and its bound

```
findings ──► triage ──► fix plan ──► implementer ──► gates ──► scoped re-review
                ▲                                                    │
                └──────────── still present, round < 2 ──────────────┘
                                     │
                              round = 2, still present
                                     ▼
                                 escalate
```

**`--max-fix` rounds for the whole run, default 2, then stop.** Not a budget-saving
heuristic: a finding that survives two honest fix attempts is a disagreement about
design, not a defect, and the third round is where an agent starts changing the
target to make the check pass. Each round costs an `opus` implementer plus a
`sonnet` re-review, so the bound is also the difference between an hour and an
afternoon. Raise it with `--max-fix 3` when the findings are genuinely independent
and mechanical; never raise it because one finding keeps coming back.

**Run-wide, not per source** — one budget covering `plan-verifier`,
`architecture-reviewer` and `/pr-self-review` together. Read per-source it would
license **six** `opus`+`sonnet` rounds on a default invocation, which is not what
`SKILL.md`'s "round budget (`--max-fix`, default 2)" promises and not a cost anyone
agreed to. Findings from a later source join the same budget; if it is already spent
when `/pr-self-review` returns a CRITICAL, that CRITICAL is `escalated` to the human
rather than silently buying a seventh round.

**The second exit is *no progress*, and it usually fires first.** After a round,
compare the re-review against the previous one **by finding id**. If nothing moved —
the same ids, still present, and the proving commands reporting what they reported
before — **stop even though the budget is not spent.** A round that changed nothing
the reviewers can see means the fix plan did not address the finding, and running it
again produces the same nothing. Two shapes to recognise:

- the implementer reported `Status: complete` and the re-review still says
  `still present` ⇒ the finding was **triaged wrong**. Re-triage it, do not re-run it.
- the implementer reported `Status: blocked` ⇒ it needed something outside its Owned
  paths or outside its authority ⇒ `escalated` immediately. A second round produces
  the same block, one dispatch later.

Record **which** exit fired — `budget spent` or `no progress` — in the ledger and in
the run report. They mean different things to the person reading it: the first says
three attempts were made, the second says the approach was wrong.

**Run the gates between the fix and the re-review.** They are cheap and
deterministic, and a fix that broke `tsc` must not consume a review round — that is
a second dispatch spent learning something `tsc` would have said in four seconds.

**Re-review scoped, never repeated.** `architecture-reviewer` judges changed hunks,
so a second full-diff pass re-derives the same conclusions about files nobody
touched, and it re-reads the whole `INSIGHTS.md` to do it. Give it the changed
paths and its own previous finding ids, and ask for `fixed` / `still present` /
`superseded` per id. Same for the verifier: re-verify **the items that were not
`yes`**, not all of them.

**Never loop on a blocked task.** `Status: blocked` from an implementer means the
fix needs something another person reasoned about. Re-dispatching it produces the
same block, one dispatch later. It goes straight to `escalated`.

**Never loop on a `spec-level` finding.** No number of rounds resolves a
disagreement about what the feature should do.

## Step 5 — Escalation

An escalated finding is not a failure of the run — it is the run doing the one thing
an autonomous loop cannot, which is to stop. Each one goes into the report's
`## Escalated — needs a human` in this shape:

```md
1. **`AR-3` — `reviewIntent` needs a field on the `ReviewFinding` contract.**
   CRITICAL, `server/src/modules/reviews/service.ts:88`, rule `DDG-DNT-001`.
   Bucket: structural. Rounds spent: 1 (implementer blocked, nothing edited).
   **What it needs:** agreement to extend `vendor/shared` — both copies move
   together, by adding a new file, never by reshaping `ReviewFinding`.
   **What it blocks:** `R4`. The rest of the feature is complete and green.
   **If declined:** `R4` comes out of the spec, which needs a `spec-creator` pass.
```

Then the run's `Status` is `partial`, never `complete` — and say so in the first
line, where it will be read.

## The ledger

In `run.md`, updated at every round boundary. Five statuses and no sixth:

| Status | Means |
|---|---|
| `open` | triaged, fix not yet attempted — **valid only mid-run** |
| `fixed` | the finding's own Done-condition passed, and the re-review says `fixed` |
| `blocked` | the implementer stopped rather than redesigning; needs agreement |
| `escalated` | the round budget is spent, **or a round made no progress**, or the bucket was structural or spec-level |
| `accepted` | consciously declined, with a reason: pre-existing, known drift, a `SUGGESTION` not worth the change |

Three invariants, all cheap to check and all worth checking:

- **No `open` rows at the end of a run.** An `open` finding is one the run lost.
- **The counts add up.** Findings normalised = fixed + blocked + escalated +
  accepted. If they do not, a finding was dropped between the report and the
  ledger — find it before writing the run report.
- **A `fixed` row names the round and the proving command.** "Fixed" without the
  command that proved it is the same claim as a gate reported without being run.

## Anti-patterns

Each of these has been observed somewhere in this class of pipeline, and each
produces a run that looks finished:

- **Fixing it yourself.** This skill writes no source. The temptation is strongest
  on a one-line CRITICAL at Phase 7, which is exactly the fix that would make the
  verdict stale.
- **Treating the reviewer's `suggestion` as the specification.** It is one
  imagined fix, offered at low cost; the task is the requirement.
- **Widening the fix round.** "While I was in there" is how a remediation diff
  becomes unreviewable, and the reviewer's own rules forbid renaming or moving
  files just to match a shape.
- **Making the check pass instead of the code right.** Deleting the assertion,
  loosening the rule, adding a `depcruise` exception, suppressing the lint. Any of
  those is a `spec-level` or `structural` decision wearing a mechanical fix's
  clothes, and all four are visible in the diff.
- **Re-dispatching the same reviewer on the whole diff** and reading its repeated
  findings as new ones.
- **Letting a `SUGGESTION` consume a round.** Bucket it `accepted` and move on;
  the round budget exists for CRITICALs.
- **Spending a second round on a finding the first round did not move.** That is
  what the no-progress exit is for. An unchanged finding after an honest attempt is
  a triage error or a design disagreement, and neither is fixed by repetition.
- **Hand-fixing a Phase 7 CRITICAL because it is "one line".** The verdict is pinned
  to the tree fingerprint; editing after it is recorded makes it stale and the
  `gh pr create` hook then denies the push. One more round, or escalate.
- **Closing a finding on the model's word.** `fixed` needs the command output, in
  this run, in the ledger.
