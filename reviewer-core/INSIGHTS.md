# reviewer-core — engineering insights

Append-only journal for `@devdigest/reviewer-core`. Seven fixed sections; newest entry at
the bottom of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

Note: changes here reach the server with no build step, so an insight about this
package is often really an insight about a live API behaviour. Say which.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or
  already stated in `CLAUDE.md` / `README.md` / `../TESTING.md`.
- **Substantial.** Record what cost real time or would mislead the next reader. Not:
  code structure that is plain from reading it, style nits, linter-catchable issues,
  or facts true only inside one session.
- Nothing substantial this session → write nothing. That is a valid outcome.

## Entry format

One bullet per insight, appended under the one section it belongs to:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `src/path/file.ts` (`functionName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

Replacing a section's `_No entries yet._` placeholder on first append is expected — it is
not an entry.

The skill that maintains this file: `.claude/skills/engineering-insights/`.

---

## What Works

Approaches and solutions that worked and should be reused.

<!-- append below -->

_No entries yet._

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

_No entries yet._

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

_No entries yet._

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-23** — **`tsconfig.eslint.json` here carries a baseline of 4 `error TS` that no script
  surfaces** — the same include-hole `server` has: `tsconfig.json`'s `include` is `src/**/*.ts` and
  `vitest` transpiles without typechecking, so `npm test` and the typecheck script can both be green
  over a test file holding a real type error. Measured: `test/run.test.ts` (1 × `TS7006`) and
  `test/structured.test.ts` (3 × `TS18048`). A gate that adds a test-file typecheck here must filter
  to the files it owns and quote 4 as the known baseline, or it is red on arrival — and a gate that
  is red on arrival stops being read. Evidence: `tsconfig.eslint.json`, `test/structured.test.ts`,
  `../scripts/verify-l06.sh` (`core · typecheck (L06 test files)`).

- **2026-08-07** — **Anthropic models via OpenRouter reject a `json_schema` response format
  that carries numeric range keywords**, and the engine surfaces it only as
  `400 Provider returned error`. All three routes OpenRouter tried (Anthropic, Bedrock,
  Azure) returned `output_config.format.schema: For 'integer' type, properties maximum,
  minimum are not supported`, while DeepSeek accepts the identical schema — so a zod
  `.min()/.max()` in a shared contract (`Review.score` is `.int().min(0).max(100)`) breaks
  reviews **only after an agent switches to a Claude model**, which reads as a model
  problem rather than a schema problem. The real message lives in OpenRouter's
  `error.metadata.raw` and is only visible by replaying the request directly against
  `/chat/completions`; the OpenAI SDK error string truncates it. This is live API
  behaviour: the server consumes this package as source, so the fix applies with no build
  step. Fixed in `toJsonSchema` (`stripNumericRangeKeywords`): the wire schema drops
  `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf` and folds each
  bound into the property's `description`; nothing is lost because `parseWithRepair`
  re-validates every response against the original zod schema and reprompts on violation.
  Evidence: `src/llm/structured.ts` (`toJsonSchema`, `stripNumericRangeKeywords`),
  `../server/src/vendor/shared/contracts/findings.ts` (`Review.score`).

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

_No entries yet._

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
