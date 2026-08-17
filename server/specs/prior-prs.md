# Prior PRs

A reviewer can ask, for any pull request, which earlier pull requests already changed the
same files — and be told how much of the repository's history that answer was computed
over, rather than being handed a list that may be empty for the wrong reason.

Client half: [`../../client/specs/prior-prs.md`](../../client/specs/prior-prs.md).
The impact map this renders beside: [`blast-radius.md`](blast-radius.md).

## Behaviour

1. `GET /pulls/:id/prior-prs` answers `PrPriorPrs` for a pull request in the caller's
   workspace, and `404 not_found` for one that is not. The workspace lookup is the FIRST
   read: `pr_files` carries no `workspace_id` of its own, so every later query is scoped by
   the `repo_id` that lookup returned.
2. The route **writes nothing** — no cache row, no derived record, no freshness rule — and
   makes **no model call**: `PriorPrsDeps` declares one port (the review repository) and no
   LLM, GitHub, git, index or job-queue port exists in reach.
3. A **prior PR** is another pull request of the same repository with at least one
   `pr_files.path` in common with this one. The pull request being viewed is excluded from
   its own history.
4. The comparison set is this PR's `pr_files` paths, deduplicated and sorted. A path is
   compared exactly — no prefix, directory or rename matching.
5. Results are ordered **newest first** by `updated_at`, falling back to `opened_at`, then
   to "oldest" for a row carrying neither; ties break on `number` DESC. That is a **total**
   order (`pr_repo_number_uq` makes `number` unique per repository), so two reads of
   unchanged rows cannot disagree.
6. The list is capped at `MAX_PRIOR_PRS` (10). `total` reports the count BEFORE the cap and
   `truncated` says the list was cut.
7. Each row carries the overlap itself: `shared_files` (sorted, capped at
   `MAX_SHARED_FILES` = 5) and `shared_file_count`, the size before that cap. The evidence
   is the paths, never a similarity score.
8. `coverage` reports how many of the repository's pull requests have an imported file list
   (`with_file_lists`) out of how many exist (`total`). Both figures include the pull
   request being viewed.
9. `status` is derived from `coverage`, never from the result — see *States*. An empty list
   is never presented as a finding unless the coverage supports that reading.

## Data

| What | Where from |
|---|---|
| Endpoint | `GET /pulls/:id/prior-prs` → `PrPriorPrs` |
| Contract | `src/vendor/shared/contracts/prior-prs.ts` (new file; adds nothing to `contracts/blast.ts` and edits nothing) |
| This PR's changed files | `pr_files`, via `container.reviewRepo.getPrFiles` |
| Workspace scope | `pull_requests`, via `container.reviewRepo.getPull` |
| The overlap | `pr_files ⋈ pull_requests`, via `reviewRepo.listPriorPrOverlaps` |
| Coverage | `count(pull_requests)` and `count(distinct pr_files.pr_id)`, via `reviewRepo.countPullCoverage` |

**Contract change on the record.** `src/vendor/shared/` is a do-not-touch zone, so this is
where the agreed change is written down: `contracts/prior-prs.ts` is a NEW file plus one
barrel line, `client/src/vendor/shared/` receives the identical file, and both copies move
together. Nothing existing is reshaped — in particular `PrBlastRadius` gains no field, so
every consumer written against the impact map is untouched.

## States

| State | `status` | `reason` | Meaning |
|---|---|---|---|
| Full history | `ok` | `null` | Every pull request in the repository has an imported file list. An empty list here is a real finding: nothing else touched these files. |
| Only one PR in the repo | `ok` | `null` | There is no prior work to find, and that is a fact rather than a gap. |
| Some file lists missing | `partial` | `incomplete_file_lists` | What is listed is real; what is missing proves nothing. |
| No other file list at all | `degraded` | `no_file_lists` | Other pull requests exist and not one of them has been opened, so nothing could be compared. |
| This PR has no file list | `degraded` | `no_changed_files` | `pr_files` is empty for it. `GET /pulls/:id` is that table's only writer, so its detail has never been loaded. No query was run. |
| PR in another workspace | — | — | `404 { error: { code: 'not_found' } }`. |

A `degraded` answer is **200**, not an error: a local-first tool whose pull requests have
not all been opened is an ordinary state, and the reviewer needs the reason.

## Non-goals

- **Not a field on `PrBlastRadius`.** The impact map is derived from the codebase index and
  says so without qualification; this is a history read over `pr_files`. Merging them would
  cost that statement, and would make the card's headline wait on a second query.
- **No fetching of missing material.** A pull request with no `pr_files` is reported, not
  repaired — a second writer of that table is how the Intent Layer came to classify PRs
  from their title alone (`INSIGHTS.md`, 2026-08-11).
- **No git history.** "Who last touched this file" via blame is a different feature with a
  different cost; this reads rows DevDigest already has.
- **No rename or move tracking.** A file renamed between two PRs reads as two paths.
- **No relevance ranking.** Rows are ordered by recency, not by overlap size or a computed
  score — the overlap travels as evidence and the reviewer judges it.
- **No writes of any kind**, so no staleness rule and nothing two readers could disagree on.

## Implementation

| File | Role |
|---|---|
| `src/modules/prior-prs/routes.ts` | The one route; `IdParams`, workspace context, no rate limit. |
| `src/modules/prior-prs/service.ts` | Grouping, ordering, the caps and the coverage→status mapping. |
| `src/modules/prior-prs/types.ts` | The one port, declared by the consumer — no import of `modules/reviews/`. |
| `src/modules/prior-prs/constants.ts` | `MAX_PRIOR_PRS`, `MAX_SHARED_FILES`. |
| `src/modules/index.ts` | Static registration (`priorPrs`). |
| `src/platform/container.ts` | `get priorPrs()` — the service, no repository of its own. |
| `src/modules/reviews/repository/pull.repo.ts` | `listPriorPrOverlaps`, `countPullCoverage`. |
| `src/vendor/shared/contracts/prior-prs.ts` | `PriorPrsStatus`, `PriorPrsReason`, `PriorPr`, `PriorPrsCoverage`, `PrPriorPrs`. |
| `test/prior-prs.test.ts` | The service, hermetic; the `Proxy` that proves the one-port claim. |
| `test/prior-prs.it.test.ts` | The route over real Postgres: registration, contract, scope, the SQL exclusion and the coverage counts. |

## History

`2026-08-15` — Feature added (L04), after the impact map: the Blast Radius card answers
what a change could reach, and reviewers kept asking the complementary question — who has
already been in this code, and who to ask about it.
