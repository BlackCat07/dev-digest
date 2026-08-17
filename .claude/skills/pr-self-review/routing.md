# Routing and checks — which rules apply to which file

Two halves of one question. **Part 1** maps a changed path to the skills that own
it. **Part 2** is the catalogue of invariants no linter here can see, each with a
stable ID.

## Part 1 — Changed path → skills

Read top to bottom; a file collects the skills of **every** row it matches,
deduplicated. Paths are repo-relative, as step 0's `git diff --name-status` and
`git ls-files` print them.

### Frontend — `client/`

| Path | Skills |
|---|---|
| `client/src/app/**/{page,layout,error,global-error,not-found}.tsx` | `next-best-practices`, `react-best-practices`, `frontend-ui-architecture` |
| `client/src/app/**/_components/**/*.tsx` | `frontend-ui-architecture`, `react-best-practices` |
| `client/src/components/**` | `frontend-ui-architecture`, `react-best-practices` |
| `client/src/**/*.test.ts(x)`, `client/src/test/**` | `react-testing-library` |
| `client/src/lib/**`, `client/src/i18n/**` | `frontend-ui-architecture`, `typescript-expert` |
| `client/src/app/**/styles.ts`, `client/src/app/globals.css` | `frontend-ui-architecture` (tokens, no ad-hoc values) |
| `client/next.config.mjs`, `client/package.json` | no skill — `client/CLAUDE.md`, plus `DDG-WIRE-006` if `env` changed |
| `client/src/vendor/ui/**`, `client/src/vendor/shared/**` | **do-not-touch** → `DDG-DNT-002` / `DDG-DNT-003`; no content review |

### Backend — `server/`, `reviewer-core/`

| Path | Skills |
|---|---|
| `server/src/modules/*/routes.ts` | `onion-architecture`, `fastify-best-practices`, `zod`, `security` |
| `server/src/modules/*/service.ts`, `server/src/modules/reviews/run-executor.ts` | `onion-architecture` |
| `server/src/modules/*/repository*.ts` | `onion-architecture`, `drizzle-orm-patterns` |
| `server/src/adapters/**` | `onion-architecture`, `security` (the only ring allowed real I/O) |
| `server/src/platform/**`, `server/src/app.ts`, `server/src/server.ts` | `onion-architecture`, `fastify-best-practices` |
| `server/src/db/schema/**` | `drizzle-orm-patterns`, `postgresql-table-design` |
| `server/src/db/**` (not `schema`, not `migrations`) | `drizzle-orm-patterns` |
| `server/src/db/migrations/**` | **generated** → `DDG-DNT-004`; never reviewed as authored code |
| `server/src/prompts/**` | no skill — `docs/agent-prompts/README.md` is the rubric |
| `server/test/**`, `**/*.it.test.ts` | no skill — `../TESTING.md` + `DDG-TEST-001` |
| `reviewer-core/src/**` | `onion-architecture` (core purity), `typescript-expert`, `zod` |

### MCP server — `mcp-server/`

| Path | Skills |
|---|---|
| `mcp-server/src/**` | `typescript-expert`, `zod` (every HTTP response is `safeParse`d with a `@devdigest/shared` schema — no `as` on a boundary) |
| `mcp-server/src/api/**`, `mcp-server/src/config.ts`, `mcp-server/src/index.ts` | + `security` (the network boundary, the one `process.env` reader, and the composition root) |
| `mcp-server/test/**` | no skill — `mcp-server/CLAUDE.md` + `../TESTING.md` |

`onion-architecture` deliberately does **not** route here: its own scope is `server/` and
`reviewer-core/`, this package is an HTTP client of the API, and the `depcruise` gate runs
`src ../reviewer-core/src` from `server/`. Do not add it to make the package look reviewed.

### Cross-cutting — keyed on the changed hunk, not the filename

| Condition | Skills |
|---|---|
| `*/vendor/shared/contracts/*.ts` | `zod` + `DDG-DNT-001` (both copies move together) |
| hunk has `z.object(` / `z.enum(` / `.safeParse(` | `zod` |
| hunk touches auth, a token, `process.env`, `octokit`, `child_process`, `simple-git`, an upload, or an SSE endpoint | `security` |
| hunk adds a generic, a conditional type, `as`, or a non-null `!` | `typescript-expert` |
| any `.ts`/`.tsx` in `server/`, `reviewer-core/` or `mcp-server/` | `DDG-WIRE-002` (ESM `.js` extension) |
| **every run** | `engineering-insights` (read at step 2, append at the end) |

### Not code

| Path | Rubric |
|---|---|
| `e2e/specs/*.flow.json` | `e2e/CLAUDE.md`, `e2e/docs/adding-a-flow.md`; deterministic locators only, never `chat` |
| `e2e/run.ts`, `e2e/lib/**` | `e2e/CLAUDE.md`, `typescript-expert` |
| `*/specs/**` | `docs/specs-convention.md` |
| `*/INSIGHTS.md` | append-only → `DDG-DOC-001` |
| `*.md`, `docs/**`, `*/CLAUDE.md`, `README.md` | prose only: are the paths it names real? (`DDG-DOC-002`) |
| `.claude/skills/**` | `.claude/skills/README.md` catalog row; locally-authored skills stay **out** of `skills-lock.json` (`DDG-DOC-004`) |
| `.claude/settings.json`, `.claude/skills/*/scripts/**` | harness config — a hook runs on every matching tool call, so check its fail-open path and its cost on the ignore path (`DDG-WIRE-008`) |
| `.github/workflows/**` | mirror of the local gates — changing one changes both (`DDG-WIRE-007`) |
| `scripts/*.sh`, `docker-compose.yml` | no skill — read it; ports and env only |
| `*/pnpm-lock.yaml`, `*/package-lock.json`, `skills-lock.json` | **never hand-edited** → `DDG-DNT-005` |

### Rules around the table

1. **Unrouted is a report line, not a skip.** A path matching no row appears as
   `unrouted: <path>`, reviewed against the nearest package `CLAUDE.md`. Twice
   unrouted ⇒ add a row.
2. **No file, no review.** A package absent from the scope is not opened, and its
   gates do not run.
3. **The hunk decides.** A 400-line file with a two-line hunk is routed by those
   two lines.
4. **Deleted files still route.** A deletion cannot be read, but it can break a
   contract, a registration, or a spec.
5. **Vendored skills are read-only rubrics.** `onion-architecture`,
   `frontend-ui-architecture`, `engineering-insights` and `pr-self-review` are
   authored here; the rest are pinned in `skills-lock.json`. Never "fix" a
   vendored skill to make a finding go away.

## Part 2 — Invariants (`DDG-*`)

Failures this repo can actually produce. Each row: the rule, its default
severity, and how to verify it. Downgrade only with a recorded reason.

Gate failures do **not** get an ID from here — they reuse the tool's own
(`tsc:TS2307`, `eslint:react-hooks/exhaustive-deps`,
`depcruise:core-stays-pure`).

### `DNT` — do-not-touch (root `CLAUDE.md`), all CRITICAL

| ID | Rule | Fires when |
|---|---|---|
| `DDG-DNT-001` | The cross-package contract has **two hand-synced copies**: `server/src/vendor/shared/**` and `client/src/vendor/shared/**` change together or the types drift. | the scope shows one side only — `diff -r` the two dirs |
| `DDG-DNT-002` | `client/src/vendor/ui/**` is the vendored design system. Extend with a new file; never restyle a primitive for one feature. | an existing file under it is modified |
| `DDG-DNT-003` | A contract change reshapes an existing symbol instead of adding a new file. | the `vendor/shared/**` diff removes or renames an export |
| `DDG-DNT-004` | `server/src/db/migrations/**` is generated — edit `src/db/schema/`, then `db:generate`. | any `M` (not `A`) under `migrations/` |
| `DDG-DNT-005` | Lockfiles are never hand-edited, and an unrelated install's churn is never committed. | a lockfile in scope while that `package.json` is unchanged |

### `WIRE` — wiring the compiler cannot see

| ID | Rule | Severity |
|---|---|---|
| `DDG-WIRE-001` | Modules register **statically**: a new `server/src/modules/<name>/` with no entry in `server/src/modules/index.ts` is never mounted — no error, just 404. | CRITICAL |
| `DDG-WIRE-002` | ESM relative imports carry `.js`. `tsc --noEmit` does not catch a missing one; it fails at runtime. | CRITICAL |
| `DDG-WIRE-003` | A `db/schema/**` change ships with a new generated migration. | CRITICAL |
| `DDG-WIRE-004` | A new port/adapter pair is bound in `server/src/platform/container.ts`, the only place allowed to name concrete classes. | CRITICAL |
| `DDG-WIRE-005` | A scaffold `server/pnpm-workspace.yaml` (pnpm drops one when an install fails) contradicts "NOT a monorepo workspace" and must be deleted, not committed. | CRITICAL |
| `DDG-WIRE-006` | `client/next.config.mjs` `env` values are inlined at **compile time**; a change needs a dev-server restart or the old value keeps being served. | WARNING |
| `DDG-WIRE-007` | A gate and its CI job are one thing in two files: `eslint.config.js`, `.dependency-cruiser.cjs` or a test script changing means the matching `.github/workflows/*.yml` changes too, including its `paths:` filter. | WARNING |
| `DDG-WIRE-008` | A `PreToolUse` hook runs on **every** matching tool call: it must fail **open**, spawn nothing on its ignore path, and match a command at an invocation position — otherwise `grep 'gh pr create' docs/` gets blocked. | CRITICAL |

### `ARCH` — judgement `dependency-cruiser` cannot make

| ID | Rule | Severity |
|---|---|---|
| `DDG-ARCH-001` | Routes stay thin: branching business logic, a computed aggregate, or error mapping added in `modules/*/routes.ts` belongs in the service. | WARNING |
| `DDG-ARCH-002` | `reviewer-core` stays pure. Its only legitimate outward import is `src/vendor/shared` (the port ring physically lives in `server/`); any fs, network or SDK use is a break. | CRITICAL |
| `DDG-ARCH-003` | A new abstraction two rings share is a **port**, and ports live in `@devdigest/shared`, not in a module. | WARNING |

### `UI` — frontend invariants

| ID | Rule | Severity |
|---|---|---|
| `DDG-UI-001` | The diff changes what a route renders (a boundary, a Suspense wrapper, a server/client split, an early return). Gates cannot see a blank first paint — flag it for a look in the running app (`/run`). | WARNING |
| `DDG-UI-002` | A unit used by both the PR **list** and PR **detail** lives in `pulls/_components/` with its own `styles.ts`; under `pulls/[number]/_components/` it forces an upward cross-route import. Formatters needed by more than one route subtree go in `src/lib/`. | WARNING |
| `DDG-UI-003` | The PR-list table has a three-way hand-synced invariant: the track count in `GRID` ↔ `COLUMN_KEYS.length` ↔ the number of top-level `<div>`s `PRRow` returns, plus the `list.columns.<key>` message. A mismatch silently shifts every later column. | CRITICAL |

### `SEC` — before it leaves the machine

| ID | Rule | Severity |
|---|---|---|
| `DDG-SEC-001` | No secret in the added lines: an API key, token, private-key block, connection string with a password, or a real `.env` value. This is `kind: secret_leak`. | CRITICAL |
| `DDG-SEC-002` | Author-controlled text reaching a model stays inside `<untrusted>…</untrusted>`; the injection guard is appended by `reviewer-core/src/prompt.ts` and must not be duplicated or bypassed. | CRITICAL |
| `DDG-SEC-003` | A new or changed route validates input with a contract zod schema and scopes every query it triggers. | CRITICAL |

### `DOC` — the docs are load-bearing here

| ID | Rule | Severity |
|---|---|---|
| `DDG-DOC-001` | `*/INSIGHTS.md` is **append-only**: never edit, delete or reorder an entry, never `Write` the file. Superseding is a new bullet. | CRITICAL |
| `DDG-DOC-002` | A doc that names a path, script or symbol names a real one. Source comments cite package docs by **bare filename**, not by path. | WARNING |
| `DDG-DOC-003` | A `pr-self-review: allow <ID>` suppression carries a reason. | WARNING |
| `DDG-DOC-004` | A new skill gets a catalog row in `.claude/skills/README.md`; a **locally-authored** skill stays out of `skills-lock.json`, which pins vendored skills by hash. | WARNING |
| `DDG-DOC-005` | A new feature in `client`/`server`/`reviewer-core` has a file in that package's `specs/` per `docs/specs-convention.md`. | WARNING |

### `TEST` — suite conventions

| ID | Rule | Severity |
|---|---|---|
| `DDG-TEST-001` | A DB-backed test (anything importing `test/helpers/pg.ts`) is named `*.it.test.ts`, or the unit lane picks it up and fails without Docker while the integration lane never selects it. | CRITICAL |
| `DDG-TEST-002` | `e2e/specs/*.flow.json` uses deterministic locators (`--url`, `--text`, `find`) only — never the AI `chat` command. | CRITICAL |
| `DDG-TEST-003` | A changed behaviour at a seam (route, adapter, contract, review pipeline, rendered component) comes with a test at that seam. The *kind* of regression is the goal, not coverage. | WARNING |

### Adding a check

A new ID earns its place only if it (a) has fired on a real diff here, (b) names
a file or symbol, and (c) states the failure mechanism. A rule that never fires
is noise; a rule overridden every time is wrong.
