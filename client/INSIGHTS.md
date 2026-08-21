# client — engineering insights

Append-only journal for `@devdigest/web`. Seven fixed sections; newest entry at the
bottom of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

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
  instead>. Evidence: `src/path/file.tsx` (`ComponentName`).
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

- **2026-08-03** — A hover panel anchored to a PR-list row has to be `position: fixed` off
  `getBoundingClientRect()`, **not** the `absolute`-inside-a-`relative`-wrapper shape
  `vendor/ui/kit/Dropdown.tsx` uses: the list's `s.tableCard` sets `overflow: hidden`, which
  clips any absolutely-positioned descendant. Three things follow. The app scrolls an inner
  `<main>` (`AppFrame`), so closing on scroll needs a **capture-phase** listener — `scroll`
  doesn't bubble to `window`. When flipping above the trigger, anchor the panel's `bottom` to
  the trigger's top instead of computing a `top` offset, or it clamps over the app header on a
  short viewport. And keep the panel's data fetch in a child mounted only while open, because
  `PRRow.test.tsx` renders with `NextIntlClientProvider` **only** — any `useQuery` in `PRRow`'s
  always-rendered subtree throws "No QueryClient set" in all of its existing cases. Evidence:
  `src/app/repos/[repoId]/pulls/styles.ts` (`tableCard`),
  `_components/FindingsHoverCard/` (`FindingsHoverTrigger`), `_components/PrFindingsCell/`.

- **2026-08-14** — **The "undefined token name" class of bug (2026-08-06, `var(--bg)`) is
  mechanically detectable in ~40 lines, and this package has no such check.** A sibling product
  that vendors this exact design system added one and it caught a real bug the moment it was
  written: nine reviewed-and-shipped files styled muted text with `var(--text-tertiary)`, which
  `styles.css` does not define — `color` fell back to *inherited*, so every date and hint
  rendered at full contrast instead of dimmed. The test is a plain vitest file: regex every
  `(--[a-z0-9-]+)\s*:` declared in `src/vendor/ui/styles.css` into a set, walk `src/` for
  `.ts|.tsx|.css`, and assert every `var(--…)` written in our own code is in that set. Two scope
  decisions make it usable here: skip `src/vendor/**` (a verbatim copy is not ours to correct, and
  a self-reference there is a finding about the copy, not a bug), and read the theme file for both
  colour schemes at once so a token defined in only one `[data-theme]` block still counts as
  defined — catching *that* asymmetry needs a second, separate assertion. Note this is the one
  styling mistake invisible to `tsc`, `eslint`, `next build` and every existing test, which is
  what makes a mechanical check worth its 40 lines. Evidence: `src/vendor/ui/styles.css`,
  `../learning-platform/frontend/src/test/tokens.test.ts` (the sibling implementation),
  `.claude/skills/product-ui-language/references/tokens.md`.

- **2026-08-19** — **A `vi.mock` factory can read a MUTABLE module-level variable, which is what
  lets one test file cover several vintages of a persisted record.** `RunTraceDrawer.test.tsx`
  mocked `useRunTrace` with a single frozen `const TRACE`, so a second trace shape was
  untestable in that file — and the shapes matter here, because a trace is read back by a cast
  rather than a parse, so an old one arrives with keys **absent**. Declaring `let current = …`
  and having the factory return `current`, then resetting it in `afterEach`, covers the current
  shape, a populated one and a key-deleted legacy one in the same file. It works because the
  factory returns closures evaluated at render time, after the module body has run — the usual
  "cannot reference a variable in `vi.mock`" hoisting complaint applies to the *factory's own*
  initialisation, not to a value it reads later. Evidence:
  `_components/RunTraceDrawer/RunTraceDrawer.test.tsx` (`current`, `LEGACY_TRACE`).

- **2026-08-20** — **A whole-ROUTE flow test can stub just `fetch` and `next/navigation` and keep
  every hook real — and mocking `@/lib/hooks` instead does not work here.** Extends the AppShell
  entry below from "the shell mounts" to "the shell, the header and two tabs mount and navigate":
  make the `fetch` stub a URL router with an **empty-list default** and the real query hooks do the
  rest, which is what lets a test drive a card row → `?tab=diff&file=…` → the file expanded in the
  diff tab as one flow. The reason the obvious alternative fails is worth knowing before trying it:
  `src/lib/repo-context.tsx` and `src/components/app-shell/hooks/useShellContext.ts` read the same
  barrel (`./hooks` and `@/lib/hooks` resolve to one file), so a module mock would have to
  re-provide the shell's own hooks too. Two traps it costs. A path rendered by a **prop-derived**
  notice resolves during the skeleton, before the grouping query settles, so asserting the notice
  and the diff together needs `findByText` and a wait on a file — otherwise the test passes on a
  page with no diff on it at all. And the repo name and the PR number each appear **twice** in a
  real shell (sidebar switcher + breadcrumb), so `getByText` on either throws "found multiple
  elements" — which is itself the evidence the shell is real rather than faked. Evidence:
  `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.test.tsx`.

- **2026-08-19** — **`AppShell` mounts cleanly in jsdom with only `vi.mock("next/navigation")`,
  a `QueryClient` and the `shell` namespace** — `useTheme` and `useActiveRepo` both have working
  default contexts and `next/link` needs no router provider. That is worth knowing because it
  makes "the rest of the screen is still usable" assertable against the **real** sidebar and
  breadcrumb instead of a faked shell: an inline-error state can be checked for the thing it
  actually promises, that navigation still works, rather than only for the error text. No
  existing `*View` test did this before. Evidence:
  `src/app/repos/[repoId]/context/_components/ContextView/ContextView.test.tsx` (`tree`).

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

- **2026-08-20** — **A `@@` hunk header does not decide which line numbers exist — the body lines
  do — so a target-line fixture written from the header silently finds no anchor.** A patch whose
  header claims a long range but whose body carries one context line and one addition renders
  head-side rows 10 and 11 only; a `targetLine` of 12 then makes
  `document.getElementById(lineId(path, line))` return `null`, the scroll never happens, and there
  is no other symptom — no throw, no warning, and the file still renders. Count the **body** lines
  when writing a fixture that a test will target, and assert the anchor exists before asserting
  anything about the scroll. Related: the `scrollIntoView` receiver entry in Recurring Errors,
  which is how you tell "scrolled to the wrong row" from "scrolled to nothing". Evidence:
  `_components/SmartDiffViewer/helpers.ts` (`lineId`, `parsePatch`),
  `_components/SmartDiffViewer/SmartDiffViewer.test.tsx`.

- **2026-08-12** — **A "reset the cursor when the filters change" effect also runs on MOUNT,
  so it silently destroys any lazily-initialised value of the state it resets.**
  `FindingsPanel` opens with `useEffect(() => setFocusIdx(0), [severity, scope, hideLow])`,
  which reads as a filter handler and is not one: an effect with a dependency array runs
  after the FIRST commit too. Starting the `j`/`k` cursor on the finding the URL targets
  (`useState(() => shown.findIndex(...))`) therefore worked for exactly one render and was
  gone by the time anything was painted — and nothing failed, because the panel's own tests
  never targeted a finding and the reset is correct in every case they do cover. The fix is
  a `useRef(false)` that skips the first run, and it is better than it looks from two other
  angles: the reset is now CONDITIONAL, so `react-hooks/set-state-in-effect` stops flagging
  the file (client eslint warnings 9 → 8, and this file was on that rule's burn-down list),
  and the guard documents that "on mount the cursor is already where it belongs" — which is
  the actual invariant. General shape to watch for: a lazy `useState` initialiser plus any
  effect that assigns the same state unconditionally is a bug the type system, the linter
  and a green suite all miss. Evidence:
  `_components/FindingsPanel/FindingsPanel.tsx` (`filtersTouched`),
  `_components/FindingsPanel/FindingsPanel.test.tsx` ("still resets the cursor when a filter
  change shrinks the list").

- **2026-08-11** — **A per-file findings count built from `reviews.flatMap(r => r.findings)`
  GROWS every time an agent is re-run, and the number looks plausible the whole way.** A
  review fans out over agents and writes one `reviews` row EACH, so summing every row
  counts superseded runs. Measured on a real PR with two agents run twice:
  `src/modules/tasks/routes.ts` showed **11 findings** while the server's `finding_lines`
  for the same file was `[13, 40]` — four of the eleven were one 200-vs-201 status-code
  problem worded differently by two agents across two runs. Nothing catches it: the count
  is a true statement about the rows, just not about the file, and it only diverges once
  somebody re-runs an agent, which no test fixture does. The fix is a reduction to the
  newest row per agent, keyed on `agent_id ?? 'row:' + id` (nullable, and null on the
  seeded review). Crucially it must be scoped to the ONE consumer that means "where do I
  look": `PrDetailView`'s `allFindings` sums every run on purpose, so the "Agent runs" tab
  badge equals the PR list's FINDINGS column (`server/INSIGHTS.md`, 2026-08-03) — changing
  that would break an equality this repo maintains deliberately. So two bases coexist on
  one screen, and any new per-file rollup has to pick one and say which. Evidence:
  `_components/SmartDiffViewer/helpers.ts` (`latestFindingsPerAgent`),
  `_components/DiffTab/DiffTab.tsx`, `../server/src/modules/smart-diff/findings.ts`.

- **2026-08-11** — **"Open a collapsed thing, then scroll to a row inside it" written as two
  effects fails `eslint` as an ERROR, and the lint-clean version is genuinely better.**
  Copying `ReviewRunAccordion`'s target/nonce pattern into Smart Diff's file card gave effect
  A (`setOpen(true); setPending(line)` when the target names this file) and effect B (scroll
  once `open && pending`), because the target ROW does not exist until the body renders on the
  next commit — `ReviewRunAccordion` gets away with one effect only because it scrolls its own
  always-mounted root. `react-hooks/set-state-in-effect` rejects both `setState` calls, and
  like `react-hooks/refs` (2026-08-05) it is an **Error**, so this would have failed
  `next build`. The fix is not a suppression: lift openness to the parent as a sparse
  `Record<path, boolean>` override map, and have the badge's `onClick` set the override AND
  the target together. React batches one event, so the single remaining effect runs after ONE
  commit in which the row already exists — the two-render dance disappears, and the effect
  now only touches the DOM and a ref, which is what an effect is for. Keep a
  `ref`-held nonce guard: the deps include a `Map` rebuilt whenever findings change, so
  without it an unrelated re-render scrolls the page out from under the reader. Evidence:
  `src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
  (`openOverrides`, `onJump`), `_components/SmartFileCard/SmartFileCard.tsx` (`scrolledNonce`).

- **2026-08-11** — **A mutation that omits an optional request field is a SILENTLY SUCCESSFUL
  no-op, and every signal a UI normally trusts says it worked.** The Intent card's Re-derive
  button called `api.post(\`/pulls/${prId}/intent\`)` with no body, so the server's optional
  `force` flag was `undefined`, its freshness check returned the STORED row, and the response
  was a 200 carrying a valid record. React Query invalidated, the card re-rendered, the spinner
  ran and stopped. Nothing was wrong except that nothing happened — and the case it silently
  failed on was precisely the one users press the button for. No test caught it because the
  suite asserted the RESPONSE; the only thing that sees this class of bug is asserting the
  REQUEST at the `fetch` boundary, which is why `src/lib/hooks/intent.test.tsx` stubs `fetch`
  rather than mocking `api`/`apiFetch` (that also keeps `apiFetch`'s conditional
  `content-type` in the code path under test). General rule: when a server field is optional
  and the client's job is to set it, assert the outgoing body. Evidence:
  `src/lib/hooks/intent.ts` (`useDeriveIntent`), `src/lib/api.ts` (`post`'s
  `body ? … : undefined`), `src/lib/hooks/intent.test.tsx`.

- **2026-08-10** — **Putting a new feature's copy into another feature's i18n namespace fails
  silently in both directions, and the symptom is the wrong feature's words on your screen.**
  The Intent Layer appended its `card.*` block to `messages/en/brief.json` (the PR **Brief**'s
  namespace) and read the empty state from that file's pre-existing keys — so a PR with no
  derivation rendered an `EmptyState` titled **"Brief not available yet."** on the INTENT
  card. Nothing catches this: the keys resolve, so next-intl emits no missing-message warning,
  and `tsc`, `eslint` and all 175 client tests were green while the screen named the wrong
  feature. It also books a collision — whoever builds the Brief must either restyle those two
  strings and break this card or fork them. There is no cost to doing it right:
  `src/i18n/request.ts` `readdirSync`s `messages/en/` and merges every file as
  `{ [basename]: … }`, so a feature's own namespace is ONE new file and no shared edit (L02's
  `conventions.json` is the precedent). Fixed by moving to `messages/en/intent.json` with its
  own `label`/`unavailable`/`unavailableHint`; the section label went from
  `brief.block.intent` to `intent.label` with the rendered string unchanged, which is what
  kept the e2e assertion passing. Tell for the next reader: `rg 'useTranslations\("<ns>"\)'`
  returning exactly one caller that is NOT that namespace's feature. Evidence:
  `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`,
  `src/i18n/request.ts` (`loadMessages`), `messages/en/intent.json`.

- **2026-08-06** — **`var(--bg)` is not a token** — `vendor/ui/styles.css` defines
  `--bg-primary` (`#0a0a0a`, the app background), `--bg-surface`, `--bg-elevated` and
  `--bg-hover`, and nothing else. An unknown custom property is not a CSS error: the
  declaration simply drops, so a `<pre>` written with `background: "var(--bg)"` stays
  **transparent** and renders the code on whatever surface is behind it — the card's
  `--bg-elevated` — instead of recessed below it. Nothing catches this: typecheck, eslint
  and the unit tests were green, and the only symptom is "the screen doesn't look like the
  mock". Two Conventions styles.ts files shipped with it and both now say
  `var(--bg-primary)`. When a style needs the base background, name that token; don't
  invent a shorter alias. Evidence:
  `src/app/repos/[repoId]/conventions/_components/ConventionCard/styles.ts` (`snippet`),
  `_components/CreateSkillModal/styles.ts` (`preview`), `src/vendor/ui/styles.css`.

- **2026-08-05** — **Holding the HTML5 drag source in `useState` produces a drop that
  silently does nothing.** `dragstart` → `dragover` → `drop` can all arrive before React
  commits a render, so `dragFrom` still reads as its previous value inside the drop
  handler's closure and the reorder is skipped with no error. Nothing catches it: typecheck,
  eslint, `next build` and the unit tests over the pure `move()` helper were all green while
  the feature did not work — it only showed up by dispatching the real event sequence at a
  running app. Keep the dragged index in a **ref** (handlers read it, nothing renders it)
  and keep only the drop-target highlight in state. Two follow-on traps: `onDragOver` must
  call `preventDefault()` or the browser refuses the drop and `onDrop` never fires at all;
  and reading `ref.current` in the JSX to compute the highlight is
  `react-hooks/refs` "Cannot access refs during render", which **fails `next build` as an
  Error** (not a warning) — resolve it inside `onDragOver` and store the result. Evidence:
  `src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx`.
- **2026-08-05** — `<Markdown>` from `@devdigest/ui` is **inline-only**: it maps `p`,
  `strong`, `code`, `a` and nothing else. react-markdown still emits real `<h2>`/`<ul>`/`<li>`
  for a document-shaped body, but unstyled they collapse into one undifferentiated block
  under the app's reset — a four-section rubric renders as a wall of text. Adding headings
  and lists to the vendored primitive is the wrong fix: every existing caller is a
  one-paragraph finding rationale, and a rationale containing `##` would suddenly grow a
  heading. `vendor/ui` is extend-by-new-file, so a feature that renders a *document* ships
  its own renderer. Evidence: `src/vendor/ui/primitives/Markdown.tsx`,
  `src/app/skills/_components/SkillBody/`.

- **2026-08-03** — Don't infer UI placement from the design **screenshots** alone, and don't
  conclude "absent from the mock ⇒ never designed". `DevDigest Design (standalone).html` is a
  self-extracting bundle — plain `grep` finds nothing, because the payload is base64+gzip
  inside `<script type="__bundler/manifest">` (a JSON map of uuid → `{mime, compressed,
  data}`; decode with `gzip.decompress(base64.b64decode(...))`, asset name = the leading
  `/* … */` comment). Decoding it showed the severity filter WAS designed — three `Chip`s
  with icon + label + count in `findings.jsx` `FindingsPanel` — but that component is
  **orphaned**: defined and exported, mounted by no screen, while the screens render
  `ReviewRunCard` with `const shown = run.findings;` and no filter. A severity chip row was
  therefore built above the TIMELINE, where the mock has literally nothing between the tab bar
  and the section label, and it had to be moved into the per-run panel afterwards. Decode the
  bundle before deciding where something goes. Evidence:
  `_components/FindingsPanel/FindingsPanel.tsx`, `_components/SeverityFilter/`,
  `../../../../../DevDigest Design (standalone).html`.
- **2026-08-03** — Running `next build`, **or the hermetic e2e stack**, while a `next dev`
  server is up corrupts that dev server: all three write the same `client/.next`, and
  `NEXT_PUBLIC_API_BASE` is inlined at compile time, so the dev server on `:3000` starts
  serving chunks with the hermetic API's `:3101` baked in ("Cannot reach the DevDigest engine
  at http://localhost:3101") — or dies outright with a 500 on every route after a `next build`,
  which no amount of reloading fixes. `touch src/lib/api.ts` forces the recompile that repairs
  the env inlining; a `next build` collision needs a full dev-server restart. Evidence:
  `next.config.mjs` (`env`), `../scripts/e2e.sh` (web 3100 / API 3101, same client dir).

- **2026-08-04** — Wrapping a screen in `<Suspense fallback={null}>` because it reads
  `useSearchParams()` **deleted the server-rendered screen** and shipped a blank first paint.
  The "useSearchParams always needs a Suspense boundary" rule applies to *statically*
  prerendered routes; `/repos/[repoId]/pulls`, `/repos/[repoId]/pulls/[number]` and
  `/agents/[id]` are all dynamic (`ƒ` in `next build` output, because of the dynamic segment),
  so the hook costs nothing there — but a boundary makes the server emit the **fallback**
  instead of the view. Nothing failed loudly: typecheck, `next build` and all 108 client unit
  tests stayed green, and e2e flow **02 passed** because it does `wait --text` before clicking.
  Flows **04/05 failed** — they click the PR row straight after `wait --url`, so they hit the
  blank page, and `test-results/04-pr-findings-fail.png` is a black rectangle. Don't add the
  boundary unless `next build` demands it (it errors when a static route needs it). Evidence:
  `src/app/repos/[repoId]/pulls/page.tsx`, `../e2e/specs/04-pr-findings.flow.json`.

- **2026-08-21** — **An EARS `WHERE` on an OPTIONAL field silently leaves the common case
  unspecified, and a green suite plus a met criterion is what hides it.** `specs/pr-brief.md`
  AC-42 promised a scroll *WHERE a review-focus entry carries a line*; the brief's model never
  sees a hunk body and is told `null` is the honest answer, so on a real pull request **all six**
  rows had `line: null`. AC-40 and AC-41 were met — `router.push` landed on `?tab=diff&file=…`
  and the card expanded — while `SmartFileCard`'s effect returned on its first line
  (`if (targetLine == null || !open) return;`), so nothing scrolled and the reader sat at the top
  of an 86-file diff with their file open below the fold. Two tests **pinned** the gap as
  intended behaviour ("scrolls nowhere when the target carries no line"), which is what a
  criterion written against the rarer branch buys you. The fix is a `targeted` flag beside
  `targetLine` and a `fileCardId(path)` anchor on the card root, so the file is the fallback
  receiver — the file was already named as the promise in that effect's own comment, and only
  the code disagreed. Tell for the next reader: when a spec's optional field decides whether
  anything observable happens, check what the field's real-data distribution is before writing
  the criterion against it. Evidence:
  `src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/_components/SmartFileCard/SmartFileCard.tsx`
  (`scrolledTarget`, `cardRef`), `SmartDiffViewer/helpers.ts` (`fileCardId`),
  `../specs/pr-brief.md` (AC-42, AC-62).

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

- **2026-08-20** — **`vendor/ui`'s "extend via a new file, don't restyle a primitive" rule
  has a third path it doesn't name: most primitives take a `style` prop, so trimming one
  for a single surface needs no `vendor/ui` edit and no fork.** `Badge` spreads
  `...style` last over its own defaults, so a caller overrides `fontSize`/`padding` for
  itself alone — which is what the do-not-touch rule actually wants (no other caller
  moves), reached without a second component. Put the override in the calling unit's
  `styles.ts` as a named member rather than inline, so the deviation from the primitive's
  scale is a thing with a name and a comment; `VerdictBanner`'s `s.countBadge` is the
  precedent. Check the primitive first — `style` is a prop on `Badge` but NOT on
  `SeverityBadge` or `CategoryTag` in the same file, so the escape hatch is per-component,
  not universal. Evidence: `src/vendor/ui/primitives/Badge.tsx` (`Badge`),
  `src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/styles.ts`
  (`countBadge`).
- **2026-08-20** — **`SectionLabel` carries its own `marginBottom: 14`, which is the gap
  before the list it heads — so reusing it as a COLLAPSIBLE header leaves that gap
  hanging under a section with nothing below it, and two shut sections then sit further
  apart than two rows of content.** Reusing the primitive is still right (it owns the
  12px/700/uppercase/0.07em scale every section label in the app shares, and re-deriving
  that in a feature's `styles.ts` is how two headings start disagreeing) — but the
  wrapping button has to cancel the margin while shut, which is why `s.sectionHead`
  takes `open` and sets `marginBottom: open ? 0 : -14`. Its `right` slot is the place for
  the count and the chevron; note that slot is `marginLeft: auto`, so a chevron style
  copied from `riskChevron` brings a SECOND `marginLeft: auto` and shoves the chevron
  away from the count it should sit beside — `s.sectionChevron` is the same style minus
  that one line. Evidence: `src/vendor/ui/primitives/SectionLabel.tsx`,
  `src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/styles.ts`
  (`sectionHead`, `sectionChevron`), `BriefCard.tsx` (`Section`).

- **2026-08-11** — **`scrollMarginTop` on this app's screens cannot be a constant, because the
  scroll container is not the window and the sticky header is not a fixed height.**
  `AppFrame` scrolls an inner `<main style={{overflow:"auto"}}>`, and `PrDetailHeader`'s root
  is `position: sticky; top: 0` inside it — roughly 128px, but ~156px on a merged or closed PR
  (the `staleBanner` branch) and taller again when `s.meta` wraps at a narrow width. So
  `ReviewRunAccordion`'s `scrollMarginTop: 16` is not merely small, it is unfixable by
  choosing a bigger number: any single value lands some PRs under the header. What works is
  measuring — a `ResizeObserver` on a `[data-sticky-header]` attribute writes the observed
  height into a CSS custom property on the feature's own root, and rows read
  `scrollMarginTop: var(--sd-sticky-h, 148px)`. Two notes for the next reader: the fallback is
  load-bearing (SSR, first paint, and jsdom, where `src/test/setup.ts` stubs `ResizeObserver`
  as a no-op that never fires), and an attribute beats a shared constant here because the
  measurer lives in a different route subtree from the header it measures. Evidence:
  `_components/SmartDiffViewer/SmartDiffViewer.tsx` (`useStickyOffset`),
  `_components/PrDetailHeader/styles.ts` (`root`), `src/vendor/ui/shell/AppFrame.tsx`.

- **2026-08-11** — **To reuse a shared unit's rendering under a different container, widen its
  barrel with a named composition kit and give the leaf component feature-AGNOSTIC props —
  do not parameterise the container.** Smart Diff needed the diff-viewer's parsing, styling
  and line rendering under its own grouped, findings-aware card. Extending `FileCard` would
  have meant ~6 new props plus making its `open` controlled, in a component two other callers
  share (one of them `src/test/smoke.test.tsx`, asserting the plain render). Instead
  `diff-viewer/index.ts` gained named exports — `CodeLine`, `parsePatch`, `Line`,
  `AUTO_EXPAND_MAX_LINES`, the style helpers, the comment-thread helpers — deliberately NOT
  `FileCard`, since its disclosure rule is the part being replaced; and `CodeLine` gained
  exactly three optional props (`id`, `rowStyle`, `right`) that say nothing about findings or
  severity. The payoff is that there is still ONE line renderer, so inline commenting cannot
  drift between the two cards — worth an explicit test, because the drift would be invisible
  (the hover "+" would vanish from the new card only). Note the barrel uses named exports and
  not `export *`: the line between "reusable" and "internal" is the thing being stated.
  Evidence: `src/components/diff-viewer/index.ts`, `src/components/diff-viewer/CodeLine/CodeLine.tsx`,
  `_components/SmartDiffViewer/SmartDiffViewer.test.tsx` ("offers the add-comment affordance").

- **2026-08-11** — **A component that composes a shared unit legitimately reads TWO i18n
  namespaces, and its tests must provide both.** The 2026-08-10 entry above ("a feature's copy
  belongs in its own namespace") reads as "one component, one namespace", and that is not the
  rule — `SmartFileCard` takes its own strings from `prReview.smartDiff` and the reused
  diff renderer's from `shell.diffViewer`, because duplicating "No diff text available" into a
  second namespace would give one situation two wordings. Mounting such a component with only
  its own namespace does not fail a test: `next-intl` renders the key path and logs
  `IntlError: MISSING_MESSAGE`, so a green run buries the problem in stderr. Provide every
  namespace the subtree reaches, and keep the boundary the earlier entry is about by asserting
  copy through the imported catalogue rather than literals. Evidence:
  `_components/SmartDiffViewer/_components/SmartFileCard/SmartFileCard.tsx` (two
  `useTranslations` calls), `_components/SmartDiffViewer/SmartDiffViewer.test.tsx` (`mount`).

- **2026-08-06** — **Settings → Feature Models can only ever write `provider: "openrouter"`,
  so a registry entry whose `defaultProvider` is anything else is unreachable from the UI.**
  `SettingsModels.setModel` hard-codes it — `update.mutate({ feature_models: { …chosen,
  [id]: { provider: "openrouter", model } } })` — and the picker's options come from
  `useProviderModels("openrouter")`. Nothing surfaces the mismatch: a feature whose default
  is `openai/gpt-4.1` runs on OpenAI until someone touches the picker, and from then on can
  never be put back without editing `settings.feature_models` by hand. The `conventions`
  entry shipped that way and was moved to an OpenRouter default when it gained its first
  consumer. So: a new `FEATURE_MODELS` entry should default to an OpenRouter model unless
  the picker is taught about providers, and the registry has to be changed in **three**
  places together — `src/lib/feature-models.ts` plus both copies of
  `vendor/shared/contracts/platform.ts`. Evidence:
  `src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx`,
  `src/lib/feature-models.ts`.

- **2026-08-02** — The PR-list table has a **three-way hand-synced invariant**: the track
  count in `GRID` ↔ `COLUMN_KEYS.length` ↔ the number of top-level `<div>`s `PRRow` returns.
  Nothing in the type system ties them, and a mismatch doesn't error — it silently shifts
  every column after the offending one. Adding a column means exactly those three plus the
  `list.columns.<key>` message; `pulls/styles.ts` and `page.tsx` need no edit because
  `s.row`/`s.headRow` read `GRID` and the (inline) header maps `COLUMN_KEYS`. Note
  `s.headCell(alignRight)` models only "is the last column", so right-aligning a middle
  column needs a signature change. Evidence:
  `src/app/repos/[repoId]/pulls/constants.ts` (`GRID`, `COLUMN_KEYS`),
  `_components/PRRow/PRRow.tsx`.
- **2026-08-02** — A feature unit shared by the PR **list** and PR **detail** must live in
  `pulls/_components/`, not `pulls/[number]/_components/` — the latter sits below the list
  route and can only be reached from it by an upward cross-route import. Such a unit also
  needs its own `styles.ts` rather than borrowing the page-level `pulls/styles.ts` its
  siblings (`PRRow`, `FilterBar`) use, since it belongs to no single page. Correspondingly,
  formatters more than one route subtree needs go in `src/lib/` (see `src/lib/format.ts`), not
  a unit's `helpers.ts` — that file is unit-private under the barrel convention. Evidence:
  `src/app/repos/[repoId]/pulls/_components/RunCostBadge/`.

- **2026-08-07** — **ConventionCard's side rail is pinned by a test to exactly two worded
  buttons (Accept/Reject)** — "offers accept and reject as the only worded decisions" — so
  any further card action must ship as an icon-only control in the content column, the way
  the snippet's copy button and the rule's edit pencil do. The edit affordance existed for
  a while only server-side: `PATCH /conventions/:id` accepted `rule`/`rationale` and
  `useUpdateConvention`'s comment said "accept, reject and edit are one mutation", yet no
  component sent that patch — grep for the hook's callers before assuming a flow the code
  comments promise is actually wired to a screen. Evidence:
  `src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.test.tsx`
  ("only worded decisions"), `src/lib/hooks/conventions.ts` (`useUpdateConvention`).

- **2026-08-07** — The two-worded-buttons pin described above was **lifted the same day** by
  an explicit product decision: the rail now carries Accept / Reject / Edit, with the pinning
  test renamed to "offers accept, reject and edit as the side-rail actions". The durable part
  of the earlier entry is unchanged — grep for a hook's callers before assuming a flow that a
  code comment promises is actually wired to a screen. Supersedes 2026-08-07 (the rail-pin
  half only). Evidence: `_components/ConventionCard/ConventionCard.tsx`,
  `ConventionCard.test.tsx`.

- **2026-08-19** — **The two editors reach their tab bodies differently, and copying a test from
  one to the other does not work.** `AgentEditor` takes `tab` / `onTab` as **props**, while
  `SkillEditor` reads `?tab=` itself through `useSearchParams` — so a test that exercises a panel
  switch in the skill editor has to mock `next/navigation` with a **mutable** `URLSearchParams`,
  where the agent editor's equivalent just passes a prop. Second trap in the same file: do not
  let a `SkillEditor` test land on the default `config` tab, because `ConfigTab` calls
  `useToast()`, which **throws** outside `<ToastProvider>` — mount on `?tab=preview` (or whichever
  tab is under test) instead. Third, minor but it wastes a run: query the tab strip by role,
  because `skills.previewTab.title` is also the word "Preview" and a text query matches two
  nodes. Evidence: `src/app/skills/_components/SkillEditor/SkillEditor.tsx`,
  `src/lib/toast.tsx` (`useToast`),
  `src/app/skills/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx`.

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-19** — **`eslint` on a path under `src/vendor/` exits 0 while linting nothing, and
  a command listing it beside real files reads as a pass for both.** The config ignores
  `src/vendor/**`, so `eslint src/vendor/ui/nav.ts src/components/app-shell/helpers.ts` exits
  `0` having parsed only the second file, emitting `File ignored because of a matching ignore
  pattern` as a *warning* among the output. Anyone writing a Done-condition that names a
  vendor path — which happens exactly when a change enters that zone under a carve-out, i.e.
  when the lint mattered most — records a green gate over an unlinted file. Assert the change
  a different way (`git diff --stat -- src/vendor/ui/` showing exactly one file is the check
  that actually holds), and keep vendor paths out of an `eslint` invocation whose exit code
  someone will read as coverage. Evidence: `eslint.config.js`, `src/vendor/ui/nav.ts`.

- **2026-08-19** — **Under fake timers, a TanStack Query `refetchInterval` refetch fires on the
  timer but its data commits on the render AFTER it, so the obvious flush sees the new call
  count and the OLD data.** `await flush(TOUR_POLL_MS)` advances the timer, the request goes
  out and the call count moves — and the assertion on the rendered payload still reads the
  previous value. A zero-millisecond second flush is still one turn early; `flush(1)` is what
  lands it. Measured while asserting that the tour poll starts on `generation_state ===
  "running"` and stops when it changes. Worth knowing before concluding the hook's interval
  predicate is wrong: the call count is the honest signal, the rendered data lags it by one
  commit. Evidence: `src/lib/hooks/onboarding.test.tsx`.

- **2026-08-10** — **`@testing-library/user-event` is NOT a dependency of this package**, so the
  usual "always `userEvent`, never `fireEvent`" advice is unreachable here — importing it fails
  at collect time, and `client/node_modules/@testing-library/` holds only `react` and
  `jest-dom`. All 21 test files in this package use `fireEvent` / `.click()`; match them rather
  than adding the dependency for one test (that is a `package.json` + lockfile change, and the
  lockfile is do-not-touch). Two other gaps worth knowing before writing a test here: there is
  **no shared QueryClient test helper** (`AgentCard.test.tsx` and `PRRow.test.tsx` each build
  one inline, and `renderHook` appeared nowhere in `src/` before `lib/hooks/intent.test.tsx`),
  and the vendored `Skeleton` is a bare `div.skeleton` with no role or aria, so a loading state
  can only be asserted through `container.getElementsByClassName` — the same last-resort escape
  `SeverityFilter.test.tsx` already uses for `[aria-disabled]`. Evidence:
  `package.json` (devDependencies), `src/lib/hooks/intent.test.tsx`,
  `src/vendor/ui/primitives/Skeleton.tsx`.

- **2026-08-19** — **jsdom dispatches no `click` for Enter on a focused native `<button>`, so
  with `fireEvent` and no `user-event` a keyboard-operability requirement cannot be asserted the
  way it reads.** The browser synthesizes that click; jsdom does not, and `user-event` — which
  models it — is not a dependency here (2026-08-10, this section). Two shapes work, and the
  choice says something about the design. For a control whose activation is *native*, assert the
  load-bearing half directly — that it is a real, tab-reachable element with an accessible name
  (`el.focus(); expect(el).toHaveFocus()`), not a `div` with an `onClick` — and then dispatch the
  activation separately, disclosing the split in the test. For behaviour with **no** native
  keyboard equivalent (a reorder, a custom navigation), put it on an explicit `onKeyDown` and the
  test drives a genuine `keyDown` with no click at all. Prefer the second where you can: it is
  both more assertable and the accessible design. Evidence:
  `src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`
  ("attaches a document and moves it one position up without a pointer").

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

- **2026-08-20** — **"Couldn't load this pull request" with the sidebar reading "No repo
  selected" is almost never the screen you just changed — it is the app talking to an API
  that refused it, and there are exactly two cheap causes.** Both were hit in one session
  while visually verifying a `VerdictBanner` restyle, and both render the app's own
  full-screen error, which is indistinguishable from a feature you just broke. (1) **Wrong
  host in the address bar.** `server/src/app.ts` registers `cors` with
  `origin: [config.webOrigin]`, and `webOrigin` is built as
  `http://localhost:${WEB_PORT}` — a literal, not a pattern. Serve the app from
  `http://127.0.0.1:3000` and the API answers 200 with **no**
  `access-control-allow-origin` header at all, so the browser discards every response and
  every hook errors. Always drive a browser at `http://localhost:3000`; `curl` cannot
  reveal this because it sends no `Origin`. (2) **You tripped the rate limiter.** The same
  file registers `@fastify/rate-limit` at `max: 120, timeWindow: '1 minute'`, so a probe
  script that walks every PR and fetches its reviews and runs exhausts the budget in
  seconds and the NEXT page load fails — the API then answers
  `{"error":{"code":"internal_error","message":"Rate limit exceeded, retry in N seconds"}}`.
  `/health` is exempt (`config: { rateLimit: false }`), which is why the stack looks up
  while the app is down. Tell the two apart in one command:
  `curl -sD - -H 'Origin: http://localhost:3000' localhost:3001/repos | grep -i
  access-control`. Evidence: `../server/src/app.ts`, `../server/src/platform/config.ts`
  (`webOrigin`), `src/lib/api.ts` (`API_BASE`).

- **2026-08-20** — **`vi.spyOn(Element.prototype, "scrollIntoView")` proves that SOMETHING
  scrolled, never WHICH element — and `mock.instances` will not tell you, because it is for
  constructors.** The 2026-08-12 entry below establishes that the shim belongs in
  `src/test/setup.ts` and must be a real function so a spy can wrap it; this is the next step, and
  it is the difference between a requirement and a shrug. A requirement like "the targeted line is
  scrolled clear of the sticky header" needs the receiver, and the way to get it is to capture
  `this` inside a `mockImplementation` — then the assertion can name the row and check that row's
  own `scrollMarginTop`, rather than asserting a call count that any scroll anywhere satisfies.
  Evidence: `_components/SmartDiffViewer/SmartDiffViewer.test.tsx` (`spyOnScroll`),
  `src/test/setup.ts`.

- **2026-08-19** — **`getByRole(…, { name })` cannot match text containing consecutive spaces
  — the accessible-name computation normalises whitespace — so a control whose name embeds a
  verbatim string will never be found by that string.** Hit while asserting that a copy
  control writes a shell command out exactly: the command is `npm run dev  # starts it` with
  two spaces, the button's accessible name collapses them to one, and
  `getByRole("button", { name: /npm run dev {2}#/ })` matches nothing while the clipboard
  receives the original. Split the two concerns — query the control by a normalised prefix,
  and assert the verbatim string on the clipboard, which is where the requirement actually
  lives. This bites any test that treats an accessible name as a byte-for-byte echo of
  content: paths, commands and code snippets are where it shows up. Evidence:
  `src/app/repos/[repoId]/onboarding/_components/TourSection/TourSection.test.tsx`.

- **2026-08-12** — **`TypeError: rootRef.current?.scrollIntoView is not a function` means
  jsdom, not your ref — and the blast radius is every test that merely RENDERS the
  component.** jsdom implements no scrolling at all, so `Element.prototype.scrollIntoView`
  is `undefined` rather than a no-op; the optional chain guards a null ref, not a missing
  method, so a component that scrolls itself into view throws from its effect. Adding that
  behaviour to `FindingCard` turned 4 tests red across THREE files — `FindingsPanel` and
  `ReviewRunAccordion` fail too, because they render the card and had nothing to do with
  scrolling. That is what makes the per-file stub the wrong fix: `SmartDiffViewer.test.tsx`
  had one (assign in `beforeEach`, `delete` in `afterEach`), and any other file rendering
  the same component inherits the crash. The shim belongs in `src/test/setup.ts` next to
  `ResizeObserver`, and it must be a real function (`function scrollIntoView() {}`) rather
  than a bare property, or `vi.spyOn` cannot wrap it — with the shim in place a test asserts
  the call with a plain spy and leaves the prototype alone. Note the app itself is fine:
  every browser has the method, so this is purely the test environment. Evidence:
  `src/test/setup.ts`, `_components/FindingCard/FindingCard.tsx` (the `landed` effect),
  `_components/FindingCard/FindingCard.test.tsx`.

- **2026-08-03** — `Module not found: Can't resolve './contracts/findings.js'` pointing at
  `src/vendor/shared/index.ts` during a Next compile means something imported a **runtime
  value** — not just a type — from `@devdigest/shared`. That vendored barrel re-exports with
  ESM `.js` extensions webpack won't map back to `.ts`, and every other client import from
  the package is `import type`, so the extensions had never been exercised. The trap is the
  feedback loop: `tsc --noEmit` **and** `vitest` both pass (each resolves the alias its own
  way) and the failure surfaces only under `next build` / `next dev`, as a **500 on every
  route that transitively imports it** — here it broke 6 of 7 e2e flows while both unit
  suites stayed green. Keep client imports of `@devdigest/shared` type-only and put any
  runtime constant in `src/lib/` (this is why `SEVERITY_LEVELS` in `src/lib/severity.ts`
  exists instead of validating against the Zod enum's `Severity.options`). Evidence:
  `src/vendor/shared/index.ts`, `src/app/repos/[repoId]/pulls/[number]/page.tsx`,
  `src/lib/severity.ts`.
- **2026-08-03** — Addendum to the entry above: the `?sev` param it cites was later removed
  (the severity filter became local per-run state), so `page.tsx` no longer validates anything
  against `SEVERITY_LEVELS`. The **rule is unchanged and still load-bearing** — client imports
  of `@devdigest/shared` must stay `import type`, and `src/lib/severity.ts` remains the home
  for the runtime constants. Only the example is historical.

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
