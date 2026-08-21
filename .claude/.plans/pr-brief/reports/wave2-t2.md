# Implementation report — SPEC-03 PR Brief / T2

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 3 files changed, 0 added, nothing committed. The four wave-1 files (`contracts/pr-brief.ts` ×2, `index.ts` ×2) were left untouched.

## Coverage

- INSIGHTS server: 41 entries, 3 relevant (2026-08-02 — `pnpm <script>` can die before the script runs, so the direct binaries were used; 2026-08-19 — `grep` without `-a` scans nothing on a NUL-carrying source file, so every grep below carries `-a`; 2026-08-19 — no gate typechecks `server/test/`, which is why the stale integration assertion under `## For the parent` is a static finding rather than a gate result).
- INSIGHTS client: 30 entries, 3 relevant (2026-08-06 — Settings → Feature Models can only ever write `provider: "openrouter"`, and the registry lives in three places that must move together: this is the whole basis of T2; 2026-08-03 addendum — client imports of `@devdigest/shared` must stay `import type`, which is why `src/lib/feature-models.ts` is a third declaration rather than an import; 2026-08-19 — `eslint` on a path under `src/vendor/` exits 0 while linting nothing, so the client `eslint` invocation deliberately names only the non-vendor file).

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `typescript-expert` | preloaded | all three changed `*.ts` |
| `zod` | preloaded | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts` |
| `frontend-ui-architecture` | preloaded | `client/src/lib/feature-models.ts` |
| `onion-architecture` | preloaded | `server/src/vendor/shared/contracts/platform.ts` (the ports ring) |

Matches the plan's routing table: yes, plus `frontend-ui-architecture` and `onion-architecture`, which T2 did not name but whose rows matched the changed files. `FEATURE_MODELS` is a plain `FeatureModelDef[]`, not a zod schema, so no `zod` rule reference file governed a line of this diff; `FeatureModelId` and `Provider` were both read and left unchanged.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/vendor/shared/contracts/platform.ts` | T2 | yes | `risk_brief`: `defaultProvider` `'openai'` → `'openrouter'`, `defaultModel` `'gpt-4.1'` → `'deepseek/deepseek-v4-flash'`; four-line comment above the entry, worded to match its `review_intent` neighbour |
| `client/src/vendor/shared/contracts/platform.ts` | T2 | yes | byte-identical change to the server copy (`DDG-DNT-001`) |
| `client/src/lib/feature-models.ts` | T2 | yes | same two values in the third declaration; five-line comment in this file's own wording (`SettingsModels`, double quotes, "this screen could never restore once changed") |

No field was added or removed, no type changed, no name moved. `FeatureModelId` gains no member. `conformance`'s `openai` / `gpt-4.1` default is untouched.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R21 | T2 | yes — all three declarations carry `openrouter` and the same model string; `FeatureModelId` unchanged; `conformance` untouched |

## Deviations from the plan

None.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0, 0 errors |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/vendor/shared/contracts/platform.ts"` | pass — rc=0 (server's `eslint.config.js` does **not** ignore `src/vendor/**`, so this is real coverage) |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings).` — the plan's baseline, unmoved |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 49 files, 618 passed, 0 failed |
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — rc=0 |
| client | lint | `CI=true ./node_modules/.bin/eslint "src/lib/feature-models.ts"` | pass — rc=0. The two `src/vendor/` paths were deliberately kept out of this invocation (`client/INSIGHTS.md`, 2026-08-19: a vendor path there exits 0 having linted nothing) |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 47 files, 388 passed, 0 failed |
| both | T2 contract-identity gate | `diff -q server/.../platform.ts client/.../platform.ts` | pass — `IDENTICAL` (and the two blobs hash the same, `29257fb`) |
| both | T2 grep gates (`id: 'risk_brief'` `-A4`, and `risk_brief -A6` on the lib file) | all three | pass — one `openrouter` line each; the corrected anchor and window the dispatch specified worked as described |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised by the dispatch |
| e2e | flows | `../scripts/e2e.sh` | gate did not run — not authorised, no browser flow in this plan |

## Not done

- `absent` — no test row. T2 has none in the plan's `## Tests` table, and none was written.
- `not checked` — `server/test/settings-models.it.test.ts` was **not run** (Docker). Its stale assertion below was found by `grep`, not by a red gate.
- `not checked` — the `/settings/[section]` screen in a running app. `SettingsModels.tsx` renders `f.defaultModel` as the selected value when no override is stored, so the Risk Brief row's displayed model changes; nothing was opened in a browser.

## For the parent

- **A test outside my Owned paths now contradicts the new default, and no gate I was allowed to run can see it.** `server/test/settings-models.it.test.ts:54-57` asserts `resolveFeatureModel(db, workspaceId, 'risk_brief')` equals `{ provider: 'openai', model: 'gpt-4.1' }`. That is precisely the value AC-61 changes. The file is `.it.test.ts` (Docker, not authorised) and is not in T2's Owned paths, so it was neither edited nor run — flagging it rather than touching it. It needs the same two values as the registry. Whoever picks it up should note `server/INSIGHTS.md` (2026-08-10): no gate typechecks `server/test/`, and (2026-08-06) a whole-suite run silently skips most `.it.test.ts` files, so this will not surface from a green run.
- `client/src/lib/feature-models.ts` has exactly one consumer, `.../SettingsModels/SettingsModels.tsx`, and it reads `f.defaultModel` for the displayed value. Observable consequence of this diff: the Risk Brief row now shows `deepseek/deepseek-v4-flash` and that value is in the live OpenRouter list, so the "ensure the current value is selectable even if it isn't in the live list" prepend branch stops firing for this row. That is a route-render change of the kind `DDG-UI-001` asks to be looked at in the running app; T2 does not name that invariant, so it is reported as an observable and not as a finding.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Neither is mine.

Relevant absolute paths: `/Users/krasymyr.tretiak/Work/dev-digest/server/src/vendor/shared/contracts/platform.ts`, `/Users/krasymyr.tretiak/Work/dev-digest/client/src/vendor/shared/contracts/platform.ts`, `/Users/krasymyr.tretiak/Work/dev-digest/client/src/lib/feature-models.ts`, and the stale assertion at `/Users/krasymyr.tretiak/Work/dev-digest/server/test/settings-models.it.test.ts`.

---

## Parent's notes on this report

**The stale assertion is entered in the finding ledger as `P1-1`, bucket `mechanical`, and is
not being fixed here.** The implementer was right not to touch it: it is outside T2's Owned
paths, and an implementer editing a file no task owns is the failure the Owned-paths rule
exists to prevent. It goes through remediation like any other finding.

**It is worth naming why this one is dangerous rather than merely wrong.** Two recorded facts
compound: no gate typechecks `server/test/` (`server/INSIGHTS.md`, 2026-08-10), and a
whole-suite `vitest run` silently skips most `.it.test.ts` files even when Docker is up
(2026-08-06). So this test can stay red for months while every visible signal is green — and it
was found by a `grep` an implementer chose to run outside its own gate list, not by any gate in
the plan. That is the report doing more than it was asked to.
