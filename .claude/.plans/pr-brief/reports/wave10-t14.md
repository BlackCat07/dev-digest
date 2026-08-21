# Implementation report — PR Brief / T14

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 1 file changed, 1 added, nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 5 relevant (2026-08-11 — `GET /pulls/:id` is the only writer of `pull_requests.body` and `pr_files`, and the list-route trigger is what made 15 of 21 `pr_intent` rows title-only; 2026-08-06 / 2026-08-07 — a discarded `job.done` killed the API twice, central catch added, per-caller catch still wanted; 2026-08-19 — a grep gate that passes on zero lines is failed by a doc-comment, and `grep` needs `-a`; 2026-08-10 — no gate typechecks `server/test/`; 2026-08-04 — zsh empties `${PIPESTATUS[0]}`).
- INSIGHTS client: not in scope — no client file in T14's Owned paths.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `fastify-best-practices` | preloaded (+ `rules/routes.md` read) | `server/src/modules/pulls/routes.ts` |
| `onion-architecture` | preloaded (+ `layer-map.md` read) | `server/src/modules/pulls/routes.ts` |
| `security` | preloaded (+ `checklists.md` read) | `server/src/modules/pulls/routes.ts` |
| `typescript-expert` | preloaded | both changed files |

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/pulls/routes.ts` | T14 | yes | one `triggerBrief` closure beside `triggerIntent` (`void container.brief.requestGeneration(workspaceId, pr.id, {}, app.log).catch(…)`), called on both exits of `GET /pulls/:id` — the GitHub-refresh return and the offline persisted return. **No import added, no query added.** |
| `server/test/brief-trigger.test.ts` | T14 | yes | new, hermetic, no `.it.` segment: 4 tests over `needsGeneration` framed as the trigger's own question (no brief → one; fresh key → none; claim in flight → none; claim past `BRIEF_STALE_AFTER_MS`, or with a null `startedAt` → one; moved key / null key / invalid body → one), plus 3 tests over the call site's source text (both exits call it, exactly one closure; the call is `void`-ed, `.catch`-ed, never `await`ed, options object empty; the file contains no `t.prBrief` access) |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R19 — a detail read starts a generation when no stored brief matches the current state, and enqueues none while one is in flight | T14 | yes — the trigger delegates both decisions to `BriefService`; the test asserts the predicate that defines them, and the `.it` half is `test-writer`'s |
| T14 acceptance — both exits call the trigger | T14 | yes — asserted, and **mutation-checked**: removing the offline-path call turns that test red (verified, then restored; `git diff` shows 53 insertions and no deletions) |
| T14 acceptance — the call is `void`-ed and `.catch`-ed | T14 | yes — asserted on the sliced closure text |
| T14 acceptance — the hermetic test asserts the service's predicate, not the route | T14 | yes |

## Deviations from the plan

- **`triggerBrief()` takes no argument**, where the plan says "exactly the same shape" as `triggerIntent(headSha)`. `BriefService.requestGeneration(workspaceId, prId, options?, log?)` re-reads the pull-request row itself (its workspace-scoped `getPull` is the authorization check), so a head SHA passed from the route would be a second copy of a value the service must load anyway — and re-deriving it here is what `DDG-ARCH-001` forbids. The ordering constraint that made `headSha` explicit for intent is preserved instead by **call position**: on the refresh path the trigger sits after the `update` that writes the refreshed head, files and body, and the comment says so.
- **One intended test assertion was rewritten.** `expect(trigger).not.toMatch(/force/)` would have been failed by the closure's own comment explaining why it never forces — the same doc-comment pressure `server/INSIGHTS.md` records for grep Done-conditions (2026-08-19), now observed inside a test. Rewritten as a positive assertion on the argument list (`requestGeneration(workspaceId, pr.id, {},`).

## Gates

| Package | Gate | Result |
|---|---|---|
| server | typecheck | pass — 0 errors, before and after |
| server | typecheck (tests) | pass — 16 errors, `pre-existing`, byte-identical list before and after (`diff` of the two error sets: IDENTICAL) |
| server | lint | pass — rc=0, no output |
| server | onion | pass — `x 22 dependency violations (0 errors, 22 warnings)`, **measured before the first edit and after: unchanged** |
| server | unit | pass — **741** passed across 56 files (baseline 734 across 55; +7 in the new file), 0 failures |
| server | `DDG-WIRE-002` | pass — 0 lines |
| server | `DDG-WIRE-001` | pass — 0 `UNREGISTERED:` lines |
| server | integration | gate did not run — needs Docker, not authorised on this dispatch |
| client / e2e | — | gate did not run — no client file touched; `e2e.sh` is not part of this plan |

## Not done

- `absent` — the route half of AC-58 (a real `pr_brief` row, a real claim, two concurrent reads). Needs Postgres; `server/test/brief.it.test.ts` is `test-writer`'s and was not touched.
- `not checked` — whether the trigger's clone walk is acceptable on a large repository. T14's own text says to measure it on a big clone before trusting any figure; that needs a running stack and a large clone.
- `not checked` — T15. `GET /pulls/:id/brief` has not been exercised against a real database.

## For the parent

- Until the `0019_*` migration is applied, every `GET /pulls/:id` now fires a background generation whose first store read hits a `pr_brief` table without the new columns — and that failure lands in the trigger's `.catch` as a log line (`PR brief generation not started`) rather than in the response, so the pull-request detail page keeps working and **the breakage is quiet**. That is by design here, but it means T15's `information_schema` check is the only thing that will surface it.
- Candidate for `server/INSIGHTS.md`: a source-text assertion is the only hermetic way to pin "called on **both** exits of a handler with two returns" — a dropped second call site is invisible to every other gate (`tsc`, `eslint`, `depcruise` and the suite all stay green, and the offline path simply never produces a brief). Evidence: `server/test/brief-trigger.test.ts` (`the trigger at its call site`), `server/src/modules/pulls/routes.ts` (`triggerBrief`); mutation-verified by removing the offline-path call.
- Related candidate, same file: an assertion of that kind must be scoped the way a grep gate is. `expect(trigger).not.toMatch(/force/)` was failed by the closure's own comment saying it never forces.
- `plan-verifier` has not been run, and T15 is still outstanding.

---

## Parent's notes on this report

**The task most likely to move the `depcruise` baseline did not move it.** `pulls/routes.ts`
already carries a `routes-no-data-access` warning inside the 22, and any query added there would
have added a second. The implementer added **no import and no query** — it reaches the brief only
through `container.brief` — and measured the baseline before its first edit and after. Unchanged.

**The `triggerBrief()` signature deviation is right and the reasoning is the interesting part.**
The plan said "exactly the same shape" as `triggerIntent(headSha)`, and copying that shape
literally would have passed a head SHA the service must load anyway — a second copy of a value,
which is the re-derivation `DDG-ARCH-001` forbids in a route. The ordering guarantee that made the
argument necessary for intent is preserved by **call position** instead: on the refresh path the
trigger sits after the `update` that writes the head, the files and the body.

**A doc-comment failed a test assertion, inside a test, for the same reason it fails grep gates.**
`expect(trigger).not.toMatch(/force/)` was failed by the closure's own comment explaining that it
never forces. This is the third time in this run that the 2026-08-19 "a zero-match check is failed
by prose" pattern has appeared, and the first time inside a test rather than a shell gate — which
is what makes it worth a new entry rather than a citation.

**One consequence to carry into T15, stated plainly by the report:** the trigger now fires on every
`GET /pulls/:id`, and until the migration is applied its store read fails into the `.catch` as a log
line rather than into the response. The page keeps working and the breakage is **silent** — so
T15's `information_schema` query is not a formality, it is the only thing that would surface it.
