# e2e — `@devdigest/e2e`, deterministic browser suite

Vercel **agent-browser** (native Rust + CDP CLI) driving the real stack.
**No Playwright, no vitest, no LLM, no API key.**

> In this package `specs/` means **browser flows**, not feature specifications.

## Commands

```sh
npm ci                  # npm, NOT pnpm
npm run e2e:hermetic    # ../scripts/e2e.sh — isolated freshly-seeded stack (use this)
npm test                # tsx run.ts — runs flows against an ALREADY-running stack
npm run typecheck
```

One-time prerequisite: `npm i -g agent-browser && agent-browser install`.

Env: `E2E_BASE_URL` (default `:3000`) · `AGENT_BROWSER_BIN` · `E2E_STEP_TIMEOUT` (60000).

## Map

```
run.ts                   the runner: loads flows, shells out to agent-browser
lib/assert.ts            resolveArgs · stdoutContains · summarize · Flow types
specs/NN-name.flow.json  one flow per file, lexical filename order
agent-browser.json       browser config (headed: false)
test-results/            generated output
```

## Conventions

- **A flow is JSON, not code**: `{ name, description, steps: [{ cmd: [...], label }] }`.
  Each `cmd` is passed verbatim to the `agent-browser` CLI.
- **`wait --text` / `wait --url` *are* the assertions.** A non-zero exit — including a
  wait whose condition never holds — fails the step and the flow. Optional
  `"assert": { "stdoutIncludes": "…" }` adds a substring check. Don't invent an
  assertion layer; express the check as a `wait`.
- **Deterministic locators only** — `--url`, `--text`, `find role|text|label`.
  **Never the AI `chat` command**: that's what keeps runs stable and key-free.
- `{BASE}` in any arg is substituted with `E2E_BASE_URL`.
- **All commands share one browser session** (the daemon keeps the page between
  invocations), so steps inherit page state from the steps before them.
- **Flows target read-only seeded data** — demo repo `acme/payments-api`, PR #482, the
  seeded agents — so nothing triggers a model call. Keep new flows read-only.

## Gotchas

- **Flows assume a freshly-seeded DB with exactly one repo.** Flow `02` follows the home
  redirect to the *first* repo, so against your dev DB (which has other imported repos)
  flows 02/04/05 land on the wrong repo and fail. That failure is the DB, not the UI —
  run `npm run e2e:hermetic` instead of `npm test`.
- ⚠️ **Never `docker compose down -v` to "reset" the dev DB** — `-v` drops the
  `devdigest_pgdata` volume with every repo and review that was imported.
- **`scripts/e2e.sh` is local-only.** CI (`e2e-web.yml`) brings up its own stack and
  calls the pure runner directly — a change to the harness must be made in both.
- The hermetic script runs on **alternate ports** (web 3100 · API 3101 · Postgres 5433)
  with an ephemeral container, deliberately, so it coexists with a live dev stack.
- **A failing step prints the agent-browser stderr, not a diff.** Debug by re-running
  that one `cmd` by hand, or flip `agent-browser.json` to `"headed": true`.

## Deeper context

- Flow anatomy, locator reference, seeded-data preconditions → `README.md`
- Where this suite sits in the CI matrix → `../TESTING.md`
