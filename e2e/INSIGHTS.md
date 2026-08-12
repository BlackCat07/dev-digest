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

- **2026-08-12** — **The real cause of that failure was the STICKY HEADER, not the re-render:
  agent-browser scrolls a target into view and clicks its CENTRE, and this app's header sits
  over that point.** Supersedes the diagnosis in the entry below (the `wait --fn` barrier it
  prescribes is a sound guard for a different race, but it did not fix anything — the flow
  failed identically with it in place, which is what forced a real measurement instead of a
  second theory). `PrDetailHeader` is `position: sticky` at the top of the `<main>` that
  scrolls, ~128px tall; a badge that needed scrolling ended at `top: 52`, so
  `document.elementFromPoint` at the button's centre returned the HEADER, the click landed
  there, and `find … click` exited 0 with nothing having happened. Two things make this
  expensive to find: it depends on whether the target was already in view, so it passes on
  one viewport and fails on another — locally every attempt passed until the page was
  deliberately scrolled away from the badge first (`agent-browser scroll down 4000`), which
  reproduced CI exactly, `✓ Done` and an unchanged URL. And the failing STEP is the one after
  the click, so the log points at the assertion rather than at the click. The fix belongs in
  the app, not the flow, and is a real accessibility fix: the button carries
  `scrollMarginTop` off the header's measured height, so Tab-focusing it from further down
  the diff no longer parks it under the header either — verified by the same probe going
  from `{top: 52, inButton: false}` to `{top: 196, inButton: true}`. **Probe to reuse when a
  green click does nothing:** scroll the element into view, then ask `elementFromPoint` at
  its centre whether the answer is inside the element. Evidence:
  `../client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/_components/FindingJumpBadge/styles.ts`,
  `../client/src/lib/sticky-offset.ts`, `specs/12-pr-smart-diff.flow.json`, run 31599113842.

- **2026-08-12** — **A `find … click` that prints `✓ Done` proves a click was DISPATCHED, not
  that anything received it — so the step that fails is the one AFTER the guilty one.** Flow
  12 clicked a findings badge (step 220, green) and then timed out waiting for the URL it
  routes to (step 221, `Wait timed out after 30000ms`), which reads as "the app does not
  navigate" and is not that: the same commands, in the same order, against a local dev
  server, routed correctly every time. The mechanism is one step earlier still.
  `wait --url order=original` returns the INSTANT the URL changes, and on this screen the
  URL is written by `router.replace` **before** React commits the re-render it causes — so
  the next command runs against the old DOM. Original order replaces the whole subtree
  (three `<section>` group wrappers become flat cards), so every file card below is a new
  node; `find` resolved the OLD badge, clicked a detached element, and exited 0. On a
  loaded CI runner the commit lands after the process spawn; locally it lands before, which
  is why this is a CI-only failure that reproduces nowhere. What fixes it is not another
  `wait --load networkidle` — the DOM swap is not a network event — but a **barrier that
  only the new render can satisfy**: `wait --fn "!document.body.innerText.includes('Core
  logic')"`, since group headers exist in Smart order only. Generalises to every step that
  changes what is RENDERED rather than merely what is fetched: assert a fact of the new
  render before the next `find`, and prefer `wait --fn` — the help's own
  wait-for-text-to-DISAPPEAR idiom — where the harness's positive-only `wait --text` cannot
  express it. Evidence: `specs/12-pr-smart-diff.flow.json` (the `wait --fn` barrier),
  `../client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
  (the `!grouped` early return), run 31599113842.

- **2026-08-11** — **`✗ land on the PR list — Wait timed out after 25000ms` as the SECOND step
  of a flow is the home redirect, not your flow.** Five flows open with the same pair —
  `open {BASE}/` then `wait --url /pulls` — and the redirect behind it is a client-side
  `router.replace` inside a `useEffect` that fires only once `useRepos` resolves
  (`client/src/app/_components/HomeView/HomeView.tsx`). So the opener has just agent-browser's
  own **25s ceiling** to complete in — `E2E_STEP_TIMEOUT` does not raise it, see the note in
  `run.ts` — and whichever flow runs LAST is the one that meets a dev server busy recompiling
  a root route it navigated away from ten flows ago. Flow 12 failed there while 11/12 passed;
  inserting `wait --load networkidle` between the two steps, so the root's `GET /repos`
  settles before the URL is asserted, made it 12/12. Same family as the 2026-08-06 entry above
  (which prescribes the same settle for a click after `wait --url`) — treat a bare
  `open` → `wait --url` pair as the harness's sharpest edge and always settle between them.
  How to tell it apart from a real bug in one step, since `run.ts` has **no single-flow
  filter**: bring the stack up by hand, then replay just that flow's `cmd` arrays through
  `agent-browser` in a loop. All 30 of flow 12's steps passed that way while the suite run
  had failed at step 2, which is conclusive. Evidence:
  `specs/12-pr-smart-diff.flow.json` (the two `networkidle` settles), `run.ts` (`STEP_TIMEOUT`).

- **2026-08-10** — **`✗ Wait timed out after 25000ms` on a `wait --text` whose text is visibly
  on the screen means the CASING is wrong, not the screen.** `wait --text` matches the
  **rendered** text, and CSS `text-transform: uppercase` changes what that is — so asserting
  a message-catalogue string against an uppercase-styled label can never match. Flow 11 was
  written with `wait --text "Intent"`, `"In scope"`, `"Confidence"`, `"Missing context"`,
  `"Sources"`; every one of those renders uppercase, because `vendor/ui`'s `SectionLabel`
  sets `textTransform: "uppercase"` and `IntentCard/styles.ts` does the same in its
  `columnHead`, `blockLabel` and `metaLabel`. The flow could therefore never pass, on any
  machine, while the feature was completely correct — the harness's own failure screenshot
  (`test-results/11-pr-intent-fail.png`) showed the whole card rendered, which is what
  separated this from a real regression in one step. Two things follow. Read the failure
  screenshot BEFORE debugging the app: a timeout with a correct-looking screenshot is a
  locator bug, and `agent-browser`'s message is identical either way. And when asserting a
  styled label, take the casing from the rendered DOM, not from `messages/en/*.json` — the
  uppercase is presentational, so the catalogue and the screen legitimately disagree.
  Evidence: `specs/11-pr-intent.flow.json`,
  `../client/src/vendor/ui/shell/SectionLabel.tsx`, `test-results/11-pr-intent-fail.png`.

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
