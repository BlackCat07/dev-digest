# agent-runner — engineering insights

Append-only journal for the CI runner. Seven fixed sections; newest entry at the
bottom of its section.

**Relationship to `README.md`:** this file is the inbox — one-off, file-grounded
observations. `README.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version there and leave the entry here as the
record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or
  already stated in `README.md` / the root `CLAUDE.md` / `../TESTING.md`.
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

- **2026-08-25** — **Two couplings between the generated workflow and this runner are
  load-bearing and guarded by nothing: the `--post-as` flag (its name and its three values)
  and the three environment-variable names.** The workflow is written by
  `../server/src/modules/ci/workflow.ts` and consumed here, in different packages with
  different test suites, so a rename on either side is a **green build on both** — a
  `post_as: none` that posts a review anyway would pass every gate this repository has. The
  artifact name escaped this fate only because it was made a shared constant
  (`CI_RESULT_ARTIFACT_NAME` in `@devdigest/shared`), which is the pattern to copy; the flag
  and the variable names were not given the same treatment and are the open risk. Both were
  caught during the build only because a coordinator relayed them between two implementers
  by hand. Evidence: `src/main.ts` (`parseArgs`, the env check),
  `../server/src/modules/ci/workflow.ts`, `../server/src/vendor/shared/contracts/ci-runtime.ts`.

## Codebase Patterns

Conventions and architectural decisions, each with the reason.

<!-- append below -->

- **2026-08-25** — **This package deliberately carries no GitHub SDK: `RunnerGitHub` is
  three REST calls over global `fetch`.** `reviewer-core/CLAUDE.md` sets the rule this
  follows — *"every dep has to survive being bundled into the L06 CI runner; prefer writing
  the helper over adding a package"* — and it is what keeps `dist/runner.mjs` at ~1.5 MB, a
  size that can honestly be committed into somebody else's repository. Keep the 422 recovery
  ladder that comes with it (full review → `COMMENT` with comments → body-only): GitHub
  refuses `APPROVE`/`REQUEST_CHANGES` on your own pull request, and one unresolvable inline
  line rejects the whole review. Evidence: `src/github.ts` (`FetchRunnerGitHub`),
  `src/review-pr.ts`.

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-25** — **esbuild cannot bundle `openai` v4 to ESM without a `createRequire`
  banner: the artefact builds cleanly and then dies on its first import with `Dynamic
  require of "stream" is not supported`.** The require comes from
  `openai/_shims/node-runtime.js` → `node-fetch`, which is CommonJS, so the failure is at
  **run time in CI**, not at build time where it would be cheap. Adding
  `banner: { js: "import { createRequire } from 'node:module'; const require =
  createRequire(import.meta.url);" }` fixes it, and after that every specifier reaching
  `__require` is a Node builtin except node-fetch's optional `encoding` inside a try/catch —
  so the bundle stays self-contained. **Verify that claim rather than assuming it:** run
  `dist/runner.mjs` from a directory containing nothing but the file and no `node_modules`.
  Reaching for a hand-written provider instead would be the wrong fix — it would end the
  guarantee that this runner and the studio review with the same engine. Evidence:
  `build.mjs`, `src/llm.ts`.

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

- **2026-08-25** — **Does `dist/runner.mjs` rebuild byte-identically on linux-x64?**
  `.github/workflows/agent-runner.yml` ends with `npm run build` followed by
  `git diff --exit-code -- dist/`, which assumes it does. Verified deterministic across two
  builds on darwin-arm64 with esbuild pinned at `0.25.12`; the cross-platform half is a CI
  observation nobody has made yet. If that step turns out to be flaky, the honest fix is to
  compare a hash of the **entry sources** rather than the artefact.
