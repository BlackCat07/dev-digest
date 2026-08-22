# What these cases actually measured

Four iterations, 46 runs, 2026-08-21/22. The run outputs are gone (regenerable, ~2.9M tokens
of agent work); this is the record of what they showed. Read it before adding a case — most of
the obvious case designs were tried here and measured as non-discriminating.

## The four iterations

| # | Cases | Configurations | Result |
|---|---|---|---|
| 1 | `01`, `02`, `03` | with / without skill, in-repo | 100% vs 100%, **delta 0.00**. All 15 assertions passed in both arms |
| 2 | `04`, `05`, `06` | + isolated with / without | in-repo 88.9% vs 88.9% (**0.00**); isolated 88.9% vs **61.1%** (**+0.28**) |
| 3 | `01`, `04`, `06` | new vs old skill version | 17/17 vs 17/17, **delta 0.00**. Zero of 17 assertions differed |
| 4 | `07` | new vs old, **5 runs each** | 34/40 (85% ± 6%) vs 30/40 (78% ± 10%) |

## Why iteration 1 measured nothing

Every planted defect was either a named `dependency-cruiser` rule or a sentence in a package
`CLAUDE.md`. `server/.dependency-cruiser.cjs` is not a bare config: it carries rule names,
severities, a `RAW_SDKS` list and a prose `comment` per rule explaining the correct shape. The
baseline quoted it verbatim, including the `from`/`to` regexes. `reviewer-core/CLAUDE.md` states
the purity contract outright. And `grep -rn "class .*Entity" server/src/` plus
`find server/src -type d -name domain` is enough to reject an entity class without any skill.

**Consequence for new cases:** a case only discriminates if the repository itself does not
already answer it. Check `.dependency-cruiser.cjs`, the package `CLAUDE.md` files, and whether a
grep over `src/modules/` settles it, before writing the fixture.

## What did discriminate (iteration 2, isolated pair only)

`D1` over-layering · `D2` rich entity · `D3` the `domain/` folder · `D_names_threshold` ·
`E2` Row type in the application ring · `F_recognises_gate_severity`.

All six are content that exists nowhere else in the tree. In the **in-repo** pair not one of the
18 assertions discriminated.

One assertion discriminated **against** the skill: `F_no_fp_repo_intel_adapters`. Only the
skill-equipped isolated run filed the ledgered `repo-intel` adapter imports as a violation,
demanding a `pathNot` and a ledger row for a rule that does not exist. Teaching that an exception
ledger exists made one run over-apply it.

## Noise (iteration 2, 3 reports per configuration)

| configuration | findings | architecture | code_quality | invented |
|---|---|---|---|---|
| with_skill | 33 | 7 | 25 | 1 |
| without_skill | 40 | 10 | 29 | 1 |
| isolated_with_skill | 31 | 8 | 20 | 3 |
| isolated_without_skill | 32 | 7 | 23 | 2 |

**The skill does not reduce noise**, and in isolation it produced more invented findings than the
baseline. Four of the seven invented findings across all arms were the same one — demanding a
`response:` schema — and the only run that checked and declined was a *baseline* run, which read
`prior-prs/routes.ts` and found the convention documented there.

## Iteration 4 — the only run with repeats (n=5, case `07`)

| Assertion | new | old |
|---|---|---|
| `P1` transitive impurity, both ends of the chain | **5/5** | **5/5** |
| `P2` Row type in the port signature | **5/5** | **5/5** |
| `P2` cites the mock's cast as evidence | **5/5** | **5/5** |
| `P3` transaction boundary | **5/5** | **5/5** |
| `T1` narrow deps left alone | **5/5** | **5/5** |
| `T2` structural adapter left alone | **5/5** | **3/5** |
| `T4` the `helpers.ts` Row import left alone | **0/5** | **0/5** |
| gate attributed correctly | **4/5** | **3/5** |

**No difference clears the n=5 bar.** `T2` at 5/5 vs 3/5 is Fisher p ≈ 0.22, and the three old
runs that passed it argued *for* structural satisfaction — the knowledge is in both versions,
just unstably applied. The gate assertion at 4/5 vs 3/5 is noise.

Two findings that are not about versions at all:

- **`T4` is 0/10, a shared blind spot.** Every run flagged `helpers.ts`'s `db/rows.ts` import
  alongside the port's and prescribed removing both. Neither `SKILL.md` says Row→DTO mapping in
  `helpers.ts` is a Row type's legitimate home. **This is an unfixed gap in the skill**, with the
  strongest evidence in the whole suite. Amend `rules.md` (`OA-DEEP-002`) and the case will move.
- **3 of 10 runs invented a gate firing.** `row-types-stay-in-persistence` was claimed to fire on
  `ports.ts` (its `from` is `(service|routes).ts`); one run claimed `ports-import-nothing` turns
  the gate red on `node:fs` (its `to.path` is `^src/(?!vendor/shared)`). Recall was saturated, so
  gate reasoning is what is left to measure.

Report length varied **170–500 lines within one configuration** at an identical prompt. Any
conclusion drawn from a single run is a coin toss — iterations 1-3 were all n=1.

## The two skill edits, measured

Both were mine, both turned out to be presentational rather than additive:

- **`OA-REV-001`** (a table of the gate's blind spots) — **inert**. The old snapshot already
  carried the same facts scattered through `rules.md`'s `Gate` column, and the baseline reasoned
  from them unaided.
- **`OA-DEEP-001`** — recall unchanged at 10/10. The old version reaches the same finding by
  splitting it into `OA-PORT-001` plus `OA-CORE-003` and joining them explicitly.

## A contradiction the runs surfaced in the skill itself

`OA-INFRA-001` makes `repository.ts` the only file permitted to hold a query. So when
`OA-SIZE-001` says a repository is unearned, **there is nowhere legal for the query to go** —
`routes.ts` breaks `OA-TRANS-001`, `service.ts` breaks `OA-APP-003`, and `OA-GATE-001` forecloses
"it is only a warn" for both. `OA-SIZE-001` is unactionable for any single-query feature.

It compounds: `SKILL.md` cites `workspace/routes.ts` as the model for *not* wrapping a query,
while that same file sits on the `routes-no-data-access` burn-down list the skill says must be
cleared. The skill holds up its own tracked drift as the pattern to copy. `04-over-layering`'s
`expected.md` inherits the error — it prescribes collapsing into `routes.ts`, which another rule
forbids. **Both still need fixing.**
