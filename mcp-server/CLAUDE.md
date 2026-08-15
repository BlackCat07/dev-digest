# mcp-server — `@devdigest/mcp-server`, a local stdio MCP server over the API

Wraps the DevDigest HTTP API in five agent-facing tools, so a coding agent can ask for a
review and read findings without opening the studio. **HTTP client only**: it never imports
`server/src/platform/container.ts`, never touches Postgres, and adds no route.

## Commands

```sh
npm ci             # npm, NOT pnpm — this package has package-lock.json
npm run typecheck  # tsc --noEmit on BOTH projects (src, then src + test + root configs)
npm run lint       # eslint .
npm test           # vitest run --passWithNoTests
npm run dev        # tsx src/index.ts — speaks MCP on stdin/stdout, not a web server
npm run inspect    # MCP Inspector over inspector.config.json — the manual tool-surface check
                   # (that file carries the launcher, the env AND the client-side
                   # requestTimeout; see Gotchas — both timeouts have to be raised)
```

`dev` is rarely what you want: this is a **stdio** server, so a client spawns it and owns its
lifetime. Started by hand it just waits for JSON-RPC on stdin. Use `inspect` to look at the
surface, or `/mcp` in a Claude Code session. Nothing in `../scripts/dev.sh` starts or installs
this package, deliberately.

Run the gates as **binaries**, never through `pnpm <script>` / `npm run <script>`: the
package-manager pre-script dep check has already killed a gate in this repo before the script
started (`../server/INSIGHTS.md`, 2026-08-02 and 2026-08-04). `CI=true` keeps a non-TTY call
from being asked a question.

```sh
CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json          # src/**
CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json   # + test/** and *.ts
CI=true ./node_modules/.bin/eslint .
CI=true ./node_modules/.bin/vitest run
```

Both `tsc` invocations matter: the second one is the only gate that looks at `test/**`, and it
is wide from day one on purpose — in `server/` no test file is typechecked by anything
(`../server/INSIGHTS.md`, 2026-08-10).

## Map

```
src/index.ts          composition root — the ONLY file that touches `process` or a transport
src/server.ts         createServer(deps) → McpServer; registers TOOL_DEFS in one loop
src/config.ts         the ONLY reader of process.env — four knobs, one zod safeParse
src/log.ts            the ONLY stream writer, and stderr is the only stream
                      + redirectConsoleToStderr()
src/errors.ts         ApiFailure union (7 kinds) → instructionFor(): one sentence per kind
src/resolve.ts        "owner/name" + PR number → ids; three per-process positive caches
src/shape.ts          pure projections: findings, conventions, one review per agent
src/instructions.ts   INSTRUCTIONS + the byte and field budget constants
src/api/client.ts     the only file that speaks HTTP; `fetchImpl` is the injected test seam
src/tools/defs.ts     the five tools AS DATA — server.ts registers it, budget.test.ts measures it
src/tools/schemas.ts  the shared argument schemas, each with a non-empty .describe()
src/tools/{list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.ts
test/                 errors · resolve · shape · run-agent · tools · budget · stdout
```

Registration lives at the repo root, not here: [`../.mcp.json`](../.mcp.json) points at
[`../scripts/mcp.sh`](../scripts/mcp.sh), which resolves its own root and `exec`s
`./node_modules/.bin/tsx src/index.ts`.

## Conventions

- **stdout IS the transport.** MCP over stdio means `process.stdout` carries JSON-RPC frames;
  one stray byte corrupts a frame and the client drops the connection with nothing pointing
  back here. Every log line goes to **stderr**, and three independent mechanisms hold that
  line, each covering what the others cannot:
  1. `eslint.config.js` — `no-console: error` package-wide (**tests included**) and
     `process.stdout` restricted to `src/log.ts` and `src/index.ts`. Sees only our source, and
     only the files a lint run was pointed at.
  2. `test/stdout.test.ts` — the same rule re-checked over the whole `src/` tree on every
     `vitest run`, anchored on `import.meta.dirname` rather than the cwd.
  3. `redirectConsoleToStderr()` in `src/log.ts` — the only layer that reaches a **dependency**
     logging from inside itself. It is called before any other module of this package is
     evaluated, which is why `src/index.ts` imports everything else with `await import(...)`.
- **This package uses npm; `server/` and `client/` use pnpm.** `package-lock.json` is npm's,
  like `reviewer-core/` and `e2e/`. Never run a pnpm command in here.
- **`@devdigest/shared` arrives through a tsconfig `paths` alias** onto
  `../server/src/vendor/shared` — the canonical Zod contracts. That path is a **do-not-touch
  zone we read and never edit** (root `CLAUDE.md`): a needed change there is coordination,
  recorded in a spec, and it moves together with the client's hand-made copy. Because the
  alias makes the contracts a compile-time dependency, **contract drift is caught by `tsc`**,
  which is why this package has no hand-written response types and no `contract.test.ts`.
  `vitest.config.ts` mirrors the alias — `tsc` and the suite have to resolve it the same way.
- **The `zod` pin in `paths` is load-bearing, not cosmetic.** `"zod": ["./node_modules/zod"]`
  keeps one zod instance in the process; two of them make `instanceof` fail across duplicates
  (`../server/src/app.ts` carries a workaround for exactly that). `reviewer-core/tsconfig.json`
  pins it the same way — copy that block rather than inventing one.
- **ESM: relative imports carry the `.js` extension** (`./log.js`), including in tests.
- **Semantic ids on the wire, with a uuid escape hatch.** `repo` is `"owner/name"` (or the
  bare name when unique — the guarantee is `repos_ws_fullname_uq`); `pr` is the GitHub pull
  request **NUMBER** (`pr_repo_number_uq`); `agent_id` and `run_id` are uuids that came out of
  one of our own earlier answers (`devdigest_list_agents`, `devdigest_run_agent_on_pr`).
  Nothing is addressed by a name the schema does not make unique — `agents.name` has no
  unique constraint at all, so two agents may legally share one.
  Since 2026-08-14 a pull request may **also** be addressed by its row uuid as `pr_id`, and a
  repository as `repo_id` on `get_conventions`: the studio's own URLs carry those ids, and
  rejecting them meant telling a caller who had one to go and find the number instead. The
  semantic pair is still the recommendation and still leads every description; the uuid wins
  when both arrive, because it names exactly one row. Neither field validates the id FORMAT —
  the API decides whether an id exists, and this package does not become an authority on how
  the API spells them. See `specs/devdigest-mcp.md` statements 15a-15c for the asymmetry a
  uuid brings with it (`PrMeta` carries no `repo_id`).
- **Every boundary parses; nothing casts.** An HTTP response is untrusted input even though
  the API runs next door: `ApiClient.request` `safeParse`s it with a schema from
  `@devdigest/shared`. There is no `as` in `src/`.
- **`process` is confined.** `process.env` only in `config.ts`; `process.stdout`/`process.exit`
  only in `index.ts` (plus `log.ts` for stderr and `config.ts` for the invalid-config exit).
- **A failure returns an instruction, never a code.** `instructionFor()` maps each of the seven
  `ApiFailure` kinds to a sentence naming the next action; `test/errors.test.ts` iterates the
  kinds and requires an imperative verb in each.
- **The tool surface is data.** `TOOL_DEFS` is one array; "exactly five tools", "one
  `outputSchema`", "every field described", "every description under the client's truncation
  limit" are then measurements rather than promises.

## Gotchas

- **`server.registerTool` is called through a narrow `ToolRegistrar` interface, and that is not
  indirection for its own sake.** Passing a real zod raw shape to the SDK's own signature fails
  to compile with `TS2589: Type instantiation is excessively deep and possibly infinite`: the
  `zod` `paths` pin and the SDK's `zod/v3` subpath resolve to two structurally identical
  declaration files, and comparing zod's recursive class hierarchy across them exhausts the
  instantiation budget. The handover is typed `unknown`; our side stays fully typed. Don't
  "fix" it by importing from `zod/v3` — that creates the second runtime instance the pin exists
  to prevent. See the comment on `ToolRegistrar` in `src/server.ts`.
- **Vitest fake timers do not drive `node:timers/promises`.** `vi.advanceTimersByTimeAsync`
  never resolves a pending `await delay(1500)` from that module, because the fake clock
  replaces the *global* `setTimeout` while `node:timers/promises` reaches Node's internals.
  `test/run-agent.test.ts` mocks the module with a one-line adapter over
  `globalThis.setTimeout`; the source keeps the API it should have.
- **`POST /pulls/:id/review` is fire-and-forget**, whatever `ReviewRunResponse`'s doc-comment
  says about a synchronous run: `reviews` in that response is always `[]`. Create → wait →
  collect is not an API operation and is stitched together inside
  `src/tools/run-agent-on-pr.ts`.
- **An env knob only reaches this server through the CLIENT's config, never through the shell.**
  A stdio client spawns us with a fixed allowlist (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`,
  `USER`) and drops everything else, so `DEVDIGEST_MCP_RUN_TIMEOUT_MS=… npm run inspect` is
  silently ignored — `config.ts` truthfully reports "not set" and applies its default. Deliver it
  as a per-server `env` entry: `../.mcp.json` for Claude Code, `inspector.config.json` for the
  Inspector (`--config <file> --server <name>`, options only, no command). Inspector's `-e`
  flag also works, but only alongside a command, and its order is load-bearing — the **command
  comes first**, options after; options first makes it look for a config file instead.
- **Raising this server's run budget without raising the CLIENT's request timeout achieves
  nothing, and the failure looks like ours.** The MCP SDK's per-request default is **60 s**
  (`DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4`), so a client given `DEVDIGEST_MCP_RUN_TIMEOUT_MS=300000`
  still aborts at 60 s with a bare `Request timed out` — a message from the client's own SDK,
  not from `instructionFor()`, and one that carries no `run_id` to collect with while the review
  keeps running server-side. Both numbers move together, and ours must be the smaller of the
  two: `inspector.config.json` pairs `300000` with `requestTimeout: 310000`.
- **`{status:'running'}` from `devdigest_run_agent_on_pr` is a normal outcome, not a failure.**
  One structured call can legitimately take three attempts of up to 90 s
  (`../server/INSIGHTS.md`, 2026-08-06), so a 120 s budget is regularly exceeded by a healthy
  run. It is returned as a success, with the `run_id` to collect with.
- **`devdigest_get_findings` by `run_id` works only within the process that started the run.**
  The API has no run-scoped read of a review — `GET /pulls/:id/reviews` is by pull request, and
  `GET /runs/:id/trace` carries a findings *count*, not findings — so the mapping run → pull
  request lives in the per-process `runOrigins` map. A `run_id` from an earlier process gets an
  instruction pointing at the `repo` + `pr` path, which always works.
- **`GET /pulls/:id/runs` answers `[]` for a pull request that does not exist**, with no error.
  A loop keyed on "no runs yet" would spin forever; the wait loop keys on *our* `run_id` and
  stops after three consecutive absences.
- **Every list empty while Postgres is visibly full ⇒ restart the API.**
  `LocalNoAuthProvider.currentWorkspace` memoises the workspace for the life of the process
  (`../server/INSIGHTS.md`, 2026-08-06). No amount of retrying from here fixes it, so the
  resolver's empty-list message says so.
- **`test/stdout.test.ts` scans raw text, comments included.** Writing the literal string
  `console.` or `process.stdout` in a doc-comment under `src/` (outside `log.ts` / `index.ts`)
  fails that test. Reword — say "the console methods" — rather than weakening the scan; a
  comment stripper naive enough to trust also truncates at the `//` in `http://localhost:3001`.
- **The measured token budget is mostly envelope.** `instructions` is 1390 B of 2048 and the
  tool names sum to 119 B, so a fresh conversation's floor is 1509 B — but the real
  `tools/list` response is **5776 B**, of which ~58% is JSON Schema scaffolding, `annotations`
  and the SDK's own `execution` key. Shortening a description barely moves it, and the
  descriptions are verbatim deliverables. `test/budget.test.ts` prints every number to stderr;
  if its ratchet fires, report the new number rather than raising the constant.
- **No `bin`, no `dist/`.** A `bin` pointing at a `.ts` file only works under `tsx` and would
  mislead, and the root `.gitignore` ignores `dist/`, so a compiled entrypoint would not be
  committed and a fresh clone would not run. `../scripts/mcp.sh` runs the source through `tsx`
  and **installs nothing** — a missing `node_modules` is one line on stderr and exit 1.

## Do not touch

- **`../server/src/vendor/shared/**`** — read through the alias, never edited from here. It is
  a cross-package contract with a hand-made copy in `client/src/vendor/shared`; both move
  together, by agreement, and by adding a file rather than reshaping a symbol.
- **`package-lock.json`** — npm regenerates it from `package.json`. Never hand-patch it, and
  never leave it churned by an unrelated install.
- **`../server/**`** — not a prohibition on the API, a prohibition on changing it *for this
  package*. The original MCP pass held `server/` at zero files by design, and that is still
  the default: a tool here wraps an endpoint that already exists, and "the MCP server needs
  it" is not a reason to add a route.
  **Superseded in one specific way (2026-08-14):** L04 added `GET /pulls/:id/blast` and the
  `contracts/blast.ts` contract as a SERVER feature, with its own spec, its own UI and its
  own tests — and `devdigest_get_blast_radius` then stopped being a stub by consuming it.
  That is the order to copy if another tool is blocked on a missing endpoint: the endpoint is
  a server feature that earns its own spec, and the tool follows it. This package still adds
  no route, no contract and no migration of its own, and its absence from
  `server/src/modules/index.ts` remains deliberate.

## Deeper context

- The five tools, how to register the server, the env knobs and the manual checklist →
  [`README.md`](README.md)
- What each tool must do, observably → [`specs/devdigest-mcp.md`](specs/devdigest-mcp.md)
  (index: [`specs/README.md`](specs/README.md))
- Dated, file-grounded findings about this package → [`INSIGHTS.md`](INSIGHTS.md)
- Where this suite sits in the CI matrix → [`../TESTING.md`](../TESTING.md)
- The contracts this server parses with → [`../server/src/vendor/shared/`](../server/src/vendor/shared)
- API behaviours the design depends on → [`../server/CLAUDE.md`](../server/CLAUDE.md) and
  [`../server/INSIGHTS.md`](../server/INSIGHTS.md)
