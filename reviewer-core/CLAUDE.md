# reviewer-core — `@devdigest/reviewer-core`, the review engine

Pure logic: **diff → prompt → LLM → grounded findings**. TypeScript + zod only.
Consumed as **source** by the server (tsconfig alias), never as a published package.

## Commands

```sh
npm ci            # npm, NOT pnpm — this package has package-lock.json
npm test          # vitest run --passWithNoTests
npm run typecheck
npm run build     # tsc --noEmit — a typecheck; this package never emits JS
```

## Map

```
src/index.ts          public barrel — the whole API surface
src/prompt.ts         assemblePrompt · wrapUntrusted · INJECTION_GUARD
src/grounding.ts      groundFindings · groundingSummary — the citation gate
src/llm/structured.ts Zod → JSON Schema · extractJson · parseWithRepair
src/llm/openrouter.ts the one bundled LLMProvider implementation
src/review/run.ts     reviewPullRequest — orchestrates a run (single-pass default)
src/review/reduce.ts  reduceReviews · sliceDiff — map-reduce path
src/output/to-review.ts  toReview — CI payload shape (used from L06)
test/                 prompt · run · to-review
```

## Conventions

- **Purity is the contract: no DB, no GitHub, no filesystem, no `process.env`.** The only
  side effect is an LLM call through an **injected** `LLMProvider`. Reaching for
  `node:fs`, a db client, or env access breaks both consumers and the mock-testability
  this package exists for — pass the value in as a parameter instead.
- **Everything public is re-exported from `src/index.ts`.** Add a symbol there when it
  becomes part of the API; consumers import `@devdigest/reviewer-core`, not deep paths.
- **Grounding is mandatory, not advisory.** A finding that doesn't cite a real line in
  the diff is dropped, and the score is recomputed deterministically from the
  **surviving** findings — never taken from the model. Don't add a bypass path.
- **Injection defense lives in one place**: `assemblePrompt` appends `INJECTION_GUARD` to
  every agent's system prompt and all external content passes through `wrapUntrusted`.
  Harden there rather than pattern-matching untrusted text downstream — downstream
  matching only ever catches one phrasing or one language.
- **Keep the dependency surface tiny.** Every dep has to survive being bundled into the
  L06 CI runner; prefer writing the helper over adding a package.

## Gotchas

- **This package uses npm while server/client use pnpm.** If `node_modules` is missing
  here, the *server* crashes at boot with `ERR_MODULE_NOT_FOUND` — it imports this raw
  source through the alias. Fix is `npm ci` here, not anything in `server/`.
- **Editing this changes the running server immediately** — no build step, no version
  bump, nothing to publish. Treat a change here as a change to the API's behaviour.
- **`@devdigest/shared` resolves to `../server/src/vendor/shared`**, the canonical copy —
  outside this package and coordination-only (see root `CLAUDE.md`).
- **Optional prompt slots are meant to be absent.** `skills` (L02), `memory` (L07),
  `specs` (L05), `callers` are fed by later lessons; when omitted `assemblePrompt` just
  leaves the section out. A missing slot is not a bug to fill in.
- `npm test` passes with no tests (`--passWithNoTests`) — a green run does not prove
  tests exist for what you changed.

## Deeper context

- Pipeline diagram, full public API list, what each lesson adds → `README.md`
- How the server injects the provider and calls in → `../server/src/platform/container.ts`
- The grounding gate and the injection guard, in depth → `docs/grounding.md`
- Curated deep-dives → `docs/README.md`
- What a feature must do, and how the `specs` prompt slot reads them → `specs/README.md`
