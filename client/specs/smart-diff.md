# Smart Diff

A reviewer opening **Files changed** sees the pull request's business logic first,
generated files last and collapsed, and can click a finding's badge to open that
finding's card in the **Agent runs** tab.

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
8. **Clicking it opens that finding's card in the Agent runs tab** — the file badge
   opens the file's **worst** finding, through the app's own router
   (`?tab=findings&finding=<id>`, a `push` so Back returns to the file being read).
   Not a popup, not a github.com link, and not a scroll to somewhere else in this
   file: the card is where a finding is actually read — rationale, suggested fix,
   accept/dismiss — and none of that fits beside a line of diff.
9. **Lines carrying a finding are decorated** with a coloured left edge across the
   finding's whole range, and the range's first line carries a severity tag, which is
   **itself a button** leading to that line's worst finding. Only one tag fits on a
   row, so a line hosting several findings shows the **worst** severity with a `×N`
   multiplier — without it the visible tags undercount and a file header's total
   cannot be reconciled with the rows below it (measured on a real PR: 31 findings
   landed on 23 distinct lines). The click follows the tag: the finding it leads with.
10. **Findings whose line this patch does not contain are reported, not dropped** —
    a footer inside the open file says how many, and the file's badge still opens
    them, because a card does not depend on a line being rendered. The badge's count
    always equals on-diff plus off-diff.
10a. **The landing is the finding, not the tab.** The run holding it opens itself
    (even when it is not the newest), the card is expanded, the `j`/`k` cursor starts
    on it, and it scrolls into view clearing the sticky PR header. Every filter is at
    its default on arrival, so nothing can have hidden the target. Switching tabs by
    hand drops `?finding` — the landing belongs to the navigation that asked for it.
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
| A finding on a line outside the patch | Counted in the badge, listed in the file's footer, and reachable: the badge opens its card like any other. |
| The targeted finding's run was deleted between the click and the arrival | The tab renders normally and nothing is highlighted. `?finding` matches no run, so no accordion claims it — a stale link degrades to "the Agent runs tab", never to an error. |

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
- **Wiring `RiskAreas`' file references to the same target** `FindingCard`'s
  `file:line` link now reaches. A risk's file reference is rendered as plain text
  where no target exists, on purpose — the shared mono-link primitive with no
  `href` renders a button that does nothing, which is worse than a label
  (`specs/pr-brief.md` EC-33). This remains a separate, not-yet-built change.

## Implementation

| File | Carries |
|---|---|
| `_components/DiffTab/DiffTab.tsx` | the container: queries, and the degradation ladder |
| `_components/SmartDiffViewer/SmartDiffViewer.tsx` | the join, the group order and per-path openness |
| `_components/SmartDiffViewer/helpers.ts` | `buildViewModel`, `initialOpen`, `partitionFindings`, `severityByLine` — pure |
| `_components/SmartDiffViewer/constants.ts` | group order, swatch tokens, severity words, the row-id prefixes |
| `…/_components/SmartFileCard/` | one file: header, summary row, decorated diff, off-diff footer |
| `…/_components/FindingJumpBadge/` | the file's badge — a real `<button>`, opens the file's worst finding |
| `…/_components/FindingLineBadge/` | a row's severity tag, made clickable — opens that line's worst finding |
| `…/_components/SeverityTag/` | icon + word off the `SEV` registry |
| `_components/PrDetailView/PrDetailView.tsx` | `openFinding` — the `router.push`, and `?finding` read back out |
| `_components/FindingsTab/FindingsTab.tsx` | passes the target down; publishes the measured sticky offset |
| `_components/ReviewRunAccordion/` | opens itself when it holds the target (lazy initial state, not an effect) |
| `_components/FindingsPanel/FindingsPanel.tsx` | expands the target, starts the `j`/`k` cursor on it |
| `_components/FindingCard/FindingCard.tsx` | scrolls itself into view, once |
| `src/lib/sticky-offset.ts` | `useStickyOffset` + `STICKY_SCROLL_MARGIN`, shared by the two tabs |
| `…/_components/SmartDiffGroupHeader/` | swatch, label, instruction, count |
| `…/_components/DiffOrderToggle/` | the `radiogroup` |
| `src/lib/hooks/smart-diff.ts` | `usePrSmartDiff` — GET only |
| `src/components/diff-viewer/index.ts` | the widened barrel: parser, `CodeLine`, style and annotation helpers |
| `src/components/diff-viewer/CodeLine/CodeLine.tsx` | three optional props — `id`, `rowStyle`, `right` |
| `_components/PrDetailHeader/PrDetailHeader.tsx` | `data-sticky-header`, the measured element |
| `messages/en/prReview.json` | the `smartDiff` block |

Server half: `../server/specs/smart-diff.md`.

## History

`2026-08-20` — **The "make `file:line` jump here instead of to github.com" non-goal is
closed: it shipped.** `specs/pr-brief.md` (SPEC-03) needed a review-focus row to land a
reader on a changed file at a line, so `DiffTab` and `SmartDiffViewer` gained optional
`targetFile` / `targetLine` props: a target seeds `openOverrides` so the file expands
even where its default state would collapse it, and `document.getElementById(lineId(...))`
scrolls the line clear of the sticky header using the `STICKY_SCROLL_MARGIN` this file's
own `2026-08-11` entry describes — no new measuring needed. A path absent from the
rendered diff (GitHub's 100-file page cap, or a file this tab never received) renders a
notice naming it rather than leaving the reader on an unchanged view. The non-goal below
is narrowed to what remains unbuilt — `RiskAreas`' own file references, which is a
separate change.

`2026-08-12` — **A findings badge now leaves the tab.** Review feedback on the L03
PR: a badge that scrolls the diff to a line is a viewer, not navigation — the reader
clicked a *problem* and wants to know what it says, which only the card can tell them.
So both badges route (`router.push`, Behaviour #8-#10a), the file's badge to the
file's worst finding and a row's tag to that row's worst, and the in-diff jump is
gone with the state that drove it: `JumpTarget`, the nonce, `firstJumpLine` and
`SmartFileCard`'s scroll effect.

Three consequences worth having on the record.

**The badge no longer needs a line, and that removed a whole case.** The old jump had
to fall back to the off-diff footer for a finding the patch never rendered
(Behaviour #10). A card exists whether or not a line does, so the fallback simply
does not arise — the footer stays as the honest count, and the badge reaches those
findings like any other.

**The sticky-offset machinery moved rather than died.** Nothing in the diff scrolls
now, but the *card* does, and it sits under the same variable-height sticky header —
so `useStickyOffset` and its measured custom property moved to `src/lib/sticky-offset.ts`
and `FindingCard` reads them. `--sd-sticky-h` became `--dd-sticky-h` with the move.
The row DOM ids stayed: they cost nothing and they are what keeps the reverse link
(below) a one-component change.

**A badge needs `scroll-margin-top`, and that turned out to be an accessibility
fix.** `PrDetailHeader` is `position: sticky` over the `<main>` that scrolls, so
anything scrolling a badge into view — Tab-focusing it from further down the diff,
or an automated click — parks it *under* the header: measured at `top: 52` beneath a
~128px header, with `elementFromPoint` at the button's centre returning the header.
A keyboard user focuses a control they cannot see, and a click there is swallowed in
silence. Both badges therefore carry the measured `scrollMarginTop`, which is also
why `SmartDiffViewer` still publishes the offset even though nothing in the tab
scrolls itself any more. Found the expensive way — two red e2e runs
(`e2e/INSIGHTS.md`, 2026-08-12) — and pinned by a style assertion in
`SmartDiffViewer.test.tsx`.

**Openness on the receiving side is a lazy initial state, for the same reason the
diff's is not an effect.** The run holding the target must be open on its FIRST
render, because the card scrolls itself into view and cannot do that while unmounted
— and `react-hooks/set-state-in-effect` would reject the obvious alternative
(`ReviewRunAccordion` is already on that rule's burn-down list). `FindingsTab`
unmounts with the tab, so arriving from the diff always builds that state afresh.
The one thing this shape cannot do is re-target an already-mounted panel, which no
path reaches: every badge is on the other tab.

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
