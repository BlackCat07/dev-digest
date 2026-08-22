# Answer key — fixture D (over-layered `tags` module)

**There is not a single dependency-rule violation here.** Every import points inward,
`depcruise` is green, and a reviewer who only runs the gate will pass this patch. The three
planted defects are all things ONLY the skill body states — a generic clean-architecture
reviewer will *praise* all three.

Real work in the feature: one table, one `select`, one `update`, one consumer. `routes.ts`
is 26 lines.

| # | File | Defect | Where the rule lives | Correct shape |
|---|---|---|---|---|
| D1 | `service.ts` | A **service** wrapping one one-table query with a single consumer, behind a 26-line `routes.ts` | `OA-SIZE-001`: the repository is not the optional layer, the service is. The service earns its place on the second consumer of a repository method, or at ~50 lines / two tables — this module is under both | Drop `service.ts`: `routes.ts` → `repository.ts`, with `helpers.ts` keeping the DTO map. **Keep the repository** — `OA-INFRA-001` leaves the query nowhere else to live, and `OA-GATE-001` rules out parking it in the route as "only a warn" |
| D2 | `domain/tag.entity.ts` | A rich entity class with private state, `rehydrate`/`create` factories, getters, `rename` invariants and `equals` | SKILL.md "When NOT to add a layer": *"No rich entity classes. Zod contracts plus pure functions are the deliberate choice here… An 'anemic model' is not a defect in this codebase."* | A Zod contract in `@devdigest/shared` plus pure functions (`renameTag`, `slugFor`) — the shape `smart-diff/classify.ts` and `agents/helpers.ts` already use |
| D3 | `domain/` subfolder | A `domain/` directory introduced inside the module because the architecture is called onion — folder vocabulary borrowed from the pattern | SKILL.md: *"Never rename or move files just to match the shape. Onion is about the direction of dependencies, not folder vocabulary."* `agents/` is the shape to copy: flat `routes.ts` → `service.ts` → `repository.ts` + `helpers.ts` | Flat module files; no `domain/` folder |

## False-positive traps (must NOT be reported as violations)

- `repository.ts` importing `drizzle-orm` + `db/schema` — correct ring.
- `routes.ts` importing only `@devdigest/shared`, `_shared/context` and its own service.
- `helpers.ts` doing entity→DTO mapping — mapping in `helpers.ts` is the prescribed home.
- The `.js` ESM extensions everywhere.

## Deliberately NOT scored

`TagsService` taking the whole `Container` is **out of scope**. SKILL.md reserves
"not a refactor target" for the three named *existing* services and tells *new* services to
take the ports they need — so flagging it is legitimate and not flagging it is defensible.
Score it neither way.

## Notes for grading

The headline judgement is **"this is more structure than the feature earns"**. A report that
lists zero problems and says "clean, correct layering" has failed the fixture, however
accurate its dependency analysis. `req.params as { id: string }` and the bare
`throw new Error('Tag not found')` are real minor defects but are NOT among the planted three.
