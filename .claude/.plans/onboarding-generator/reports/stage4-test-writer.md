# Stage 4 — `test-writer`

Tests derived from the acceptance criteria in `specs/onboarding-generator.md`, **not** from
the code at `401e8d6` — which is what makes them capable of catching a wrong implementation
rather than pinning the one that exists.

**Status: complete.**

As of `401e8d6` (`L05-spec-driven-development`); 9 files added, 0 amended, nothing committed. Server 44 → **49 files / 618 tests**, client 43 → **47 files / 388 tests**, both green.

## Coverage

- `INSIGHTS server: 51 entries, 9 relevant` (2026-08-10 — no test file here is typechecked by any gate, so `tsconfig.eslint.json` is the only gate that sees this output; 2026-08-06 — `timeoutMs` ignored / `maxRetries` defaults to 2; 2026-08-06 — whole-suite runs silently skip `.it.test.ts`, read the `↓` lines; 2026-08-19 — a symlink-skipping walk passes an escape test for the wrong reason, assert the pair; 2026-08-19 — jsonb read by cast arrives with keys absent; 2026-08-14 — `import type` does not exempt `no-cross-module-internals`; 2026-08-10 — `modules-no-raw-sdk` does not list `node:fs`; 2026-08-02/04 — never `pnpm <script>`, zsh `${PIPESTATUS[0]}` and word-splitting traps; 2026-08-19 — a feature can pass every gate and still 500 because nothing applies its migration)
- `INSIGHTS client: 29 entries, 6 relevant` (2026-08-10 — no `user-event`, no shared QueryClient helper, `Skeleton` is a bare `div.skeleton`; 2026-08-19 — jsdom dispatches no click for Enter on a focused button; 2026-08-19 — `AppShell` mounts in jsdom with `next/navigation`, a `QueryClient` and the `shell` namespace; 2026-08-11 — a component composing a shared unit reads two namespaces and a missing one fails silently; 2026-08-05 — vendored `<Markdown>` is inline-only; 2026-08-03 — client imports of `@devdigest/shared` stay `import type`)
- `INSIGHTS reviewer-core: 5 entries, 1 relevant` (2026-08-07 — Anthropic-via-OpenRouter rejects numeric range keywords; `parseWithRepair`'s reprompt is AC-10's one repair round-trip)

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `react-testing-library` | injected body (no `Skill` call) | the four client test files — `getByRole` first, one flow per state, `findBy`/`waitFor` never `setTimeout`, mocking at boundaries; **local override:** `fireEvent`, because `userEvent` is not a dependency here |
| `fastify-best-practices` | injected body; `rules/testing.md` **not** read | n/a — no route-level test is in scope (see `## Not tested`) |
| `typescript-expert` | injected body (no reference files needed) | all nine files — no `any` at a fixture boundary, structural port fakes, `as const` avoided where it would make a readonly tuple meet a mutable field |

## Tests written

The plan states its requirements *are* the spec's criteria (`the AC-n id is the Source: in every case`), so the plan id and the spec id coincide; no `R<n>` exists to cite separately.

| File | Covers | Suite | Seam | Regression it would catch | Owned? |
|---|---|---|---|---|---|
| `server/test/onboarding-facts.test.ts` | AC-5, AC-6, AC-7, AC-16, AC-18, AC-19 | server hermetic | `facts.ts` over a fixture `OnboardingIndexReader` | the reading path re-sorted (alphabetically, or by anything but rank); a second junk filter appearing in this module; chains reshaped; a degraded/partial index losing its reason, or an unknown index reason leaking onto the screen | yes |
| `server/test/onboarding-commands.test.ts` | AC-20, AC-21, AC-22 | server hermetic | `commands.ts` over the **real** `ConfinedRepoDocReader` and a `mkdtemp` clone | a README or any prose becoming a command source; a command losing its declaring file; a hostile script name reaching a copy button; an escaping symlink being read **and** an in-clone symlink being dropped; a subprocess call entering the module | yes |
| `server/test/onboarding-service.test.ts` | AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-14, AC-25, AC-26, AC-27, AC-28, EC-21, AC-30 | server hermetic | `OnboardingService` against declared-port fakes | the model reordering or shortening the five sections; a 404 for a never-generated tour; a second concurrent generation; an ungrounded path being stored; a second model call; a read that writes or polls the provider; a cap that truncates an item; a write after the repository is gone | yes |
| `server/test/onboarding-degraded.test.ts` | AC-10, AC-11, AC-15, AC-16, AC-17 | server hermetic | the same service with three **locally declared** failure providers | the three failure reasons collapsing into one; a hanging provider taking the job's whole budget; `maxRetries` reverting to the provider's default of 2 (three round-trips); a provider being constructed — and charged — for an unindexed repository | yes |
| `server/test/onboarding-prompt.test.ts` | AC-23, AC-24, AC-13 (shape) | server hermetic | `prompt.ts` + one priced generation | a fact block escaping its `<untrusted>` wrapper; a `</untrusted>` breakout; repository text reaching the **system** message; the single priced log line losing a figure | yes |
| `client/src/components/app-shell/helpers.test.ts` | AC-32 | client | `activeKeyFor` | the `includes("/onboarding")` clause returning, so the add-a-repository screen lights the tour entry (EC-25); any ladder neighbour being captured | yes |
| `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.test.tsx` | AC-31, AC-33, AC-34, AC-35, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46 | client | the screen inside the **real** `AppShell` | the nav entry moving out of place; five blank cards instead of one empty state; a notice replacing the sections; an unknown reason rendering an enum literal or a key path; an error or running state taking the sidebar with it; a caption built from today's index; `Share link` minting anything | yes |
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/TourSection.test.tsx` | AC-35, AC-36, AC-37, AC-38, AC-39, AC-45, AC-47 | client | the card, with `mermaid` (not the wrapper) stubbed | a document body collapsing into one wall of text; a diagram printed as text; an unrenderable diagram taking the section down; a copy control mangling a command; an `Open` link pinned to a branch instead of the tour's SHA | yes |
| `client/src/lib/hooks/onboarding.test.tsx` | AC-34 (data half) | client | the two hooks with `fetch` stubbed at the network boundary | a poll that never starts, or never stops; a generate POST growing a body (and with it a `content-type` Fastify rejects); a 422 refusal swallowed | yes |

**Evidence these tests can fail.** Each key assertion was checked by reverting the behaviour it pins and re-running: sorting `rankedPaths` (3 red), un-grounding links / widening `MAX_FIRST_TASKS` / `TOUR_MAX_RETRIES = 2` (3 red), leaking a fact into the system message and unwrapping the commands block (3 red), dropping the script-name guard (1 red), a blanket symlink skip (**1 red — the in-clone half only**, exactly the shape `server/INSIGHTS.md` 2026-08-19 warns about), reordering `NAV`, restoring `includes("/onboarding")`, removing the reason fallback, branch-instead-of-SHA links, always-on polling and a `fallback`-less diagram (8 red). Every mutation was reverted; `git status` shows only the nine new files.

## Not tested

- **AC-12's storage round-trip** — `absent`. The five provenance figures are asserted as far as the service's `StoredTourWrite` and back through the fake store; that the columns and the `jsonb` `safeParse` survive Postgres (EC-28) needs `test/helpers/pg.ts`, which makes a file `*.it.test.ts`. Docker was scoped out by the plan.
- **The HTTP envelope** — `absent`. The `202`, the `422` for a concurrent generation, the `404`, the route's Zod `params` and the two `config.rateLimit` blocks are asserted only at the service boundary. The plan's `## Tests` table names no route-level file, and `app.inject()` against the app factory brings the container and its database with it.
- **AC-14's fallback to the registry default** — `absent` at its true site. The service is asserted to ask for `onboarding` and to use whatever the resolver answered; the "no override stored ⇒ registry default" half lives in `modules/settings/feature-models.ts`, which this module deliberately does not import and which needs a `Db`.
- **AC-13 as a demonstration** — `not checked`. The log line's shape is asserted; generating a real tour and reading the line needs a running stack.
- **AC-45's activation by keyboard** — `not checked` mechanically, by the spec's own wording: jsdom synthesizes no click for Enter on a focused native button, so reachability and accessible name are asserted and activation is dispatched separately.
- **AC-19 as inspection, AC-22 as analysis** — the spec marks both non-`test`. AC-19's vocabulary is asserted against the contract enums; AC-22 is asserted mechanically (no subprocess API anywhere under `src/modules/onboarding/`) rather than by inspection alone.
- **e2e** — `absent`. No flow is in the plan's table; `../scripts/e2e.sh` needs Docker.
- **`DocumentMarkdown.test.tsx`** — not this agent's; it was moved by T5 and is green in the run above.

## Deviations

- **AC-6's fixture, and which reading was chosen.** Both: the fixture facade reproduces the shipped `getTopFilesByRank` (rank DESC, `JUNK_PATH_PATTERNS` substring match — copied verbatim, since `isJunkPath` is module-private and importing `repo-intel` would be the cross-module violation the module avoids), **and** a separate case pins that the onboarding layer adds no second filter. Stated in the file's doc-comment.
- **AC-43 is covered in `OnboardingView.test.tsx` only**, not additionally in `lib/hooks/onboarding.test.tsx` where the plan also listed it. The observable is what renders, and the reason lookup lives in `src/lib/onboarding.ts` — testing it from a hooks file would put it in the wrong home. The hooks file covers the outgoing request shape instead (the `intent.test.tsx` precedent).
- **`mermaid` is mocked, `MermaidDiagram` is not.** Mocking the wrapper would make AC-38 a test of the mock; the component owns both failure modes and EC-12's is the second. The stub's `parse` refuses an unquoted `/` in a node label.
- Three assertions were corrected against real behaviour rather than the code being questioned: the declared-command order is path-ascending (`Makefile` before `docker-compose.yml`), an accessible name collapses the double space inside a command (so the clipboard assertion, not the query, carries AC-39), and the screen holds its error state until the repos list resolves (`findBy`, deliberate — it stops a generic error flashing in front of the 404 boundary).

## Blocked

None. No requirement needed a production-code change to be testable.

## Gates

| Package | Suite | Command | Result |
|---|---|---|---|
| server | hermetic units | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | **pass** — 49 files / 618 tests, 0 `↓` lines |
| server | **test-file typecheck** | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json 2>&1 \| grep "^test/onboarding"` | **pass** — 0 lines. 16 errors remain across `prompt-callers` ×7, `repo-intel-facade-degraded` ×3, `skills.it` ×3, `adapters`, `conventions.it`, `agents-versions.it` — **pre-existing**, the same six files measured on 2026-08-10 |
| server | source typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | **pass** |
| server | lint (new files, listed literally) | `./node_modules/.bin/eslint test/onboarding-*.test.ts` | **pass** — 0 errors, 0 warnings |
| server | integration | — | **gate did not run** — Docker not authorised; no `*.it.test.ts` was written |
| client | components + hooks | `./node_modules/.bin/vitest run` | **pass** — 47 files / 388 tests |
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | **pass** |
| client | lint (new files) | `./node_modules/.bin/eslint <4 paths>` | **pass** |
| reviewer-core | engine (N2 verification row) | `./node_modules/.bin/vitest run --passWithNoTests` | **pass** — 5 files / 45 tests; `git diff --stat -- reviewer-core/` is 0 lines |
| e2e | browser flows | — | **gate did not run** — out of scope, needs Docker |

## For the parent

INSIGHTS candidates — recorded here, not appended by the agent:

- **client, Tool & Library Notes** — under fake timers, a react-query `refetchInterval` refetch fires on the timer but its data commits on the render *after* it, so `await flush(2000)` sees the new call count and the **old** data; a zero-millisecond second flush is still one turn early and `flush(1)` is what lands it. Measured in `src/lib/hooks/onboarding.test.tsx`.
- **client, Recurring Errors** — an accessible-name query cannot carry a command's internal double space: the name computation normalises whitespace, so `getByRole("button", { name: /npm run dev {2}#…/ })` never matches while the clipboard receives the string verbatim. Assert the copy on the clipboard, query the control by a normalised prefix.
- **client, Codebase Patterns** — `OnboardingView` (and any screen with a repo-scoped 404 boundary) holds its inline error until `reposLoaded`, so an `isError` test must use `findBy`, not `getBy`; a synchronous query sees the skeleton.
- **server, What Works** — the confinement pair now has a second worked example beyond `project-context-walk`: mutating `collectCandidates` to skip every symlink leaves "the escaping symlink is omitted" green and turns only the in-clone case red. Cheap, repeatable evidence for the 2026-08-19 entry.

---

**Parent's independent verification:** server suite 49 files / 618 tests green with **0 `↓` lines**; `tsc --noEmit -p tsconfig.eslint.json` filtered to `^test/onboarding` returns **0** lines; client suite 47 files / 388 tests green; no new server test filename contains `.it.`, so none lands in the wrong CI lane; all nine files present as untracked additions.
