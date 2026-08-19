# Retro ledger

Append-only. One row per run, newest at the bottom; then the insights that outlived
their run, grouped by the module they are about. Never rewrite a row — a superseded
entry gets a new line that says so.

`uncached` = input + cache-creation + output, the tokens paid for in full. Cache
reads are excluded deliberately: including them inflates the figure by an order of
magnitude. `deep` says whether the run's numbers were measured from transcripts or
taken from what the orchestrator witnessed in context.

## Runs

| Date | Run | Participants | Uncached | Wall | deep | Outcome | Report |
|---|---|---|---|---|---|---|---|
| 2026-08-18 | Project Context spec (SPEC-01) | 4 — main + `spec-creator` → 2 × `researcher` | 3.06M | 130m (30m in agents) | yes | `specs/project-context.md`, 742 lines, 52 AC / 0 open questions | [report](./2026-08-18-project-context-spec.md) |

## Insights by module

### `server`

- **2026-08-18** — `server/INSIGHTS.md` is ~49 KB, and the session protocol makes
  every participant that touches the package read it. In a one-author-plus-two-
  researchers run that came to **8 opens across 3 participants** to quote four
  entries. A dispatch that has already read the journal should carry the relevant
  entries in the brief and say so; citing the path buys a second full read.
  Evidence: `docs/retro/2026-08-18-project-context-spec.md` (Duplicated context).

### Agents & dispatch

- **2026-08-18** — A subagent cannot call `AskUserQuestion`, so any question it
  would have asked becomes a silent default. `spec-creator` had four blocking
  questions and no channel for them; three were answered only because the
  orchestrator asked them independently. Questions that change a contract, a
  threshold or the shape of a deliverable are asked **before** the dispatch, by the
  orchestrator. Evidence: `docs/retro/2026-08-18-project-context-spec.md` (What was
  hard; What the dispatch got wrong).
- **2026-08-18** — A subagent inherits none of the parent's images. A design-bearing
  task must carry the design as prose, or the result is silently narrower than the
  mock and neither side can name what was lost. Evidence: same report (What was
  missed).
- **2026-08-18** — Two `researcher`s on sonnet, dispatched concurrently with
  ~1 700-character briefs, cost ~0.36M uncached each and returned in ~3 minutes
  against 30 minutes for the opus author — and one returned the finding the whole
  deliverable turned on. Cheap parallel research under an expensive author is the
  default shape for spec work at this size. Evidence: same report (What worked).

### Applied

- **2026-08-19** — all four proposals from the 2026-08-18 run applied on the human's
  go-ahead. Two landed somewhere other than proposed: the dispatch-brief rule went to
  `.claude/agents/README.md` rather than `docs/agent-prompts/` (that directory holds
  the *product's* reviewer prompts, not our dispatch briefs — a rule filed there
  would have rotted), and the images rule merged into the same block instead of
  standing alone. The `spec-creator` change grew from "add wording" to "withdraw the
  `AskUserQuestion` grant and make eleven references consistent across two files",
  because the file already carried an *under verification* note that the measurement
  closed. Evidence: `docs/retro/2026-08-18-project-context-spec.md` (Proposed
  changes, with a status line under each).
