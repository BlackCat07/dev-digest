# `@devdigest/mcp-server` — DevDigest as five MCP tools

A local **stdio MCP server** that puts DevDigest in reach of a coding agent. Without it,
DevDigest is driven from the browser only: an agent working in some other repository cannot ask
for a review and cannot read the findings, so it opens the studio by hand or does without.

It is an **HTTP wrapper**, deliberately: it talks to the DevDigest API on
`http://localhost:3001` and nothing else. No database, no `Container`, no route of its own — so
it can run against an API you started with `./scripts/dev.sh` and go stale in no way other than
the API's own.

Two design rules shape every response:

- **Result, not operation.** `devdigest_run_agent_on_pr` is one call that starts the review,
  waits for it, and returns the verdict and findings. "Create a run, poll it, collect the
  review" is not something the API offers, and the agent should not have to do it.
- **No raw payloads, and no uuids on the way in.** Every answer is an explicit projection —
  `system_prompt`, the conventions `scan`/`budget` envelope and verified `evidence` snippets
  never leave this process. Addressing is human: `repo` is `"owner/name"`, `pr` is the GitHub
  pull request number. The only uuids in play (`agent_id`, `run_id`) always come back out of one
  of this server's own earlier answers.

## The five tools

| Tool | For | Arguments |
|---|---|---|
| `devdigest_list_agents` | The reviewer agents and, crucially, their **ids** — the input `run_agent_on_pr` requires. Call it first. | none |
| `devdigest_run_agent_on_pr` | Review a pull request **now**. The only tool that writes and the only one that spends a model call. | `repo`+`pr` or `pr_id`, `agent_id` |
| `devdigest_get_findings` | Read an **already-finished** review. Free and instant; try it before paying for a new run. | `run_id`, `pr_id`, **or** `repo` + `pr`; `response_format`, `offset`, `limit` |
| `devdigest_get_conventions` | A repository's house rules — to justify a finding, or to read before proposing code for it. | `repo` or `repo_id`, `response_format` |
| `devdigest_get_blast_radius` | What else a PR could touch: changed symbols, their callers at `file:line`, and the endpoints/crons reachable from them. Free — index reads only, no model call. A non-`ok` `status` means the map is incomplete, and never "no impact". | `repo`+`pr` or `pr_id`, `response_format` |

Exact response shapes, every status and every empty case:
[`specs/devdigest-mcp.md`](specs/devdigest-mcp.md).

### Two ways to name a pull request

`repo` + `pr` is the recommended pair and what every description leads with: `"owner/name"`
(or a bare name when it is unambiguous) plus the **GitHub number**. Both are stable,
human-checkable, and reconstructible from a GitHub URL.

If what you have is a **uuid from a DevDigest studio URL** — which is what the studio's own
address bar and several walkthroughs give you — pass it as `pr_id` and omit `repo`/`pr`
(`repo_id` on `devdigest_get_conventions`). A uuid wins when both are supplied, because it
names exactly one row.

One asymmetry worth knowing. `PrMeta` carries no `repo_id`, so a uuid does not directly say
which repository it belongs to; the resolver recovers the name from its caches, or from a
single-repository workspace, or by listing pulls until it matches. The two read tools omit
`repo` from their answer if all three come up empty — `devdigest_run_agent_on_pr` refuses
instead, because it reports a run *against* a repository and has ten messages that need the
name.

### `{status:"running"}` is a normal outcome, not a failure

`devdigest_run_agent_on_pr` waits up to **120 s by default** and then answers
`{status:"running", run_id, next_step}` — as a **success**. That is not a degraded path: a
single structured model call in this stack can legitimately take **three attempts of up to
90 s**, because `StructuredRequest.timeoutMs` is ignored (the timeout is fixed when the provider
client is constructed) and `maxRetries` defaults to `2` (`../server/INSIGHTS.md`, 2026-08-06).
The same entry measured real per-call latency swinging from ~35 s to over 105 s on one
repository and one model.

So the 120 s budget is a deliberate "short cycle, collect later" choice over a three-minute
block. Nothing is lost when it fires: the `run_id` in the answer is the one
`devdigest_get_findings` takes, and starting a second run would only spend a second model call.

A session that would rather block than collect later raises the budget per-client with
`DEVDIGEST_MCP_RUN_TIMEOUT_MS` (the checked-in `.mcp.json` and `inspector.config.json` both set
**300 s**, which covers three 90 s provider attempts end to end). The compiled-in default stays
120 s: the knob belongs to whoever is running the client, not to the package.

**Raising it alone is not enough**, and the second half is easy to miss because the failure
looks like ours: the CLIENT has its own per-request timeout, and if it is shorter, it aborts
first and reports something like `Request timed out` with no `run_id` to collect with. The MCP
SDK's default is **60 s**, so any client given a 300 s server budget needs its own timeout
raised to match — `inspector.config.json` carries `requestTimeout: 310000` for exactly this.

## Running it from scratch

**This server is not a daemon and does not listen on a port.** An MCP client spawns it as a
child process and talks to it over stdin/stdout, so its lifetime is the client's session. That
makes "start it separately" two different questions: what has to be alive for it to work (the
API on `:3001`), and who starts it (the client, from `../.mcp.json`). Running
`npm run dev` by hand is not wrong, it is just useless — the process sits there waiting for
JSON-RPC on stdin.

Nothing starts it implicitly. `../scripts/dev.sh` neither launches nor installs this package,
by design: `dev.sh` holds its processes in the foreground, and this one belongs to the client.

**1 — install, once per clone.**

```sh
cd mcp-server && npm ci          # npm, NOT pnpm
ls node_modules/.bin/tsx         # must exist
```

Repeat only when `package.json` changes. `../scripts/mcp.sh` installs **nothing** on start —
a missing `node_modules` is one line on stderr and a non-zero exit.

**2 — start the only thing it depends on: the API.** The web client is not needed.

```sh
./scripts/dev.sh --no-client     # Postgres -> migrate -> seed -> API :3001
curl -s http://localhost:3001/agents | head -c 200
```

Empty response while Postgres visibly has data → restart the API (checklist item 6).

**3 — smoke-test the launcher before wiring it to anything.**

```sh
bash scripts/mcp.sh </dev/null >/tmp/mcp.out 2>/tmp/mcp.err
wc -c /tmp/mcp.out               # must be 0
cat /tmp/mcp.err                 # "devdigest-mcp ready on stdio ..."
```

Closed stdin closes the transport, so the process starts and exits. A non-empty stdout means no
client will ever connect, and the error it reports will not point back here.

**4 — MCP Inspector, to see the surface by hand.**

```sh
cd mcp-server && npm run inspect
```

That is `npx @modelcontextprotocol/inspector --config inspector.config.json --server devdigest`,
and everything the session needs is in that one committed file — the launcher to spawn, the env
it must be spawned with, and the client-side `requestTimeout`. Three things about it:

- It points at **`bash ../scripts/mcp.sh`**, not at `tsx src/index.ts`, so it exercises the
  same path a real client takes, guard and root resolution included.
- `requestTimeout: 310000` is the setting that matters for `devdigest_run_agent_on_pr`. The
  Inspector's own default is the SDK's **60 s**, well under this server's 300 s run budget, so
  without it a healthy review is cut off client-side with a bare `Request timed out` — the
  server is still running the review, and the answer is simply thrown away. 310 s keeps OUR
  budget the one that fires, which is the one that returns a `run_id`.
- `--server` is currently a no-op for the web UI (it says so on startup and lists every server
  in the file); the file holding exactly one server is what makes the UI open on `devdigest`.

`tools/list` works without the API up; getting data back out of a tool needs step 2. The
Inspector is not a dependency of this package — `npx` fetches it on demand.

**5 — connect Claude Code.** `../.mcp.json` is project-scoped and committed, so `claude` started
from the repository root picks it up; `/mcp` should show `devdigest` connected with **5 tools**.
Details and the absolute-path fallback are in [Register it](#register-it) below.

**The daily loop is two commands** — one terminal each, and no MCP process to manage:

```sh
./scripts/dev.sh --no-client     # the API
claude                           # the client starts the MCP server itself
```

To take the server away from the client temporarily, remove the entry from `../.mcp.json`
(or `claude mcp remove devdigest` if you registered it by hand); `/mcp` manages the list inside a
live session.

## Register it

`../.mcp.json` is committed, so a fresh clone already has the server configured:

```json
{ "mcpServers": { "devdigest": {
    "command": "bash", "args": ["scripts/mcp.sh"],
    "env": {
      "DEVDIGEST_API_URL": "http://localhost:3001",
      "DEVDIGEST_MCP_RUN_TIMEOUT_MS": "300000"
    },
    "timeout": 330000 } } }
```

Two numbers that move together. `DEVDIGEST_MCP_RUN_TIMEOUT_MS` raises this session's wait budget
from the compiled-in 120 s to 300 s — the default stays 120 s for anyone who configures nothing,
because the `running` path is cheap and a blocked agent is not. The client `timeout` must then
stay **above** it, so the tool's own timeout fires with a useful `next_step` instead of the
client killing the process mid-run; 330 s leaves that margin. Raise one and you raise the other.

The env block is the ONLY way to move this knob: a stdio client passes the server a fixed
allowlist of variables (`HOME`, `PATH`, `SHELL`, …) and drops the rest, so exporting
`DEVDIGEST_MCP_RUN_TIMEOUT_MS` in the shell that starts the client silently does nothing.

There is no secret to configure: the API's local auth provider resolves a default workspace
server-side, so this server sends no credentials at all.

Install and start the API first — steps 1 and 2 of
[Running it from scratch](#running-it-from-scratch).

If your client does not pick up the project-scoped config, register it by absolute path:

```sh
claude mcp add devdigest --transport stdio -- bash /abs/path/to/dev-digest/scripts/mcp.sh
```

`../scripts/mcp.sh` resolves its own repo root (so the client's working directory does not
matter), writes nothing to stdout, and **installs nothing** — a missing `node_modules` is one
line on stderr and a non-zero exit.

## Environment

`src/config.ts` is the only reader of the environment. It parses once at startup and exits
non-zero with one line per problem, rather than falling back and failing later. An empty value
(`DEVDIGEST_MCP_LOG_LEVEL=`) counts as unset.

| Variable | Default | Accepted |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | absolute `http:`/`https:` URL; trailing slashes trimmed. A bare `localhost:3001` is rejected with a worked example |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `120000` | whole number of ms, **clamped** into `[30000, 600000]` |
| `DEVDIGEST_MCP_POLL_INTERVAL_MS` | `2000` | whole number of ms, **clamped** into `[1000, 15000]` |
| `DEVDIGEST_MCP_LOG_LEVEL` | `info` | `error` · `warn` · `info` · `debug` |

Out-of-range millisecond values are clamped, not rejected — asking for a 5 s run budget gets
30 s rather than a server that refuses to start. Only a value that is not a whole number at all
is a startup failure.

Two related numbers are **not** knobs, on purpose. Each HTTP request has a 20 s deadline
(`REQUEST_TIMEOUT_MS`), well under the run budget so one stuck request cannot starve the wait
loop; and the poll interval's default exists because the API's rate limit is 120 req/min and it
is **shared with the studio open in your browser** — 2 s is 30 req/min, which leaves room for a
human clicking around.

Every log line goes to **stderr**, at every level: stdout is the JSON-RPC transport. Log lines
carry method, path, status and duration and **never a body** — PR titles, descriptions and
whole diffs travel through this process.

## Manual verification checklist

Six things no test in this package can cover. Work through them after a change that touches the
transport, the tool surface, or the wait loop.

1. **The surface, in the Inspector.** `cd mcp-server && npm run inspect`, then Connect → Tools →
   List: five tools, each description readable on its own, each argument carrying its
   `.describe()` text. Run `devdigest_list_agents` from there. Do this **before** wiring it to a
   client — the Inspector shows you the raw protocol, so a schema mistake reads as a schema
   mistake rather than as a tool the agent mysteriously never calls.
2. **It connects.** Run `./scripts/dev.sh`, then `/mcp` in a Claude Code session: `devdigest`
   shows as connected with **5 tools**.
3. **A real review, on a real imported PR — not the seed.** `acme/payments-api` is a fixture
   that does not exist on GitHub, so its GitHub sync 404s and the fixture hides the shapes real
   diffs have. Import a real PR and run `devdigest_run_agent_on_pr` on it. **Expect both
   outcomes**: `completed` and `running`. At 120 s the second one is entirely normal and is the
   one worth seeing with your own eyes — then collect it with `devdigest_get_findings` and the
   `run_id` it handed you.
4. **stdout is byte-empty.** Run `bash scripts/mcp.sh` with stdin closed and the two streams
   redirected to different files:
   ```sh
   bash scripts/mcp.sh </dev/null >/tmp/mcp.out 2>/tmp/mcp.err
   wc -c /tmp/mcp.out        # must be 0
   cat /tmp/mcp.err          # the "devdigest-mcp ready on stdio" line
   ```
5. **The token budget, from the client's side.** Compare the `tools/list` size your session's
   context view reports against the number `test/budget.test.ts` prints (`tools/list JSON
   (whole response)`; 5776 B on this tree).
6. **Troubleshooting: every list empty while Postgres is full ⇒ restart the API.**
   `LocalNoAuthProvider.currentWorkspace` memoises the workspace for the life of the API
   process, so after a re-seed every query is scoped to a workspace id that no longer exists —
   `devdigest_list_agents` answers `{count:0}` and repository resolution reports "no
   repositories imported" while `psql` visibly disagrees. Nothing throws and no retry helps;
   restart the API (`../server/INSIGHTS.md`, 2026-08-06).

## Testing

```sh
CI=true ./node_modules/.bin/vitest run
```

116 hermetic tests across 7 files: no network, no API, no keys. `fetchImpl` is injected into
`ApiClient`, so every HTTP interaction is a fake, and `test/budget.test.ts` measures the real
`tools/list` over `InMemoryTransport.createLinkedPair()` — a real MCP client talking to a real
server with no socket and no stdio. No test here is named `*.it.test.ts`: that suffix is
`server/`'s CI filter for DB-backed suites, not a general marker.

Suite and CI matrix: [`../TESTING.md`](../TESTING.md). The rules for working in this package,
including why `pnpm <script>` must not be used to run a gate: [`CLAUDE.md`](CLAUDE.md).
