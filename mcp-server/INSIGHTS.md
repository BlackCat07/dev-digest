# mcp-server — engineering insights

Append-only journal for `@devdigest/mcp-server`. Seven fixed sections; newest entry at
the bottom of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

Note: this package only ever reads the DevDigest API over HTTP, so an insight about it is
often really an insight about that API's behaviour, or about the `@devdigest/shared`
contracts it parses with. Say which — and if it is the API's, `../server/INSIGHTS.md` may
be the better home.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or
  already stated in `CLAUDE.md` / `README.md` / `../TESTING.md`.
- **Substantial.** Record what cost real time or would mislead the next reader. Not:
  code structure that is plain from reading it, style nits, linter-catchable issues,
  or facts true only inside one session.
- Nothing substantial this session → write nothing. That is a valid outcome.

## Entry format

One bullet per insight, appended under the one section it belongs to:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `src/path/file.ts` (`functionName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

Replacing a section's `_No entries yet._` placeholder on first append is expected — it is
not an entry.

The skill that maintains this file: `.claude/skills/engineering-insights/`.

---

## What Works

Approaches and solutions that worked and should be reused.

<!-- append below -->

- **2026-08-13** — **The `@devdigest/shared` alias was verified against all THREE resolvers
  before any code leaned on it, and the third one is the only one that proves anything.**
  `client/INSIGHTS.md` (2026-08-03) records the failure mode this guards: a runtime-value
  import from that barrel passes `tsc` **and** `vitest` — each resolves the alias its own way
  — and dies only in the real resolver, because the barrel re-exports with ESM `.js`
  extensions. So the scaffolding check was `tsc -p tsconfig.json`, then a probe test under
  `vitest`, then **`tsx src/probe.ts`** — the runtime `scripts/mcp.sh` actually starts. Two
  details that made the check worth its time rather than ceremonial: a **negative control**
  (`const bad: PrMeta = { number: "not-a-number" }` must fail with `TS2322`, or the import is
  silently `any` and the probe proves nothing), and a `require.resolve('zod')` from inside the
  aliased barrel, which returned `mcp-server/node_modules/zod` with
  `PrMeta instanceof z.ZodObject === true` — i.e. the `paths` zod pin really does collapse to
  one instance. Copy this three-resolver-plus-negative-control shape when adding any new
  alias here; two of the three agreeing means nothing. Evidence: `tsconfig.json` (`paths`),
  `vitest.config.ts` (`resolve.alias`).

- **2026-08-14** — **Shipping a stub with the real signature paid off exactly as intended, and
  the one thing that still moved is worth knowing before writing the next one.** L04 added
  `GET /pulls/:id/blast` and `devdigest_get_blast_radius` became real: `repo` and `pr` were
  unchanged (only `response_format` was added, which every read tool here has), so no caller
  written against the stub broke. The stub's honesty properties survived too and are now
  carrying real data — `status`/`reason` lead the payload, and `next_step` still names the
  inference not to draw. What DID move is the part the stub had guessed: it promised the
  snake_cased fields of the facade's `BlastResult`, i.e. a flat `callers` array, and the real
  answer groups callers under `symbols[]`. The grouped shape was already defined in
  `@devdigest/shared` as `DownstreamImpact` — so the lesson is that a stub should copy the
  shape from the CONTRACT that already exists, not from the internal type of the service that
  will feed it; those two differed here, and only one of them was the wire format. Evidence:
  `src/tools/get-blast-radius.ts`, `../server/src/vendor/shared/contracts/blast.ts`
  (`BlastDownstream`), `specs/devdigest-mcp.md` (statements 46-51).

- **2026-08-14** — **Two HTTP calls, and the first one is made for its WRITE.**
  `devdigest_get_blast_radius` calls `GET /pulls/:id` before `GET /pulls/:id/blast`, because
  the map is a function of `pr_files` and that route is its only writer
  (`../server/INSIGHTS.md`, 2026-08-11) — without it, any PR nobody has opened in the studio
  answers `degraded / no_changed_files`, which is a truthful answer to a question the caller
  did not mean to ask. Two details make it safe rather than clever: the detail call's failure
  is deliberately NOT propagated (the map is still requested, and reports for itself if it had
  nothing to work with), and it runs AFTER resolution, so a typo'd address still fails on the
  cheap path. Any future tool reading something derived from `pr_files` needs the same
  prelude. Evidence: `src/tools/get-blast-radius.ts`, `src/api/client.ts` (`getPull`,
  `getBlast`), `test/tools.test.ts` ("loads the PR detail first").

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

- **2026-08-13** — **A total-order test asserted over an ALREADY-SORTED fixture passes with
  every tiebreaker deleted, so the fixture has to be fed in the wrong order or the test is
  theatre.** `../server/INSIGHTS.md` (2026-08-06) prescribes asserting that the returned ids
  equal the *sorted* ids, which is necessary and, on its own, not sufficient: `Array.prototype.sort`
  is **stable** in V8, so a fixture list that already arrives in the intended order comes back
  in that order whether the comparator has its tiebreakers or not. Measured here on the three
  comparators in `shape.ts`: with the fixtures deliberately shuffled, deleting the `id`
  tiebreaker from the findings comparator turns 3 tests red and deleting
  category/rule/id from the conventions comparator turns 2 more red; over pre-sorted fixtures
  the same five assertions stay green. So the checklist for any ordering test in this repo is
  two items, not one — assert against the sorted ids **and** shuffle the input. Evidence:
  `src/shape.ts` (`compareFindings`, `compareConventions`, `compareReviewsNewestFirst`),
  `test/shape.test.ts` (`UNORDERED_FINDINGS`, `UNORDERED_CONVENTIONS`).

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

- **2026-08-14** — **`PrMeta` carries no `repo_id`, so "address a pull request by its uuid" is
  not the one-line feature it looks like.** Every route a uuid unlocks (`/pulls/:id/...`) needs
  only the id, but every PAYLOAD wants the repository name — and the API offers no way from one
  to the other: `GET /pulls/:id` returns `PrDetail`, which extends `PrMeta` and adds body,
  files, commits and the linked issue, none of them the repository. What worked is a three-tier
  lookup, cheapest first: the resolver's already-cached pull lists (free, exact), then a
  single-repository workspace (then it can only belong to that one), then a bounded search that
  lists each repository's pulls until it matches — caching every list, so the cost is paid at
  most once per repository per process and later resolutions ride on it. The tier that matters
  is the last one, and it is worth its cost only because of the second finding here: the two
  READ tools can omit an unknown `repo` from their answer, but `run_agent_on_pr` cannot, because
  it stores the name in `runOrigins` and builds ten sentences out of it. Rather than thread "the
  repository might be unknown" through all ten, that tool REFUSES the uuid when the name cannot
  be found and names the recommended form instead. Generalises: before adding an alternative
  address form, check which consumers treat the derived fields as mandatory — that, not the
  lookup, is what decides how hard the resolution has to try. Evidence: `src/resolve.ts`
  (`resolvePullById`, `repoHoldingPull`), `src/tools/run-agent-on-pr.ts` (`resolvePullTarget`),
  `../server/src/vendor/shared/contracts/platform.ts` (`PrMeta`).

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-13** — **The server `instructions` string is not in `tools/list`** — it travels in
  the initialize result, and the only way to read what actually arrived is
  `client.getInstructions()` on an SDK `Client`. This matters for the budget test: measuring
  the exported `INSTRUCTIONS` constant instead would keep passing if the second `McpServer`
  constructor argument were ever dropped, which is precisely the regression that silently
  costs every new conversation its addressing rules. `test/budget.test.ts` measures the wire
  value and separately asserts it equals the constant. Evidence: `test/budget.test.ts`,
  `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` (`getInstructions`).

- **2026-08-14** — **The `tools/list` ratchet fired for the first time, and the useful part is
  the breakdown rather than the number.** Adding four optional uuid arguments (`pr_id` on three
  tools, `repo_id` on one) took the response from **5776 B to 6879 B** — a 19% jump for four
  fields, which is far more than their text. Shortening both new `.describe()` strings
  recovered only **136 B** (→ 6743), confirming what `CLAUDE.md` says about this response being
  mostly envelope: the rest is per-field JSON Schema scaffolding (`type`, `description`, the
  `required` bookkeeping) and cannot be written away without dropping the field. So the
  practical rule when this fires: measure, try the descriptions once, and if the growth is
  scaffolding then it is the FIELD COUNT that must be justified — not the wording. Raised to
  7000 with the measurement recorded at the constant. Also worth watching:
  `devdigest_get_findings` now sits at **7 of 8** allowed input fields, so it has room for
  exactly one more before `MAX_TOOL_INPUT_FIELDS` blocks it. Evidence:
  `test/budget.test.ts` (`TOOLS_LIST_RATCHET_BYTES`), `src/tools/schemas.ts` (`PrIdArg`).

- **2026-08-13** — **`new URL('localhost:3001')` does not throw — it parses, with
  `protocol === 'localhost:'`.** A bare `host:port` reads to WHATWG as a scheme, so a config
  validator that only guards against a throw accepts `DEVDIGEST_API_URL=localhost:3001` and
  then fails much later at fetch time. The scheme allowlist catches it, but the honest message
  is not "unsupported scheme `localhost:`" — that reads as nonsense to whoever typed a
  perfectly reasonable host. Carry a worked example in the message (`http://localhost:3001`)
  so the fix is visible from the error alone. Evidence: `src/config.ts` (`ApiUrlSchema`).

- **2026-08-15** — **None of this package's env knobs reach it under MCP Inspector, and the
  failure is silent.** `@modelcontextprotocol/client`'s stdio transport does not pass the parent
  environment to the spawned server: `getDefaultEnvironment()` copies a fixed allowlist —
  `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` on posix — and drops everything else. So
  `DEVDIGEST_MCP_RUN_TIMEOUT_MS=300000 npm run inspect` starts a server on the 120 s default with
  no warning anywhere, because `config.ts` correctly reads "not set" and applies its fallback.
  The knob only arrives through a per-server `env` block (an Inspector `--config` file, a
  writable `--catalog` entry, or `.mcp.json` for Claude Code) — never through the shell that
  launched the client. Worth knowing before debugging "why is my config being ignored": the
  answer is one layer above this package. Evidence:
  `~/.npm/_npx/*/node_modules/@modelcontextprotocol/client/dist/stdio.mjs`
  (`DEFAULT_INHERITED_ENV_VARS`), `src/config.ts` (`pick`).

- **2026-08-15** — **`.min(1)` on an OPTIONAL string argument is hostile to form-based clients,
  which send a touched-but-blank field as `""` rather than omitting it.** Clearing `pr_id` in
  MCP Inspector's generated form leaves the key in the `tools/call` params with an empty value,
  and the SDK rejects it against `inputSchema` before any handler runs — so the caller gets
  `MCP error -32602: Input validation error … String must contain at least 1 character(s) at
  pr_id` instead of `EITHER_OR_MESSAGE`, which is the whole point of that either/or refinement
  and never gets a chance to speak. The user-visible workaround is to reload the client so the
  field is untouched again; the code-level fix, if this recurs, is
  `z.preprocess(v => (v === '' ? undefined : v), …)` on every optional string arg (`pr_id`,
  `repo`, `repo_id`, `run_id`). General shape: an optional field whose absence carries meaning
  needs to treat blank and absent alike, or the friendliest error in the package is unreachable.
  Evidence: `src/tools/schemas.ts` (`PrIdArg`), `src/tools/run-agent-on-pr.ts`
  (`EITHER_OR_MESSAGE`).

- **2026-08-15** — **The run budget has a SECOND half that lives in the client, and until both
  are raised the first one is decorative.** `-e DEVDIGEST_MCP_RUN_TIMEOUT_MS=300000` really does
  reach the server (verified: `configuration loaded {"run_timeout_ms":300000}`), and a long
  review still died at about a minute with a bare `Request timed out`. That string is the
  client's, not ours — `instructionFor()` never produces a bare phrase — and it comes from the
  MCP SDK's per-request default, `DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4`, which applies because
  Inspector 2.2.0 ships `requestTimeout: 0` meaning "SDK default" (its raw-wire path uses a
  separate `?? 3e4`). So the client aborts at 60 s while the server happily waits 300 s, and the
  run keeps going with nobody holding its `run_id` — strictly worse than the honest
  `{status:'running'}` a smaller budget would have returned. **Ours must be the smaller of the
  two numbers.** Fixed by moving the whole session into `inspector.config.json`
  (`--config <file> --server <name>`, options only, no command), which carries the launcher, the
  `env` AND `requestTimeout: 310000` in one committed file; verified through the Inspector's own
  `GET /api/servers` (header `x-mcp-remote-auth: Bearer <token>`), which echoes both back.
  Note `--server` is a **no-op for the web UI** in 2.2.0 — it prints so on startup and lists
  every server in the file — so a one-server file is what makes the UI open on the right one.
  Evidence: `inspector.config.json`, `package.json` (`inspect`), `src/config.ts`
  (`DEFAULT_RUN_TIMEOUT_MS`), `~/.npm/_npx/*/node_modules/@modelcontextprotocol/inspector`
  (2.2.0, `clients/web/build/index.js`).

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

_No entries yet._

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

- **2026-08-13** — **`devdigest_get_blast_radius` is a deliberate stub, and exactly one thing
  unblocks it: an HTTP route.** `RepoIntel.getBlastRadius(repoId, changedFiles)` is **fully
  implemented** (`../server/src/modules/repo-intel/service.ts`), but
  `repo-intel/routes.ts` mounts two routes and this is not one of them — so the only missing
  pieces are the route, its zod contract, and a decision about where `changedFiles` comes from
  (`pr_files` is written only by `GET /pulls/:id` — see `../server/INSIGHTS.md`, 2026-08-11).
  Exposing it is a `server/` change, which this pass held at zero files by design. Until then
  the stub answers `reason: "not_implemented"`, a value deliberately **outside** the real
  `DegradedReason` union, so it can never be mistaken for a truthfully-empty impact map.

  **RESOLVED 2026-08-14.** The route landed as an L04 **server** feature with its own spec
  (`GET /pulls/:id/blast`, `../server/specs/blast-radius.md`), and this tool consumes it.
  Both open decisions were settled the way this bullet anticipated: the contract is a new
  `contracts/blast.ts` in the frozen shared package (extend-by-new-file, mirrored into the
  client copy), and `changedFiles` comes from `pr_files` — with the tool calling
  `GET /pulls/:id` first, precisely because that route is their only writer. See the two
  2026-08-14 entries under *What Works*. Closed; the bullet above stays as the record.

- **2026-08-13** — **Whether this package should get its own `.dependency-cruiser.cjs` is still
  open.** `dependency-cruiser` is already a runtime dependency of `server/`, so gating the
  layering here would cost a config plus a script, not an install — but the existing gate runs
  as `depcruise … src ../reviewer-core/src` from `server/`, so extending it would mean editing
  `server/package.json` and `server/.dependency-cruiser.cjs`. Deferred on the ground that a
  `src/` of ~12 files has not yet earned a graph gate; revisit when a second consumer or a
  second transport arrives. Note `onion-architecture` deliberately does **not** govern this
  package — its own stated scope is `server/` and `reviewer-core/`.
