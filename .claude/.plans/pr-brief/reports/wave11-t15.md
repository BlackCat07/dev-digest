# Implementation report — SPEC-03 PR Brief / T15

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`), worktree dirty from waves 1–10. **No file was edited, added, or deleted by this task**, and nothing was committed. The API was **not** restarted — it did not need to be.

## Coverage

- INSIGHTS server: 55 entries, 4 relevant (2026-08-19 — a feature can pass every gate and still `500` because nothing applies the migration it ships, `404` = unregistered vs `500` = unapplied; 2026-08-06 — `LocalNoAuthProvider.currentWorkspace` memoises a workspace uuid for the life of the process; 2026-08-19 — `drizzle-kit generate` always rewrites `meta/_journal.json`; 2026-08-02 — run `./node_modules/.bin/<tool>` directly).
- INSIGHTS client: 32 entries, 0 relevant.

## Changes

**No repository file was changed.** T15's Owned paths are `none`; the only mutation was to the `devdigest` database in the `devdigest-postgres` container. The `M`/`??` entries under `server/src/db/` are **T3's** output and were already present.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 (the half no hermetic test can reach) | T15 | yes — `GET /pulls/:id/brief` answers `200` against the real database with all 15 new columns applied |
| `pr_brief` reports the new columns | T15 | yes — all 15 present, queried from `information_schema` |
| `GET /pulls/:id/brief` answers `200` with a `generation_state` | T15 | yes — `200`, `"generation_state":"never_generated"` |
| The Overview tab renders the card rather than an inline error | T15 | `not checked` — needs a browser |

## Results

**1. The migration.** `CI=true ./node_modules/.bin/tsx src/db/migrate.ts` → **exit code `0`**, `✓ migrations applied`, preceded by three idempotency `NOTICE`s. Confirmed against the docker-compose database (`DATABASE_URL=…@localhost:5432/devdigest`; `devdigest-postgres` bound to `0.0.0.0:5432`, up 2 weeks, healthy). No interactive rename prompt — `0019_misty_terrax.sql` is 15 `ADD COLUMN` statements and nothing else. `drizzle.__drizzle_migrations` now holds **20** rows and `meta/_journal.json` **20** `idx` entries; nothing pending.

**2. The column list, queried from the database:**

```
attempts, cache_key, cost_usd, error, generated_at, head_sha, json, model,
pr_id, provider, reason, risk_level, started_at, state, status, tokens_in, tokens_out
```

17 columns: the 2 pre-existing plus **all 15 new ones present by name**. A name-by-name loop over the 15 printed zero `MISSING:` lines.

**Evidence that this task was not a formality: before the migration, the same query returned exactly `json` and `pr_id`.** The migration T3 shipped was genuinely unapplied, and the `500` this task exists to prevent was live in the tree.

**3. The route.**

- uuid: **`5b58a299-a694-4cfd-8419-7a289c5d5639`** (PR #1, `BlackCat07/typescriptdemo`) → **`200`**. Second uuid (PR #2) → **`200`**.
- Body: `generation_state: "never_generated"`, `status: "degraded"`, every provenance field null, `diff_stats` all zero — consistent with `select count(*) from pr_brief` returning `0`.

**No task owns a fix.** Nothing failed.

Three collateral confirmations, each ruling out a way the `200` could have been a false pass:

- **The route discriminates.** A valid but nonexistent uuid answers **`404`** with the service's own envelope, `{"error":{"code":"not_found","message":"Pull request not found"}}` — not Fastify's generic route-not-found. The handler ran and the workspace resolution executed.
- **The process is not stale.** The brief route exists only in the dirty tree, so a `tsx watch` process running pre-wave code would have `404`'d it.
- **No workspace-memoisation trap.** `GET /repos` reports the same `workspace_id` the `pull_requests` rows carry in `psql`, so the `200` is scoped to the right workspace rather than accidentally matching nothing.

Registration evidence: `grep -n "^  brief,$" src/modules/index.ts` → **`50:  brief,`**.

## Deviations from the plan

- The dispatch offered `GET /repos` → `GET /repos/:id/pulls` *or* querying `pull_requests` directly. Both halves were used rather than either: `psql` for the uuid and `GET /repos` for the workspace id, specifically so the two could be compared. That comparison is what rules out the memoisation trap, which a uuid from `GET /repos/:id/pulls` alone would have hidden by construction.

## Gates

| Gate | Result |
|---|---|
| migration apply | pass — rc=0, `✓ migrations applied` |
| column existence (from the DB) | pass — 17 columns, all 15 new ones by name |
| route answers | pass — `200`, twice, on two real uuids |
| route discriminates | pass — `404 not_found`, handler-generated |
| typecheck / lint / onion / unit | gate did not run — no file was edited by this task |
| integration | gate did not run — belongs to `test-writer` |
| client | gate did not run — no client file, no client command |

## Not done

- `not checked` — **the Overview tab rendering the card in a browser.** The server-side half is discharged: the endpoint the card reads answers `200` with a well-formed `PrRiskBrief`, so the card has no reason to show an inline error. `DDG-UI-001` still wants a human look.
- `not checked` — **the T14 generation trigger end to end.** Firing it means `GET /pulls/:id`, which enqueues a real generation and spends a real model call — a cost this dispatch did not authorise, and not a clean signal anyway since the trigger is un-awaited. Note a Drizzle select names its columns explicitly, so the `200` could not have been returned at all if any of the 15 were missing.
- `absent` — no repository file was edited, so there is no diff of this task's for anyone to review.

## For the parent

- Candidate for `server/INSIGHTS.md`: **the 2026-08-19 "nothing applies the migration it ships" entry just paid for itself, with a measured before/after.** `pr_brief` held exactly `json` and `pr_id` immediately before this task ran, after T3 had shipped the migration, satisfied `DDG-WIRE-003` and passed ten waves of gates. The `500` was live and unobserved until a plan carried an explicit apply-and-verify task. The generalisable half is that **giving the apply step its own task in the plan is what closed the gap.**
- Candidate for `server/INSIGHTS.md`: **a `200` on a new route is only evidence of registration if the `404` path is also checked.** An unregistered module and a registered one both answer `404` for a bad uuid, but only the registered one answers with the service's own `not_found` envelope rather than Fastify's route-not-found. One extra request turns "the route answered" into "the handler ran and the workspace resolution executed".
- `DDG-UI-001` (WARNING) is **not** discharged and needs a human look at `http://localhost:3000` on a pull-request Overview tab.
- The database is now migrated, so the DB-backed acceptance pass has a schema to run against — but `server/test/brief.it.test.ts` still does not exist.

---

## Parent's notes on this report

**This task justified its own existence with a number.** Immediately before it ran, `pr_brief`
had exactly two columns — `json` and `pr_id`. T3 had shipped `0019_misty_terrax.sql` ten waves
earlier, satisfied `DDG-WIRE-003`, and every gate in every wave since had been green. The `500`
was live in the tree and nothing in the pipeline would have surfaced it. Giving the apply step
its own task, with `information_schema` rather than the schema file as the check, is the
structural fix and it worked.

**The three collateral checks are the difference between a status code and evidence.** A `200`
alone does not prove registration, a live process or correct workspace scoping. Checking that a
bad uuid returns the service's own `not_found` envelope rather than Fastify's proves the handler
ran; comparing `GET /repos`'s `workspace_id` against the `pull_requests` rows in `psql` rules out
the memoisation trap that would have made an accidental empty match look like a pass. None of
that was asked for.

**What is honestly still open:** `DDG-UI-001` needs a human at `localhost:3000`, and the
generation path has never been fired end to end — that costs a real model call and was not
authorised here. Both are stated as `not checked` rather than implied to be fine.
