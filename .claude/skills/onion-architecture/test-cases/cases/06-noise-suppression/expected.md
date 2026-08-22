# Answer key — fixture F (`exports` — noise suppression)

This fixture inverts the others. It contains **exactly ONE real violation** and **three
deliberate traps** that a reviewer without the skill is likely to report as problems. It
measures false positives, not recall.

## The one real violation

| # | File | Defect | Rule (severity) | Correct shape |
|---|---|---|---|---|
| F1 | `modules/exports/service.ts` lines 1, 22-23, 31 | A feature module imports the `octokit` SDK directly and constructs `new Octokit({ auth: token })` from a hand-fetched secret | `modules-no-raw-sdk` (**error**) — `octokit` is first in the `RAW_SDKS` list. Gate goes red | `await this.container.github()` — the `GitHubClient` port and its adapter already exist, with a mock for tests |

## The three traps — reporting any of these as a violation is a false positive

| Trap | What it looks like | Why it is correct |
|---|---|---|
| T1 | `ExportsRepository` returns the module's own `ExportItem` type rather than a Drizzle row | The layer table says a repository "return[s] rows or domain values, never a leaked query builder". Returning the domain value is the point of the ring, so asking for a Row type back is backwards |
| T2 | `modules/exports/types.ts` is Zod schemas + free functions (`render`, `orderItems`, `filenameFor`) with no class and no behaviour on the data | SKILL.md: *"No rich entity classes. Zod contracts plus pure functions are the deliberate choice here… An 'anemic model' is not a defect in this codebase."* This is the prescribed shape |
| T3 | `modules/repo-intel/pipeline/exports.ts` imports `adapters/codeindex/extract.js` and `adapters/astgrep/index.js` directly, and reads `SUPPORTED_EXT` from `repo-intel/constants.js` | Both are **named exceptions** in the skill's exception ledger: *"`modules/repo-intel/service.ts` imports adapters directly. repo-intel **is** the indexer subsystem; it behaves as infrastructure and is reached only through the `container.repoIntel` facade"*, and `SUPPORTED_EXT` is the encoded `pathNot` exception. Encoded in `.dependency-cruiser.cjs` as `pathNot` |

## Deliberately NOT scored

`ExportsService` taking the whole `Container` is **out of scope** — same reasoning as
`04-over-layering`: it is a *new* service, so SKILL.md's "take the ports they need" applies
and flagging it is legitimate. Score it neither way.

## Notes for grading

- A report scores well by finding F1 **and** leaving all three traps alone. Silence on a trap
  counts as leaving it alone; explicitly endorsing it is better but not required.
- Naming a trap as a deliberate/known exception is a pass. Filing it as a problem, a violation,
  a "should be refactored", or a "consider narrowing/adding a class" is a **false positive**.
- Real but unplanted defects, not scored either way: the N+1 `octokit.rest.pulls.get` inside
  the loop, `repoFullName` taken from a path param without validation, the CSV injection risk
  in `render`, `groupBy` omitting `t.findings.id`, and the missing `response` schema.
