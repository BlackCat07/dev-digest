# Run plan — pr-brief

**Status: phase 0 complete, awaiting a go-ahead before Phase 1.**

As of `06d7488` (`L05-spec-driven-development`). Nothing committed by this run.
Invocation: `plan:.claude/.plans/pr-brief/plan.md spec:specs/pr-brief.md mode:multi max-fix:2`.

## Phase 0 — validation

| Check | Result |
|---|---|
| `EXECUTION MODE` | `multi-agent` — answered by the human at the planner dispatch. Not `unanswered`, so the run may proceed |
| Task fields | 15 tasks · 15 `Owned paths` · 15 `Done-condition` — counts match |
| Spec `Status` | `approved` (`specs/pr-brief.md:1`), promoted by the human at `9f6824e` |
| Requirement coverage | R1 … R22 each appear in at least one task's `Satisfies` — no orphaned requirement |
| Wave disjointness | re-checked by hand, path by path. W3 `T3`(server/db) ‖ `T4`(client/messages); W4 `T5`(server) ‖ `T6`(client); W5 `T7`(server) ‖ `T8`(client); W6 `T9`(server) ‖ `T10`(client). No intersection, and no wave puts two tasks in one package. `platform/container.ts` is touched by `T5` (W4) and `T13` (W9) only — five waves apart |
| Dependencies installed | `client`, `server`, `reviewer-core`, `e2e`, `mcp-server` — all five have `node_modules`, so no gate will report "gate did not run" for a missing install |
| Clarification markers | none. `assumed default — confirm`, `NEEDS CLARIFICATION` and `BLOCKING` all return zero hits in both the plan and the spec — the spec's twelve questions were decided by the human before approval, and the planner's three were decided before this invocation |
| Plan provenance | written by `implementation-planner`, so the field scan is reliable rather than a parse of improvised markdown |
| Cross-model review | done before this run, at Phase 2 of the pipeline rather than inside it. 3 CRITICAL / 7 WARNING applied to the plan; see `reports/stage2-cross-model-review.md` |

**Tree state.** Three untracked files, none in any task's Owned paths:
`HOME-TASK05.md`, `PROMPT.md` (the lesson's own brief and prompt notes) and `specs/Untitled`
(53 bytes, an IDE accident containing one line of chat text). They are not unrelated *work* —
no source, no test, no config — but they do enter the diff every downstream reviewer scopes,
and `diff-hash.sh` hashes untracked content, so they are part of the fingerprint a verdict is
recorded against. Raised with the human before Phase 1 rather than decided here.

## Two things switched off, and what each costs

- **`test-writer` is not dispatched** — this skill's standing cut. The plan anticipated it:
  nine of its eleven test rows carry `Owner: implementer` and ship inside the task that
  writes the code. **Two do not**, and they are the gap:
  - `server/test/brief.it.test.ts` — the DB-backed acceptance pass (AC-1 … AC-9 end to end,
    AC-35's cross-workspace 404, AC-58's trigger). Cannot move to an implementer: Docker is
    not authorised in the dispatch template, and `DDG-TEST-001` forces the `.it.test.ts`
    name. Its hermetic counterpart, `brief-service.test.ts` (T13), does cover the
    no-second-model-call criterion against a mock provider — which is the homework's own
    acceptance criterion — so what is missing is the real-Postgres version, not the proof.
  - `client/…/PrDetailView/PrDetailView.test.tsx` — the cross-tab flow. This one *could* move
    to T10, which already owns `PrDetailView.tsx`.
  `/pr-self-review` will raise `DDG-TEST-003` at Phase 7 for whichever of these is still
  absent, and that is the correct outcome rather than a surprise.
- **`architecture-reviewer` and `plan-verifier` run `sonnet`**, not `opus`. The cost is a
  documented failure mode: a fluent summary that reads like verification. Mitigation is
  arithmetic — the verifier's two headline counts must add to the plan's item count, every
  `R<n>` and `T<n>` must have its own row in the plan's order, and every `yes` must carry a
  locator or command output. Counts that do not add up are a re-dispatch, not an
  interpretation.

## The run, if it proceeds

| Wave | Tasks | Package(s) | Dispatches |
|---|---|---|---|
| 1 | T1 contract, both copies | server + client | 1 |
| 2 | T2 `risk_brief` default | server + client | 1 |
| 3 | T3 schema + migration ‖ T4 message namespace | server ‖ client | 2 |
| 4 | T5 Smart Diff role boundary ‖ T6 file/line target | server ‖ client | 2 |
| 5 | T7 effective document set ‖ T8 data hooks | server ‖ client | 2 |
| 6 | T9 ports + repository ‖ T10 the card | server ‖ client | 2 |
| 7 | T11 cache key, documents, assembly | server | 1 |
| 8 | T12 prompt, schema, grounding | server | 1 |
| 9 | T13 service, routes, registration, container | server | 1 |
| 10 | T14 the detail-read trigger | server | 1 |
| 11 | T15 apply the migration, prove the route | — (no file edited) | 1 |

**15 implementer dispatches**, then Phase 2 (Done-conditions, re-run by the orchestrator, no
dispatch), Phase 3 (two `sonnet` reviewers in one message), Phase 4 (≤ 2 fix rounds), Phase 5
(`doc-writer`, `sonnet`), Phase 6 (`/engineering-insights`), Phase 7 (`/pr-self-review`).

**Budget.** Measured 2026-08-10: an `implementer` costs ≈67k tokens before its first edit —
eleven injected skill bodies plus the in-scope `INSIGHTS.md` in full — so reckon 70–90k per
dispatch. Fifteen of them is **≈1.05–1.35M tokens**, and the reviewers, the fix rounds and
the doc pass put a realistic total at **≈1.3–1.8M**, over several hours of wall-clock. A
three-minute `running` status is not a hang.

## Phases

| Phase | Agent | Model | Result | Artefact |
|---|---|---|---|---|
| 0 validate | — | — | **pass**, with two questions raised for the human | `run.md` |
| 1 wave 1 | implementer | opus | **T1 complete.** The contract in both copies, byte-identical, 11 symbols; `contracts/brief.ts` untouched in both. `depcruise` unmoved at 22 warnings | `reports/wave1-t1.md` |
| 1 wave 2 | implementer | opus | **T2 complete**, no deviations. `risk_brief` moved to `openrouter` / `deepseek/deepseek-v4-flash` in all three declarations; the two `platform.ts` copies still hash identically | `reports/wave2-t2.md` |
| 1 wave 3 | implementer ×2 | opus | in flight — T3 (schema + migration `0019`) ‖ T4 (`messages/en/prBrief.json`) | — |
| 1 waves 4 … 11, 2 … 7 | — | — | not started | — |

## Finding ledger

| ID | Source | Severity | Bucket | Rounds | Status | Where |
|---|---|---|---|---|---|---|
| P3-1 | architecture-reviewer (SUGGESTION) | SUGGESTION | mechanical | 0 | **open** | Six new client files label the feature `(L06)` while the branch, the spec (SPEC-03) and every other file in the diff are L05: `BriefCard/{BriefCard.tsx,constants.ts,helpers.ts,styles.ts}`, `PrDetailView.tsx:79`, `lib/hooks/brief.ts`. The reviewer named two; the orchestrator's own `grep -rn "L06"` found six. Comment text only. The other `L06` hits in the tree (`SkillEditor/constants.ts`, `contracts/eval-ci.ts`, `repo-intel/README.md`) are pre-existing and legitimately about a future lesson |
| P3-2 | architecture-reviewer (SUGGESTION) | SUGGESTION | accepted | 0 | **accepted** | `modules/brief/assemble.ts` importing `approxTokens` from `adapters/tokenizer` makes it the **second** in-package consumer of an adapter-side port, which `layer-map.md` names as the trigger to move `Tokenizer` into `vendor/shared` instead. No `depcruise` rule governs it, the guidance is advisory, and it repeats `project-context/service.ts`'s existing shape rather than inventing one. Accepted for this feature; the promotion is its own change with its own agreement |
| P1-1 | wave 2 report (`## For the parent`) | CRITICAL | mechanical | 0 | **open** | `server/test/settings-models.it.test.ts:54-57` asserts `resolveFeatureModel(… 'risk_brief')` equals `{ provider: 'openai', model: 'gpt-4.1' }` — the exact pair AC-61 changes. Confirmed by the orchestrator at the source line. Outside every task's Owned paths, so no implementer may fix it in place; queued for the first remediation round. Dangerous rather than merely wrong: no gate typechecks `server/test/` (`server/INSIGHTS.md`, 2026-08-10) and a whole-suite run silently skips most `.it.test.ts` files (2026-08-06), so it can stay red while every visible signal is green |

## Plan corrections made during the run

The skill repairs no plan. These two are gate defects found by an implementer and fixed
because a gate whose comment contradicts its own logic is the failure mode the cross-model
review's three CRITICALs were about — not task content, and no task's scope changed.

| What | Was | Now |
|---|---|---|
| T1 prose | "declaring the twelve new symbols" over an enumeration of eleven | "eleven" |
| T1 Done-condition comment | "Assert the twelve symbols by name — 12 lines expected" over a loop that echoes only `MISSING:` lines | "Assert the eleven symbols by name. The loop echoes only MISSING: lines, so 0 lines = pass" |

## The two Phase-0 questions, answered by the human 2026-08-20

1. **The untracked files.** `specs/Untitled` deleted — 53 bytes of IDE accident inside the
   specs directory, contents read before removal (one line of chat text, nothing else).
   `HOME-TASK05.md` and `PROMPT.md` stay untracked deliberately: they are the lesson's brief,
   not this feature's work, and they enter the reviewers' scope as untracked context rather
   than as a change to judge.
2. **The two `test-writer` rows.** `client/…/PrDetailView/PrDetailView.test.tsx` **moves to
   T10**, which already owns `PrDetailView.tsx` — a test written inside that dispatch is free.
   `server/test/brief.it.test.ts` stays deferred to a separate `test-writer` dispatch after
   the run, because Docker is not authorised in an implementer dispatch and `DDG-TEST-001`
   forces the `.it.test.ts` name. **`plan.md` is not amended for this** — this skill repairs
   no plan — so the reassignment is carried in T10's dispatch text and recorded here.

## Next step

Phase 1, wave 1: `T1`, the contract file in both `vendor/shared` copies.
