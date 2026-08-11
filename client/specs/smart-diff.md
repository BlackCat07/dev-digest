# Smart Diff

A reviewer opening **Files changed** sees the pull request's business logic first,
generated files last and collapsed, and can click a finding's badge to land on the
line it is about.

## Behaviour

The `?tab=diff` tab of the PR detail screen.

1. **Files are grouped by role**, each group carrying a coloured swatch, a label, a
   one-line instruction and a file count: *Core logic — "The substance of the change
   — review closely"*, *Wiring — "Hooks the core into the app"*, *Boilerplate —
   "Generated / mechanical — skim"*.
2. **Core is first, boilerplate last.** The client re-imposes this from its own
   order, so a response listing groups differently still reads correctly.
3. **A group with no files renders nothing** — no zero-count heading.
4. **Every changed file appears exactly once**, whatever the grouping says. A path
   the response did not classify falls into a fourth *Unclassified* group, rendered
   last. This tab is the only place the diff can be read, so nothing may hide a file.
5. **A file starts expanded iff** it has findings, **or** it is `core` and its
   changed lines are within `AUTO_EXPAND_MAX_LINES`. Precedence is
   findings → role → size: a finding always wins, boilerplate and wiring never open
   themselves, and size only gates the no-findings case.
6. **A lock file therefore starts collapsed** — it is `boilerplate` and has no
   findings.
7. **A file with findings carries a badge** reading "N findings" (or "1 finding"),
   led by the file's worst severity worded as *blocker* / *warning* / *suggestion*.
   It is a real button: reachable by Tab, activated by Enter or Space.
8. **Clicking the badge opens the file if collapsed and scrolls the diff to the
   first finding's line**, clearing the sticky PR header. Clicking the same badge
   again scrolls again.
9. **Lines carrying a finding are decorated** with a coloured left edge across the
   finding's whole range, and the range's first line carries a severity tag. Only one
   tag fits on a row, so a line hosting several findings shows the **worst** severity
   with a `×N` multiplier — without it the visible tags undercount and a file header's
   total cannot be reconciled with the rows below it (measured on a real PR: 31
   findings landed on 23 distinct lines).
10. **Findings whose line this patch does not contain are reported, not dropped** —
    a footer inside the open file says how many, and the badge jumps there instead.
    The badge's count always equals on-diff plus off-diff.
11. **A file with a quoted summary shows a "✨ summary" marker** in its header and a
    *"What this does: …"* row above its diff when open.
12. **The order is switchable.** *Smart order | Original order* is a radio group;
    *Original order* renders the same cards with the same badges and decoration in
    the order GitHub sent them. The choice lives in `?order`, so a link carries it.
13. **The tab never costs a model call.** One GET, no mutation, no re-derive control.

## Data

| On screen | From |
|---|---|
| Group, per-file summary | `GET /pulls/:id/smart-diff` (`usePrSmartDiff`) |
| Path, patch text, ± stats | `pr.files` — already on `PrDetailView` |
| Badge count, severity, line decoration | the PR's review rows, reduced to the newest review **per agent** (`latestFindingsPerAgent`) |
| Summary line's file count and totals | `pr.files_count`, `pr.additions`, `pr.deletions` |

**Findings come from the review rows, never from the response's `finding_lines`** — the
rows are the only source carrying `severity` (the badge colour) and `dismissed_at`. They
are first reduced to the **newest review per agent**, the same reduction the server
applies, so re-running an agent REPLACES a file's badge instead of adding to it. Without
it the badge counts review rows that mentioned a file rather than problems in it:
measured on a real PR with two agents run twice, `src/modules/tasks/routes.ts` showed
`11 findings` against the server's `finding_lines: [13, 40]`, and four of the eleven were
one status-code problem worded differently by two agents across two runs.

This deliberately does **not** match `PrDetailView`'s `allFindings`, which sums every run
so the "Agent runs" tab badge equals the PR list's FINDINGS column
(`server/INSIGHTS.md`, 2026-08-03). The two bases answer different questions — "how much
has been said about this PR" versus "where do I look" — so the reduction is scoped to
this tab and changes nothing else on the screen. Dismissed findings are excluded either
way, matching `ReviewRunAccordion`. `finding_lines` is received and not rendered.

`pr.files_count` and `pr.files.length` can legitimately differ — GitHub caps the file
list on a very large PR. The summary line reports `files_count`; the list renders what
arrived.

## States

| State | What the tab shows |
|---|---|
| Loading the grouping | The section label, the real summary line, a disabled toggle, and three skeleton bars. Deliberately **not** the flat diff: order is the feature, so painting the wrong order and rearranging it under the reader is worse than a moment of nothing. |
| Grouping failed, or came back empty | A muted inline notice — *"Couldn't group these files by role — showing the original order."* — **plus the original flat diff viewer with inline commenting intact**. The toggle is forced to *Original* and *Smart* is `aria-disabled`. The tab degrades to exactly what it was before this feature and is never blank. |
| PR has no changed files | *"No changed files."* |
| A file with no patch text | The row renders; its body says the patch is unavailable (the shared diff renderer's own wording). |
| No review yet | Groups and order render in full, with no badges and no decoration. |
| A finding on a line outside the patch | Counted in the badge, listed in the file's footer, and the badge jumps to that footer. |

## Non-goals

- **A fourth tab.** *Files changed* already existed; this replaces what it renders.
- **Rendering `finding_lines`.** See Data — it would add a cache coupling (the query
  would have to be invalidated when a run finishes) for a number the screen already
  has better.
- **Re-classifying on demand.** There is nothing to re-derive: the server recomputes
  the whole answer per request. A "re-classify" button is the shape the acceptance
  criterion forbids, which is why `hooks/smart-diff.ts` ships no mutation.
- **The split suggestion.** The server returns `split_suggestion` and this tab does
  not render it yet; the copy (`smartDiff.largeTitle` / `largeBody`) is in place for
  when it does.
- **Making `FindingCard`'s `file:line` link jump here** instead of to github.com, and
  wiring `RiskAreas`' file references to the same target. Both become possible now
  that a line has a DOM id; both are separate changes.

## Implementation

| File | Carries |
|---|---|
| `_components/DiffTab/DiffTab.tsx` | the container: queries, and the degradation ladder |
| `_components/SmartDiffViewer/SmartDiffViewer.tsx` | the join, the group order, jump target and per-path openness |
| `_components/SmartDiffViewer/helpers.ts` | `buildViewModel`, `initialOpen`, `partitionFindings`, `severityByLine` — pure |
| `_components/SmartDiffViewer/constants.ts` | group order, swatch tokens, severity words, the sticky-offset variable |
| `…/_components/SmartFileCard/` | one file: header, summary row, decorated diff, off-diff footer, the scroll effect |
| `…/_components/FindingJumpBadge/` | the clickable badge — a real `<button>` |
| `…/_components/SeverityTag/` | icon + word off the `SEV` registry |
| `…/_components/SmartDiffGroupHeader/` | swatch, label, instruction, count |
| `…/_components/DiffOrderToggle/` | the `radiogroup` |
| `src/lib/hooks/smart-diff.ts` | `usePrSmartDiff` — GET only |
| `src/components/diff-viewer/index.ts` | the widened barrel: parser, `CodeLine`, style and annotation helpers |
| `src/components/diff-viewer/CodeLine/CodeLine.tsx` | three optional props — `id`, `rowStyle`, `right` |
| `_components/PrDetailHeader/PrDetailHeader.tsx` | `data-sticky-header`, the measured element |
| `messages/en/prReview.json` | the `smartDiff` block |

Server half: `../server/specs/smart-diff.md`.

## History

`2026-08-11` — Added. Three decisions were reached by being wrong first.

**Openness lives in the viewer, not in each card.** The first design held `open` in
`SmartFileCard` and used two effects — one to open on a jump, one to scroll after the
body rendered. ESLint rejected it: `react-hooks/set-state-in-effect` is an **error**
here, not a warning, so it would have failed the build. Lifting openness to the viewer
made the fix better than the original: the jump handler sets openness AND the target in
one click, React batches them, and the single remaining effect runs after one commit in
which the target row already exists. The two-render dance disappeared.

**`scrollMarginTop` is measured, not chosen.** The scroll container is the `<main>` in
`AppFrame`, and `PrDetailHeader` is `position: sticky` inside it — ~128px normally,
taller on a merged PR (the stale banner) and taller again when the meta row wraps. Any
constant is wrong for some PRs, so the viewer publishes the header's observed height as
`--sd-sticky-h` and every row reads it, with a documented fallback for SSR and jsdom
(where `ResizeObserver` is a no-op stub). `ReviewRunAccordion`'s `scrollMarginTop: 16`
was the starting point and is far too small here.

**`CodeLine` was extended; `FileCard` was not.** The alternative — teaching `FileCard`
roles, summaries, badges and a controlled `open` — pushes feature concepts into a
component two other callers share, one of them a smoke test asserting the plain render.
Instead the barrel was widened with a narrow composition kit and `CodeLine` gained three
optional, feature-agnostic props (`id`, `rowStyle`, `right`), so there is still exactly
one line renderer and inline commenting cannot drift between the two cards.
`SmartDiffViewer.test.tsx` pins that with a case asserting the hover "+" still appears
inside a smart card.

Copy went into the **existing** `prReview.smartDiff` block rather than a new namespace,
by explicit decision. `prReview` is this screen's namespace, not another feature's, so
the collision `client/INSIGHTS.md` (2026-08-10) records does not apply. Its pre-written
keys still needed correcting: `filesCount` and the badge became ICU plurals (they
rendered "1 files"), and the three flat role labels became `groups.<role>.{label,
description}` carrying the design's wording ("Core logic", not "Core"). Note the card
reads TWO namespaces — its own strings from `prReview`, and the shared diff renderer's
from `shell` — which is why its tests provide both.
