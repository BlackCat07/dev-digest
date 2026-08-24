# Implementation report — SPEC-03 PR Brief / T7

**Status: complete.**

Reported as of `34cb66e`; the run's actual base is `06d7488`. Worktree dirty from waves 1–4;
**3 files changed by this task, 0 added, 157 insertions and 0 deletions, nothing committed.**

## Coverage

- INSIGHTS server: 55 entries, 6 relevant (2026-08-19 — `grep` reports nothing on `project-context/service.ts` without `-a`, it carries a NUL byte; 2026-08-10 — no gate typechecks `server/test/`, measured 16 errors across 6 files; 2026-08-14 — `import type` does not exempt a cross-module edge, `depcruise` counts it; 2026-08-19 — "a listing that opens no files" vs. a character-derived token count are contradictory, which is exactly why the new method returns metadata and no tokens; 2026-08-19 — `== null` over `!` on a nullish contract field; 2026-08-02 — `pnpm <script>` can die before the script runs).
- INSIGHTS client: no receipt taken — no `client/` file is in T7's Owned paths and none was opened. The other implementer in this wave owns that package.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `server/src/modules/project-context/{types,service}.ts` |
| `typescript-expert` | preloaded | all three changed files |
| `drizzle-orm-patterns` | preloaded | — named by the plan; **nothing to apply**: the method adds no query and `repository.ts` is forbidden and untouched |
| `zod` | preloaded | `service.ts` — no new schema and no new `parse`; the return type reuses the contract's `z.infer` alias |
| `security` | preloaded | `service.ts` — confidence gate: no route exposes the method, no attacker-controlled input reaches it, and it inherits `resolveForRun`'s scoping posture. Nothing to report |

Matches the plan's routing table: yes, plus `zod` and `security`, whose rows matched the changed file even though T7's `Skill:` line names only three.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/project-context/types.ts` | T7 | yes | `EffectiveContextDoc` added to the existing `import type { … } from '@devdigest/shared'`; one method, `listEffectiveDocs(agentId, repoId): Promise<EffectiveContextDoc[]>`, appended to the `ProjectContext` interface with the doc-comment stating why it exists and why it takes no `workspaceId`. No existing member touched |
| `server/src/modules/project-context/service.ts` | T7 | yes | `EffectiveContextDoc` added to the existing type-only import; `listEffectiveDocs` implemented as the same two store reads plus the same `mergeEffectiveAttachments(own, inherited, repoId)` call, returning `.effective` and stopping there. No `repoDocs` call, no text, no token count. Placed after `resolveForRun`, before the private helpers |
| `server/test/project-context-effective.test.ts` | T7 | yes | one `describe` block appended, three tests, over the file's existing `store()` / `reader()` / `deps()` fakes. Nothing above it altered |

The two facts worth naming, because they are what make this additive rather than a redesign:

- `EffectiveAttachment` (this module's own row type) is already field-for-field the contract's `EffectiveContextDoc` — `{ path, source: ContextDocSource, order: number }` — so `merged.effective` satisfies the declared return type **structurally**, with no `as` and no mapping step.
- The interface widening breaks no fixture: the only other `projectContext` fake in the suite (`test/project-context-run.test.ts:133`) reaches the container through `as unknown as Container`, so it never had to satisfy `ProjectContext` in the first place.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R20 | T7 | yes — for T7's half. `listEffectiveDocs` is the per-agent effective set, deduplicated by path with the first occurrence winning, ordered agent-then-attachment. The **union over the repository's enabled agents** is T11's, not in this dispatch |

T7's own Acceptance clause, line by line:

| Acceptance line | Met |
|---|---|
| Same paths, same order, as `resolveForRun`'s `paths` for an agent whose every document reads cleanly | yes — asserted as an equality between the two methods' answers over one store fixture, not against two hand-written literals |
| A document attached directly **and** through two skills appears once, at the agent's position | yes — `specs/shared.md`, sourced `{ kind: 'agent' }`, at index 0 |
| A document reached through a **disabled** skill does not appear | yes — `docs/off.md` absent |
| A document belonging to another repository does not appear | yes — `specs/elsewhere.md` absent |
| **No** `repoDocs.read` call, asserted with a fake that throws on `read` | yes — the test injects `reader({})`, whose `read` and `list` both throw. **Mutation-verified:** inserting one `repoDocs.read` call into `listEffectiveDocs` turns 2 tests red with `read must not be reached in this case`; the file was restored from a copy taken before the mutation and `git diff --stat` reads `23 ++++` on `service.ts`, i.e. the real change only |

The same fixture also leaves `getRepoById` and `repoNames` `unreachable`, so the test proves the method resolves no clone and looks up no repository name either.

## Deviations from the plan

None.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0 |
| server | typecheck (tests) | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | **16 errors before the first edit, 16 after** — same 6 files, same distribution. All `pre-existing`; none in a file this task touched |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/modules/project-context/types.ts" "src/modules/project-context/service.ts" "test/project-context-effective.test.ts"` | pass — rc=0, paths quoted separately |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings)`, identical to the pre-edit baseline measured on this tree |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 50 files, **631 passed** (baseline before these edits: 50 files, 628 passed; the three new ones are this task's). 0 failures |
| server | `DDG-WIRE-002` | the `gate.md` grep, verbatim, with `-a` — load-bearing on this exact file | pass — 0 lines |
| server | `DDG-WIRE-001` | the `gate.md` loop | pass — no `UNREGISTERED:` line. T7 adds no `routes.ts` |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised on this dispatch |
| client | — | — | gate did not run — no `client/` file was touched |

## Not done

- `absent` — `repository.ts`, `routes.ts` and `constants.ts` carry no change. The new method needs no new query, no new route and no new constant; all three are in T7's Forbidden list and `git status` shows them untouched.
- `absent` — no consumer. `listEffectiveDocs` has zero callers after this task; T11 is the first.
- `not checked` — every existing method's runtime behaviour beyond what the suite covers. The diff is 157 insertions and 0 deletions and no line of the seven existing methods was edited, but the evidenced guarantee is 628 → 631 passing with no failure.
- `not checked` — the DB-backed half and the browser flows.

## For the parent

- Candidate for `server/INSIGHTS.md`: `test/project-context-effective.test.ts`'s `store()` / `reader()` helpers default **every** port method to a thrower (`unreachable(name)`), which turns "this method reads no bytes and resolves no clone" from prose into a failing test naming the offending method. It is the only mechanism in this package that proves such a negative, and it is reusable — the mutation check above showed it fires. Evidence: `test/project-context-effective.test.ts` (`unreachable`, `reader({})`), `src/modules/project-context/service.ts` (`listEffectiveDocs`).
- The plan's prediction about `tsconfig.eslint.json` held exactly: **16 errors across 6 files, before and after.** Any wave that reports a higher number owns the delta.
- `specs/pr-brief.md` was not opened for writing and no `Status:` line moved. T7's change is the one the plan records a human approving against the spec's N1 (`## Open questions` Q1) — worth carrying into the hand-off, since N1's text still reads "changes none of [its dependencies'] behaviour" and this adds a method to one of them. That correction is `doc-writer`'s, not mine.
- `plan-verifier` has not been run, and `test-writer` is not dispatched on this run.

---

## Parent's notes on this report

**The negative assertion is the whole task and it is properly proved.** "This method reads no
bytes and resolves no clone" is a claim about what *does not happen*, and the only way to
evidence it is a fake that throws on every port method the implementation must not reach. The
test does that, and the implementer then **mutated its own implementation** — inserting a
`repoDocs.read` call — to confirm two tests go red rather than assuming the guard fires. That is
the difference between a test that would catch a regression and one that merely passes today.

**The `unreachable(name)` pattern is a real `INSIGHTS` candidate and is held for Phase 6.** It
generalises well beyond this feature: any port-based module can prove "this path performs no
I/O" the same way, and nothing in the repository records the technique.

**One flag carried forward for `doc-writer`, not for this run.** The spec's N1 still reads that
this feature "changes none of [its dependencies'] behaviour", and T7 adds a method to one of
them. A human approved exactly that trade (the plan's Q1), so the code is right and the spec's
wording is now imprecise. It belongs in the `approved → implemented` pass, not in a fix round.
