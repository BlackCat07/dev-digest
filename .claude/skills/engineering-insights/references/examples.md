# Calibration — what a good entry looks like

## Contents

- Read this first (why you must not copy the examples below)
- One good bullet per section
- Bad entries, and why each fails
- Near-miss: the same finding, vague then fixed

## Read this first

**Every "good" example below comes from a gotcha that already lives in a `CLAUDE.md` in
this repo.** They are here to calibrate *shape* — how much mechanism, how much blast
radius, what goes in the claim versus the evidence.

As live candidates, all of them would be **dropped at the dedup step**. Do not copy any of
them into a journal. If a session rediscovers one, the correct output is
"dropped — already in `client/CLAUDE.md` Gotchas".

## One good bullet per section

**What Works**

```
- **2026-08-02** — Service tests stay hermetic by overriding the DI container, not by
  mocking modules: pass `ContainerOverrides` with the fakes from `adapters/mocks.ts`.
  Module-level mocking of `octokit`/`openai` works until a second adapter needs faking,
  then it fights the wiring. Evidence: `src/platform/container.ts` (`ContainerOverrides`).
```

**What Doesn't Work**

```
- **2026-08-02** — Setting `content-type: application/json` unconditionally in `apiFetch`
  breaks every body-less POST (refresh, reindex, generate) with Fastify's "Body cannot be
  empty". The conditional looks like dead weight and invites removal; it is load-bearing.
  Evidence: `src/lib/api.ts` (`apiFetch`).
```

**Codebase Patterns**

```
- **2026-08-02** — The `.it.test.ts` suffix is a CI routing decision, not a naming
  preference: it means the test needs live Postgres, and the two workflows filter on
  exactly that suffix. Misnaming a DB-backed test puts Postgres in the hermetic job, where
  it fails for an unrelated reason. Evidence: `test/`, `.github/workflows/`.
```

**Tool & Library Notes**

```
- **2026-08-02** — Path aliases must be added in two files: `vitest.config.ts` duplicates
  the tsconfig aliases, so adding one to `tsconfig.json` alone typechecks cleanly and then
  fails at test runtime. The symptom points at the test, not the missing alias.
  Evidence: `vitest.config.ts`, `tsconfig.json`.
```

**Recurring Errors & Fixes**

```
- **2026-08-02** — `relation ... does not exist` means migrations, not a schema bug:
  migrations never run on boot. Run `pnpm db:migrate` against the docker-compose database —
  pgvector arrives in migration `0000`, so migrating a different local Postgres leaves the
  extension missing. Evidence: `src/db/migrations/`, `docker-compose.yml`.
```

**Session Notes** — use this only when the *shape* of the session is the lesson: where the
time went, what the misleading signal was. A session that simply completed its task needs
no entry here.

```
### 2026-08-02
- Two hours on a client/server type mismatch that turned out to be vendored drift, not the
  change under test. `client/src/vendor/shared` lags the server's canonical copy; no sync
  script, no CI check, so nothing flags it. The first hour went into silently syncing the
  copy — wrong move, both paths are coordination-only.
```

**Open Questions**

```
- **2026-08-02** — Nothing detects `vendor/shared` drift; who owns closing that gap? Known
  divergences: `openrouter` missing from `LLMProvider.id`, no `sessionId`, no
  `CommitFile`/`CommitFilesPayload`. Every future type mismatch costs the same debugging
  session until either a check exists or the copy is declared frozen.
  Evidence: `client/src/vendor/shared/`, `server/src/vendor/shared/`.
```

## Bad entries, and why each fails

| Entry | Why it fails |
|---|---|
| "Promises can be tricky." | Nothing to act on — no file, no threshold, no direction. |
| "The server is Fastify and modules register in `src/modules/index.ts`." | Obvious in ten seconds of reading. Also already in `server/CLAUDE.md`. |
| "Fixed the type error in the reviews service." | A changelog line. The next session cannot use it. |
| "The client should have more test coverage." | An opinion, not a finding. Nothing was discovered. |
| "Migrations don't run on boot — run `pnpm db:migrate`." | Correct, useful, and already in `server/CLAUDE.md` Gotchas. Drop it and say so. |
| "Be careful with the e2e ports." | Names no port, no file, no failure mode. |
| "Watch out — `apiFetch` has a tricky bit around headers. Evidence: `src/lib/api.ts:NN`." | Names the file but not the behaviour, and ships an unresolved `:NN` placeholder. |

## Near-miss: the same finding, vague then fixed

**Vague** — "Don't use `docker compose down -v` on the dev database."

Non-obvious, but not actionable cold: it never says what `-v` destroys, so a reader under
pressure assumes it's a style preference and uses it anyway.

**Fixed:**

```
- **2026-08-02** — `docker compose down -v` destroys every imported repo and review: `-v`
  drops the `devdigest_pgdata` volume, not just the containers. It is the reflex command
  for "reset the stack", and the loss is silent — the stack comes back up healthy and
  empty. Evidence: `docker-compose.yml` (`devdigest_pgdata`), `../scripts/e2e.sh`.
```

The fix added the mechanism (`-v` drops the named volume), the blast radius (all imported
data), and why the mistake recurs (it looks like a reset, and it succeeds quietly).
