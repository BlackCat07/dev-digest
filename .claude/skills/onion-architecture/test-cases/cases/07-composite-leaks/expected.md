# Answer key — fixture 07 (`insights` — composite leaks)

11 files, 379 lines, four rings, two packages. Planted violations: **3**.

**Every individual import in this fixture is legal.** `depcruise` is green: the core imports
only the port ring, the port ring imports only `zod` and `node:fs` (which no rule mentions),
the repository is the sole `drizzle-orm` importer, the adapter imports nothing from `modules/`,
and there is no cross-module edge. All three defects are compositions — legal edges that add
up to something the rules forbid — so nothing mechanical can catch any of them and a reviewer
who checks import lines will pass the patch.

| # | Rule | Chain to trace | Why it is a violation | Fix |
|---|---|---|---|---|
| P1 | `OA-DEEP-001` | `reviewer-core/src/review/reliability.ts:2` imports the **value** `DEFAULT_WEIGHTS` from `@devdigest/shared` → `server/src/vendor/shared/contracts/insights.ts:2,14-15` does `readFileSync` at **module scope** | The pure core now performs filesystem I/O the moment it is loaded. `core-stays-pure` only matches `^src/(?!vendor/shared)` and npm packages, so the hop through the port ring is invisible; `ports-import-nothing` only forbids `^src/`, and `node:fs` is neither `^src/` nor `zod`. Both rules stay green | Move the default table into the core as a plain constant, or make `weights` a required field so the caller supplies it. The port ring declares contracts; it does not load them |
| P2 | `OA-DEEP-002` | `server/src/modules/insights/ports.ts:1,11` — `InsightsRepositoryPort.runsInWindow` returns `AgentRunRow[]` imported from `db/rows.js`. The consequence is visible at `server/src/adapters/insights/mocks.ts:19-37` | A consumer-declared port is only a boundary while every type in it is one a test can build. This one has moved the Drizzle schema into the contract: the fake hand-writes 13 columns and still needs `as unknown as AgentRunRow`. The rule that would catch a Row type (`row-types-stay-in-persistence`) matches only `(service|routes).ts`, so a `ports.ts` is exempt | The port returns `RunOutcome[]` (or the module's own row type from `types.ts`); the repository maps Row → that shape. The fake then becomes three fields and no cast |
| P3 | `OA-INFRA-003` | `server/src/modules/insights/service.ts:50-51` awaits `recordSnapshot` then `markWindowClosed`; `server/src/modules/insights/repository.ts:41` opens `db.transaction` **inside `recordSnapshot` only** | The service's own doc-comment claims the two writes "are written together" and explains why that matters — but they are two transactions. A throw between them leaves a snapshot with an open window, or a closed window whose snapshot is missing, which the comment says would be "skipped forever". The transaction boundary sits in the ring that cannot see the use case | The service owns the boundary: open one transaction and pass `tx` into both repository methods. `OA-INFRA-003` is the rule; no gate enforces it |

## False-positive traps (must NOT be reported as violations)

| Trap | What it looks like | Why it is correct |
|---|---|---|
| T1 | `InsightsService` takes a narrow `InsightsDeps` rather than `Container` | This is the shape `OA-APP-004` **asks** for in a new service. Reporting it inverts the rule |
| T2 | `adapters/insights/window-clock.ts` implements `WindowClockPort` without importing it | Structural satisfaction is the sanctioned pattern — it is what keeps the adapter a leaf. `HourAlignedWindowClock` imports nothing from `modules/` |
| T3 | `repository.ts` imports `drizzle-orm` + `db/schema` | The one ring permitted to |
| T4 | `helpers.ts:1,7` imports `AgentRunRow` from `db/rows.js` — **the same import as P2** | Legitimate here and only here. `db/rows.ts`'s own header exists so cross-cutting consumers may name a row shape, and Row → DTO mapping in `helpers.ts` is the prescribed job. P2 is about the import appearing in a **port signature**; T4 is the same symbol doing its job. A report that flags both has not made the distinction the case tests |

## Notes for grading

- The discriminating skill content is `OA-DEEP-001`, `OA-DEEP-002` and `OA-INFRA-003`. `OA-DEEP-001`
  and `OA-DEEP-002` exist **only in the new version** of the skill; `OA-INFRA-003` is in both.
- A finding must name the **chain**, not the endpoint. "reviewer-core is impure" without naming
  the port-ring file is a partial answer: it sends the reader to the wrong file.
- Real but unplanted, do **not** score: `req.query as {...}` in `routes.ts` (a cast on a boundary,
  `OA-BND-001`); `report()` using `repoIds[0] ?? ''` so the report's window belongs to the first
  repo only; `new Date()` in the service and the adapter making both untestable; the
  `insight_snapshots` / `insight_agents` / `insight_windows` tables and `container.insights` not
  existing; `scoreReliability` / `RunOutcome` not being exported from the `reviewer-core` barrel;
  and the module not being registered in `modules/index.ts`.
