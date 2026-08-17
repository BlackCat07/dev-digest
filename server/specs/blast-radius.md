# Blast Radius

A reviewer can ask, for any pull request, what else the change could touch — which symbols
it declares, who calls them, and which HTTP endpoints and scheduled jobs are reachable from
there — without the server analysing the repository during the request.

Client half: [`../../client/specs/blast-radius.md`](../../client/specs/blast-radius.md).
MCP half: [`../../mcp-server/specs/devdigest-mcp.md`](../../mcp-server/specs/devdigest-mcp.md).
The card's history footer, deliberately a separate route: [`prior-prs.md`](prior-prs.md).

## Behaviour

1. `GET /pulls/:id/blast` answers `PrBlastRadius` for a pull request in the caller's
   workspace, and `404 not_found` for one that is not. The workspace lookup is the FIRST
   read: `pr_files` and the index tables carry no `workspace_id` of their own.
2. The map is derived on every read from the persistent codebase index. The route **writes
   nothing** — no cache row, no derived record, no freshness rule.
3. The route makes **no model call**, and cannot: `BlastDeps` declares two ports (the review
   repository and one index read) and no LLM, GitHub, git or job-queue port exists in reach.
4. The route **never parses the repository**. No AST extraction and no import-graph build
   happen during the request; every fact is read from `symbols`, `references`, `file_edges`,
   `file_rank` and `file_facts`. The reverse graph walk costs at most `BFS_DEPTH` (2) indexed
   queries.
5. **Changed symbols** are the symbols declared in the PR's changed files. The qualified
   `Class.method` dual-emit is skipped — the bare name already covers it.
6. **Callers** are cross-file references whose `decl_file` resolved to a changed file. The
   declaring file is excluded from its own callers. An ambiguous (`NULL decl_file`) reference
   is not asserted as a caller: the map favours precision over recall.
7. Callers are ordered by the caller file's `file_rank` DESC, then `file`, `line`,
   `viaSymbol` — a **total** order, so two reads of unchanged rows cannot disagree.
8. Callers are capped at `MAX_CALLERS_PER_SYMBOL` (20) **per symbol**, not per response.
   `caller_count` reports the count BEFORE the cap and `truncated` says the list was cut, so
   "14 callers" above a shorter list is a correct reading rather than a discrepancy.
9. **Impacted endpoints and crons** are collected from three directions, deduplicated on
   label+kind+file, keeping the shallowest `depth`:
   - `depth: 0` — declared by a changed file itself.
   - `depth: 1` — declared by a file holding a resolved symbol caller.
   - `depth: 1..BFS_DEPTH` — declared by a file that (transitively) **imports** a changed
     file, found by walking `file_edges` **backwards**.
10. The graph direction is "who depends on the changed file", never "what the changed file
    depends on". A dependency of a changed file must never appear as downstream of it.
11. `downstream` carries one entry per changed symbol that has at least one caller, ordered
    by `caller_count` DESC then impact count, symbol, file. A changed symbol with no callers
    stays in `changed_symbols` and does not appear in `downstream`.
12. `impacted` (map level) is the union from statement 9 and is strictly wider than the
    per-symbol lists: impact belonging to the PR rather than to one symbol lives only here.
13. `counts` is computed once, server-side, from the map-level union — so the four figures a
    client renders cannot drift from the tree beneath them. `endpoints` and `crons` count
    DISTINCT labels; one route reached through three symbols is one route at risk.
14. Endpoints sourced from **test files** are excluded. The extractor cannot distinguish
    "declares this route" from "calls this route", so an integration test records the API it
    exercises; a test is a consumer that will re-run, not a live surface at risk.
15. An empty map always states why — see *States*. The response never presents a gap as a
    fact.

## Data

| What | Where from |
|---|---|
| Endpoint | `GET /pulls/:id/blast` → `PrBlastRadius` |
| Contract | `src/vendor/shared/contracts/blast.ts` (new file; reuses `ChangedSymbol` and `DownstreamImpact` from `contracts/brief.ts` and edits neither) |
| Changed files | `pr_files`, via `container.reviewRepo.getPrFiles` |
| Workspace scope | `pull_requests`, via `container.reviewRepo.getPull` |
| Symbols, callers, ranks | `symbols`, `references`, `file_rank` — through `repoIntel.getBlastRadius` |
| Import graph | `file_edges`, reverse-indexed on `(repo_id, to_file)` |
| Endpoints and crons | `file_facts`, written by the indexer's `extractEndpoints` / `extractCrons` |
| Index coverage | `repo_index_state.status` and `.last_indexed_sha` |

**Contract change on the record.** `src/vendor/shared/` is a do-not-touch zone, so this is
where the agreed change is written down: L04 adds `contracts/blast.ts` and one barrel line.
Nothing existing is reshaped, and `client/src/vendor/shared/` receives the identical file —
both copies move together.

## States

| State | `status` | `reason` | Meaning |
|---|---|---|---|
| Complete map | `ok` | `null` | The index covers the repository. An empty `downstream` here is a real finding: nothing calls the changed symbols. |
| Incomplete index | `partial` | `index_partial` | Real data, but callers may be missing. Absence proves nothing. |
| No changed files | `degraded` | `no_changed_files` | `pr_files` is empty. `GET /pulls/:id` is its only writer, so the PR's detail has never been loaded. Nothing was analysed. |
| No index | `degraded` | `index_missing` | Nothing usable was read; the facade fell back or found nothing. |
| Indexing off | `degraded` | `flag_off` | `REPO_INTEL_ENABLED` is off for this workspace. |
| Index failed / repo too large | `degraded` | `index_failed`, `repo_too_large` | Passed through from the facade unchanged. |
| PR in another workspace | — | — | `404 { error: { code: 'not_found' } }`. |

A `degraded` map answers **200**, not an error: a local-first tool with no index yet is an
ordinary state, and the reviewer needs the reason rather than a failure.

## Non-goals

- **No model-written summary.** The optional one-paragraph explanation the lesson allows was
  deliberately not built, so the "main path makes exactly zero LLM calls" property needs no
  qualification. Adding one later means a separate endpoint, not a field on this one.
- **No fetching of missing material.** A PR with no `pr_files` is reported, not repaired.
  A second writer of that table is precisely how the Intent Layer came to classify PRs from
  their title alone (`INSIGHTS.md`, 2026-08-11).
- **No re-indexing on read.** Coverage is a repository-level concern with its own control
  (`POST /repos/:id/resync`).
- **No transitive symbol callers.** Callers are one hop in the *symbol* graph; reachability
  is expressed through the file graph instead, bounded at two hops.
- **No writes of any kind**, so no staleness rule and nothing two concurrent readers could
  disagree about.

## Implementation

| File | Role |
|---|---|
| `src/modules/blast/routes.ts` | The one route; `IdParams`, workspace context, no rate limit. |
| `src/modules/blast/service.ts` | Grouping, attribution, status mapping, the counts and the test-path filter. |
| `src/modules/blast/types.ts` | The two ports, declared by the consumer — no import of `modules/repo-intel/`, which would trip `no-cross-module-internals`. |
| `src/modules/index.ts` | Static registration (`blast`). |
| `src/platform/container.ts` | `get blast()` — the service, no repository of its own. |
| `src/vendor/shared/contracts/blast.ts` | `BlastStatus`, `BlastReason`, `BlastEndpoint`, `BlastDownstream`, `BlastCounts`, `PrBlastRadius`. |
| `src/modules/repo-intel/service.ts` | `getBlastRadius` — per-symbol cap, `compareCallers` total order, `reverseImpact`, `ownFacts`. |
| `src/modules/repo-intel/repository.ts` | `getImporters` — the reverse `file_edges` read. |
| `src/adapters/codeindex/extract.ts` | `extractEndpoints`, now scanning whole files. |
| `src/modules/repo-intel/constants.ts` | `INDEXER_VERSION = 3`, forcing the re-extraction that fix needs. |
| `test/blast-service.test.ts` | The service, hermetic; the `Proxy` that proves no LLM port is reachable. |
| `test/repo-intel-blast.test.ts` | The facade: cap, total order over shuffled fixtures, graph direction. |
| `test/blast.it.test.ts` | The route over real Postgres: registration, contract, scope, no-model proof. |

## History

`2026-08-14` — Feature added (L04). Three defects in the pre-existing
`repoIntel.getBlastRadius` were fixed as part of it, each of which the acceptance criteria
would otherwise have failed on: the 20-caller cap applied to the whole response instead of
per symbol; `ORDER BY rank DESC` had no tiebreaker, so ties decided which callers survived
truncation; and endpoints were collected only from files holding a symbol caller, one hop
away, rather than by walking the import graph backwards. A fourth was found on real data —
the "changed files declare no symbols" early return dropped the index status, making a fully
indexed repository report `partial / index_missing` for any docs-only change.

`2026-08-14` — `extractEndpoints` scanned line by line, so it could not see a route whose
path sits on the line after `app.get(` — which is how prettier formats every
`modules/*/routes.ts` in this repository. Measured on a real index: 21 files carried endpoint
facts and all 21 were client hooks; every server route file carried none, so the endpoint
half of this feature was empty on real data. Fixed by scanning whole files, with
`INDEXER_VERSION` bumped to 3 to force re-extraction.
