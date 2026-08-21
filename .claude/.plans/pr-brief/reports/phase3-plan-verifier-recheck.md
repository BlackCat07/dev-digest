# Plan verification — re-check of R14 after fix round 2

**R14: `partial` → `yes`.** Corrected totals for the full set: **19 `yes`, 3 `yes (differently)`,
0 `partial`** — 19 + 3 = 22, matching the plan's 22 requirements. This supersedes both the header
arithmetic slip in the first report and that report's R14 row; its other 21 rows stand unchanged.

Targeted re-dispatch, not a fresh run. R1–R13 and R15–R22 were deliberately not re-derived: the
two remediation rounds touched no file any of them depend on, apart from the eleven whose gates
are re-run below.

## R14 / AC-30 — the blast map's counts are now on the stored payload

Method: inspection + test, both run in the verifier's own session.

- **Contract.** `server/src/vendor/shared/contracts/pr-brief.ts:253-268` — `BriefDiffStats` now has
  six **required** (non-nullable, non-optional) `z.number().int()` fields: `files_changed`,
  `files_listed`, `additions`, `deletions`, `symbols`, `endpoints`. `diff -q` against the client
  copy: `IDENTICAL`.
- **Population site.** `server/src/modules/brief/assemble.ts:415-426` — the **one** place
  `diffStats` is built, taking `symbols` / `endpoints` from `input.blast.counts`, with a
  doc-comment on why they are not re-derived from `changed_symbols` / `impacted`.
  `service.ts:576` forwards `assembled.diffStats` unchanged, and both `emptyBrief()`
  (`service.ts:898-905`, the `never_generated` state) and `repository.ts`'s `EMPTY_BODY`
  (`:78-90`) carry the same six-field shape with honest zeros — consistent everywhere rather than
  patched in one spot.
- **A test asserting the values, not merely typechecking them.**
  `server/test/brief-service.test.ts:685-704` — "carries the deterministic figures and no invented
  advice (AC-30)" drives `ThrowingProvider` (so the model call fails and the brief is model-less)
  against `blast: blastFacts({ counts: { symbols: 4, callers: 9, endpoints: 3, crons: 2 } })`, then
  asserts `brief.diff_stats` `toEqual` the full six-field object including `symbols: 4,
  endpoints: 3`. **Four distinct numbers, deliberately** — a swapped field fails rather than
  passing on a coincidence. `risk_level: null` and `risks: []` are asserted alongside.
  Ran this session: 3 files, 55 tests passed.

## `DDG-DNT-001`

`diff -q` on the two `contracts/pr-brief.ts` copies → `IDENTICAL`. `git diff --stat` on both
`contracts/brief.ts` → empty, so the frozen contract is untouched in both copies as the fix plan
required.

## Standing gates, re-run independently

| Gate | Result |
|---|---|
| server `tsc --noEmit -p tsconfig.json` | pass, 0 errors |
| server `tsc --noEmit -p tsconfig.eslint.json` | pass — exactly **16** `error TS`, across exactly `adapters`, `agents-versions.it`, `conventions.it`, `prompt-callers`, `repo-intel-facade-degraded`, `skills.it` |
| `depcruise` | pass — `x 22 dependency violations (0 errors, 22 warnings). 234 modules, 801 dependencies cruised.` |
| server hermetic suite | pass — **741** tests, 56 files, 0 failures |
| client `tsc` | pass, 0 errors |
| client suite | pass — **414** tests, 50 files, 0 failures |

All six match the round-2 report's claimed figures, measured independently rather than taken on
trust — which was the point of asking.

## Judgment on the `safeParse` consequence

**Within spec, not a defect.** Because the two new fields are required, a brief stored under the
earlier four-field shape fails `StoredBody.safeParse` and reads back as no brief. The verifier
grounded the agreement rather than accepting the claim: `repository.ts`'s own header documents this
as designed and **predates** the fix — "a body that fails the parse comes back with
`bodyValid: false`, which the read path treats as NO brief and offers for regeneration — never as a
500 nobody can clear without a database" (EC-24) — and `StoredBody` is derived from the served
contract via `.pick()` precisely so a field the contract adds cannot silently drop on the way out.
No acceptance criterion requires backward-compatible reads across a contract that had not yet
shipped a stored row.

## Not checked

- **The `pr_brief` row count in the live database.** The verifier is read-only and had no database
  access, so it accepted "zero rows" as the round-2 report's measurement and flagged it as not
  independently confirmed. The orchestrator did confirm it earlier in the run: T15's own
  `select count(*) from pr_brief` returned `0` against `devdigest-postgres`.
- R1–R13, R15–R22 and the fifteen Done-conditions beyond the eleven-file gate re-run — excluded by
  the dispatch, and stated as excluded so the record is unambiguous.
