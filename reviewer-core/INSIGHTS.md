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
- **2026-08-25** — **Google models reject a `$ref` in a structured-output schema, and it wears
  the same `400 Provider returned error` disguise as the Anthropic numeric-range problem
  below.** `zodResponseFormat` DEDUPLICATES any sub-schema it meets twice into a top-level
  `definitions` block and points a `$ref` at it — and `Finding` reuses one enum in two places
  (`trifecta_components[]` and `evidence[].component`), so the wire schema carries exactly one
  reference. OpenAI and DeepSeek resolve it; Gemini does not, and answers
  `reference to undefined schema at properties.findings.items.properties.evidence.anyOf.0.items.properties.component`.
  Measured against `google/gemini-3.7-flash` via OpenRouter: 400 with the reference, 200 with
  the identical schema once inlined. **Retrieving that message is the whole difficulty** — the
  SDK string is just the eight-word placeholder, and the real text lives in the response's
  `error.metadata.raw`, reachable only by replaying the request against `/chat/completions`
  directly (the recipe the 2026-08-07 entry below already gives; this is its second use, so
  treat `400 Provider returned error` as "go and replay it", never as a diagnosis). Fixed in
  `toJsonSchema` with `inlineDefinitions`, a sibling of `stripNumericRangeKeywords`: every
  `$ref` is expanded and `definitions` / `$schema` are dropped. Safe because a zod schema's
  reference graph is a TREE — `definitions` here is deduplication, not recursion — so expansion
  terminates and the accepted shape is unchanged. Two things worth knowing next to it: the key
  is NOT in `server/.env` (all three `*_API_KEY` lines there are empty) but in
  `~/.devdigest/secrets.json`, which is what `LocalSecretsProvider` reads; and the server's
  `tsx watch` DOES follow this package's sources across the path alias — an edit here restarted
  the API child process within the same second, no build and no manual restart. Evidence:
  `src/llm/structured.ts` (`inlineDefinitions`), `test/structured.test.ts`
  ("no $ref reaches the wire", mutation-verified), `../server/src/platform/container.ts:516`.


- **2026-08-28** — **Google rejects `$ref`, so a schema `zodResponseFormat` de-duplicated
  breaks every review on a Gemini model.** A shape used twice is hoisted into
  `definitions` and referenced; Google AI Studio does not resolve that and answers
  `INVALID_ARGUMENT — reference to undefined schema at properties.findings.items.
  properties.evidence.…`, which OpenRouter passes through as a bare
  `400 Provider returned error`. The failure is total and looks like anything but a
  schema problem: every run failed in **under a second with zero tokens spent**, while the
  identical schema on DeepSeek answered 200, and the model id was still valid in
  OpenRouter's catalogue. Bisecting the request is what finds it — a trivial
  `json_schema`, `temperature: 0`, `usage.include` and `session_id` all pass on Gemini;
  only the real `Review` schema fails. **This is the SECOND instance of the class the
  2026-08-07 entry below describes** (a provider rejecting a wire-schema construct that
  others accept, surfaced as a bare 400), so `toJsonSchema` now runs two provider-
  portability passes and should be assumed to need more. Fixed by `inlineDefinitions`:
  references are expanded in place and the block dropped — the shared `Review` schema went
  4208 → 2183 bytes and two `$ref`s → none — while a cyclic or unresolvable reference is
  left alone AND the block kept, since removing it would turn a schema this function
  merely failed to simplify into one that is definitively broken. Evidence:
  `src/llm/structured.ts` (`toJsonSchema`, `inlineDefinitions`), `test/structured.test.ts`.

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

- **2026-08-28** — **`400 Provider returned error` no longer has to be replayed by hand to
  be read.** OpenRouter wraps an upstream failure as `{"error":{"message":"Provider
  returned error","code":400,"metadata":{"provider_name":…,"raw":…}}}`, and the OpenAI SDK
  builds its `Error.message` from `error.message` alone — so what reached a log was that
  string and nothing else: no model, no reason, no way to tell a bad schema from a rate
  limit from an outage. `metadata.raw` is where the actual sentence lives. `openrouter.ts`
  now folds `provider_name` and `raw` into the message (`withProviderDetail`), widening it
  in place so `status`, `code` and the original stack survive for anything that branches on
  them. **Supersedes the half of the 2026-08-07 entry that says the real message "is only
  visible by replaying the request directly against `/chat/completions`"** — that was true
  and cost this class of bug two separate investigations before it was fixed at the source.
  Evidence: `src/llm/openrouter.ts` (`withProviderDetail`, `completeStructured`).

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
