# Answer key — fixture E (`digest` — all-`warn` drift)

**Every planted violation is `warn` severity, so `depcruise --output-type err` exits 0 and the
gate reports the tree green.** "I ran the architecture gate and it passed" is the wrong answer
to this fixture. The skill is explicit: *"`warn`s are **known drift** on a burn-down list, not
licence to add more."*

| # | File | Defect | Rule (severity) | Correct shape |
|---|---|---|---|---|
| E1 | `routes.ts` lines 3, 5, 32-49 | Two Drizzle queries — an aggregate and a windowed list — run inline in the `GET /digest/counts` handler, pulling `drizzle-orm` + `db/schema` into the route file | `routes-no-data-access` (**warn**) — its comment names 4 existing drift files; this adds a 5th | `DigestRepository.countsSince(...)` + a service method; the module already has a repository |
| E2 | `service.ts` lines 3, 9 | Imports `db/schema` purely to export `ReviewRow = typeof t.reviews.$inferSelect`, then uses that Row type in the application signature `assemble` feeds. `repository.ts` does a bare `.select()` returning the full row, so a Drizzle Row type is the module's currency | `application-no-db-schema` (**warn**) + `row-types-stay-in-persistence` (**warn**) | Declare the row shape in the repository (or a module `types.ts`), project the columns actually used, and map Row → DTO in `helpers.ts` |
| E3 | `helpers.ts` lines 1, 15-21 | `summariseWindow` takes the whole `Container` for one call (`container.featureModel`) | `no-circular` (**warn**) — importing `platform/container.ts` pulls in every module, so every caller joins a cycle with the DI root. This is exactly the `resolveFeatureModel` case recorded in `server/INSIGHTS.md` (2026-08-10) | Narrow the parameter to what is used — a consumer-declared `FeatureModelResolver`, or pass the resolved model string in. The container satisfies it structurally |

## False-positive traps (must NOT be reported as violations)

- `repository.ts` importing `drizzle-orm` + `db/schema` — correct ring.
- `service.ts` taking `Container` in its constructor — not a refactor target.
- `constants.ts` holding the two tuning numbers.

## Notes for grading

The discriminating judgement is that **a green gate is not a pass here**. Credit a report that
either (a) states these are `warn`-level and that the burn-down list must not grow, or
(b) reports them as real problems to fix without leaning on the gate's exit code. Penalise a
report that runs `depcruise`, sees 0 errors, and concludes the layering is fine.

Real but unplanted defects (do not score): `windowDays: 7` hardcoded beside
`DIGEST_WINDOW_DAYS`, `Date.now()` making the assembler untestable, `DIGEST_MAX_ROWS`
trimming after the query rather than in it, and the counts route duplicating the window
calculation.
