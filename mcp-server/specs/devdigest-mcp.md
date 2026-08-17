# DevDigest MCP server

A coding agent can list DevDigest's reviewer agents, run one on a pull request and get the
verdict and findings back from a single call, read an earlier review, and read a repository's
extracted conventions — all over stdio, addressing everything by `owner/name` and pull request
number rather than by internal id.

## Behaviour

### The surface

1. The server advertises **exactly five tools**: `devdigest_list_agents`,
   `devdigest_run_agent_on_pr`, `devdigest_get_findings`, `devdigest_get_conventions`,
   `devdigest_get_blast_radius`.
2. Every tool's input schema is **flat** — `string`, `number` and `enum` fields only, no nested
   object and no array — with at most 8 fields, and **every field carries a non-empty
   description**.
3. `devdigest_list_agents` is the **only** tool with an `outputSchema`, and it is therefore the
   only one whose result is also returned as `structuredContent`.
4. Annotations: `devdigest_run_agent_on_pr` is `readOnlyHint: false`, `destructiveHint: false`,
   `idempotentHint: false`, `openWorldHint: true`. The other four are `readOnlyHint: true`,
   `idempotentHint: true`, `openWorldHint: false`.
5. The server sends a non-empty `instructions` string in the handshake, under 2048 bytes, and
   every tool description is non-empty and under 2048 bytes.
6. Nothing but MCP protocol frames is ever written to **stdout**. Log output goes to stderr, at
   every level, and never contains a request or response body.
7. Every response is an **ordered projection** with a fixed key set — never a passthrough of an
   API payload. `system_prompt`, the conventions `scan`/`budget` envelope, per-row ids and
   triage timestamps never appear in any response.
8. Every list a tool returns has a **total order** (each comparator ends on a unique column), so
   two calls with the same arguments over unchanged data return rows in the same order.
9. A failure is reported as an MCP error result whose only content is **one sentence naming the
   next action** — never a status code, an error code or a stack.

### Addressing

10. `repo` accepts `"owner/name"`, or a **bare repository name** when exactly one repository has
    it. Matching is case-insensitive.
11. A bare name matching two or more repositories is **not** resolved: the answer lists the
    matching full names and asks for one of them.
12. `pr` is the **GitHub pull request number**. A non-integer or non-positive value is rejected
    before any HTTP call is made.
13. `agent_id` is an **agent id** from `devdigest_list_agents`, never a name — the answer for an
    unknown id lists the agents that exist, with their ids.
14. `run_id` is an id this server returned from `devdigest_run_agent_on_pr` in the **same
    process**.
15. An unresolvable `repo`, `pr` or `agent_id` produces a message that names the alternatives it
    does know (at most 20, then `(+N more)`) and the next call to make.
15a. A pull request may ALSO be addressed by its row uuid as `pr_id`, and a repository by
    `repo_id` on `devdigest_get_conventions`. `repo`/`pr` remain the recommended pair and
    what every description leads with; the uuid exists because the DevDigest studio's own
    URLs carry one, and a caller holding it previously had no way in. Neither field validates
    the id FORMAT — the API is the authority on whether an id exists, so only emptiness is
    rejected locally.
15b. **A uuid wins when both forms are supplied**, because it names exactly one row while a
    bare repository name may not. Supplying neither form is rejected with a message naming
    both accepted combinations, before any HTTP call.
15c. A uuid-addressed pull request does not always name its repository: `PrMeta` carries no
    `repo_id`, so the resolver tries its caches, then a single-repository workspace, then a
    bounded search that lists each repository's pulls until one matches (caching every list
    on the way, so the cost is paid at most once per repository per process). If all three
    come up empty, the two READ tools omit `repo` from the answer rather than invent one,
    and `devdigest_run_agent_on_pr` refuses with a message naming the recommended form —
    it reports a run *against* a repository and builds ten messages from that name.

### `devdigest_list_agents`

16. Takes no arguments. Returns `{ count, agents[] }`, each agent being exactly
    `{ id, name, description, model, enabled }`, and `description` capped at 200 characters.
17. Agents are ordered by `name`, then by `id`.
18. `enabled: false` means the agent is disabled in the studio; it can still be run by id
    (statement 25).
19. It reads the agents **live** on every call, so an agent added, edited or disabled while the
    session is open is reflected.
20. With no agents configured, the answer is `{ count: 0, agents: [] }` plus a `next_step`.

### `devdigest_run_agent_on_pr`

21. Takes `agent_id` plus one way of naming the pull request — `repo` + `pr`, or `pr_id` — and
    performs the whole cycle in one
    call: start the review, wait for it, return the result. The caller never polls.
22. It has **exactly three outcomes**, distinguished by `status`: `completed`, `failed`,
    `running`. One agent id means exactly one run, which is what bounds the set at three.
23. `status: "completed"` carries `repo`, `pr`, `agent`, `verdict`, `score`, `counts` (by
    severity), `run` (`run_id`, `duration_ms`, `cost_usd`), `findings`, `summary`.
24. `status: "failed"` carries `repo`, `pr`, `agent`, `run`, `error` (capped at 300 characters)
    and a `next_step`. A run that ends `cancelled` gets a different `next_step` from one that
    ends `failed`.
25. Naming a **disabled** agent by id runs it, and the response carries a `note` saying so — the
    results are real, and only a review across all agents skips disabled agents.
26. `status: "running"` is returned as a **success**, not an error, when the wait budget
    (`DEVDIGEST_MCP_RUN_TIMEOUT_MS`, 120 s by default) is exhausted. It carries `run_id` and a
    `next_step` that names `devdigest_get_findings` with that `run_id`, and states that no work
    was lost and that a second call would start a second run.
27. While waiting, only `done`, `failed` and `cancelled` are terminal. A `null` status, and any
    status string this server does not recognise, mean "still running".
28. If the created run is absent from three consecutive polls of the pull request's run history,
    the tool stops and answers `status: "failed"` with an `error` saying how many polls missed it
    — it does not wait the budget out.
29. On a `done` run the findings are read once. A `done` run with no review row answers
    `completed` with empty findings and a `next_step` naming the missing row.

### `devdigest_get_findings`

30. Accepts **either** `run_id`, **or** `pr_id`, **or both** `repo` and `pr`. None of them, or
    `repo` without `pr`, is rejected with a message that spells out all three accepted
    combinations. Passing several is accepted, and the most specific wins: `run_id`, then
    `pr_id`, then the pair.
31. The `run_id` path returns exactly one agent's pass: `reviewed: true`, `repo`, `pr`,
    `run_id`, `verdict`, `score`, `counts`, `total`, `offset`, `agents` (one entry), `findings`.
32. The `repo` + `pr` path reduces to the **newest `kind: 'review'` row per agent**, then
    aggregates: `verdict` is the worst across those agents and `score` is the **lowest** — the
    same basis the studio shows for the same pull request. Re-running one agent replaces that
    agent's row rather than adding to it.
33. A **never-reviewed** pull request answers `{ reviewed: false, repo, pr, findings: [],
    next_step }`, where `next_step` names `devdigest_run_agent_on_pr` with the same `repo` and
    `pr` and an agent id from `devdigest_list_agents`.
34. A `run_id` this process **did not hand out** is not a data answer: the response explains
    that run lookup is per-session (the API has no run-scoped read) and points at the
    `repo` + `pr` path, which works regardless of session.
35. A known `run_id` whose review row does not exist yet answers `reviewed: false` with the
    `repo`, `pr`, `run_id` and `agent` it does know, plus a `next_step`.
36. Findings are ordered severity (`CRITICAL`, `WARNING`, `SUGGESTION`), then confidence
    descending, then `file`, then start line, then id. **Dismissed findings are dropped**, not
    labelled.
37. `counts` and `total` are computed over the whole non-dismissed list, **before** paging, so a
    capped answer still reports how many findings the review really has.
38. `offset` and `limit` page over findings: `limit` defaults to 20 and is clamped to 50, and
    `offset` is clamped at 0. A response that is not the whole list carries a `truncated` string
    naming the exact next `offset`, and stating that what is not shown is lower severity or
    lower confidence rather than dropped.
39. An `offset` past the end returns no findings and a `truncated` string that says how many
    findings exist and to retry with a smaller offset.
40. `response_format: "concise"` (the default) gives each finding as `severity`, `title`, `file`
    (`"path:13"`, or `"path:13-19"` for a range) and `rationale`. `"detailed"` adds `category`,
    `confidence` and `suggestion` — it adds **fields, never rows**. Prose fields are capped at
    1200 characters, and a per-agent `summary` at 600.

### `devdigest_get_conventions`

41. Takes `repo` and `response_format`. Returns `repo`, `scanned`, `count`, `accepted_count` and
    `conventions[]`.
42. **All** candidates are returned, each with an `accepted` boolean — not only the accepted
    ones. Ordering is accepted first, then untriaged, then rejected; then confidence descending,
    then `category`, then `rule`, then id.
43. `response_format: "concise"` (the default) gives `rule`, `category`, `file`, `lines`,
    `confidence`, `accepted`. `"detailed"` adds `rationale` and up to 3 `evidence` citations,
    each snippet capped at 400 characters. **`evidence` never appears in `concise`.**
44. At most 30 conventions are returned; a capped answer carries a `truncated` string saying so
    and stating that `detailed` adds fields rather than rows.
45. The **two empty cases are distinguishable and answer differently**. `scanned: false` means
    conventions were never extracted for that repository, and its `next_step` states that the
    empty result is not evidence that the repository has no house rules. `scanned: true` with an
    empty list means the scan ran and kept nothing — every candidate failed evidence
    verification or held in too few places — and its `next_step` says that this is a
    measurement.

### `devdigest_get_blast_radius`

46. Takes `response_format` plus either `pr_id` or `repo` + `pr` (statements 15a-15c), and
    answers the pull request's impact map read
    from the codebase index: the symbols it changes, who calls them at `file:line`, and the
    HTTP endpoints and cron jobs reachable from there. Free — no model call and no analysis at
    request time.
47. **Callers are grouped BY SYMBOL** (`symbols[]`, each with `caller_count` and `callers`),
    not flattened into one list. "Which of my changed functions has fourteen callers" is the
    question a reviewer asks, and a flat list cannot answer it without a group-by. This is the
    one thing that moved from the stub, which had promised a flat `callers` array; the grouped
    shape is the one the server's own `DownstreamImpact` contract already defined.
48. **`status` leads the payload, and an empty map is never presented as "no impact".** Read
    top-down, a caller meets `status` and `reason` before it meets an empty `symbols` array,
    and for any non-`ok` status `next_step` names the **wrong conclusion** explicitly — that
    this pull request has no callers must not be inferred, because nothing was computed. The
    honesty property the stub was built around, kept now that real data sits behind it.
49. `counts` is the server's, passed through unchanged, so it keeps describing the whole map
    even where rows were truncated. `concise` shows at most 5 callers per symbol and
    `detailed` every caller the server sent (its own cap is 20 per symbol); either way
    `callers_truncated` marks a shortened list. At most 10 symbol rows, with
    `symbols_truncated` saying how many were dropped and on what ranking.
50. It makes **two** requests after resolving: `GET /pulls/:id` first, then
    `GET /pulls/:id/blast`. The first is called for its WRITE — it is the only writer of
    `pr_files`, which the map is a function of — so a pull request nobody has opened in the
    studio still gets a real answer instead of `degraded / no_changed_files`. A failure of
    that first call is **not** fatal: the map is still requested, and reports for itself if it
    had nothing to work with.
51. It still resolves `repo` and `pr` before anything else, so a typo fails immediately rather
    than hiding behind an empty result.

## Data

Everything comes from the DevDigest HTTP API over `DEVDIGEST_API_URL`, and every response is
parsed with a Zod contract from `@devdigest/shared` before it is projected. No database access,
no `Container`, no route added.

| Tool | Endpoints | Contract |
|---|---|---|
| `devdigest_list_agents` | `GET /agents` | `Agent` |
| `devdigest_run_agent_on_pr` | `GET /repos`, `GET /repos/:id/pulls`, `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /pulls/:id/reviews` | `Repo`, `PrMeta`, `ReviewRunResponse`, `RunSummary`, `ReviewRecord` + `FindingRecord` |
| `devdigest_get_findings` | `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id/reviews` | `Repo`, `PrMeta`, `ReviewRecord` + `FindingRecord` |
| `devdigest_get_conventions` | `GET /repos`, `GET /repos/:id/conventions` | `Repo`, `ConventionsPayload`, `ExtractedConvention` |
| `devdigest_get_blast_radius` | `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id`, `GET /pulls/:id/blast` | `Repo`, `PrMeta`, `PrDetail`, `PrBlastRadius` |

Every tool that takes `repo`/`pr` also accepts `pr_id` (statements 15a-15c); on that path it
reaches `GET /pulls/:id` to validate the id and read the number, and may reach
`GET /repos/:id/pulls` while naming the repository.

Notes on where the numbers come from:

- **The POST body is always `{agentId}`** — the `agentId` half of `RunRequest`
  (`contracts/platform.ts`), never the `all: true` path, which is what keeps one call to exactly
  one run and the status set at three. An empty body is rejected by the API with 400
  `invalid_run_request`.
- **`POST /pulls/:id/review` is fire-and-forget.** It creates the `agent_runs` rows and returns;
  `reviews` in its response is always `[]`, whatever `ReviewRunResponse`'s doc-comment says.
  Statement 21's single call is stitched together in this package, not offered by the API.
- **Findings are reachable only per pull request.** `GET /pulls/:id/reviews` is the only read of
  persisted findings — `GET /runs/:id/trace` carries a findings *count* and the raw model
  output. So the `run_id` path (statements 31, 34) depends on a per-process map from run id to
  pull request, written when the run is started.
- **A terminal run status implies the review row exists**, because the executor writes
  `insertReview` → `saveRunTrace` → `completeAgentRun`. That is what makes statement 29's single
  read race-free.
- **`reviews.kind` is not filtered by the API** and `reviews.agent_id` carries no foreign key
  and no `NOT NULL`, so the per-agent reduction in statement 32 filters `kind` itself and keys
  each bucket on `agent_id` with the row id as a fallback.
- **`score` is the minimum, by contract.** `PrMeta.score` is documented as the lowest score
  across the agents that reviewed the pull request, so statement 32 reports the same number the
  studio does.
- **Repository, pull request and agent lists are cached per process**, positively only: a
  successful list is remembered, a miss never is. A miss triggers exactly one refetch and then
  reports, so a pull request imported after startup resolves on the second attempt without a
  restart, and a genuinely absent one costs one extra request rather than a poll loop.

## States

| Case | Response |
|---|---|
| No agents configured | `{ count: 0, agents: [] }` + `next_step` |
| No repositories at all | resolution fails with a message naming the memoised-workspace cause and the restart that fixes it |
| Bare repo name matching 2+ repositories | resolution fails, listing the full names |
| Repository has no pull requests | resolution fails, naming the GitHub-sync causes (no token, repository absent on GitHub, no open PRs) |
| PR listed with no internal id | its own message: open the PR once in the studio, then retry |
| Pull request never reviewed | `{ reviewed: false, …, findings: [], next_step }` (statement 33) |
| Review finished, zero findings | `reviewed: true`, all-zero `counts`, `findings: []` |
| All findings dismissed | same as zero findings — dismissed rows are dropped |
| Findings beyond the page | `truncated` naming the next `offset` (38) |
| `offset` past the end | no findings + `truncated` naming the total (39) |
| Unknown `run_id` (earlier process) | failure explaining per-session lookup, pointing at `repo` + `pr` (34) |
| Run still going / no review row for a known run | `reviewed: false` + `next_step` (35) |
| Wait budget exhausted | `status: "running"` as a **success**, with `run_id` (26) |
| Run vanished from the run history | `status: "failed"`, `error` naming the missed polls (28) |
| Conventions never scanned | `scanned: false`, empty list, its own `next_step` (45) |
| Scanned, nothing kept | `scanned: true`, empty list, a different `next_step` (45) |
| Blast radius, complete map | `status: "ok"`, no `reason`, no `next_step` (48) |
| Blast radius, partial index | `status: "partial"`, real rows kept, `next_step` warning that an absent caller is not proof (48) |
| Blast radius, nothing analysed | `status: "degraded"` + the `reason`, and a `next_step` naming the inference not to draw (48) |
| API unreachable / rate limited / 5xx / contract drift | one sentence naming the next action — start the API, wait and retry once, read the API log with the `requestId`, or report the drifted field path |

## Non-goals

- **No blast-radius summary in prose.** The map is nodes and edges from the index; nothing in
  this tool asks a model to describe it.
- **No auth and no workspace argument.** The API's local provider resolves a default workspace
  server-side; this server sends no credentials.
- **No Streamable HTTP transport.** stdio only.
- **No SSE consumption.** `GET /runs/:id/events` exists, but polling `GET /pulls/:id/runs` is
  stateless, covers every run of a pull request in one request, and already carries `error`,
  `cost_usd` and `findings_count`. No tool exposes progress.
- **No paging outside `devdigest_get_findings`.** The other tools use a cap plus a `truncated`
  string that says how to narrow.
- **No convention triage, no writes of any kind** other than starting a review.
- **No compiled `dist/`.** The entrypoint runs from source under `tsx`.

## Implementation

| File | Role |
|---|---|
| `src/index.ts` | composition root: console redirect, config, client, resolver, server, stdio transport, signals |
| `src/server.ts` | `createServer(deps)`; registers `TOOL_DEFS`; turns a tool outcome into an MCP result |
| `src/tools/defs.ts` | the five tools as data — names, descriptions, annotations, schemas, handlers |
| `src/tools/schemas.ts` | the shared argument schemas and their descriptions; `ToolOutcome` |
| `src/tools/list-agents.ts` | statements 16–20, and the one `outputSchema` |
| `src/tools/run-agent-on-pr.ts` | statements 21–29: the start → wait → collect loop |
| `src/tools/get-findings.ts` | statements 30–40, and the findings block `run_agent_on_pr` reuses |
| `src/tools/get-conventions.ts` | statements 41–45 |
| `src/tools/get-blast-radius.ts` | statements 46-51 |
| `src/resolve.ts` | statements 10–15 and the per-process caches |
| `src/shape.ts` | the projections and every ordering: findings, conventions, per-agent reduction, aggregates |
| `src/errors.ts` | the seven `ApiFailure` kinds and `instructionFor` (statement 9) |
| `src/api/client.ts` | the only HTTP caller; segment encoding, boundary parsing, no body logging |
| `src/config.ts` | the four environment knobs, their defaults and clamps |
| `src/log.ts` | stderr-only logger and `redirectConsoleToStderr()` (statement 6) |
| `src/instructions.ts` | the handshake `instructions` and the budget ceilings (statement 5) |
| `test/budget.test.ts` | measures the real `tools/list` over an in-memory client pair: 1–5 |
| `test/tools.test.ts`, `test/run-agent.test.ts` | the tool surface and the wait loop |
| `test/shape.test.ts`, `test/resolve.test.ts`, `test/errors.test.ts` | the projections, the caches, the instructions |
| `test/stdout.test.ts` | statement 6, scanned over the whole `src/` tree |
| `../.mcp.json`, `../scripts/mcp.sh` | registration and launch |

## History

- **2026-08-13** — Added with the L04 MCP server: the five tools, the projections, the wait
  loop, and the blast-radius projection.
