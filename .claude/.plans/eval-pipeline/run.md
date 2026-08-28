# Run — eval-pipeline (SPEC-04)

Started at `b35fe9b` on `L06-homework`. Tree clean, nothing untracked.
Plan: `.claude/.plans/eval-pipeline/plan.md`. Spec: `specs/eval-pipeline.md`, `Status: approved`.
Mode: **multi-agent**, 7 waves, 12 dispatches. `max-fix: 2`.

## Phase 0 — validation

| Check | Result |
|---|---|
| `EXECUTION MODE` answered | multi-agent |
| Tasks / Owned paths / Done-conditions / Satisfies | 12 / 12 / 12 / 12 |
| Every `R<n>` claimed by a task | 29 declared, 29 claimed, 0 unclaimed |
| Spec `Status` | `approved` |
| Tree dirty with unrelated work | no — clean at `b35fe9b` |
| Two tasks in one wave sharing a path or package | none |
| `Owned paths: none` tasks to relocate to Phase 2 | none — all 12 are real dispatches |
| `node_modules` per package | client, server, reviewer-core, e2e, mcp-server, evals — all present |
| Unresolved markers (`NEEDS CLARIFICATION`, `BLOCKING`) | none in plan or spec |

**Questions settled before dispatch.** The plan carried four; two were spec defects
and went to the human, two took the plan's default.

1. AC-50 asks for five finding actions while N3 keeps two unimplemented → **render all
   five, `Learn` and `Reply to author` present and inert.** Human decision.
2. AC-54 names `Stats` and `CI` in the tab strip while N7 excludes both → **the strip
   reads Config, Skills, Context, Evals.** Human decision.
3. Distinct `Run all agents` skip reasons → **`agent_disabled` and `no_cases`**, plan default.
   A reader cannot otherwise tell a disabled agent from an empty one.
4. `eval_runs` pruned with its batch → **`onDelete: 'cascade'`**, plan default. The
   alternative grows unbounded and serves no read this plan builds.

**Two Done-conditions deliberately withheld from their implementer and moved to Phase 2.**
Both write outside their task's Owned paths, and the skill puts exactly these in the
parent's sweep:

- **T4 applies the migration.** The implementer generates it and stops. Applying it
  writes to the running dev database, which is not a repository file and not the
  implementer's to touch. I run `tsx src/db/migrate.ts` and the `information_schema`
  query in Phase 2.
- **T6's `eval-order.it.test.ts` runs under testcontainers.** The implementer writes
  the file and reports `gate did not run`. I run it serially in Phase 2, because a
  mixed `vitest run` silently skips most `.it.test.ts` files even with Docker up.

**INSIGHTS carried in the briefs, not re-read per dispatch.** The plan's `## Constraints`
section already quotes every relevant entry verbatim with its date and package — 19 from
`server`, 16 from `client`, 1 from `reviewer-core`, each attributed. Implementers are
pointed at that section and told to take it as read. The journals were read once, at
planning time; `server/INSIGHTS.md` alone is ~72 KB and re-reading it twelve times is
the measured failure this rule exists to prevent.

## Budget

12 implementer dispatches at ≈70–90k each, plus two `sonnet` reviewers, plus doc-writer
and the two skills. Reckon roughly one million tokens and well over half an hour of
wall clock. A three-minute `running` status is not a hang.

## Phases

| Phase | Agent | Model | Result | Artefact |
|---|---|---|---|---|
| 0 validate | — | — | **pass** | this file |
| 1 wave 1 — T1 | implementer | opus | **complete** | `reports/wave1-t1.md` |
| 1 wave 2 — T2, T3 | implementer ×2 | opus | **complete** | `reports/wave2-t2.md`, `reports/wave2-t3.md` |
| 1 wave 3 — T4, T5 | implementer ×2 | opus | **complete** | `reports/wave3-t4.md`, `reports/wave3-t5.md` |
| 1 wave 4 — T6, T7 | implementer ×2 | opus | T6 **complete**, T7 **partial** | `reports/wave4-t6.md`, `reports/wave4-t7.md` |
| 1 wave 4b — T7 panel half | implementer | opus | **complete** | `reports/wave4b-t7-panel.md` |
| 1 wave 5 — T8, T9 | implementer ×2 | opus | **complete** (T9 `partial` on one unsatisfiable gate) | `reports/wave5-t8.md`, `reports/wave5-t9.md` |
| 1 wave 6 — T10, T11 | implementer ×2 | opus | **complete** | `reports/wave6-t10.md`, `reports/wave6-t11.md` |
| 1 wave 7 — T12 | implementer | opus | **complete** | `reports/wave7-t12.md` |
| 2 Done-conditions | — | — | **pass**, re-run by me | below |
| 3 verify ‖ arch review | plan-verifier, architecture-reviewer | sonnet | **complete** | below |
| 4 fix round 1 — FT1, FT2 | implementer ×2, sequential | opus | **complete** | `fix-1.md` |
| 5 docs | doc-writer | sonnet | running | |
| 4 fix loop | implementer | opus | pending | |

| 6 insights | /engineering-insights | — | pending | |
| 7 verdict | /pr-self-review | — | pending | |

## Finding ledger

| ID | Source | Severity | Bucket | Rounds | Status | Where |
|---|---|---|---|---|---|---|
| F1 | architecture-reviewer → orchestrator (verified) | spec-level | fix round 1 | 1 | **fixed** — `FT1`, mutation-verified | `modules/eval/runner.ts` engine call |
| F2 | T8 → plan-verifier (R15 `partial`) | spec-level | accepted | 0 | **accepted gap** — user deferred | **AC-47**, `EvalRunAllResult.skipped[].reason` |
| F3 | T10 → plan-verifier (R14 `partial`) | spec-level | fix round 1 | 1 | **fixed** — `FT2`, mutation-verified | **AC-43**, `promoteAgentVersion` skill links |

**Triage.** All three are one gap: *the feature treats an agent as a (prompt, model) pair, and an
agent is also its linked skills.* The user chose to fix F1 and F3 (no contract change) and to accept
F2, which needs a third enum member in both `vendor/shared` copies. Fix plan: `fix-1.md`.

**F1 — the eval replay does not carry the agent's linked skills, so one of the feature's three
stated levers cannot move a number.**

`architecture-reviewer` raised this as a non-boundary observation and was right not to call it a
violation. I verified the functional consequence myself:

| | real review (`run-executor.ts`) | eval replay (`runner.ts`) |
|---|---|---|
| system prompt | yes | yes, from the batch snapshot |
| model | yes | yes, from the batch snapshot |
| **skills** | yes — `resolveSkills(agent.id)`, bodies into the prompt | **no** |

The homework's framing is *"changed a system prompt, a model **or a linked skill** → ran the evals
→ saw in numbers whether the agent got better or worse"*, and the spec's own opening sentence says
the same. As built, editing a linked skill changes nothing the harness can see.

**This is not the implementer's error.** AC-21 says, verbatim, that a case is replayed *"with the
batch's snapshotted prompt and model"* — skills are not named. `runner.ts` satisfies AC-21
exactly. The divergence is between the criterion and the feature's purpose, and it is in my spec,
not in the code.

Schema facts that bound the fix: `skill_versions(skill_id, version, body)` **does** store versioned
bodies, but `agent_versions.config_json.skills` stores only skill **ids**, with no version. So a
strictly reproducible replay of an *old* batch is already impossible by schema. That is fine for
the purpose — each batch is a fresh run, and "the skills as linked right now" is exactly what makes
the lever work. `container.skills` already exposes the service the real path uses.

## Dispatch log

- Phase 0 complete, no dispatch.
- **Wave 1 — T1, complete.** 17 contract symbols in a new `contracts/eval-batch.ts`, added
  byte-identically to both `vendor/shared` copies with one barrel line each. `depcruise`
  `0 errors, 22 warnings, 235 modules` — the module count rose from the plan's 234 baseline,
  which is the evidence the new file was analysed rather than silently unresolved. Server
  741 tests and client 420 tests green. Six deviations, all inside the new file, none
  touching an existing symbol.
  - **Carried forward:** `EvalDashboardRow.alert` is `{ metric, change } | null`, not the
    composed string the shipped `EvalDashboard.alert` uses. A server-composed sentence cannot
    be translated and would put a second delta convention on the screen — the exact failure
    AC-56 exists to prevent. Relayed into the T3 brief, and owed to T10 and T11.
  - **Honest gate:** `client` eslint over the two `vendor/shared` paths recorded
    `gate did not run` — rc=0 while linting nothing, because `client/src/vendor/**` is
    eslint-ignored. Correctly reported rather than banked as a pass.
  - **Two INSIGHTS candidates held for Phase 6**, both about the pipeline rather than the
    feature: `git diff --name-only` cannot satisfy an "exactly N paths changed" condition for
    a task that *adds* files, since new files are untracked and an implementer may not
    `git add`; and `DDG-WIRE-005`'s "delete a scaffold `pnpm-workspace.yaml`" will send a
    later implementer at a file that is tracked, deliberate and load-bearing.
- **Wave 2 — T2, T3, complete.**
  - **T2, the mechanical scorer.** `scoreEvalBatch` in `reviewer-core/src/eval/score.ts`, one
    type-only import of `@devdigest/shared` and nothing else — which is what makes T12's
    transitive no-model-call gate checkable by reading one file instead of walking a graph.
    13 tests, `depcruise` `0 errors, 22 warnings, 236 modules` (risen again).
    **Mutation-verified:** three defects inserted one at a time — an unnormalised range, a
    no-output case poisoning the denominator, and `0` instead of `null` on a zero denominator —
    each confirmed to turn specific tests red, then reverted. A green arithmetic suite proves
    little on its own; this is what makes it evidence.
  - **T3, the client vocabulary.** +95 keys in `eval`, +16 in `prReview`, and
    `src/lib/eval.ts` holding every runtime value. Verified mechanically that no shipped key
    was reshaped: flattening both catalogues at `HEAD` and in the worktree gives
    `lost_or_changed=0` for each.
  - **Three carry-forwards, all raised by the implementers rather than by me:**
    1. **`MetricCard` cannot carry AC-56.** The vendored primitive renders
       `Math.abs(delta).toFixed(2)` with an arrow and **no unit** — literally the `↓ 0.02`
       convention EC-30 flags as the bug. `DDG-DNT-002` forbids giving it a prop, so T9 and
       T11 must render the change from `formatMetricChange` and leave `delta` unset. Owed to
       both briefs as an explicit acceptance line.
    2. **A baseline the plan does not document.** `reviewer-core/tsconfig.eslint.json` reports
       **4** `error TS` across two files on a clean tree (`test/run.test.ts`,
       `test/structured.test.ts`). The plan records `server`'s 16-in-6 baseline but not this
       one, and T12's `core` gate list has no test-file typecheck. If one is added it must be
       filtered the way the server gate is, or it is red on arrival. Owed to T12.
    3. **Two refusal reasons render outside the findings UI.** All nine
       `EvalRefusalReason` messages live in `prReview.finding.evalRefusal.*`, including
       `cross_agent_compare` (T11) and `batch_already_running` (T9). Those two tasks read them
       from `prReview`, not a second copy in `eval`, and their tests must mount both namespaces.
  - **A Done-condition of mine was wrong twice, in the same way.** T3's gate
    `grep -n "@devdigest/shared" <file> | grep -v "import type"` is a check about *imports*
    written as a whole-file text search, so it fires on a comment that merely names the
    specifier — the exact failure the plan's own constraints quote from
    `server/INSIGHTS.md` 2026-08-19. T3 reworded a comment to satisfy it rather than
    reword my gate. T5 carries the identical gate, and its brief now carries the honest
    form (`grep -nE "^import .*@devdigest/shared"`). Phase 6 candidate.
  - **A spec ambiguity, reported rather than silently resolved.** AC-94's observable is
    single-anchor, so it does not settle the pass rule for a hand-edited multi-anchor
    `must_find` case. T2 took the literal reading, left a comment at the branch, and said so.
    Owed to `doc-writer` at Phase 5.
- **Wave 3 — T4 (`server`, schema + migration), T5 (`client`, hooks), dispatched concurrently.**
  **Revision to the Phase 0 decision:** the migration apply moves from Phase 2 to **immediately
  after this wave**, not after wave 7. T10's Done-condition curls the live API, and an
  unapplied migration answers `500` there — which is precisely the failure mode the
  relocation exists to catch, so it must happen before the task that would hit it.
  T4 generates and verifies the shape; I apply.
  - **T4 complete.** `0020_short_the_anarchist.sql` — 1 `CREATE TABLE`, 11 `ADD COLUMN`,
    3 FK constraints, 7 `CREATE INDEX`, and `grep -acE "DROP (COLUMN|TABLE)"` = 0, so the
    interactive rename prompt that hangs `drizzle-kit` forever could not arise. Server 741
    tests green, `depcruise` 22 warnings / 236 modules.
  - **Migration APPLIED by me, and verified in the database rather than in a file.**
    `tsx src/db/migrate.ts` → `✓ migrations applied`, then `information_schema` and
    `pg_indexes` directly: `eval_batches`, `eval_cases`, `eval_runs` all present; all 11 new
    columns present; all 7 indexes present. This is the step whose absence gave Project
    Context a `500` on its first screen with a clean verdict recorded.
  - **Two boundary facts T4 surfaced, both owed to T6 and neither discoverable from the
    schema alone:**
    1. `server/src/db/schema.ts`'s `schema` object — the one passed to `drizzle(sql, {schema})`
       — does **not** list `evalBatches`. It only types the relational query API, and
       `grep -rn "db\.query\." src/` returns nothing repo-wide, so the query builder is
       unaffected. But if T6 reaches for `db.query.evalBatches` it will fail, and that file
       is owned by no task in this plan.
    2. `eval_cases.expectation` is **nullable in the database** while
       `EvalAgentCase.expectation` in the contract is **not**. T6's Row → DTO mapper has a real
       null to resolve at the boundary — precisely the shape of cast that already shipped
       `$NaN` to a client in this repo once.
  - **A third Done-condition of mine that could not pass as written.** T4's migration-shape
    gate predicts an `A` line from `git status --short`. A newly generated file on an unstaged
    tree is `??`, and `A` only appears after a `git add` an implementer is forbidden to run.
    The formulation that holds is "exactly one `.sql` line, and it is not `M`". Third such
    defect this run, all in gates I wrote. Phase 6 candidate.
  - **T5 complete.** 6 read hooks, 6 write hooks and one SSE subscription hook, all through
    `apiFetch`. 51 files / 426 tests green in `client`. Two judgment calls worth keeping:
    - It **declined to copy the precedent it was pointed at.** The plan names `useRunEvents`
      as the `EventSource` model; that hook does two synchronous `setState` resets in its
      effect body, and `eslint.config.js` lists its file among seven entries on the
      `react-hooks/set-state-in-effect` burn-down. T5 copied the wire handling and derived the
      returned values instead, so the new file adds no eighth entry. Measured: the reset form
      did fire the rule before the change.
    - It found a **second shape** of the grep-gate defect. Not only prose trips a whole-file
      text search — a **wrapped multi-line `import type { … }`** does too, because the module
      specifier lands on the `} from "@devdigest/shared";` line, which no `grep -v "import type"`
      can exempt. It used four single-line imports so both the literal and the honest gate pass.
      Fourth gate defect this run, same root cause: I wrote the checks imagining a tree state
      that an implementer is forbidden to produce.
- **Wave 4 — T6 (`server`, repository + helpers + the one DB-backed test), T7 (`client`, the
  finding-card action), dispatched concurrently.** T6 writes `eval-order.it.test.ts` but does
  not run it — testcontainers, and Docker is unauthorised in a dispatch; I run it serially in
  Phase 2. T7 carries the human's answer to the plan's question 1 (five actions, two inert)
  and the three-parent constraint on `FindingCard`: the eval action is a new **optional** prop
  so `ReviewRunAccordion` and `RunTraceDrawer` stay untouched.
  - **T6 complete.** Six files, 37 hermetic tests, `depcruise` `0 errors, 22 warnings, 240
    modules` (236 → 240), server suite 57 files / 778 tests. Three things it did beyond the task:
    - **Proved three ports satisfiable before anyone needs them.** A compile-time
      `Satisfies<Port, Impl>` assertion in the test file pins `ReviewRepository` ←
      `EvalFindingSource`, `AgentsRepository` ← `EvalAgentSource`, `parseUnifiedDiff` ←
      `DiffParser`. The module imports no sibling by design, so `tsc -p tsconfig.json` never
      sees both shapes together; the widened test config is what makes those three lines a
      check rather than a decoration. T10's container binding now needs no adapter and no cast.
    - **De-risked a test it was forbidden to run.** Built the three query shapes and read
      `.toSQL().sql` over a `postgres()` handle that never connects, confirming bare `OFFSET`
      with no `LIMIT` is valid and that `DISTINCT ON` puts its expression first in `ORDER BY`.
    - **Chose the null-boundary fallbacks to make an unreadable row score the agent WORSE.**
      `expectation` falls back to `must_find`, so such a case fails and turns its findings into
      false positives; a `must_not_flag` fallback would have passed for free and silently
      inflated every batch's pass count. For a regression harness that is the difference
      between an instrument and a lie.
  - **T7 `partial`, and the plan was at fault.** `FindingsPanel` cannot gain its first React
    Query hook without also touching two test files that mount it — `FindingsPanel.test.tsx`
    and `ReviewRunAccordion.test.tsx` mock only `lib/hooks/reviews` and provide no
    `QueryClientProvider`, so `useCreateEvalCase` throws `No QueryClient set` and crashes 16
    previously-green tests while `tsc --noEmit` stays clean. **Neither file was owned by any
    task in this plan.** T7 measured it (`16 failed | 10 passed`, 17 occurrences), reverted its
    own wiring rather than leave the suite red, and returned the exact remedy.
    - It also corrected my brief: `FindingCard` is rendered by **one** parent, not three. I
      took "three" from the exploration report; `FindingsSection` draws its own markup and
      `ReviewRunAccordion` renders the panel, not the card.
    - **Plan AMENDED by me**, with the measurement quoted inline: the two test files are added
      to T7's Owned paths. I verified the diagnosis first — both files mock only the reviews
      hooks and neither provides a provider — and confirmed no other task owned them.
- **Wave 4b — the T7 panel half, re-dispatched alone.** Alone rather than folded into wave 5,
  because wave 5 already carries a `client` task (T9) and two implementers in one package
  compile each other's half-written files under a whole-package `tsc`.
  - **T7 finished.** Suite 437/437 — the 434 baseline plus three new panel flow tests. The
    amendment was sufficient and nothing else was needed.
    - It took the `QueryClientProvider` option over the `vi.mock` option **on purpose**: a
      provider keeps the real hook in the code path, and it means the accordion's test will
      still notice if the panel gains another hook later. A mock would hide exactly that.
    - It found another false green. **A `curl` of a PR page proves nothing about the findings
      panel:** the two hits for `Turn into eval case` in 98 KB of HTML are the message
      catalogue inside the flight payload, and `data-finding-id`, `>Accept<` and
      `aria-disabled` are all absent, because the reviews list is client-fetched after
      hydration. A label grep on that route is a false pass; `DDG-UI-001` there needs a browser.
      Both dispatches said plainly that they did not look at the action row.
- **Wave 5 — T8 (`server`, service + runner), T9 (`client`, Evals tab + case editor),
  dispatched concurrently.** The two heaviest tasks in the plan. T8 carries T6's two deferred
  decisions (the `agentId ?? 'row:' + id` grouping key, and staleness as a service rule over a
  list), the `maxRetries: 0` + own-the-deadline requirement, and the thrower-fake technique for
  proving R7's negatives. T9 carries the `MetricCard` finding — the vendored primitive renders
  a delta with no unit and may not be given a prop, so the change is rendered from T3's
  formatter with `delta` left unset — plus both human-settled decisions (four tabs, and which
  denominator each figure reads).


---

# RESUMED at wave 6 (was paused at the end of wave 5)

Stopped deliberately after the wave-5 implementers finished rather than mid-dispatch — killing
two in-flight `opus` dispatches would have discarded ~70–90k tokens each for nothing. Resumed on
`--from 1`, which correctly re-entered at wave 6 rather than restarting: the phase table below is
what makes that possible.

**One decision taken at the resume, by me, to avoid blocking it.** The
`EvalRunAllResult.skipped[].reason` gap stays as T8 read it — an agent whose batch is already in
flight comes back in `created`, not as a named skip. Widening the enum is a `vendor/shared` change
in both copies and no remaining task owns that file. Recorded here and carried into T11's brief so
the client renders exactly the two reasons that exist. **AC-48 goes to `plan-verifier` as a known
risk**, not as a silent pass.

## Resume with

```
/run-plan plan:.claude/.plans/eval-pipeline/plan.md spec:specs/eval-pipeline.md --from 1
```

This file is what `--from` reads. **A second `/run-plan` on this feature is a resume, not a
restart.** What remains: wave 6 (T10 `server` routes/registration/container/promotion, T11
`client` `/eval` screens + nav), wave 7 (T12 `verify:l06`), then Phases 2–7.

## State at the pause, measured not recalled

| | |
|---|---|
| Branch / base | `L06-homework` at `b35fe9b`, 3 feature commits ahead of the lab tip |
| Worktree | 61 paths touched, **nothing committed** — `/run-plan` commits nothing by design |
| Tasks done | T1–T9 (9 of 12), T7 complete across two dispatches |
| Migration | `0020_short_the_anarchist.sql` generated **and applied**; 3 tables, 11 columns, 7 indexes verified against `information_schema` / `pg_indexes` |
| Dataset | 8 `must_find` + 4 `must_not_flag` on `General Reviewer` |
| Stack | API `:3001` → 200, web `:3000` → 200 (T9 measured `000` for the web at its run; transient) |

Gates re-run by me at the pause, all green:

| Package | typecheck | suite | onion |
|---|---|---|---|
| `server` | pass | **59 files / 822 tests** | `0 errors, 22 warnings, 242 modules, 834 deps` |
| `client` | pass | **52 files / 446 tests** | n/a |
| `reviewer-core` | pass | **6 files / 58 tests** | covered by the server cruise |

`depcruise` warnings held at the plan's 22 baseline the whole run; the module count moved
234 → 235 → 236 → 240 → 242, one rise per wave that added source, which is the only evidence
those files were analysed rather than silently unresolved.

## Not done, and owed

- **Phase 2** — `eval-order.it.test.ts` has never executed (testcontainers; withheld from T6 by
  design). Run it serially: `vitest run --pool=forks --poolOptions.forks.singleFork eval-order.it`,
  and read the `↓` lines, not the pass count.
- **`DDG-UI-001`** — nothing in this feature has been *seen* rendered. Three dispatches said so
  plainly rather than implying otherwise, and one measured why a `curl` cannot substitute: the
  HTML carries the message catalogue inside the flight payload, not the rendered control,
  because the data is client-fetched after hydration. A browser is required.
- **One contract decision, before `plan-verifier`.** `EvalRunAllResult.skipped[].reason` is
  `z.enum(['agent_disabled','no_cases'])` and cannot express "this agent already has a batch in
  flight" — a reachable state. T8 returns the in-flight batch in `created` instead. The
  alternative is a third enum member, which is a `vendor/shared` change in both copies and
  therefore a human's call. **AC-48 is the criterion at risk.**
- **One promotion follow-up.** `EVAL_REFUSAL_MESSAGE_KEY` now has consumers in two units and
  will have a third at T11; its home is `client/src/lib/eval.ts`, which no remaining task owns.

## Five Done-condition defects, all mine, all found by implementers

The pattern, stated once because it generalises past this feature: **I wrote gates imagining a
tree state that an implementer is forbidden to produce** — staged files, `git add`, post-commit
diffs. Every one was caught by an agent that refused to bank a false green.

1. **T1** — `git diff --name-only` cannot satisfy "exactly N paths changed" for a task that
   *adds* files: new files are untracked and invisible to `git diff`, and `git add` is forbidden.
   `git status --short -- <paths>` is the form that sees both.
2. **T3** — a check about *imports* written as a whole-file text search fires on a comment that
   merely names the specifier. T3 reworded a comment to satisfy my gate and said so rather than
   silently bending the code.
3. **T4** — the migration-shape gate predicts an `A` line; a newly generated file on an unstaged
   tree is `??`. The form that holds is "exactly one `.sql` line, and it is not `M`".
4. **T5** — the same import gate has a *second* failure shape: a wrapped multi-line
   `import type { … }` puts the specifier on the `} from "…";` line, which no
   `grep -v "import type"` can exempt.
5. **T9** — **T9's fourth Done-condition contradicts T1's third.**
   `git diff --name-only -- src/vendor/` cannot return 0 lines while T1's own condition requires
   exactly 4 paths under those trees and nothing is committed. Scope it to `src/vendor/ui/` —
   which is the `DDG-DNT-002` risk T9 actually carries, and which is clean.

## What the implementers verified beyond their tasks

- **T2** mutation-verified the scorer (3 defects inserted, each confirmed red, reverted).
- **T6** proved three ports satisfiable with a compile-time `Satisfies<Port, Impl>` assertion
  before T8/T10 needed them, and de-risked a test it was forbidden to run by reading
  `.toSQL().sql` over a handle that never connects.
- **T8** mutation-verified four negatives, and found the run's most generalisable gate hole: a
  `server/` test file importing a **non-existent** member from `@devdigest/shared` is green under
  `vitest` and invisible to every gate — `tsc -p tsconfig.json` excludes `test/**` and vitest
  strips type-only imports without resolving them. Measured: 44/44 green while the eslint-tsconfig
  baseline moved 16 → 20. **The symptom is a passing suite.**
- **T7** wrote, measured and *reverted* its own finished work rather than leave 16 previously-green
  tests red, and returned the exact remedy — which turned out to be a real plan defect: two test
  files no task owned. Plan amended, with the measurement quoted inline.
- **T6, T7, T8, T9** each corrected something I had asserted: the parent count of `FindingCard`
  (one, not three), the `db.query` caveat, the `pnpm-workspace.yaml` false positive, and the
  `MetricCard` delta that cannot carry a unit.

## Wave 6 — the feature became reachable

Nine tasks had landed and **none of it was usable**: `modules/eval/` had no `routes.ts` and no
entry in `modules/index.ts`, so the service, runner, repository, scorer and every client surface
were dead code. T10 was the wiring; T11 the screens.

**T10 — measured live, not asserted.** `GET /eval/dashboard` → `200` with one row per agent.
`GET /eval/agents/<nonexistent>/cases` → `{"error":{"code":"not_found",…}}`, the *service's* envelope
rather than Fastify's route-not-found — which is the only thing that distinguishes a registered
module from an unregistered one, since both answer `404`. `POST /eval/cases` twice → `201` then
`409 duplicate_source_finding` carrying the first case's id. Server suite 61 files / 835 tests;
`depcruise` 244 modules, warnings still 22.

**The whole chain now works end to end, verified in the database.** T10's own Done-condition
created one real case: `5d211c40-…`, named `src/adapters/webhooks.ts:2-8`, expectation
`must_find` **derived from the accepted finding** rather than supplied, provenance kept, and a
459-byte real diff fragment. That is R1 demonstrated on live data.

**T11 — the judgment call worth keeping.** The trend chart **drops** points where any of the three
metrics is null instead of rendering them, because `LineChart` maps a missing value to `0` and
would therefore draw "we could not measure this" as "it scored zero" — the exact conflation this
whole feature exists to prevent. Those batches still appear in the recent-runs table with `—`.
`/eval` and `/eval/[agentId]` answer `200` where both were `404`. Client suite 54 files / 455 tests.
`git diff --stat -- src/vendor/ui/` = exactly one file, `nav.ts`.

### Two things wave 6 surfaced that need a human

1. **Promotion does not restore the promoted version's skills.** `AgentsRepository.update`'s patch
   has no skills field and `snapshotVersion` re-reads the agent's *current* links, so promoting v6
   while v7 is current yields a v8 whose `config.skills` is v7's set. Prompt, model and strategy
   restore correctly. AC-43 says "that version's stored config", and whether skills are part of
   "config" is a question about intent, not code. Raised to the user with three options and a
   recommendation (leave it, and say so in the spec — the eval experiment compares *prompts*, and
   a batch's prompt snapshot is already immutable). **Unanswered at the time of writing.**
2. **Both wave-6 dispatches named the wrong base in their report headers** — `b65d2da` /
   `L06-evals-and-plan-verifier` instead of `b35fe9b` / `L06-homework`. The tree was verified
   correct both times. Two independent agents making the identical slip in one wave is a pattern,
   not a coincidence, and a wrong base in a report is precisely what a later reader trusts.
   Phase 6 candidate.

## Wave 7 — T12, and the most consequential measurement of the run

`scripts/verify-l06.sh`: 15 gates, the `verify-l03.sh` shape, exits with the **count** of failures.
Two entries in `server/package.json`; lockfile untouched.

**It proved AC-97 by breaking itself on purpose**, which a green run cannot do: three failures →
`rc=3` with all 12 selected gates still reported; two failures → `rc=2` with both named. The
script does not stop at the first failure, and that is now demonstrated rather than asserted.

**And it found the thing I would not have thought to check.** With
`import type { LLMProvider } from '../llm/openrouter.js'` sitting at the top of the scorer,
`depcruise`'s `core-stays-pure` stayed **GREEN** — an intra-package edge inside `reviewer-core` is
not a violation that rule can express. The architectural gate everyone would trust does not cover
a provider reaching the scorer; the AC-98 import grep is the only thing that saw it. That is the
difference between a gate that exists and a gate that guards.

It also added two gates the plan omitted — a filtered `core` test-file typecheck (quoting the
**4**-error baseline the plan never recorded, which unfiltered would be red on arrival) and the
`core` half of the `DDG-WIRE-002` grep — and it made the three selector flags additive, because
`verify-l03.sh`'s "each selector zeroes the others" pattern makes `--core --server` run nothing
once there are three groups.

## Phase 2 — every Done-condition re-run by me

| Check | Result |
|---|---|
| `eval-order.it` serially, `--pool=forks --poolOptions.forks.singleFork` | **10 tests, 0 skipped** — `↓` markers counted explicitly, because a silently skipped file reads as green |
| `bash scripts/verify-l06.sh` | **rc=0, 15 gates, all PASS** |
| `server` typecheck / suite | pass / 61 files, 835 tests |
| `client` typecheck / suite | pass / 54 files, 455 tests |
| `reviewer-core` typecheck / suite | pass / 6 files, 58 tests |
| `depcruise` | 0 errors, **22 warnings** (unmoved across 12 tasks), 244 modules, 849 deps |
| Migration applied | `eval_batches` + 11 columns + 7 indexes, verified in `information_schema` and `pg_indexes` |
| `GET /eval/dashboard` | `200` |
| `GET /eval/agents/<nonexistent>/cases` | `{"error":{"code":"not_found","message":"Agent not found"}}` — the **service's** envelope, which is the only thing distinguishing a registered module from an unregistered one |
| `GET /eval` · `GET /eval/<agentId>` | `200` · `200` (both `404` before T11) |
| The agent's live case set | one real case, `must_find` derived from an accepted finding, with a genuine SSRF diff fragment |

`eval-order.it` had **never executed** before this phase — T6 wrote it and was forbidden to run
it. It is the one assertion in the feature no fake can reproduce: ordering on a non-unique column
returns rows in physical heap order and an update moves one, so the test compares returned ids
against **independently sorted** ids.

## Phase 3 — both reviewers, in parallel

Parallel was safe because Phase 2 came back green: nothing was going to change the diff under them.

**`architecture-reviewer`: 0 CRITICAL, 0 WARNING, 0 SUGGESTION.** It re-measured `depcruise`
itself (`0 errors, 22 warnings, 244 modules, 849 deps` — matching mine exactly), then **read all 22
warnings line by line** and attributed every one to a pre-existing file this diff does not touch.
It also grepped the `routes-no-data-access` output specifically for `modules/eval/routes.ts` and
found no hit, so that rule's burn-down is still 3 files / 6 edges. All eight boundary claims I
asked it to break instead held: the scorer's single type-only import, no sibling or `node:` import
under `modules/eval/`, `repository.ts` as the only `drizzle-orm` consumer, Row types out of every
port signature, thin routes, one `vendor/ui` edit, byte-identical `vendor/shared` copies, static
registration with the `.js` extension.

**`plan-verifier`: 27 `yes`, 2 `partial`; Done-conditions 8 pass, 4 fail.** The arithmetic adds up
(27+2 = 29 requirements, 8+4 = 12 conditions), which is the check that tier owes. It re-ran, itself,
every item it would not mark `yes` — the integration test (10/10, 0 skipped), both live curls, the
`git status`/`git diff` forms, `bash -n`, the `pnpm run` grep — and took my sweep for the rest, as
instructed.

### It corrected me twice, and both corrections matter

1. **I framed AC-43 as "a question about intent". It is not — the spec already answers it.**
   `## Problem & why` defines `agent_versions` as snapshotting *"provider, model, `system_prompt`,
   output schema, strategy, `ci_fail_on`, repo-intel settings **and ordered skill ids**"*. So
   AC-43's *"that version's stored config"* includes the skill ids by the spec's own definition,
   and the implementation does not restore them. I verified the line myself. **R14 is a fail
   against the spec text, not an open question**, and putting it to the user as a matter of taste
   undersold it.
2. **The criterion at risk is AC-47, not AC-48.** AC-47 is *"the id and reason of every agent it
   skipped"*; AC-48 is the period filter and is fully met. Both T8's report and my own dispatch
   named AC-48. Mislabelled twice, corrected once.

### Four of the twelve Done-conditions fail as literally written — all mine

T1, T4, T9, T11 — and the verifier confirmed each **independently** rather than citing my ledger.
It also drew the distinction I asked for: these are failures of the **condition**, not of the work,
and in each case it re-ran the corrected form and recorded that the substance holds.

## Phase 4 — fix round 1, both landed, both mutation-verified

**FT1 — the replay now carries the agent's current skill bodies**, resolved through the same
service the real review path uses, spread **omit-when-empty**. That spread is the highest-stakes
line in the round: `skills: []` instead of an absent key would make every batch recorded before the
fix incomparable to every batch after it, and a regression harness whose own history is
incomparable is worse than none. Mutation-verified — an unconditional spread turned **exactly one
of fourteen** tests red, and it was the key-absence assertion. The other thirteen are indifferent
to that line, which is what makes that one the evidence.

**A distinction FT1 drew that the plan left open, and got right.** `run-executor.ts` resolves
skills best-effort: it catches, logs and degrades to no skills, because a review without skills is
a worse review, not a broken one. The eval runner deliberately does **not** catch — a failed
resolution fails the batch. Reason, recorded in the code: a silently skill-less batch records a
*number* against an agent measured without its skills, which the dashboard cannot detect and which
then reads as a regression no prompt edit caused. The same failure should degrade in production and
fail loudly in measurement.

**FT2 — promotion now restores the version's ordered skill links**, written **before** `update` so
the snapshot records them. Mutation-verified: moving the call after `update` turned two tests red,
including the ordering one. The fixture makes v6's set differ from v7's in **order** as well as
membership, so the test catches order rather than mere membership. A version naming a skill no
longer in the workspace is refused `422` with `{ version, skill_ids }` before either write, so the
refusal path touches nothing; the two-write path carries a hand-rolled compensation because a real
transaction boundary would require editing `repository.ts`, which the fix plan forbade — flagged for
a human as a possible follow-up rather than done quietly.

**Re-verified by me after the round:** server 61 files / **842** tests; `depcruise` 0 errors,
**22** warnings, 244 modules; `eval-order.it` 10/10 with 0 skipped; `verify:l06` **15 gates, rc=0**;
and the live stack still answers `200` on `/eval/dashboard` and `/eval` — which mattered because
`platform/container.ts`, the composition root, was one of the changed files.

**Sixth gate defect of mine, found by FT1.** The sibling-import check
`grep -arnE "from '\.\./[a-z_-]+/"` matches `_shared` — the one kernel every module is *allowed*
to import — so it could never return 0 on this tree. FT1 reported `1 line, pre-existing` instead of
claiming a pass. Same root cause as the other five: I wrote checks against a tree state that does
not exist at the moment of checking.

## Insights held for Phase 6

Ten candidates across `server` (4), `client` (5) and `reviewer-core` (2), collected verbatim in
the `## For the parent` sections of `reports/*.md`. **Nothing has been appended to any
`INSIGHTS.md`** — that is Phase 6's, and it must be the last write to a tracked file or the
`/pr-self-review` verdict goes stale and the `gh pr create` hook denies the push.
