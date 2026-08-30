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
| 2026-08-25 | **Export to CI (SPEC-05)** — spec → plan → build | 11 — main + `spec-creator` (4 dispatches, 1 nested `researcher`) + `implementation-planner` + 5 × `implementer` + `plan-verifier` + `architecture-reviewer` + `doc-writer` | not measured (in-context) — ~1.96M subagent tokens on opus, 642k on sonnet | 300m (≈150m in agents) | no | SPEC-05 `implemented`; 3 commits; 42 paths; 903/468/53 tests; verdict `comment`, 0 CRITICAL | [report](./2026-08-25-export-to-ci.md) |

## Insights by module

### `server`

- **2026-08-18** — `server/INSIGHTS.md` is ~49 KB, and the session protocol makes
  every participant that touches the package read it. In a one-author-plus-two-
  researchers run that came to **8 opens across 3 participants** to quote four
  entries. A dispatch that has already read the journal should carry the relevant
  entries in the brief and say so; citing the path buys a second full read.
  Evidence: `docs/retro/2026-08-18-project-context-spec.md` (Duplicated context).

- **2026-08-25** — **An acceptance criterion can demand more distinct outcomes than its input
  is able to carry, and no review catches it — only a written test does.** SPEC-05's AC-24
  asked for four distinct reasons across four unreadable-artifact cases, but two of them reach
  the decoder as identical `null` bytes. Found by a failing assertion, not by reading. When a
  criterion says "each with its own distinct reason", ask which *input* carries the
  distinction before implementing, and assert the reasons are pairwise different. Evidence:
  `server/src/modules/ci/artifact.ts`, `server/test/ci-ingest.test.ts`,
  [2026-08-25 report](./2026-08-25-export-to-ci.md).

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

- **2026-08-25** — **`implementation-planner` holds no `Write` tool, so its plan comes back as
  a message the parent must retype at `opus` output rates.** Measured on SPEC-05: the plan was
  792 lines, and the agent's own report asked for it to be persisted *verbatim*. Either give
  it `Write` scoped to `.claude/.plans/<feature>/`, or budget the retyping — but do not
  discover it mid-run. Evidence: `.claude/agents/implementation-planner.md:6`,
  [2026-08-25 report](./2026-08-25-export-to-ci.md).
- **2026-08-25** — **An image *block* cannot travel through a dispatch's text-only prompt, but
  the *file* can — so a subagent working "blind" on a design is a dispatch that withheld the
  path, not a platform limit.** Every dropped image is written to disk and its path printed in
  the message carrying it; `spec-creator` holds `Read`, and `Read` renders an image. On SPEC-05
  the parent paraphrased six mocks instead of passing twelve real PNGs, the paraphrase lost that
  the CI tab's rows show the latest run's status rather than the install date, and the correction
  cost an AC amendment after the plan already existed. Store mocks at `docs/design/<feature>/`
  (a temp dir is OS-cleaned and invisible to later sessions), name the paths in the dispatch with
  an instruction to `Read` each before writing a criterion, and name the screens that have **no**
  mock so their absence is recorded rather than invented. Evidence:
  [2026-08-25 report](./2026-08-25-export-to-ci.md).
- **2026-08-25** — **A journal digest built once and quoted into the brief works — and on
  SPEC-05 it was only built for the implementers.** All five confirmed they opened no journal;
  meanwhile `spec-creator`, `implementation-planner`, `plan-verifier`, `architecture-reviewer`
  and `doc-writer` each read all three journals in full, two of them at `opus` rates. The
  digest is cheap to carry further than the wave briefs. Evidence:
  [2026-08-25 report](./2026-08-25-export-to-ci.md).
- **2026-08-25** — **Naming, in the dispatch, what a `sonnet` verifier must NOT confirm on the
  parent's word is what keeps it honest.** On SPEC-05 three items were listed as unproven (a
  never-executed `.it.test.ts`, `DDG-UI-001`, an unapplied migration); the verifier honoured
  all three, returned `partial`/`not checked`, and named the command that would settle them
  rather than agreeing with the parent's own green figures. Evidence:
  [2026-08-25 report](./2026-08-25-export-to-ci.md).

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
