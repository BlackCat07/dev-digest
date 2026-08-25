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
| 2026-08-25 | Multi-Agent Review (SPEC-05) — spec → plan → 16-task build → review → 2 fix rounds | 27 — main + `spec-creator` ×2 (→ 2 × `researcher`) + `implementation-planner` + 18 × `implementer` + `plan-verifier` + `architecture-reviewer` + `doc-writer` | 15.53M | 364m (350m summed in agents) | yes | SPEC-05 `implemented`, 105 AC; 126 files, +16.9k/−206; server 842→933 tests, client 455→491; depcruise unchanged at 22 warnings | [report](./2026-08-25-multi-agent-review.md) |

## Insights by module

### `server`

- **2026-08-18** — `server/INSIGHTS.md` is ~49 KB, and the session protocol makes
  every participant that touches the package read it. In a one-author-plus-two-
  researchers run that came to **8 opens across 3 participants** to quote four
  entries. A dispatch that has already read the journal should carry the relevant
  entries in the brief and say so; citing the path buys a second full read.
  Evidence: `docs/retro/2026-08-18-project-context-spec.md` (Duplicated context).

- **2026-08-25** — **The 2026-08-18 fix above was applied in full and did not hold at
  scale.** The plan carried ~35 `INSIGHTS.md` entries quoted verbatim with their dates,
  and every one of 18 implementer briefs repeated the entries relevant to its paths and
  said "take as read, do not open the journals". Measured anyway: **84 opens of
  `server/INSIGHTS.md` and 75 of `client/INSIGHTS.md`, across 12 participants.** The
  cause is not disobedience — root `CLAUDE.md`'s session protocol *requires* reading a
  package's journal before answering about it, so a dispatch instruction was asking
  agents to break a standing rule, and the rule correctly won. Carrying the entries is
  necessary and not sufficient: **the exemption has to be written into the protocol
  itself**, not into the brief. Supersedes 2026-08-18 on the sufficiency claim only; the
  advice to carry the entries stands. Evidence:
  `docs/retro/2026-08-25-multi-agent-review.md` (Duplicated reading).

### Agents & dispatch

- **2026-08-25** — **Cache creation, not generation, is what a multi-agent run costs.**
  Measured over 27 participants: 13.47M of 15.53M uncached tokens (**87%**) were
  cache *writes*; output was 2.05M (13%). The practical consequences are the opposite
  of the intuitive ones — trimming a prompt matters less than reducing the number of
  turns that re-write a growing prefix, and the model tier multiplies the whole bill
  rather than just the generated part. Concretely: the three `sonnet` roles did **20.6%
  of the uncached work for 4.6% of the money**. Evidence:
  `docs/retro/2026-08-25-multi-agent-review.md` (Where the cost went).

- **2026-08-25** — **The orchestrating main loop was the largest single participant
  after the implementer pool** — 2.76M uncached, 17.8% of the run, over 398 turns. Every
  subagent report returns into the parent's context *in full*, and the parent then
  re-states it; with 26 dispatches that is unavoidable in kind but not in degree. Batch
  the per-wave bookkeeping (save reports, update the ledger, dispatch the next wave)
  into as few turns as the dependencies allow, and never re-narrate a report the reader
  can open. Evidence: `docs/retro/2026-08-25-multi-agent-review.md`.

- **2026-08-25** — **Subagents do not inherit chat images, and describing a design in
  prose instead is a third source of truth that will diverge.** `spec-creator` wrote
  SPEC-05 from a textual description of six screenshots; comparing the shipped spec to
  the actual images afterwards found the grouping rule's entry condition inverted badly
  enough that the design's own reference screen would have rendered empty. The
  correction cost a second full `spec-creator` run (357k uncached, opus) plus two
  fix-round items created by the parent's incomplete manual sync. `Read` accepts image
  files: **write the images to disk and put the paths in the dispatch.** Evidence:
  `docs/retro/2026-08-25-multi-agent-review.md` (What was missed).

- **2026-08-25** — **A plan handed to N implementers is read N times in full.**
  `plan.md` (947 lines) was opened **122 times by 18 participants**, and four separate
  implementers ran the identical `sed -n '411,700p'` to reach the shared constraints
  block. Emitting `tasks/T<n>.md` beside the plan — that task's section plus the shared
  constraints — would give each implementer ~150 lines instead of 947 without losing
  anything, since the plan stays the record. Evidence:
  `docs/retro/2026-08-25-multi-agent-review.md` (Duplicated reading).

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

- **2026-08-21** — **the 2026-08-19 entry above was true about the edit and wrong about
  the effect: the dispatch-brief rule never bound.** It landed in
  `.claude/agents/README.md`, which is human-facing and **loaded by no dispatch**, while
  `implementer.md` step 1 went on saying *"read each in-scope package's `INSIGHTS.md` in
  full — never `head` it"*. Between two instructions the agent only ever sees one.
  Measured three features later: `server/INSIGHTS.md` had grown **49 KB → 72 KB** and
  **24 of 46 run reports still recorded a full read** of it — roughly 48 full journal
  reads across the three runs, against the 8-in-one-run figure that prompted the rule.
  Now fixed in the two files that bind: `implementer.md` step 1 takes the entries as read
  when the brief carries them and names the source in its receipt, and
  `run-plan/SKILL.md` Phase 0 reads each in-scope journal once and quotes it into every
  wave brief. **The durable lesson is not about journals.** A rule filed where a human
  reads it is documentation; a rule is only enforced in the file that is loaded into the
  participant it governs. When a retro proposal targets agent behaviour, name the loaded
  file it must land in, and verify from a report receipt that the behaviour moved —
  not from the diff that added the wording.

- **2026-08-21** — same session, unprompted by a retro: **146 lines of maintainer-only
  text left the eight agent files** (six `## Editing this file` blocks, four trailing
  `## Grounded in` bibliographies) for `.claude/agents/README.md`. They had been shipping
  inside every system prompt as instructions the agent cannot act on — restart procedures
  and academic provenance. The bibliographies turned out to be pure duplicates of that
  README's own `## Where each agent's rules come from`; every external source in them was
  already cited there. Two `/run-plan` changes for the same reason: a task with
  `Owned paths: none` is no longer dispatched (its commands move into the Phase 2 sweep
  that would re-run them anyway — the *check* stays, only the ~80k-token dispatch goes),
  and `plan-verifier` no longer re-runs Done-conditions it is about to mark `yes`, which
  had them running three times. Also pinned `--max-fix` run-wide: read *per source* it
  licensed six `opus`+`sonnet` rounds on a default invocation. Deliberately **not** taken,
  so nobody re-derives them as new: trimming `skills:` on the two eleven-skill agents,
  collapsing the worked-example templates, and a shared `agent-protocol` skill for the
  ~828 lines of cross-file duplication.
