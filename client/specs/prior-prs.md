# Prior PRs

A reviewer reading the BLAST RADIUS card can see, in the same card, which earlier pull
requests already changed these files, how long ago, and open any of them in one click —
without leaving the Overview tab.

Server half: [`../../server/specs/prior-prs.md`](../../server/specs/prior-prs.md).
The card this sits inside: [`blast-radius.md`](blast-radius.md).

## Behaviour

1. The block renders as the FOOTER of the BLAST RADIUS card on the PR Overview tab,
   separated from the impact map by a rule. It is one card because the reviewer asks both
   questions together; it is a footer because the map is the subject and history is context
   for it.
2. It reads its own endpoint (`GET /pulls/:id/prior-prs`) through `usePriorPrs`, owned by
   `OverviewTab` like every other query on this screen — the card and the block are both
   presentational and mount without a `QueryClient`.
3. Because it is a second query, its states are independent: a failed or still-loading
   impact map leaves history rendering normally, and a failed or still-loading history
   leaves the map rendering normally.
4. The header shows the label, the total count, and a chevron. It is a button; clicking it
   collapses the list. The count stays visible while collapsed. The block opens **expanded**.
5. Each row shows `#<number>`, the pull request title (truncated to one line, never widening
   the card) and its age — `11d ago`, `2mo ago` — from `updated_at`.
6. A row links to that pull request inside DevDigest (`/repos/<repoId>/pulls/<number>`).
   With no repository id the row still renders, unlinked: the fact is the pull request, not
   the link.
7. The row's `title` attribute names the shared files — the evidence for why it is listed.
8. When the server reports `truncated`, the block says how many of how many are shown.
9. Every empty list states which empty it is (see *States*); there is no bare "no results"
   branch anywhere in the block.

## Data

| What | Where from |
|---|---|
| The list | `GET /pulls/:id/prior-prs` → `PrPriorPrs`, via `usePriorPrs` (`src/lib/hooks/prior-prs.ts`) |
| Ordering, capping, coverage | Server-side; the block renders what it is given and sorts nothing |
| Age | `formatAge` (`src/lib/format.ts`) over `updated_at` |
| Copy | `messages/en/blast.json`, `prior.*` — the card's own namespace |
| Repository id | `PrDetailView` → `OverviewTab` → the card, from the route segment |

## States

| State | What renders |
|---|---|
| Loading | One skeleton line. No label, no count. |
| Rows | The header, the count, and one row per pull request. |
| Truncated | The rows, plus "Showing the N most recent of M." |
| Nothing found, full coverage | "No other pull request in DevDigest has touched these files." — the one empty that is a finding. |
| `partial` | The rows it did find, plus a caveat naming how many pull requests were actually searched. A caveat over real data, never instead of it. |
| `degraded` / `no_changed_files` | "This PR's changed files have not been imported yet…" and no finding. |
| `degraded` / `no_file_lists` | "No other pull request… has an imported file list yet, so nothing could be compared — this is not a statement that none touched these files." |
| Query error | One muted line saying history could not be read, explicitly noting the map above is unaffected. |
| Collapsed | Header and count only. |

## Non-goals

- **Not its own card.** It shares the Blast Radius card's surface; a second card in the
  Overview grid would compete with INTENT for the reader's eye and imply a third subject.
- **No filtering, sorting or searching.** Ten rows, newest first, decided by the server.
- **No author avatars.** The author travels in the payload for a later use; the row is a
  scanning line, and a face on each one is weight the block has not earned.
- **No diff preview on hover.** The shared paths in the row's tooltip are the evidence; the
  linked PR is one click away for the rest.

## Implementation

| File | Role |
|---|---|
| `BlastRadiusCard/_components/PriorPrs/PriorPrs.tsx` | The block: header, rows, and one note per state. |
| `BlastRadiusCard/_components/PriorPrs/styles.ts` | Footer styling — a rule, not a border box. |
| `BlastRadiusCard/BlastRadiusCard.tsx` | Renders the block outside its own state branches. |
| `OverviewTab/OverviewTab.tsx` | Owns `usePriorPrs` and threads `repoId`. |
| `src/lib/hooks/prior-prs.ts` | The query. |
| `src/lib/format.ts` | `formatAge` — `3h` / `11d` / `2mo` / `1y`. |
| `messages/en/blast.json` | `prior.*`. |
| `BlastRadiusCard/_components/PriorPrs/PriorPrs.test.tsx` | One case per state, copy asserted through the real catalogue. |

## History

`2026-08-15` — Feature added (L04), as the history half of the Blast Radius card.
