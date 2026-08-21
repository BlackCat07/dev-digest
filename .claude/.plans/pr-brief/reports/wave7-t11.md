# Implementation report — SPEC-03 PR Brief / T11

**Status: complete.** Third dispatch; the first two were killed by API 529 before making an edit.

As of `06d7488` (`L05-spec-driven-development`); 5 files added, 0 modified, nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 12 relevant — 2026-08-06 (`ORDER BY` with no tiebreaker: a heap order moves on any `UPDATE`, so the key sorts the file list into a total order); 2026-08-11 (`GET /pulls/:id` is the only writer of `body`/`pr_files` — why head SHA alone is not sufficient); 2026-08-11 (a hand-written `pull_requests` total contradicted the `pr_files` sums — why `diff_stats` sums the rows the brief was built from); 2026-08-15 (`pr_files` sparse on every real workspace); 2026-08-14 (`import type` does not exempt a cross-module edge); 2026-08-10 (`modules-no-raw-sdk` does not list Node builtins — the grep is the gate); 2026-08-10 (no gate typechecks `test/` — ran `tsc -p tsconfig.eslint.json` and diffed the count, which caught two real `error TS` in a green suite); 2026-08-19 (`grep` needs `-a`); 2026-08-19 (a grep gate scoped to an import specifier; fix the prose, not the gate); 2026-08-19 (`approxTokens` is `ceil(chars/4)`, and a listing that opens no files takes `size` from `stat`); 2026-08-04 (zsh `PIPESTATUS`, no word-splitting); 2026-08-02 (`pnpm <script>` can die before the script).
- INSIGHTS client: not in scope — no client path owned, none touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | all three `server/src/modules/brief/*.ts` |
| `typescript-expert` | preloaded | all five changed files |
| `security` | preloaded | `assemble.ts` (eight foreign inputs, no patch, no normalised path escaping), `documents.ts` (confined reads through the port) |
| `zod` | preloaded | the contract types consumed (`BriefSource`, `BriefDiffStats`) — no new schema declared here |
| `fastify-best-practices` | preloaded | not exercised — no route file in this task |
| `drizzle-orm-patterns`, `postgresql-table-design` | preloaded | not exercised — `repository.ts` is T9's and untouched |

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/brief/cache-key.ts` | T11 | yes | new. `computeCacheKey`, `renderCacheKeyState`, `dedupeFilesByPath`; the nine AC-2 values plus `BRIEF_FORMAT_VERSION`, each in its own length-prefixed slot; the file list deduplicated by path and sorted into a total order before digesting |
| `server/src/modules/brief/documents.ts` | T11 | yes | new. `collectEffectiveDocSet` (AC-59's union across enabled agents, first occurrence winning), `docWalkRoots`, `sizeEffectiveDocs` (one `stat`-only walk, exact-membership `match`), `cacheKeyDocs`, `readEffectiveDocs` (size cap checked before a byte is read) |
| `server/src/modules/brief/assemble.ts` | T11 | yes | new. `assembleBriefInput` over the eight sources; order-then-cap through `orderChangedFilesByRole` + `capFileList(ordered, MAX_PROMPT_PATHS)`; whole-source shedding in `SHED_ORDER`; `coreOverBudget` for AC-16; compile-time assertion that every `BriefSourceKind` is core or droppable and none is both |
| `server/test/brief-cache-key.test.ts` | T11 | yes | new. 21 tests — the nine-value table, key stability, heap-order independence, EC-4, document order, separator-imitation, plus the effective-document-set union and sizing |
| `server/test/brief-assemble.test.ts` | T11 | yes | new. 20 tests — the eight kinds, the audit trail, AC-11's patch absence, AC-60/AC-17 at 400 files, EC-36's case pair, the five-drop shed ladder, AC-16, AC-30's figures |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R2 — the nine-value cache key | T11 | yes — the `MUTATIONS` table plus "ten distinct keys" |
| R5 — eight sources, no diff hunk body, every string traceable | T11 | yes — "offers exactly the eight named kinds and no others"; "leaks no substring of a stored patch" |
| R6 — size is `sum of ceil(characters/4)` | T11 | **partially, by design** — the formula is `approxTokens`, applied to the blocks; AC-12's *as-sent* measurement is T12's and this task claims nothing about the 8 000 ceiling |
| R7 — shed optional sources in `SHED_ORDER`, never the core, no call if the core overruns | T11 | yes — three tests |
| R8 — role order, then the 200 cap, remainder stated | T11 | yes — mutation-verified |
| R16 — one source entry per offered input | T11 | yes — the `dropped_over_budget` rewrite asserted with `chars: null` |
| R20 — the union of the enabled agents' effective sets | T11 | yes — `collectEffectiveDocSet` tests |

Two assertions were mutation-verified rather than trusted, each applied to the real file and then reverted (`diff -q` confirms both files byte-identical again): removing the canonical sort in `canonicalFileLines` turns `brief-cache-key.test.ts` red, and swapping `orderChangedFilesByRole`/`capFileList` turns `brief-assemble.test.ts` red.

## Deviations from the plan

- **The digest is a pure three-lane 32-bit hash plus the canonical length, not `createHash('sha256')`.** `node:crypto` is unreachable from this module: T9's and T12's Done-conditions both gate `src/modules/brief/` on zero `node:` import specifiers, and T12 runs after this wave, so importing it would turn a later task's gate red. The alternative — a `Digest` port — needs `platform/container.ts`, not in T11's Owned paths. The key is a change detector, not a security primitive: nothing is authenticated by it, and the worst outcome of a collision is one stale brief, which `force` clears. Stated in the file header.
- **AC-2's "nine values" is read as the nine pull-request-state values, with the brief-format version as the tenth ingredient.** The criterion's enumeration has eight clauses; its observable says "changing any one of those nine values, with the other eight held". The only self-consistent reading is that the version is not one of the nine — it is a constant of the code and cannot be held while another moves. Every value the criterion names is digested in its own slot and the test asserts each one alone moves the key, so nothing depends on the count.
- **The key's file list is sorted; the prompt's is role-ordered.** The order imposed for the key is `(path, additions, deletions)` ascending, applied *before* the dedup so a disagreeing duplicate pair resolves the same way every time. The prompt keeps `pr_files` order within each role, because AC-60 requires it and `file-roles.ts` refuses to re-sort. Deliberate, documented in both files.
- **`documents.ts` also exports `readEffectiveDocs`.** The plan's bullet named the union and the byte sizes. The read is here because `MAX_DOCUMENT_BYTES` has no other honest call site: it must be checked against the size the walk just reported, before a byte is opened. Its consumer is T13.
- **A document the walk never sized but that reads cleanly is `used`, not `unfetched`.** The plan's phrasing assumes a missing size means the document is gone; the read is the more authoritative answer, and marking a document that actually reached the prompt `unfetched` would report a gap that does not exist and could push a brief to `partial` for nothing. The sizing note travels onto the entry, so the audit trail still says the key's `0` was a stand-in. A document that cannot be read is still `unfetched`.
- **The document-set union is tested in `server/test/brief-cache-key.test.ts`.** A third test path is not in T11's Owned paths, and the set is one of the nine key values.
- **`assemble.ts` imports `approxTokens` from `../../adapters/tokenizer/index.js`.** The same edge `modules/project-context/service.ts` already has; no `dependency-cruiser` rule covers module → adapter, and the baseline held. Re-implementing `ceil(chars/4)` locally would be a second spelling of the figure the plan wants comparable across features.
- **Two "nothing was offered" cases record no source entry:** a pull request with no description, and a prior-PRs read that succeeded with no overlap. Both follow `modules/intent/sources.ts`: an `unfetched` entry reads as a failure and neither is one. A non-`ok` prior-PRs status *is* recorded.

## Blocked

None.

## Gates

| Package | Gate | Result |
|---|---|---|
| server | typecheck (src) | pass — 0 errors |
| server | typecheck (tests) | pass — 16 errors, all `pre-existing`, 0 in a `brief-*` file. **Measured 16 before the first edit, 18 mid-run (own fixture), 16 after the fix** |
| server | lint | pass — five paths quoted individually |
| server | onion | pass — `x 22 dependency violations (0 errors, 22 warnings)`, baseline unmoved |
| server | unit | pass — 52 files, **672 tests**, 0 failures (baseline 50 / 631; +41) |
| server | no sibling-module import | pass — 0 lines |
| server | no `node:` import | pass — 0 lines |
| server | no db access outside `repository.ts` | pass — 0 lines |
| server | `DDG-WIRE-002` | pass — 0 lines |
| server | `DDG-WIRE-001` | pass — 0 `UNREGISTERED:` lines; `modules/brief/` still has no `routes.ts`, correctly skipped |
| server | integration | gate did not run — Docker not authorised |
| client | — | gate did not run — no client file touched |

## Not done

- `absent` — the final post-wrap size check. `AssembledInput.tokens` is the pre-wrap figure the shedding decided on, and both the file header and the test header say so; AC-12's measurement over the messages *exactly as sent* is T12's, and nothing here may be read as proof the 8 000-token ceiling holds.
- `absent` — `prompt.ts`, `schemas.ts`, `grounding.ts`, the service and the routes. T12 and T13.
- `not checked` — `server/test/brief.it.test.ts` and any DB-backed behaviour.
- `not checked` — the running app. No route render changed here.

## For the parent

- **Candidate for `server/INSIGHTS.md`:** a feature module in this repo cannot use `node:crypto`, because the `modules/<name>/` grep gates forbid every `node:` import specifier and not just the filesystem one — so a feature needing a digest either declares a port for the composition root to satisfy or hand-rolls a pure one. `modules/repo-intel/pipeline/full.ts` and `.../incremental.ts` do use `createHash('sha1')`, which reads as a precedent and is not one: repo-intel is the named infrastructure exception in `.dependency-cruiser.cjs`. Evidence: `src/modules/brief/cache-key.ts` (`computeCacheKey`), `src/modules/repo-intel/pipeline/full.ts:21`.
- **Candidate for `server/INSIGHTS.md`:** the "hand it a row with an extra property" trick that proves an absence is defeated by TypeScript's excess-property check, and only under `tsconfig.eslint.json` — `vitest` stays green because it transpiles without typechecking. The fixture must be bound to a `const` first to lose its freshness. A concrete instance of the 2026-08-10 entry, and it cost two real `error TS` here that the suite could not see. Evidence: `test/brief-assemble.test.ts` (`leaks no substring of a stored patch`, the `rows` binding).
- **`specs/pr-brief.md` AC-2 counts its own values as nine and enumerates eight clauses.** The reconciling reading is recorded in `cache-key.ts` and is what the tests assert. Worth one clarifying clause from `doc-writer` when the spec reaches `implemented`, in the same pass as F1/F2/F3.
- **T12 inherits two named obligations:** re-measure `approxTokens(system) + approxTokens(user)` after wrapping (over budget with any optional block still present means the shed loop was handed a stale figure and is a defect, not a degradation), and ground citations against `AssembledInput.groundingPaths` — the *listed* subset, not `changedPaths`, because a path the cap left out was never in front of the model. `groundingPaths` carries paths in the exact form `pr_files` recorded.
- `plan-verifier` has not been run, and is not mine.

---

## Parent's notes on this report

**Three dispatches, two killed by API 529 before their first edit.** Verified on disk after each
failure: none of T11's five Owned paths existed, so neither retry had anything to reconcile. An
API error is not `Status: blocked` — nothing about the task needed a human decision — and the
skill's no-retry rule does not apply to it. The third attempt's dispatch added a suggested work
order (`cache-key.ts` first, it depends on nothing but the ports) so that a fourth failure
mid-run would leave one whole module rather than three half-written ones.

**The `node:crypto` finding is the sharpest thing in this report.** The module gates forbid
*every* `node:` import specifier, not just the filesystem one — so a feature module that needs a
digest cannot have one, and the two files in `repo-intel` that call `createHash` read as a
precedent while being the named infrastructure exception in `.dependency-cruiser.cjs`. The
implementer took the honest way out and said so in the file header: the key is a change detector,
nothing is authenticated by it, and a collision costs one stale brief that `force` clears. Held
for Phase 6.

**A fourth spec finding, alongside the plan's F1/F2/F3.** AC-2 says "nine values" and enumerates
eight clauses. The reading that reconciles them — the format version is an ingredient of the
digest but not one of the nine changeable state values — is now recorded in the code and asserted
by the tests, so nothing downstream depends on the count. Added to the ledger for `doc-writer`.

**The excess-property-check note is a real trap and it caught itself.** The trick for proving an
absence — hand the assembler a row carrying a `patch` it should never read — is defeated by
TypeScript's freshness check, and **only** under `tsconfig.eslint.json`, which no gate runs by
default. The implementer watched the count go 16 → 18 → 16 and fixed its own fixture. Anyone who
skipped that command would have shipped two real type errors under a green suite.
