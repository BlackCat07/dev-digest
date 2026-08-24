# Stage 3 — wave 2 — T3: the nav entry, the active-key fix, and the feature's message namespace

**Status: complete.**

As of `7bc2916` (`L05-spec-driven-development`); 3 files changed in `client/`, 0 added, nothing committed. T1's files were already in the worktree and were not touched.

## Coverage

- INSIGHTS client: 29 entries, 4 relevant (2026-08-10 — a feature's copy belongs in its **own** namespace, `src/i18n/request.ts` merges `messages/en/*` by basename; 2026-08-11 — a component composing a shared unit legitimately reads two namespaces, so keys must be complete or `next-intl` renders the key path and only logs; 2026-08-19 — jsdom dispatches no click for Enter on a focused native button, so AC-45 rests on accessible names, which the catalogue must supply; 2026-08-03 — `next build` while `next dev` is up corrupts the dev server, so no build was run).
- INSIGHTS server: not read — no file under `server/` is in T3's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`, `client/messages/en/onboarding.json` |
| `next-best-practices` | preloaded | `client/src/components/app-shell/helpers.ts` (route-shape reasoning for the anchored match) |
| `typescript-expert` | preloaded | both changed `*.ts` |
| `react-best-practices` | preloaded | reviewed for the catalogue's a11y-facing keys (icon-only control names, complexity as a word) |

Matches the plan's routing table for T3: yes (`frontend-ui-architecture`, `next-best-practices`, `typescript-expert`), plus `react-best-practices`, whose row matches `client/src/**` copy that icon-only controls will read.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/vendor/ui/nav.ts` | T3 | yes | one `NAV[0].items` entry (`onboarding-tour` / `Workflow` / `/repos/:repoId/onboarding` / `gKey: "o"`) inserted between `pulls` and `context`, and one `SHORTCUTS` row `g o`. Nothing else in the file |
| `client/src/components/app-shell/helpers.ts` | T3 | yes | `activeKeyFor`'s `pathname.includes("/onboarding")` clause replaced with an anchored `/^\/repos\/[^/]+\/onboarding/` test, plus the doc-comment saying why; ladder order and every other clause unchanged |
| `client/messages/en/onboarding.json` | T3 | yes | `generate.body` reworded to the design's five sections (EC-26); additive keys for the rail, running state, section-title fallbacks, the `meta` caption, the three notices, all nine `OnboardingReason` values plus `generic`, the diagram-unavailable notice, command/copy, path/`Open`, task complexity, links, share, and `loadError.body` |

`client/messages/en/shell.json`, `Sidebar.tsx`, `primitives/Markdown.tsx`, `styles.css`, `AppShell.tsx` and its `hooks/` were not opened for writing.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-31 (`Onboarding Tour` between `Pull Requests` and `Project Context` in `WORKSPACE`) | T3 | yes — runtime check of `NAV[0].items`: `pulls/GitPullRequest/p, onboarding-tour/Workflow/o, context/FileText/x` |
| AC-32 (add-a-repository screen must not mark the entry active) | T3 | yes — runtime check: `activeKeyFor("/onboarding") === ""`, `activeKeyFor("/repos/abc/onboarding") === "onboarding-tour"`, `"/repos/abc/pulls" → "pulls"`, `"/settings/models" → "settings"` |
| AC-33 (enabling — empty state copy) | T3 | yes — `generate.title/body/cta/generating` present; `generate.body` now names architecture, critical paths, run locally, reading path, first tasks |
| AC-38 (enabling — diagram-unavailable string T9 passes as `fallback`) | T3 | yes — `diagram.unavailable` |
| AC-41 (enabling — stale/partial notice copy) | T3 | yes — `notice.stale.*`, `notice.partial.*` |
| AC-42 (enabling — degraded notice copy) | T3 | yes — `notice.degraded.*` |
| AC-43 (enabling — one key per reason plus a generic sentence) | T3 | yes — checked mechanically against the enum in `client/src/vendor/shared/contracts/onboarding.ts`: 9 members, 10 keys, 0 missing, `generic` present and worded as a complete sentence |

Keys for the tasks that read this namespace later: `rail.label`, `running.*`, `sectionTitle.<kind>` (all five, checked against `OnboardingSectionKind`), `meta.generated`/`filesIndexed`/`filesSkipped`/`age` (AC-40), `command.copy`/`copyLabel`/`copied`/`declaredIn`/`none`/`notRun` (AC-39), `path.open`/`openLabel`/`unavailable` (AC-47), `task.complexity.{low,medium,high}` + `task.complexityLabel`, `links.label`, `share.label`/`ariaLabel`/`copied` (AC-46), `loadError.title`/`body` (AC-44), and the pre-existing `title`, `sections`, `sectionCount`, `regenerate`, `regenerating`, `unknownError`.

## Deviations from the plan

- **T3, icon.** The plan offered `Workflow`, `Boxes` or `ListChecks` and required verification. `client/src/vendor/ui/icons.tsx` exports all three (`Map`, `Compass` and `BookOpen` are genuinely absent, as the plan said). `Workflow` was used: `ListChecks` is already the `conventions` entry's icon and reusing it would give two sidebar rows the same glyph.
- **T3, `activeKeyFor`.** The regex is a module-level `const ONBOARDING_TOUR_ROUTE` rather than an inline literal in the ladder — a `RegExp` literal rebuilt on every call inside a hot helper, and the reason for the anchoring needed somewhere to live. Behaviour is identical.
- **T3, message keys.** The plan's list is "at minimum"; the agent added `command.notRun`, `path.unavailable`, `command.none`, `links.label` and `task.label` so T9/T10 cannot hit a missing key for a state the plan's own Change sections describe (a repository declaring no commands, a tour with no `indexed_sha`, the section's item-group headings). No key was removed and `shell.json` was not touched.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | unit | `./node_modules/.bin/vitest run` | pass — rc=0, 43 files / 353 tests passed, 0 failed |
| client | lint | `./node_modules/.bin/eslint src/vendor/ui/nav.ts src/components/app-shell/helpers.ts` | pass — rc=0, 0 errors. One warning, and it is about coverage rather than code: `nav.ts` is *"File ignored because of a matching ignore pattern"*, so eslint linted `helpers.ts` only |
| client | `vendor/ui` blast radius | `git diff --stat -- src/vendor/ui/` | pass — exactly one file (`nav.ts \| 8 ++++++++`, insertions only, no deletions) |
| client | message catalogue parses | `node -e "JSON.parse(…messages/en/onboarding.json…)"` | pass — `json ok` |
| client | AC-31/AC-32 runtime check | `node --experimental-strip-types` over `helpers.ts` + `nav.ts` | pass — output quoted in `## Acceptance` |
| server | — | — | gate did not run — no `server/` file was touched; T2 is concurrent in that package |

No test was red before the first edit and none is red now; there is no `pre-existing` failure to report.

## Not done

- `absent` — `client/src/components/app-shell/helpers.test.ts` (AC-32's test). The plan's `## Tests` table assigns it to `test-writer`; there is no test on this helper today and none was created.
- `not checked` — the running app. `DDG-UI-001` says this changes what the shell renders on two routes and is worth a look in `/run`; no dev server was run and no screenshot taken. `/repos/:repoId/onboarding` has no route yet (T10), so the new entry currently links to a 404.
- `not checked` — e2e flows and any Docker-backed suite; not requested and not authorised on this run.

## For the parent

- Candidate for `client/INSIGHTS.md`: **`eslint <path under src/vendor/ui/>` exits 0 while linting nothing** — the file matches an ignore pattern, so the run reports `0 errors` plus a `File ignored because of a matching ignore pattern` warning. A Done-condition that lists a `vendor/ui` path alongside real files reads as a pass for both, and the vendor file was never parsed. Evidence: `client/eslint.config.js`, this run's `eslint src/vendor/ui/nav.ts src/components/app-shell/helpers.ts`.
- For whoever dispatches T7: the reason lookup lands on `onboarding.reason.<value>` with `onboarding.reason.generic` as the default, and the section-title fallbacks on `onboarding.sectionTitle.<kind>`. The caption keys are under `onboarding.meta.*`. T7 and T10 must read those paths; the plan does not fix them and T3 owns the file.
- No spec contradiction found: `specs/onboarding-generator.md` AC-31, AC-32, AC-33, AC-38, AC-41, AC-42 and AC-43 are all satisfiable as written by what shipped here. Nothing under `specs/` was edited.
- Nothing was committed, staged or pushed; no PR was opened.

---

**Parent's independent re-run of T3's Done-conditions:** `git diff --stat -- src/vendor/ui/` shows exactly one file, 8 insertions and no deletions; `messages/en/shell.json` 0 lines changed; the catalogue parses with 20 top-level keys; a script reading the real `OnboardingReason` enum out of the contract found **9 members, 0 missing keys, `generic` present**; `tsc --noEmit` clean.
