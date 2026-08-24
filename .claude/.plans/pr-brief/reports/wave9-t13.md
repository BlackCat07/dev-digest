# Implementation report — SPEC-03 PR Brief / T13

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 2 files changed, 3 added, nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 13 relevant — 2026-08-06 (`StructuredRequest.timeoutMs` is ignored and `maxRetries` defaults to 2, so both bounds are required); 2026-08-06 / 2026-08-07 (a discarded `job.done`, and a `queued`/`running` state needs a staleness window); 2026-08-10 (no gate typechecks `server/test/`); 2026-08-11 (`GET /pulls/:id` is the only writer of `body` and `pr_files`); 2026-08-14 (`import type` does not exempt a cross-module edge); 2026-08-14 (an exit that omits an optional field makes a correct consumer report the wrong status); 2026-08-10 (a helper taking the whole `Container` closes a cycle); 2026-08-19 (`grep` needs `-a`); 2026-08-19 (a grep gate scoped to an import specifier); 2026-08-02 (`pnpm <script>`); 2026-08-04 (zsh `PIPESTATUS`); 2026-08-02 / 2026-08-19 (a jsonb read back arrives with keys absent); 2026-08-19 (a green tree still 500s when the migration was never applied — T15's).
- INSIGHTS client: 32 entries, 1 relevant — 2026-08-11 (a mutation omitting an optional request field is a silently successful no-op; the route therefore takes `GenerateBriefPayload.nullish()`). No client file was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `service.ts`, `routes.ts`, `platform/container.ts`, `modules/index.ts` |
| `fastify-best-practices` | preloaded | `modules/brief/routes.ts` |
| `zod` | preloaded | `service.ts` (the job payload — `safeParse`, never `.parse`), `routes.ts` |
| `security` | preloaded | `service.ts` (the workspace lookup as the authorization check, the issue read's single-repository surface), `routes.ts` |
| `typescript-expert` | preloaded | all changed `*.ts` |

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/brief/service.ts` | T13 | yes | new — `BriefService implements PrBriefs`: `registerJobHandler`, `getBrief`, `requestGeneration`, `runGeneration`, the one bounded call, the grounding hand-off, persistence and the single log line; plus the exported pure predicate `needsGeneration` and `resolveOutcome` |
| `server/src/modules/brief/routes.ts` | T13 | yes | new — `GET /pulls/:id/brief` at 60/min; `POST /pulls/:id/brief/generate` with `GenerateBriefPayload.nullish()` and a per-pull-request `keyGenerator` at 10/hour; job-handler registration with `app.log` |
| `server/src/modules/index.ts` | T13 | yes | one import line, one registry entry `brief`, and `brief` deleted from the doc-comment's "not yet" list |
| `server/src/platform/container.ts` | T13 | yes | the `brief` getter (binds `BriefRepository` and the twelve ports), a `brief?` field on `ContainerOverrides`, one private cache field, three imports. T5's `fileRole` property was read, not reconstructed, and nothing else in the file moved |
| `server/test/brief-service.test.ts` | T13 | yes | new — 28 hermetic tests over `BriefDeps` and a mock provider |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 — a read answers the stored brief, no call, no write, reports key agreement | T13 | yes — asserted over 100 reads (byte-identical payloads, empty write list) and by the stale flip |
| R3 — rebuild on a differing key, no call when it matches, `force` rebuilds regardless | T13 | yes — three tests |
| R4 — a second generation refused; a >5-minute claim treated as abandoned | T13 | yes — through `claimRunning`'s return value only; the fake store models the statement's `WHERE` term for term, including `started_at IS NULL` |
| R9 — one structured request, one round-trip, a 75 000 ms deadline, the `risk_brief` model choice | T13 | yes — `maxRetries: 0` asserted on the request, the deadline on fake timers, `featureModel` asserted as `[[workspace, 'risk_brief']]` |
| R13 — no call with no changed files; three distinguishable failure reasons; a skipped call names its precondition | T13 | yes — `no_changed_files` and `inputs_too_large` both assert `llmConstructed === []` |
| R14 — deterministic facts, no level, no risks, no review focus | T13 | yes for the four `BriefDiffStats` fields, the null level and the two empty lists. **The blast map's counts have no field in `PrRiskBrief`** — see `## For the parent` |
| R15 — a missing/failed intent is partial; a blast map that is not ok is partial carrying its own reason | T13 | yes — `no_intent`, and `index_partial` carried verbatim rather than re-derived |
| R16 — one source entry per offered input, plus the provenance and the figures | T13 | yes — sources come from the assembly untouched; every figure asserted readable back |
| R17 — the pull request is resolved in the workspace before any other read, and before a clone path | T13 | yes — `loadPull` is the first await of both entry points; a foreign workspace rejects `NotFoundError` with an empty write list |

The plan's own T13 acceptance list, item by item: a hundred reads with an empty provider call list — yes; two generations with nothing changed recording one call — yes; a forced request recording a second — yes; two in flight producing one accepted and one refusal with exactly one call — yes; a six-minute-old running row accepting a new generation — yes; three fixture providers (throwing, hanging, `{}`) producing three stored briefs with three different reasons and no HTTP error — yes.

## Deviations from the plan

- **`requestGeneration` answers a fresh brief with `jobId: ''`.** `PrBriefs` (T9's `types.ts`, not T13's) fixes the return at `{ status: 'accepted'; jobId: string }`, AC-5 requires no model call for an unchanged pull request, and R19/AC-58 needs the automatic trigger to enqueue *nothing* for a fresh brief — so the freshness check must sit in `requestGeneration` and there is no variant for "accepted, nothing to do". Documented at its declaration. The client already treats the field as optional and renders it nowhere.
- **`service.ts` exports one extra symbol, the pure predicate `needsGeneration(stored, cacheKey, now?)`.** T14's Acceptance says its hermetic test asserts "the service's own 'does this need a generation' predicate rather than the route"; this is that predicate, shaped like `intent`'s `needsDerivation`, and it keeps the freshness rule out of `pulls/routes.ts` (`DDG-ARCH-001`).
- **A blast reason with no `BriefReason` equivalent is carried as `null`, not translated.** `BlastReason` has `flag_off`; `BriefReason` does not. AC-32 says carry the map's own value, so it is passed through `BriefReason.safeParse` and an unmappable one yields `partial` with a null reason (the client's generic fallback, AC-49) rather than an invented third meaning.
- **The order among the three `partial` reasons** is `restates_title` → the blast map's reason → `no_intent`. The plan fixes each rule but not their precedence, and only one `reason` field exists. `restates_title` is first because it is the only one whose evidence is nowhere else on the card: a null `what` has no other explanation, while a partial index and a missing intent are both already in the `sources` audit trail.
- **Three reads are failure-tolerant rather than fatal:** a throwing blast read degrades to `degraded` / `index_failed` (a read of the brief must not 500 because the index misbehaved, and the key needs the map's status), and a throwing intent or prior-PRs read is treated as absent. Documented at each call site, including the caveat that a transient database error on the blast read reports as `index_failed`.
- **The linked-issue parse (nine lines) lives in `service.ts`.** The plan's Assumptions state the brief re-uses the intent layer's approach and not its code, because a cross-module import is not available; narrowed to the first referenced issue, since the assembly takes one.

## Blocked

None. Nothing outside T13's Owned paths was edited, and no contract, column or port needed a change.

## Gates

| Package | Gate | Result |
|---|---|---|
| server | typecheck | pass — 0 errors |
| server | typecheck (tests) | pass — **16** errors across 6 test files, identical to the baseline; none in `test/brief-service.test.ts` |
| server | lint | pass — 0 problems, five paths quoted |
| server | onion | pass — `x 22 dependency violations (0 errors, 22 warnings)` |
| server | `DDG-WIRE-002` | pass — 0 lines |
| server | `DDG-WIRE-001` (both parts) | pass — 0 lines; no `UNIMPORTED:` and no `UNREGISTERED:` |
| server | `DDG-WIRE-001` (own entry) | pass — exactly 1 line, `50:  brief,` |
| server | module boundary | pass — 0 lines |
| server | no filesystem module | pass — 0 lines |
| server | unit | pass — 55 files, **734** passed (baseline 54 / 706; +1 file, +28 tests), 0 failures |
| server | integration | gate did not run — Docker not authorised |
| client | — | gate did not run — no client file touched |

## Not done

- `absent` — no `*.it.test.ts` written or run. `server/test/brief.it.test.ts` is `test-writer`'s.
- `not checked` — migration `0019_misty_terrax.sql` is on disk (T3) and has **not** been applied; that is T15. The two routes this task adds will `500` until it is.
- `not checked` — the routes have never been exercised against Postgres, a real clone or a real provider. Every assertion here is hermetic.
- `not checked` — `DDG-UI-001`'s look in the running app; no rendered route changed here.

## For the parent

- `specs/pr-brief.md` AC-33's observable reads "a pull request with **no linked issue** and one unreadable document stores two entries". The assembly records a source entry only for an input that was *offered* — an issue the description never referenced produces none — and `test/brief-service.test.ts` now asserts that (`expect(kinds).not.toContain('linked_issue')`). Either reading is self-consistent; worth a decision by `plan-verifier` / `test-writer` before the `.it` pass pins the other one.
- R14 asks a degraded brief to carry "the blast map's counts". `BriefDiffStats` (T1's contract) has four fields and no place for them, so on the payload they reach nobody; they are in the single log line and on the Blast Radius card beside the brief. If they are wanted on the brief itself, that is a `vendor/shared` change and needs an agreement.
- Candidate for `server/INSIGHTS.md`: `MockLLMProvider.completeStructured` **throws** `MockLLMProvider fixture failed schema: …` when its fixture fails the schema, so a `{ structured: {} }` mock is the cheapest possible `model_invalid` fixture in this package — one of the three provider failure modes needs no locally-declared provider class at all, unlike the throwing and hanging ones. Evidence: `src/adapters/mocks.ts`, `test/brief-service.test.ts`.
- Candidate for `server/INSIGHTS.md`: a hermetic service test for a job-driven feature must use **real uuids** for its workspace and entity ids. Eight of these tests failed on `ws-1` / `pr-1` at the job-payload boundary, because the payload is validated (`z.string().uuid()`) rather than cast. Evidence: `src/modules/brief/service.ts` (`BriefJobPayload`), `test/brief-service.test.ts`.
- `plan-verifier` has not been run. T14 can reach the service through `container.brief.requestGeneration(...)` plus the exported `needsGeneration` predicate.

---

## Parent's notes on this report

**The module is registered and the strengthened gate proved it.** `grep -n "^  brief,$"` returns
exactly one line, `50:  brief,`, and both parts of the rewritten `DDG-WIRE-001` check are clean.
That gate exists because the original version — which checked only the import string — would have
passed a module that mounts nowhere and 404s. This is the first task in the run where it could
actually fire, and it did not.

**Two findings for the ledger, both about the contract rather than the code.** R14 asks a degraded
brief to carry the blast map's counts and `BriefDiffStats` has no field for them, so they reach the
reader through the log line and the neighbouring Blast card instead of through the payload. And
AC-33's observable presumes a source entry for a linked issue that was never referenced, while the
assembly records an entry only for an input that was *offered*. Both are `vendor/shared`-shaped or
spec-shaped, neither is an implementer's to settle, and both go to Phase 3.

**The `jobId: ''` deviation is the run's clearest example of the wave split biting.** `PrBriefs`
fixes the return type, T9 owns that file, and there is no variant for "accepted, nothing to do" —
so a fresh brief answers with an empty job id. The right call given the constraint, documented at
the declaration, and the client already ignores the field. Worth a cleaner shape if the contract is
ever revisited.

**The precedence among the three `partial` reasons was genuinely unspecified** and the reasoning
given for choosing it is sound: `restates_title` goes first because it is the only one whose
evidence appears nowhere else on the card, while a partial index and a missing intent are both
already visible in the `sources` audit trail.
