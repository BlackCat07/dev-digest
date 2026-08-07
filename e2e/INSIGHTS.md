# e2e — engineering insights

Append-only journal for `@devdigest/e2e`. Seven fixed sections; newest entry at the bottom
of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

Note: a red flow here is usually the stack or the seeded data, not the UI. An entry is
worth recording when it separates those two — that is the expensive distinction.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path — a flow file, `run.ts`, or
  `../scripts/e2e.sh` — and a step label where useful.
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
  instead>. Evidence: `specs/NN-name.flow.json` step "label".
```

Point at `run.ts` or `../scripts/e2e.sh` when the finding is about the harness rather than
a flow. Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

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

_No entries yet._

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

_No entries yet._

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

_No entries yet._

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-04** — `../scripts/e2e.sh` defaults its isolated Postgres to **:5433**, which is a
  common second-Postgres port — an unrelated local container already held it here and the run
  died at setup with docker's `Bind for 0.0.0.0:5433 failed: port is already allocated`
  (exit 125, before a single flow). That is a stack failure, not a red flow: check
  `docker ps --format '{{.Names}}\t{{.Ports}}'` first, then override all three ports together,
  e.g. `E2E_PG_PORT=5441 E2E_API_PORT=3111 E2E_WEB_PORT=3110 ./scripts/e2e.sh`. Also pass
  `CI=true` when invoking it from a non-TTY context, or pnpm's pre-script dep check can abort
  the migrate step (see `server/INSIGHTS.md`, 2026-08-04). With those, 7/7 flows pass.
  Evidence: `../scripts/e2e.sh` (`PG_PORT`/`API_PORT`/`WEB_PORT` defaults).

- **2026-08-05** — Running `client`'s `pnpm build` immediately before `e2e.sh` makes the run
  die in **setup**, not in a flow: the harness starts its own `next dev` in the same
  `client/` directory, so it inherits the production `.next` the build just wrote, and the
  dev server is SIGTERMed mid-compile. The script reports `web process exited before
  becoming reachable` — which reads like a port clash or a slow machine, and is neither; the
  60×1s readiness loop never even times out. `rm -rf client/.next` before the run fixes it.
  This is the e2e-side face of the collision `client/INSIGHTS.md` records for a live dev
  server (2026-08-03): three writers, one `.next`. Gate order matters — run e2e *before*
  `pnpm build`, or clear the directory between them. Evidence: `../scripts/e2e.sh:148`.

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

- **2026-08-06** — `✗ open the PR row — Command failed: agent-browser find text "Add rate
  limiting to public API endpoints" click` in flow **04 or 05** is a timing flake, not a
  broken screen — and the warning printed beside it names the wrong cause twice over.
  Every `GET /repos/:id/pulls` tries a live GitHub PR sync before serving. With a real
  `GITHUB_TOKEN` in `~/.devdigest/secrets.json` — which the hermetic stack reads, this is
  not `.env`-only — that call goes out to api.github.com for the **fictional** seeded repo
  `acme/payments-api`, 404s, and is swallowed as `GitHub PR sync skipped (no token /
  offline); serving persisted PRs`. A token IS present and the machine IS online; the
  message describes neither. The route still answers 200 from the persisted rows, but the
  round-trip adds enough latency that flows 04/05 — which click the PR row immediately
  after `wait --url`, the same sharp edge `client/INSIGHTS.md` records on 2026-08-04 —
  sometimes fire before the row paints. Measured over three consecutive `scripts/e2e.sh`
  runs on one machine, no code change between them: 10/10, then 04 failed, then 05 failed.
  So a single red run of 04/05 is not evidence of a regression; re-run before believing it,
  and a `wait --load networkidle` before the click would settle it properly. Evidence:
  `../server/src/modules/pulls/routes.ts:87`, `specs/04-pr-findings.flow.json`,
  `specs/05-pr-diff.flow.json`.

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

- **2026-08-07** — **`find role link` matches nothing in CI, while `find role button` in the
  same run matches fine.** On `e2e-web.yml` (ubuntu, headless Chrome, production `next
  start`), `find role link click --name Conventions` on `/repos/:id/pulls` answered the bare
  `Element not found`, which agent-browser only emits when NO element carries that role —
  its other message (`N elements have role "link", but none match name "X"`) is what a
  name mismatch produces. The failure screenshot taken milliseconds later shows the
  sidebar with six anchors, and `find role button --name Preview|Versions|Stats|Open`
  passed in flow 09 of that same run, so the role engine itself was working. Not
  reproducible locally: the same command succeeds against `next dev` AND against a
  production build served from a scratch copy on :3200 (both checked). Flow 10 now clicks
  the sidebar by text, the locator style every other passing flow uses. What is unknown is
  whether this is agent-browser's a11y snapshot on Linux, something about `<a>` wrapping a
  `<div>` in `NavItem`, or the `/pulls` screen specifically. Evidence:
  `specs/10-conventions.flow.json`, `../client/src/vendor/ui/shell/NavItem.tsx`,
  run 31168422411.
