# dependency-checker — provenance

Authored in this repo, 2026-08-22. No upstream, so **no entry in
`skills-lock.json`** — see the note in [`../README.md`](../README.md) about which
skills may be reshaped.

## What it is

A dependency audit that ends in a prioritised action list. Four files:

| File | Role |
|---|---|
| `SKILL.md` | The procedure, the hard rules, the prioritisation rubric |
| `report-format.md` | The six-section output template |
| `metrics.md` | What each measured number means and where it misleads |
| `scripts/scan.mjs` | The measurement. Facts only, no judgement |

## Design decisions

**A script measures, the agent judges.** Sizes and counts are exactly the thing a
language model should not produce from reading files — they get estimated, and an
estimate in a table looks identical to a measurement. `scan.mjs` emits JSON with no
opinions in it; the rubric in `SKILL.md` turns that into priorities. Every number in
a report is traceable to a command.

**The scanner has no dependencies and never will.** `jq` is not installed on the
development machine, and adding an npm package to run the audit would mean editing a
lockfile, which the root `CLAUDE.md` lists as never-hand-edit. Node stdlib only.

**Candidates, not verdicts.** The first version reported `unusedCandidates` as
"unused". Checking the three it found in `server/` produced three different answers —
one genuinely unused, one loaded through a deliberately opaque dynamic import, one
redundant-but-load-bearing. Mandatory Step 4 verification came from that, and the
worked example is kept in `SKILL.md` because it is more convincing than the rule.

**Six sections, always all six.** An audit's value is knowing what was checked. A
section that prints `none` is a result; a section that is absent is ambiguous between
clean and skipped, which is why `Not measured` in section A is mandatory.

## Measured on this tree (2026-08-22, for calibration)

Whole-repo scan: **~2 s**, no network. 1.46 GB installed across six packages, 1801
package installs, of which only `client/`'s 11 runtime dependencies can reach a
browser. Four dependencies drift across packages (`@types/node`, `typescript-eslint`,
`globals`, `tsx`) — all of them types or toolchain, none runtime.

## Sources

- pnpm docs — `node-linker`, the `.pnpm` virtual store, `pnpm audit --json`
- npm docs — `npm audit --json`, hoisting and resolution order
- Node.js — CommonJS/ESM `node_modules` resolution algorithm
- Everything else is measured on this repository; the tables in `metrics.md` cite the
  file and line each claim came from.
