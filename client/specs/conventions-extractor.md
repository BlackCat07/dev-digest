# Conventions — triage what the extractor found, and turn it into a skill

A repo-scoped screen listing the house rules a scan extracted, each backed by real code you
can open on GitHub, with accept / reject / edit per candidate and one button that composes
the accepted ones into a skill.

Server half of this feature:
[`../../server/specs/conventions-extractor.md`](../../server/specs/conventions-extractor.md).

## Behaviour

1. `/repos/:repoId/conventions` renders the heading `Conventions in <full_name>`, the scan
   meta line, and the candidate list. The route entry is thin; the screen lives in
   `_components/ConventionsView`.
2. The sidebar carries a **Conventions** entry under SKILLS LAB, `g c`, whose href resolves
   `:repoId` from the active repo.
3. The scan button reads `Run extraction` before the first scan, `Re-scan` after one, and
   `Scanning…` while one is in flight. It is absent when the repo cannot be scanned.
4. While a scan is running the screen **polls**; when none is, it makes no requests.
5. A repo the extractor cannot scan shows a panel naming the reason — not cloned, not
   indexed, or already scanning. **If the repo already has candidates they are still listed**
   and still triageable; blocking concerns the scan, not work already done.
6. The meta line states how many files the scan looked at and how long ago it ran, plus the
   cost when known.
7. **Dropped candidates are shown, not hidden**: `N candidates were dropped before reaching
   this list`, broken down into "without verifiable evidence" and "below the adherence
   floor". A list of five with no context reads as "this repo has five conventions".
8. A `partial` scan says so: `Sampled N of M files — the highest-ranked ones`.
9. Each card shows the rule, its rationale, a category chip, the evidence, and — closing the
   card, under the evidence it was derived from — a confidence bar. The only controls are
   **Accept and Reject**; a candidate's text and its citations are not editable from here.
10. **Evidence links to the exact lines on GitHub**, built from the corrected line numbers and
    pinned to the scan's commit. With no commit sha the location renders as plain text rather
    than a link that would drift off the cited lines.
11. A citation the verifier had to relocate is labelled `line corrected` or
    `found elsewhere in the file`.
12. Extra citations beyond the first are collapsed behind `N more citations`.
13. Under the confidence bar, a **measured** candidate reads `312 of 343 places follow this`
    and an **unmeasured** one reads `Not mechanically checkable — the model's own estimate`.
    Without that line the two render identically and the distinction the feature rests on
    disappears.
14. Clicking the status a candidate already holds returns it to untriaged, so a mis-click is
    one click to undo.
15. The actions row is `Deselect all` · the `N of M accepted` counter · `Create skill`, with
    the category filter leading it. `Deselect all` returns
    **every** triaged candidate — accepted and rejected alike — to untriaged, and is disabled
    when nothing is triaged.
16. `Create skill` is disabled until at least one candidate is accepted.
17. The create modal previews the body **fetched from the server**, so what is shown is what
    is saved. It offers one merged skill or one per category, an enabled toggle, and — in
    merged mode only — a name and description.
18. On success the screen navigates to the new skill in the Skills Lab.
19. Every control on the actions row is the same height. The category filter is a local
    control rather than `SelectInput`, which stands ~9px taller and takes neither a size nor
    a style prop — restyling the vendored primitive would move it on Settings and in the
    agent editor too. A category filter narrows the list; a category with no candidates says so rather than
    looking like an empty repo. There is no free-text search — a scan yields tens of
    candidates, not hundreds, and the category chips already partition them.
20. A large repo shows the estimate — files, tokens, model calls, cost — and asks for
    confirmation before scanning. A small one just scans.

## Data

| Reads | From |
|---|---|
| scan, budget, candidates, repo | `GET /repos/:repoId/conventions` (one query, one cache key) |
| pre-scan estimate | `GET /repos/:repoId/conventions/budget` |
| start a scan | `POST /repos/:repoId/conventions/scan` |
| accept / reject, and each candidate a reset clears | `PATCH /conventions/:id` |
| body preview | `POST /repos/:repoId/conventions/skill/preview` |
| create | `POST /repos/:repoId/conventions/skill` |

One query for the whole screen because scan, budget and candidates change together — three
queries would let the header say "scanning…" over a list that had already refreshed.

Runtime values (category list, category colours, confidence thresholds) live in
`src/lib/conventions.ts`, not imported from `@devdigest/shared`. A runtime import from that
package breaks `next dev`/`next build` while `tsc` and vitest both pass — the same rule
`src/lib/skill.ts` and `src/lib/severity.ts` follow.

## States

| State | What renders |
|---|---|
| Loading | skeleton |
| Load failed | `ErrorState` |
| Not cloned / not indexed, no candidates | blocked panel with its own copy, no scan button |
| Blocked but candidates exist | a warning line **above the list**, which still renders |
| Never scanned | empty state with `Run extraction` |
| Scanning | button spins, list polls |
| Scan failed | the error on the meta line, list unchanged |
| Nothing survived | a distinct empty state naming how many rules were proposed |
| Category matches nothing | its own empty state, not the first-run one |
| No accepted candidates | `Create skill` disabled with a tooltip |

## Non-goals

- **Editing a candidate.** The server still accepts a text edit, but no control here offers
  one: the citations were read out of the repo, and making any of it typeable would turn a
  verified candidate back into a claim.
- **Bulk triage beyond a reset.** `Deselect all` issues one PATCH per triaged candidate. A
  bulk endpoint is the answer if a repo ever produces enough candidates for that to matter.
- **Composing the skill body client-side.** The server composes it; the modal previews.
- **A second model picker.** The model is chosen in Settings → Feature Models, which already
  lists live OpenRouter models with prices.
- **Running a scan from the Skills Lab.** A scan belongs to a repo and lives on the repo's
  screen.

## Implementation

| File | Carries |
|---|---|
| `src/app/repos/[repoId]/conventions/page.tsx` | thin route entry, no `<Suspense>` (dynamic route) |
| `…/_components/ConventionsView/` | the screen, its states, filters and the budget confirmation |
| `…/_components/ConventionCard/` | one candidate: evidence, GitHub link, confidence, triage |
| `…/_components/CreateSkillModal/` | mode, naming, server-rendered preview |
| `…/_components/CategoryFilter/` | the category picker, sized to `Button`'s `md` metrics so it lines up with the buttons beside it |
| `src/lib/hooks/conventions.ts` | the five queries and mutations |
| `src/lib/conventions.ts` | runtime constants and derivations |
| `src/vendor/ui/nav.ts` | the sidebar entry and `g c` (route config, the one editable thing in `vendor/ui`) |
| `messages/en/conventions.json` | every string on the screen |

## History

`2026-08-06` — screen added (L02). Extends the `conventions` namespace that shipped ahead of
the feature.

`2026-08-06` — free-text search removed (the category filter is the only one), and the
card's Accept/Reject sized to match every other button on the screen.

`2026-08-06` — aligned with the product mock: centred container, scan button on the heading's
line, the standing subtitle dropped (the empty state already carried the same sentence),
confidence moved to the foot of the card, the toolbar split into an actions row and a filter
row with `Deselect all` added, and **Edit removed from the UI**. The server keeps
`UpdateConventionPayload`'s text fields and the `edited` column, so restoring the control is
one component.
