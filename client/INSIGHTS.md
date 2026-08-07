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

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

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

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

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

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

_No entries yet._

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

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
