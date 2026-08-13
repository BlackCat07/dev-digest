# Findings severity — counters, hover panel, per-run filter

A reviewer can see how bad a PR's findings are without opening it, preview them without
leaving the list, and then isolate one severity level inside a single review run.

Server half of this feature: [`../../server/specs/findings-severity.md`](../../server/specs/findings-severity.md).

## Behaviour

### PR list — the FINDINGS column

1. Each row shows one icon+number per severity that is **non-zero**, worst first
   (`CRITICAL`, `WARNING`, `SUGGESTION`). Zero levels are omitted, so the strip stays short
   and a PR with three criticals reads as red at a glance.
2. A PR with no findings shows an em-dash, not three zeros.
3. The column header carries the tooltip `list.findingsTooltip` — *"Findings by severity,
   across every review run"* — because the numbers **sum every run**, not the latest one.
   That is deliberately unlike the SCORE and COST columns, which collapse to each agent's
   latest row.
4. A row with findings shows a dotted underline, signalling the hover panel; a row without
   findings has no hover target.

### PR list — the hover panel

5. Hovering the counters opens a panel listing the findings themselves: severity icon,
   title, file, line label (`12` for a single line, `61-74` for a range) and a two-line
   rationale preview with markdown syntax stripped.
6. The panel sorts worst-severity-first, so it opens on what matters.
7. Clicking a finding navigates to that PR's **findings** tab
   (`/repos/:repoId/pulls/:number?tab=findings`), not the PR's default tab.

### PR detail — the severity filter

8. The Agent-runs tab shows one filter row **per review run**, in that run's findings-panel
   toolbar — never above the timeline. The chip counts therefore always describe the cards
   directly beneath them.
9. Filtering is **isolate**, not multi-select: clicking `CRITICAL` shows only critical
   findings; clicking the active chip again clears the filter. At most one level is ever
   active, and each run filters independently.
10. A level with nothing to isolate is dimmed — unless it is the active one, so the filter
    is always clearable from where you set it.
11. Changing the filter resets the `j`/`k` cursor to the first visible card. It starts on
    the first card too — **unless the screen was navigated to one finding in particular**
    (`?finding=<id>`, set by a badge in the Smart Diff; see
    [`smart-diff.md`](./smart-diff.md) Behaviour #10a), in which case the cursor starts
    there and that card arrives expanded and outlined. Only the FIRST reset is skipped, so
    a later filter change still rescues the cursor as above.
12. Filtering composes with the existing *hide low confidence* toggle.

### PR detail — read-only counters

13. Each timeline row shows the same counter strip for that run, hiding entirely when the
    run has no findings (an em-dash there would collide with the cost badge's own dash).
14. A review-run accordion header stays **text only** — `N findings · M blockers`, no
    coloured counters. The icons belong to the timeline.
15. The tab's own total counts `kind === 'review'` rows only, which is exactly how the list
    column rolls up — so the badge and the column can never disagree.

## Data

| Surface | Source |
|---|---|
| List counters | `PrMeta.findings_by_severity` — comes free with the list payload |
| Hover panel | `GET /pulls/:id/reviews` via `usePrReviews`, fetched **on hover** |
| Detail filter + timeline | the reviews already loaded by the detail page |

The panel's fetch lives in a child component that only mounts while the panel is open: a
50-row list must not register 50 idle queries, and `PRRow` itself must stay free of
TanStack Query (its test renders without a `QueryClientProvider`). It reuses the detail
page's query key, so hovering warms the detail page's cache and vice versa.

Contract type: `FindingsBySeverity` — `{ CRITICAL, WARNING, SUGGESTION }`, uppercase keys
mirroring the `Severity` enum so the UI can index its token registry with them directly.
Colour and icon per level come from `SEV` in `@devdigest/ui`; this feature adds no fourth
copy of that registry.

## States

| Case | Renders |
|---|---|
| No findings on the PR | em-dash in the column, no hover target |
| Panel loading | `findingsPanel.loading` |
| Panel request failed | `findingsPanel.error` |
| Panel loaded, nothing to show | `findingsPanel.empty` |
| Run with zero findings | no counters on its timeline row; no filter row in its panel |
| Level with zero findings | dimmed chip, still clickable only if it is the active one |
| Review with a null `run_id` (the seeded one) | contributes no timeline counters and no hover target |

## Non-goals

- **No multi-select.** One level at a time; a set-based filter would need a different
  control and a way to show "2 of 3 levels".
- **No fourth severity level.** The contract enum defines three. A stored severity outside
  it (the DB column is plain `text`) lands in **no** bucket, so the three counters can sum
  to *less* than the PR's total finding count, and such a finding is unreachable by the
  filter. Accepted, and mirrored on the server.
- **No persistence.** The filter is component state; it does not survive a reload or land
  in the URL.
- **No counters on the accordion header.** Tried, then reverted to match the design
  (`63ffd2d`); e2e flow `04` waits on the literal string `2 findings` there.

## Implementation

| File | Role |
|---|---|
| `src/lib/severity.ts` | `SEVERITY_LEVELS`, `countBySeverity`, `totalOf` — shared by both route subtrees |
| `pulls/_components/SeverityCounters/` | the icon+number strip (list column, timeline row) |
| `pulls/_components/FindingsHoverCard/` | hover trigger + panel, and its `helpers.ts` |
| `pulls/_components/PrFindingsCell/` | the FINDINGS column: counters + on-hover fetch |
| `pulls/constants.ts` | the `findings` column in `GRID` / `COLUMN_KEYS` |
| `pulls/[number]/_components/SeverityFilter/` | the isolate-filter chip row |
| `pulls/[number]/_components/FindingsPanel/` | hosts the filter; `visibleFindings` applies it |
| `pulls/[number]/_components/RunHistory/` | per-run counters on the timeline |
| `messages/en/prReview.json` | `list.columns.findings`, `list.findingsTooltip`, `findingsPanel.*`, `severityFilter.*` |

Adding the column also required the three-place grid invariant — see
[`../docs/feature-unit.md`](../docs/feature-unit.md).

## History

- **2026-08-03** — Feature added: counters, hover panel, per-run isolate filter (`a52dc05`).
- **2026-08-03** — Agent-runs tab aligned with the design: filter moved from above the
  timeline into each run's findings panel; accordion header reverted to text only
  (`63ffd2d`).
