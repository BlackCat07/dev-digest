# Implementation report — eval-pipeline / T10

**Status: complete.**

4 files changed, 4 added, nothing committed. Work left uncommitted in the worktree.

> **Orchestrator note.** This report's own header named `b65d2da` / `L06-evals-and-plan-verifier`.
> That is a reporting slip, not a state problem: verified immediately after, the branch is
> `L06-homework` at `b35fe9b` with the three expected feature commits, and nothing had moved.
> Recorded because a wrong base in a report is exactly the kind of thing a later reader would
> trust.

## Coverage

- INSIGHTS server: supplied verbatim in the brief, taken as read — the plan's `## Constraints` plus the three the dispatch added; relevant here: `LocalNoAuthProvider.currentWorkspace` memoisation, no `node:` specifier under `modules/eval/`, `grep -a` + "grep exits 1 on no match is the passing case", the `tsconfig.eslint.json` hole that makes a bad test import invisible, `pnpm <script>` pre-script hazard, `200`-is-not-registration, `rateLimit: false` on SSE. Did not open `server/INSIGHTS.md` — the supplied set named a hazard for every path I touched.
- INSIGHTS client / reviewer-core / e2e / mcp-server / evals: 0 relevant per the dispatch; no file in those packages was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `modules/eval/{schemas,routes}.ts`, `platform/container.ts`, `modules/agents/{routes,service}.ts` |
| `fastify-best-practices` | preloaded | `modules/eval/routes.ts`, `modules/agents/routes.ts`, both test files |
| `zod` | preloaded | `modules/eval/schemas.ts`, `modules/agents/service.ts` |
| `security` | preloaded | `modules/eval/routes.ts`, `modules/agents/routes.ts` |
| `typescript-expert` | preloaded | all changed `*.ts` |

Matches the plan's routing table for T10 exactly. `drizzle-orm-patterns` / `postgresql-table-design` did not match (no `db/schema` file touched); the five client skills did not match (no client file touched).

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/eval/schemas.ts` | T10 | yes | new — 6 request schemas: three id-param objects, `CreateEvalCaseBody` (`.strict()`, `finding_id` only), `SaveEvalCaseBody` = the contract's `EvalCaseSave`, `StartEvalBatchBody`/`…Payload` (`nullish`), `EvalPeriodQuery` (`EvalPeriod.default(DEFAULT_PERIOD)`), `EvalCompareQuery` |
| `server/src/modules/eval/routes.ts` | T10 | yes | new — all 12 eval routes from the plan's endpoint table, schema-on-route, service calls only; SSE route with `config: { rateLimit: false }` bridging `container.runBus` exactly as `reviews/routes.ts` does; `rateLimit: { max: 10, timeWindow: '1 minute' }` on the two batch-starting routes; no `try`/`catch`, no db, no aggregate |
| `server/src/modules/index.ts` | T10 | yes | one aliased import `'./eval/routes.js'` + registry entry `eval: evalPipeline`; doc comment updated |
| `server/src/platform/container.ts` | T10 | yes | `ContainerOverrides.eval?: Evals`, `get eval(): Evals` binding T8's shape with **one** shared `EvalRepository` instance and no bounds passed, `readonly diffParser = (raw: string): UnifiedDiff => parseUnifiedDiff(raw)` beside `featureModel`/`fileRole` |
| `server/src/modules/agents/service.ts` | T10 | yes | `AgentPromotionStore<TRow>` port + exported `promoteAgentVersion()` (parses `AgentVersionConfig` with `safeParse`, feeds it through `repo.update`), plus a thin `AgentsService.promoteVersion` |
| `server/src/modules/agents/routes.ts` | T10 | yes | `POST /agents/:id/versions/:version/promote` on the existing `VersionParams`, no body, `404` on unknown agent/version |
| `server/test/eval-routes.test.ts` | T10 | yes | new — 8 hermetic `app.inject` tests through `ContainerOverrides.eval` + a fake `AuthProvider` |
| `server/test/agents-promote.test.ts` | T10 | yes | new — 5 hermetic tests over `promoteAgentVersion` with a recording fake |

`agents/repository.ts`, `app.ts`, `adapters/**` and the six earlier eval-module files were read and called, never edited.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 (create a case from a finding) | T10 | yes — route reached live: `POST /eval/cases` → `201` with the derived case |
| R2 (named refusals) | T10 | yes — passed through untouched; live `409 duplicate_source_finding` carries `{case_id, case_name}` |
| R3 (read an agent's set) | T10 | yes — `GET /eval/agents/:agentId/cases` → `200` |
| R4 (save / delete a case) | T10 | yes — `PUT`/`DELETE /eval/cases/:caseId` declared with `EvalCaseSave` |
| R5 (out-of-workspace ⇒ `404` service envelope) | T10 | yes — live `{"error":{"code":"not_found",…}}`, and a unit test asserts it |
| R6 (batch acknowledged as `running`) | T10 | yes — `202` with the batch, before any case executes |
| R8 (live event stream) | T10 | yes — SSE route; the replay-then-close path is a passing test |
| R13 (compare) | T10 | yes — `GET /eval/compare?a=&b=`, `422` without both |
| R14 (promotion) | T10 | yes — new higher version through `repo.update`, no `agent_versions` row mutated |
| R15 (dashboards, run-all) | T10 | yes — `/eval/dashboard`, `/eval/agents/:id/dashboard`, `POST /eval/dashboard/runs`; live `200` and `422` on an unknown period |

## Deviations from the plan

- **Status codes were not specified by the plan; I chose `201` for `POST /eval/cases` and `202` for the two batch-starting routes** (`202` matching `brief`/`onboarding` generate, which likewise acknowledge work that outlives the request). `apiFetch` accepts any 2xx, so the already-shipped client hooks are unaffected.
- **The promotion rule lives in an exported pure function `promoteAgentVersion(store, …)` in `agents/service.ts`, not as a method body.** `AgentsService` constructs its own `AgentsRepository` from the container, so a method body could not have been tested hermetically, and `agents/repository.ts` is forbidden. The narrow three-method port keeps the Drizzle row out of the signature (`OA-DEEP-002`) and `AgentsRepository` satisfies it structurally. Same behaviour, same single call to the existing `update` path.
- **Two per-route rate limits added** (`max: 10 / 1 minute` on `POST /eval/agents/:agentId/batches` and `POST /eval/dashboard/runs`), copying `/pulls/:id/review`'s stated reason — one call fans out to up to fifty model requests. The plan mandated only the SSE `rateLimit: false`, which is also in place.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| server | lint | `./node_modules/.bin/eslint` over all eight Owned paths | pass — 0 errors, 0 warnings |
| server | onion (`depcruise`) | `… --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings. 244 modules, 849 dependencies cruised` (baseline 242 modules → **rose by 2**, my two new files) |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 61 files, 835 tests, 0 failures (13 of them new) |
| server | test-file typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | pass — exactly **16** errors across the six documented unrelated files; neither new test file appears |
| server | `DDG-WIRE-001` | the `for m in $(ls -d src/modules/*/ …)` loop, verbatim | pass — no `UNREGISTERED:` line |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | live `curl` (registration) | `GET localhost:3001/eval/dashboard` | pass — `200`, real payload with one row per agent |
| server | live `curl` (AC-18 envelope) | `GET /eval/agents/00000000-…/cases` | pass — `{"error":{"code":"not_found","message":"Agent not found"}}`, not Fastify's route-not-found |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised |
| client | — | — | gate did not run — no client file was touched (another implementer owns `client/` this wave) |

Extra live checks, all as expected: `?period=nope` → `422`; `POST /agents/<real>/versions/999/promote` → `404`; `GET /eval/compare` without params → `422`; `GET /eval/batches/<unknown>/events` → `404` (authorized through the service before subscribing); `POST /eval/cases` twice → `201` then `409 duplicate_source_finding`.

## Not done

- `absent` — the client half of wave 6 (T11). Not mine.
- `not checked` — the e2e flows and `../scripts/e2e.sh`: they need Docker and a stack on `:5433`, and no browser flow is in this plan.
- `not checked` — `test/eval-order.it.test.ts` and every other `*.it.test.ts`: Docker not authorised.
- `not checked` — whether a real batch executes end to end against a live provider. Starting one spends model calls on the demo agent; the route, the acknowledgement and the runner wiring are covered by tests and by the container binding, but no batch was run.

## For the parent

- **One row of demo data was created deliberately**, by the Done-condition's own `curl`: eval case `5d211c40-c53e-46c2-a157-46af51871ea2` on `General Reviewer`, from finding `2acbb986-…`. It is the only way to prove the route reaches Postgres through T4's applied migration, and it gives T11's client screens a non-empty set. Delete it with `DELETE /eval/cases/5d211c40-…` if a clean dataset is wanted.
- **Promotion does not restore the promoted version's `skills` list**, and that is a real gap worth a decision. `AgentsRepository.update`'s patch has no skills field, and `snapshotVersion` re-reads the agent's *current* links — so promoting v6 produces a v8 whose `config.skills` is v7's set, not v6's. Restoring them would need `setSkills` (which validates each id against the workspace) and would fail on a skill deleted since. AC-43 speaks of "that version's stored config", so this may or may not satisfy it; I did not widen the scope, and it is noted in the code at `promoteAgentVersion`. Evidence: `server/src/modules/agents/repository.ts:148` (`snapshotVersion`) reading `skillIdsForAgent(row.id)`.
- Candidate for `server/INSIGHTS.md`: **`reply.sse` with an async generator works under `app.inject`** — a completed `RunBus` stream replays its buffer and terminates the request, so the AC-24 replay-then-close path is testable hermetically with no Docker and no timer. Evidence: `server/test/eval-routes.test.ts`, the "replays a completed batch's buffered events" case.
- Candidate for `server/INSIGHTS.md`: **`isConfigChange` treats any *defined* `outputSchema` in a patch as a config change** (`server/src/modules/agents/helpers.ts:83`), which is what makes "promotion always yields a higher version" true even when the promoted config equals the current one. A patch that omitted `outputSchema` would silently promote without a version bump.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Both are the next steps and neither is mine.
