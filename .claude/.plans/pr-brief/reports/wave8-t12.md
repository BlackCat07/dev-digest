# Implementation report — SPEC-03 PR Brief / T12

**Status: complete.**

Reported as of `34cb66e`; the run's actual base is `06d7488`. Worktree dirty from earlier waves; T12 added 5 files and changed none. Nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 9 relevant — 2026-08-19 (two prompt-template renderers disagree about a missing variable; `platform/prompts.ts` leaves the literal `{{name}}`), 2026-08-05 (where the "is this input trusted?" decision lives is the **service**, and a second wrap makes the first read as data), 2026-08-19 (a grep gate that passes on zero lines is failed by a doc-comment — fix the prose, not the gate), 2026-08-19 (`grep` without `-a` silently scans nothing on two files in `src/modules/`), 2026-08-10 (no gate typechecks `test/`; 16 errors across 6 files was the measured baseline), 2026-08-19 (`== null` and an explicit throw rather than `!`), 2026-08-14 (`import type` does not exempt a cross-module edge), 2026-08-02 (`pnpm <script>` can die before the script runs), 2026-08-04 (zsh: empty `${PIPESTATUS[0]}`, no word-splitting).
- INSIGHTS client: not read — no client file in T12's Owned paths.
- INSIGHTS reviewer-core: not read — `reviewer-core/**` is forbidden by N3. Its 2026-08-07 entry is quoted in the plan and was applied from there; `reviewer-core/src/prompt.ts` was opened **read-only** to verify the `INJECTION_GUARD` claim.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `security` | preloaded | `src/prompts/brief.system.md`, `src/modules/brief/prompt.ts`, `src/modules/brief/grounding.ts` |
| `zod` | preloaded | `src/modules/brief/schemas.ts` |
| `onion-architecture` | preloaded | all three `src/modules/brief/*.ts` |
| `typescript-expert` | preloaded | all changed `*.ts` |

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/prompts/brief.system.md` | T12 | yes | new template: its own SECURITY untrusted-data clause, the "you have not seen the diff" limits, the field rules, the closed risk-kind set, the caps, and "you are not asked for a risk level". 10 `{{…}}` variables, all supplied |
| `server/src/modules/brief/schemas.ts` | T12 | yes | new — `BriefRiskKind`, `DraftRisk`, `DraftReviewFocus`, `PrBriefDraft`. No `.optional()`, no array bound, no numeric range keyword, **no risk-level field** |
| `server/src/modules/brief/prompt.ts` | T12 | yes | new — `loadTemplate`, `buildSystemMessage`, `buildBriefMessages`; one `wrapUntrusted` per block, system message = rendered template only, and the post-wrap `approxTokens(system) + approxTokens(user)` re-measurement |
| `server/src/modules/brief/grounding.ts` | T12 | yes | new — `groundBriefDraft`, `blastReferences`; the three citation rules, the caps, the derived level, the title-restatement check |
| `server/test/brief-prompt.test.ts` | T12 | yes | new — 10 tests: the clause, no unrendered placeholder, AC-55, AC-54/56, EC-30, AC-12, the delimiter overhead, AC-16, the stale-shed defect, AC-11 |
| `server/test/brief-grounding.test.ts` | T12 | yes | new — 24 tests over AC-22 … AC-27, EC-15, EC-16, EC-17 and `blastReferences` |

No existing file under `src/prompts/` was touched, `reviewer-core/**` was not touched, and no other file under `modules/brief/` was touched.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R5 — eight sources, no diff hunk body, every string traceable | T12 | yes — `prompt.ts` places exactly the blocks the assembly produced; the tests assert all eight kinds present and wrapped, and that no substring of a patch reaches either message |
| R9 — one structured request against a draft schema | T12 | yes for the half T12 owns — `PrBriefDraft` and `BRIEF_SCHEMA_NAME`'s subject. The round-trip cap, the 75 000 ms race and the model choice are T13's |
| R10 — risk citations grounded, path-only comparison, suffix kept, all-dropped risk dropped, no-path risk kept | T12 | yes — five tests, one mutation-verified |
| R11 — review focus only from the changed-file list; endpoints among the blast map's impacted | T12 | yes, with a deviation on **where** an endpoint can be named — see below |
| R12 — level derived, never taken; a `what` restating the title stored as null and the brief partial | T12 | yes — `riskLevel` derived in `grounding.ts`, the draft has no field for one; `restatedTitle` reported for T13 |
| R18 — every foreign input wrapped exactly once, no foreign text in the system message, a closing delimiter escaped | T12 | yes — and the clause AC-54's delimiters depend on is asserted on the **rendered** text |

## Deviations from the plan

- **AC-25's endpoint citations ride in the draft's `file_refs`, not in a field of their own.** The stored `Risk` (`contracts/brief.ts`, frozen) has exactly `kind, title, explanation, severity, file_refs`. A separate `endpoint_refs` on the draft would have had nowhere to land, so every surviving endpoint would be discarded and AC-25's observable — "stores the item **without** it" — would pass vacuously, which is the "gate that certifies work it cannot see" shape this plan's review history names. So one citation field carries both kinds and two rules check it: a whole-string match against the blast map's impacted labels, then a path match with the `:line` suffix stripped. The prompt tells the model this in as many words. Mutation-verified: deleting the endpoint arm turns exactly one test red.
- **The review-focus half of AC-25 is vacuous by construction, and that is recorded rather than papered over.** `ReviewFocusItem` is `{ path, line, reason }`; `path` is grounded strictly against the changed-file list by AC-24 and no other field can name an endpoint. Checking an endpoint string inside `reason` would need prose pattern matching, which the plan forbids.
- **`buildBriefMessages` returns a discriminated refusal rather than throwing**, with `kind: 'core_over_budget' | 'shed_incomplete'`. The plan required the two be *distinguished*; this is the mechanism, and it keeps T13's "never throws for anything the brief can describe" reachable while leaving the defect case labelled as a defect.
- **`grounding.ts` also exports `blastReferences`.** "The blast map's referenced files" is a derivation, not a value the caller holds, and it belongs beside the rule that consumes it.
- **Two drop rules the plan did not enumerate**, both stated in the code: a risk with no title is dropped (the intent layer's precedent — a chip with no label cannot be rendered or clicked), and a review-focus row with no reason is dropped (the reason is the only part the model contributes).
- **The intent layer's `kindFromPaths` correction is deliberately not copied.** It rewrites a vague `other` from the cited paths; this card renders a neutral icon for an unrecognised kind, and a second path-shaped opinion about a category is a rule nobody asked for here.

## Gates

| Package | Gate | Result |
|---|---|---|
| server | typecheck | pass — 0 errors |
| server | typecheck (tests) | pass — **16** errors, unchanged from the baseline; none in a file this task touched |
| server | lint | pass — five paths quoted individually |
| server | onion | pass — `x 22 dependency violations (0 errors, 22 warnings)` |
| server | unit | pass — **706** passed across 54 files (baseline 672 across 52; +34), 0 failures |
| server | `node:` import grep | pass — 0 lines |
| server | sibling-module import grep | pass — 0 lines |
| server | `DDG-WIRE-002` | pass — 0 lines |
| server | integration | gate did not run — Docker not authorised |
| client / e2e | — | gate did not run — no client file touched, no browser flow in this plan |

Three assertions were mutation-verified rather than merely observed green, each turning exactly one test red: deleting the template's `## SECURITY` section, dropping the endpoint arm of the citation check, and letting a review-focus row ground against the blast files.

## Not done

- `absent` — the service, the routes, the registration and the container binding (T13), and the detail trigger (T14).
- `not checked` — that the assembled prompt holds under 8 000 tokens on a real 400-file pull request. The ceiling is enforced and tested at a 100-token budget; AC-13's own figure needs real `pr_files` data and is T13/T15 territory.
- `not checked` — anything requiring a live provider or Postgres.

## For the parent

- **Measured, and it is the cross-model finding reproduced exactly:** with the `## SECURITY` section deleted from `brief.system.md`, **9 of the 10** tests in `test/brief-prompt.test.ts` still passed — the blocks were still wrapped once each, the system message still carried no foreign text, the budget still held. Only the assertion written against the *rendered clause* failed. Candidate for `server/INSIGHTS.md`: a wrapping-mechanics test suite is not evidence of an injection defence, because the delimiters are inert without a sentence telling the model what they mean, and this module reaches no shared guard (`INJECTION_GUARD` is a non-exported const at `reviewer-core/src/prompt.ts:16`, used only at lines 114–115 inside `assemblePrompt`).
- **For `plan-verifier` and whoever reviews the boundary:** the AC-25 deviation is the one place T12's output shape differs from a literal reading of the plan. `DraftRisk.file_refs` carries paths *and* endpoint labels; `ReviewFocusItem` carries no endpoint at all. If that is wrong, the fix is a contract change (`Risk` gaining an endpoint field), which is `vendor/shared` and needs its own agreement.
- **For T13's implementer:** `buildBriefMessages` returns `{ ok: false, kind: 'shed_incomplete' }` when the messages are over budget with an optional block still present. That is an arithmetic defect in the shed loop, not a size fact about the pull request — log it as such rather than storing `inputs_too_large`. `groundBriefDraft` needs `AssembledInput.groundingPaths` (not `changedPaths`) as `listedPaths`, and `blastReferences(blast)` produces the other two fields of its context.
- `PrBriefDraft` was probed through `platform/structured.ts`'s `toJsonSchema` in a throwaway test (since removed): it produces no `minimum` / `maximum` / `minItems` / `maxItems` / `minLength` / `maxLength` keyword, so the Anthropic-via-OpenRouter rejection recorded in `reviewer-core/INSIGHTS.md` (2026-08-07) is not reachable from this schema.
- `plan-verifier` has not been run, and `specs/pr-brief.md` was read as input only.

---

## Parent's notes on this report

**The cross-model CRITICAL is now a measurement, not a prediction.** With the `## SECURITY`
section deleted, **9 of 10** prompt tests still passed: every block still wrapped exactly once,
no foreign text in the system message, the budget still held. Only the assertion written against
the *rendered clause* failed. That is the finding in one number — a wrapping-mechanics suite is
not evidence of an injection defence, because the delimiters are inert without a sentence telling
the model what they mean. Strongest `INSIGHTS` candidate of the run; held for Phase 6.

**The AC-25 deviation is a real spec-versus-frozen-contract collision and is entered in the
ledger.** The stored `Risk` in `contracts/brief.ts` has exactly five fields and no endpoint among
them. So a draft field of its own would have had nowhere to land, and every surviving endpoint
would have been discarded — making AC-25's own observable ("stores the item without it") pass
**vacuously**. The implementer instead carried both citation kinds in `file_refs` with two
distinct rules, told the model so in the template, and mutation-verified the endpoint arm. It also
said plainly that the review-focus half of AC-25 is vacuous **by construction**, because
`ReviewFocusItem` has no field that could name an endpoint. That is the honest reading and it
needs a human's eye at Phase 3, not a silent fix.

**Three mutation checks again, unprompted.** This is now the fourth task in the run to verify its
own assertions by breaking the implementation rather than trusting a green line.
