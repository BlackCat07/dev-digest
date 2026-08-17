# Blast Radius

A reviewer opening a pull request sees, beside the INTENT card, what else the change could
touch — the changed symbols, their callers as clickable `file:line` links, and the endpoints
and cron jobs in reach — and can tell an empty map apart from an unbuilt one.

Payload and its guarantees: [`../../server/specs/blast-radius.md`](../../server/specs/blast-radius.md).
The card's history footer, a separate endpoint and spec: [`prior-prs.md`](prior-prs.md).

## Behaviour

1. The PR **Overview** tab renders INTENT and BLAST RADIUS side by side in a two-column
   grid. The pair collapses to one column when the container cannot give each card 380px —
   in CSS, with no media query and no client-only branch, so the server-rendered first paint
   and the hydrated view agree.
2. The card leads with four figures — symbols, callers, endpoints, cron/jobs — taken
   verbatim from `counts`. They are never recomputed from the rendered rows: `callers` is a
   pre-cap total and may legitimately exceed the number of visible caller rows.
3. Below them, one collapsible row per changed symbol, most-impacted first, showing
   `<symbol>()` and its pre-cap caller count. The **first row starts expanded** and the rest
   collapsed; any explicit click overrides that default in both directions.
4. An expanded row lists its callers as `path/to/file.ts:23`, each a link that opens
   **that line** on github.com in a new tab.
5. Caller links are pinned to `indexed_sha` — the commit the index was built at — because
   the line numbers were measured against that tree, not against the PR's head. With no sha
   in the response the link falls back to `HEAD`, which GitHub resolves against the default
   branch.
6. When a caller list was truncated, the row says so (`top 2 of 4`) rather than leaving the
   count looking wrong.
7. Endpoints and crons render as badges under the symbol they are attributed to: endpoints in
   the accent colour, crons in the warn colour. A badge reached indirectly carries its hop
   count in its tooltip.
8. Impact that belongs to the PR rather than to any one symbol — a route a changed file
   declares itself, or one reached from a changed file whose symbols live elsewhere — renders
   in its own row under "Declared by the changed files". Without it the figures could count
   endpoints the body of the card never shows.
9. A **tree / graph** toggle appears whenever there is at least one symbol row. The graph
   view renders the same map as a left-to-right mermaid flowchart, arrows pointing the way
   impact travels (symbol → caller), inside its own horizontal scroll box.
10. Copy comes from the `blast` i18n namespace only. The card reads no other namespace.
11. The card is presentational: it calls no data hook and mounts with
    `NextIntlClientProvider` alone. `OverviewTab` owns `usePrBlast`.

## Data

| What | Where from |
|---|---|
| The map | `usePrBlast(prId)` → `GET /pulls/:id/blast` → `PrBlastRadius` |
| Repo full name | `useActiveRepo()`, passed down from `PrDetailView` |
| Caller links | `githubBlobUrl(repoFullName, indexed_sha, file, line)` — the existing helper |
| Copy | `messages/en/blast.json` |

No polling and no mutation, unlike the INTENT card: the server derives the whole map from
index rows on every read, so there is no `running` state to watch and no "re-derive" to
press. Re-indexing is a repository-level action with its own control.

## States

| State | What renders |
|---|---|
| Loading | Skeleton bars. No empty-state copy — a not-yet-read map must not read as an empty one. |
| Complete, with impact | Stat row, symbol tree (first row open), badges. |
| Complete, no callers | Stat row plus "No downstream callers found", qualified by how many changed symbols were checked. The one empty state allowed to read as a finding. |
| Partial index | A warn notice ABOVE the data — a reader who stops at the first row must already know the map may be incomplete — with the real rows still rendered below it. |
| Degraded | A muted notice naming the cause (index missing, indexing off, changed files not imported, index failed, repo too large) plus the sentence that nothing was analysed. The "nothing calls this" copy is deliberately NOT shown. |
| Read error | An inline notice saying the map could not be read and that the rest of the page is unaffected. Distinct from a degraded map, and never borrowing its copy. |
| No repo name | Caller rows still render, unlinked. The fact is the caller; the URL is a convenience. |
| Unknown `reason` | Falls back to the generic degraded copy rather than printing the raw enum or an i18n key path. |

The stat row stays visible in every state, degraded included: four zeroes next to the reason
they are zero is more honest than hiding the figures.

## Non-goals

- **No "Prior PRs touching these files" panel.** It appears in the design mock but has no
  data behind it in this lesson and no copy in the namespace; it belongs to PR History.
- **No re-index button on the card.** Coverage is a repository concern, and
  `POST /repos/:id/resync` already owns it.
- **No in-app code viewer.** A caller is by definition a file this PR does not change, so the
  Files-changed tab cannot show it; github.com is the destination.
- **No model-written explanation of the map.**
- **No separate Blast tab.** The lesson text suggests one; the design places the card in the
  Overview grid beside INTENT, and the design won — the two derived readings of one diff
  belong on one screen.

## Implementation

| File | Role |
|---|---|
| `src/lib/hooks/blast.ts` | `usePrBlast` — one query, no polling, no mutation. |
| `.../[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx` | The card and its state ladder. |
| `.../BlastRadiusCard/helpers.ts` | `linkRef`, `callerUrl`, `fileLineLabel`, `unattributed`, `buildGraph`. |
| `.../BlastRadiusCard/styles.ts` | Tokens only; mirrors `IntentCard`'s frame so the pair reads as one row. |
| `.../OverviewTab/OverviewTab.tsx` | The container that owns both cards' queries. |
| `.../OverviewTab/styles.ts` | The `auto-fit` two-column grid. |
| `.../PrDetailView/PrDetailView.tsx` | Passes `repoFullName` through. |
| `messages/en/blast.json` | The namespace, which already existed for this lesson. |
| `.../BlastRadiusCard/BlastRadiusCard.test.tsx` | One case per state; the empty-map cases assert that the three empties render differently. |

## History

`2026-08-14` — Feature added (L04). The `blast` i18n namespace already existed in
`messages/en/` as a placeholder for this lesson and was extended rather than replaced.
Placement follows the design mock (a card in the Overview grid) rather than the lesson
text's "add a Blast tab"; recorded under *Non-goals* so it is not later "fixed".
