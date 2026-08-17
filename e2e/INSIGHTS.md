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

- **2026-08-15** — **`../scripts/e2e.sh` is NOT a mirror of CI, and the difference is the one
  that matters for a CI-only red: it serves the app with `next dev`, while `e2e-web.yml`
  serves a `next build` + `next start`.** So "12/12 locally" from the hermetic script does not
  clear a production-only failure, and the cheapest next step is a hand-rolled mirror rather
  than a push-and-watch loop: an ephemeral Postgres on a free port, `tsx src/db/migrate.ts` +
  `tsx src/db/seed.ts` against it, `tsx src/server.ts` on :3101, then
  `NEXT_PUBLIC_API_BASE=http://localhost:3101 next build && next start -p 3100`, then
  `E2E_BASE_URL=http://localhost:3100 tsx run.ts`. It reproduced a failure the dev-server run
  could not (flows 04/05, see Recurring Errors 2026-08-06) on the first attempt. Two
  housekeeping notes: `client/.next` now holds a PRODUCTION build, so delete it before the next
  `next dev` (2026-08-05, this section's neighbour), and the run must not overlap a live dev
  server for the same reason. Evidence: `../.github/workflows/e2e-web.yml` ("Build + start web
  (:3000)"), `../scripts/e2e.sh` (`next dev -p "$WEB_PORT"`).

- **2026-08-15** — **The 2026-08-06 prescription for flows 04/05 was applied and holds.** Those
  two were the only flows still clicking the PR row straight after `wait --url`, with no settle
  and no `wait --text` — the shape flows 02 and 11 already avoid, and the one `find` cannot
  survive because it never polls. Under the CI mirror above they failed on the first run
  (both, same step) and passed on the second with two lines added to each: `wait --load
  networkidle` for the list's live-GitHub round-trip, then `wait --text` on the row itself.
  No assertion changed. Worth stating because a red 04/05 has now been misread as a
  regression twice: they fail on the PR LIST, before any PR-detail feature renders, so a diff
  touching the detail screen cannot be the cause. Evidence:
  `specs/04-pr-findings.flow.json`, `specs/05-pr-diff.flow.json` (the two inserted steps).

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

- **2026-08-12** — **A red CI run on a public repo is fully diagnosable with NO `gh auth`.**
  `api.github.com/repos/<o>/<r>/actions/runs?branch=…`, `…/runs/<id>/jobs` (per-step ✓/✗)
  and `…/runs/<id>/artifacts` all answer anonymously; what 403s without a token is the log
  download AND the artifact download — and the artifact ZIP comes through
  `https://nightly.link/<o>/<r>/actions/runs/<id>/<artifact-name>.zip` instead. For this
  suite the artifact IS the failure screenshot `run.ts` uploads, and one look at it settled
  what three theory-driven fix commits had not (see Recurring Errors, 2026-08-12 below):
  it showed the page's scroll position, which no log line carries. Evidence: `run.ts`
  (the failure screenshot), `../.github/workflows/e2e-web.yml` ("Upload failure artifacts").

- **2026-08-12** — **`agent-browser get cdp-url` exposes the daemon's browser WebSocket, and
  raw CDP over it works** — `Target.getTargets` → `Target.attachToTarget {flatten:true}` →
  `Emulation.setCPUThrottlingRate {rate:20}` starves the live page's renderer x20 without
  touching the harness, which is the right first probe for a "slow CI runner" theory about
  a CI-only failure. Remember to set the rate back to 1: it sticks to the page for the
  daemon's lifetime, and the whole suite shares that one session. On flow 12 it did NOT
  reproduce the CI failure, which is what demoted every timing theory and left node
  detachment as the only mechanism consistent with the artifact. Evidence:
  `specs/12-pr-smart-diff.flow.json` (the investigation it served), `run.ts` (the shared
  daemon session).

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

- **2026-08-12** — **A CI-only "click exited 0, nothing happened" that no local environment
  reproduces is `find` resolving a node a remount already DETACHED — and the failure
  screenshot proves it through the scroll that ISN'T there.** Supersedes 2026-08-12 (the
  sticky-header entry above) as the diagnosis of flow 12's CI failure: that fix is real and
  stays (a scrolled-to badge does land clear of the header, and Tab-focus needed it too),
  but CI failed identically with it shipped — three straight runs on two commits
  (31599113842, 31600061139, 31600976140). The pin: `find … click` exits 0, the URL never
  changes, and the artifact screenshot ~30s later shows the page still at scroll TOP, yet
  the badge sits at y≈1050 in a 577px viewport — a click that reached anything attached
  would have scrolled. `scrollIntoView` + click on a detached node is a silent no-op, and
  the only remount between the flow's barrier and its click was Original order replacing
  the card subtree. Six configurations would not reproduce it (macOS dev + prod, this exact
  runner in a linux/amd64 container against a prod build, agent-browser 0.33.2 and 0.34.0,
  a x20 CDP CPU throttle), so the fix is structural, not another wait: the badge click
  moved BEFORE the order flip — a subtree that has never re-rendered cannot offer a stale
  node — with a `wait --fn` hittability probe in front of it (scroll to centre, then
  `elementFromPoint` must land inside the button), so a swallowed click now times out at
  ITS step instead of the assertion after it; the flip moved to the tail behind the same
  settle depth the tab-switch remount already survives in CI; and `run.ts` now appends
  `url at failure:` to every failed step, which is the one line that separates "never
  routed" from "routed, wrong locator" without downloading the artifact. Evidence:
  `specs/12-pr-smart-diff.flow.json` (step "click the findings badge on a flagged file"),
  `run.ts` (`urlAtFailure`).

- **2026-08-12** — **The detachment fix above did NOT hold either: run 31605913685 failed the
  same way with the badge clicked BEFORE any remount, and its artifact shows the page scrolled
  TO the badge** — so this time the target was attached, found and scrolled to, and the click
  still navigated nothing. That refutes, in order: timing (four settle steps + a passed
  hittability probe ahead of the click), geometry (the probe centres the badge and checks
  `elementFromPoint`), staleness (no remount had happened yet), and the app (the same build
  routes on every local click, and the PR-row and tab-bar clicks in the SAME CI run navigate
  fine). What is left is the locator engine: `find role button --name … click` swallowing the
  click on CI Linux specifically, which is the second `find role` CI-only anomaly this suite
  has hit (see Open Questions, 2026-08-07). The flow no longer clicks the badge — the click
  contract moved down to component tests (`SmartDiffViewer.test.tsx` badge→id,
  `FindingsPanel.test.tsx` targeted-card expansion, `FindingCard.test.tsx` scroll landing),
  with the two-line `PrDetailView.openFinding` glue named in the flow description as the one
  seam that leaves unpinned. Full click version preserved at commit 9cb8385 if the engine
  anomaly is ever resolved. Supersedes 2026-08-12 (the detachment entry above) as the
  diagnosis; the probe pattern and the `url at failure:` runner line it introduced stay.
  Evidence: `specs/12-pr-smart-diff.flow.json` (description), run 31605913685's artifact.

- **2026-08-15** — **Third instance of the CI-only swallowed click, and the first one on
  `find text` — so the anomaly is not confined to `find role`.** Flow 11's
  `find text "Auth surface touched" click` exits 0 on CI and the step after it times out at
  30 s (runs 31887724598 and 31888941824, two different commits, 2/2). The 2026-08-12 Open
  Question explicitly recorded that `find text` clicks WORKED in the runs where
  `find role button` did not; that no longer holds. Four local environments cannot reproduce
  it, and this time each competing mechanism was measured rather than argued.
  **The sticky header:** at the CI viewport (1280x577, which is what the browser reports) the
  chip starts at `top: 659`, and after the scroll `document.elementFromPoint` at its centre
  returns a node INSIDE the button — so the mechanism the 2026-08-12 geometry fix addresses is
  not this one. **Visibility of the assertion:** `wait --text` matched a string sitting at
  `top: 847` in that same 577px viewport instantly, so a disclosure panel opening below the
  fold cannot explain the timeout. **Timing:** every settle passes, and replaying the flow's
  own commands against the same build at the same viewport opens the panel every time.
  **The diff under review:** `OverviewTab/styles.ts` sets `alignItems: "start"`, so the L04
  card beside `IntentCard` growing taller cannot move the chip at all. Resolved the way flow 12
  was: the click left the flow, the contract stayed in `RiskAreas.test.tsx` ("opens a chip to
  reveal its explanation and the files it cites"), and the flow's description names the one
  seam that leaves unpinned. For whoever picks the root cause up: `agent-browser click <sel>`
  is a DIFFERENT code path from `find … click` and documents that it reports a covering element
  instead of mis-dispatching — but the chip is a bare `<button>` with no id, testid or title,
  and this CLI's XPath did not match it, so using it means adding a handle to the component
  first. Evidence: `specs/11-pr-intent.flow.json` (description),
  `../client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/_components/RiskAreas/RiskAreas.tsx`.

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

- **2026-08-12** — **Second `find role` CI-only anomaly, worse than the first: the 2026-08-07
  case matched NOTHING (loud), this one matches something and clicks it into the VOID
  (silent).** On CI Linux only, `find role button click --name "Open the finding in
  src/api/users.ts in the Agent runs tab"` exits 0 and no `onClick` fires — four consecutive
  runs (31599113842, 31600061139, 31600976140, 31605913685), while `find text` clicks and
  `find role button --name "Files changed"` in the SAME runs work. Everything app- and
  flow-side is ruled out; the trail is in Recurring Errors (three 2026-08-12 entries).
  Unresolved and stated for pickup: (1) the failing runs' LOGS — which now carry `run.ts`'s
  `url at failure:` line — need an authenticated `gh run view --log`; anonymous API 403s
  log downloads, though `nightly.link` serves the artifact ZIP. (2) A minimal repro against
  agent-browser upstream would need a GH-hosted runner, since six local environments
  (including linux/amd64 + Chrome-for-Testing + 0.34.0 via this exact runner) cannot
  trigger it. (3) If the engine is fixed, flow 12's full click version lives at commit
  9cb8385. Evidence: `specs/12-pr-smart-diff.flow.json` (description), `run.ts`
  (`urlAtFailure`).
