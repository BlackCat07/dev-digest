# Retro: writing the Project Context spec (SPEC-01) — 2026-08-18

| | |
|---|---|
| Session | `68579648-178d-41f5-92d0-6204d2e0b2b4` |
| Source | deep — transcripts measured by `collect.py` |
| Participants | 4 — main loop + `spec-creator`, which dispatched 2 `researcher`s (nested) |
| Uncached tokens | 3.06M total: 1.01M main, 1.33M spec-creator, ~0.36M per researcher |
| Wall-clock | 130m end to end, human-paced; 30m inside `spec-creator`, 3m per researcher |
| Outcome | `specs/project-context.md` — SPEC-01, 742 lines, 52 AC / 25 EC / 9 US, 0 open questions; plus one `specs/README.md` index row and two `server/INSIGHTS.md` entries |

## Where the cost went

`spec-creator` is the most expensive participant at 1.33M uncached tokens, and it
earned it: 100k output tokens across 116 turns produced the deliverable. The two
`researcher`s cost **~0.36M each on sonnet and returned in ~3 minutes**, against
30 minutes for the opus author — and one of them returned the finding the whole
spec turned on (`GET /repos/:id/context` is already agreed contract with a shipped
client hook and no server route). Cheap parallel research under an expensive
author is the right shape at this size and should be the default for spec work.

The main loop's 1.01M is not compute-heavy work; it is 96 turns of grounding reads,
relaying decisions, and verifying the agent's claims. Its 130m wall-clock includes
human reading time and must not be read as machine time.

## What was hard

- **`spec-creator` could not ask its questions.** It hit
  `AskUserQuestion is not available inside subagents`, had four blocking questions
  drafted, and could not put any of them to a human. Three were only answered
  because the parent asked them independently; the fourth (attachment identity)
  stayed open. This is the single most consequential friction in the run and it is
  structural, not incidental.
- **Its own tooling fought it three times**: a `cat` whose exit code was 1, and a
  `ugrep` pattern that failed on `mismatched (`. Cheap, but they are two of three
  failures in the run.
- **One researcher asked three questions the tree had no answer to** (3 empty
  results) — consistent with its finding that no per-repo config surface exists at
  all. An empty result was the answer.

## What worked

- **Two researchers, concurrent, sonnet, ~1 700-character briefs each.** Verified
  concurrent from timestamps (dispatched 9 seconds apart, both finished inside
  3 minutes). Narrow question in, structured finding out.
- **Verifying the agent's claims against the tree before relaying them.** Four of
  its load-bearing claims were checked by the parent and held; one did not (below).
- **Handing the agent a dispatch that named the grounding.** 17 432 characters of
  brief produced a 742-line spec that needed no structural rework — `Rework: none`
  in the facts, and no file it wrote was re-edited by anyone.

## Duplicated context

The clearest waste in the run, and it is all one shape:

| Path | Read by | Opens |
|---|---|---|
| `server/INSIGHTS.md` | 3 participants | 8 |
| `client/INSIGHTS.md` | 3 participants | 4 |
| `server/src/db/schema/{agents,skills,context}.ts` | 3 participants each | 4 each |
| `server/src/vendor/shared/contracts/trace.ts` | 2 participants | 4 |

`server/INSIGHTS.md` is ~49 KB and was opened **eight times across three
participants** so that a handful of entries could be quoted. The session protocol
requires each participant to read the journal of the package it touches, so this is
not disobedience — it is the protocol's cost, paid three times over because nobody
passes the conclusion down. The parent had already read it in full and had the
relevant four entries in hand before the first dispatch.

## What was missed

- **The parent's own INSIGHTS edit was mis-attributed.** `spec-creator` reported
  `server/INSIGHTS.md` as modified by "someone else … between my last report and
  now". It was the parent, and the parent had said so in the message before. The
  agent's handling was still correct (it left the file alone), but the report
  asserted an unknown third party where the transcript held the answer.
- **An entry count was wrong by eight.** Its coverage receipt said
  `INSIGHTS server: ~35 entries`; the real count is 43. Nothing depended on it, and
  that is exactly why it survived — an approximate count in a receipt is unverified
  by construction.
- **The design was described, not seen.** Five mockups existed as images in the
  parent's context; a subagent inherits no images, so every design finding in the
  spec rests on the parent's prose description of them. Anything the description
  omitted is invisible in the spec, and neither side can name what that was.

## What the dispatch got wrong

- **It gave an agent a job whose last step it could not perform.** Interrogating
  ambiguity is `spec-creator`'s remit, and asking a human is how that ends. The
  dispatch should have said upfront: return questions to the parent, do not attempt
  to ask.
- **It sent the grounding as prose instead of as facts already established.** Four
  packages' journals were re-read downstream because the brief cited them rather
  than carrying the conclusions.
- **It left one contract-shaping question (OQ-1) to be discovered at the end** of a
  30-minute dispatch, when the same question was answerable in one sentence before
  the dispatch started.

## Proposed changes

Each names one artifact and the wording. **All four applied 2026-08-19** on the
human's go-ahead; the status line under each records what actually landed, and two
of them landed somewhere other than proposed. The reasons are part of the record.

1. **`.claude/agents/spec-creator.md`** — its frontmatter lists `AskUserQuestion`
   among its tools, and it cannot call it. Either remove it from the tool list, or
   add to the body: *"You cannot ask a human anything — `AskUserQuestion` is
   unavailable inside a subagent. Collect every question you would have asked and
   return them numbered, each with a proposed default, in your final report."*
   The second is better: the capability is what is missing, not the intent.

   **Applied — and harder than proposed.** The file already carried a blockquote
   saying the capability was *under verification* with a fallback, so the honest
   edit was not to add advice but to **close the question**: the tool is now proven
   absent, quoted error and date, so the grant is withdrawn from the frontmatter and
   the section rewritten around returning blocking gaps to the parent. Five further
   places in the same file still assumed the tool worked (the three-route table, the
   asking rules, step 4 of the procedure, the minor-gap row, and its own behavioural
   check) and were made consistent — a half-updated agent file is worse than an
   un-updated one. `.claude/agents/README.md` needed five matching edits: the catalog
   row, the stop-and-ask paragraph ("seven of the eight" → all eight), the
   permissions bullet, the permissions matrix cell, and the Known-limits entry, which
   now records the residual risk rather than the open question. Plus one `Versions`
   row.
2. **`.claude/skills/run-plan/SKILL.md`** and any dispatching skill — add a
   pre-dispatch step: *"Any question whose answer changes a contract, a threshold
   or the shape of the deliverable is asked BEFORE the dispatch, by you. A subagent
   cannot ask."*

   **Applied** to Phase 0, as a step that runs before any dispatch: re-read the
   plan's open questions and assumptions, `rg` for the three marker strings, ask in
   one round anything that changes a contract, a threshold or the shape of the
   deliverable, and explicitly let everything below that bar take the plan's stated
   default. Priced against the budget already in that phase — one round of questions
   versus 70–90k tokens and half an hour per implementer.
3. **`docs/agent-prompts/README.md`** — add a rule for every dispatch template:
   *"When you have already read a package's `INSIGHTS.md`, quote the relevant
   entries in the brief and say the file was read. A dispatch that only cites the
   path buys a second full read of it."* Evidence: 8 opens of a 49 KB journal
   across 3 participants in one run.

   **Applied, but not there.** `docs/agent-prompts/` documents the **product's**
   reviewer prompts — the `agents.system_prompt` rows that `reviewer-core`'s
   `assemblePrompt` assembles — and has nothing to do with dispatching our own
   subagents. Putting a dispatch rule there would have been filed under the wrong
   domain and rotted. It landed in `.claude/agents/README.md` instead, in the
   *Inputs and outputs* section beside the two acceptance checks the parent already
   owes, and it cites the precedent already in the tree:
   `implementation-planner.md` requires quoting an `INSIGHTS.md` entry for a
   requirement's `Source:`, and this generalises that to the brief.
4. **`.claude/agents/README.md`** — state that a subagent inherits no images, so a
   design-bearing task must carry the design as prose or the finding will be
   silently narrower than the mock.

   **Applied, merged with the one above.** `.claude/agents/README.md` already stated
   the image limitation, but only as a `spec-creator`-specific *Known limit*. What
   was missing was the set-level instruction to the **parent**, so it sits with the
   other pre-dispatch rule and adds the part the old wording left out: a prose
   description bounds what the agent can find, and neither side can name what was
   left out of it.
5. **Routed elsewhere, not here** — the two codebase facts this run found (the
   feature is pre-wired in three packages; the clone is a `reset --hard` mirror)
   belong in `server/INSIGHTS.md` and were appended there by `/engineering-insights`
   during the session, not in this report.

## Facts
# Run facts

- transcript: `/Users/krasymyr.tretiak/.claude/projects/-Users-krasymyr-tretiak-Work-dev-digest/68579648-178d-41f5-92d0-6204d2e0b2b4.jsonl`
- session: `68579648-178d-41f5-92d0-6204d2e0b2b4`
- span: 132m29s wall-clock, 3 subagent(s) dispatched
- agent wall-clock summed: 35m33s

## Ledger

`uncached` = input + cache-creation + output — the side that is paid for in full.
`cache read` is the cheap column and is reported separately on purpose: summing
the two produces a headline number that is wrong by an order of magnitude.

| participant | model | turns | uncached | output | thinking | cache create | cache read | tools | wall |
|---|---|---|---|---|---|---|---|---|---|
| main loop | claude-opus-5 | 102 | 1 044 368 | 167 101 | 52 824 | 877 063 | 14 957 806 | 43 | 132m29s |
| spec-creator (a1bad62b) | claude-opus-5 | 116 | 1 327 413 | 100 152 | 30 424 | 1 227 029 | 17 553 330 | 68 | 29m46s |
| ↳ researcher (a27ed66d) | claude-sonnet-5 | 56 | 367 044 | 15 603 | 3 620 | 351 329 | 3 571 937 | 39 | 2m44s |
| ↳ researcher (a3319746) | claude-sonnet-5 | 65 | 359 384 | 16 034 | 3 960 | 343 220 | 4 422 560 | 43 | 3m01s |
| **total** | | 339 | **3 098 209** | 298 890 | 90 828 | 2 798 641 | 40 505 633 | 193 | 132m29s |

## Dispatch order

| # | at | by | agent | model | prompt chars | description |
|---|---|---|---|---|---|---|
| 1 | +7m50s | main loop | spec-creator | claude-opus-5[1m] | 17 432 | Write Project Context spec |
| 2 | +8m42s | spec-creator (a1bad62b) | researcher | claude-sonnet-5 | 1 577 | Server config surfaces research |
| 3 | +8m51s | spec-creator (a1bad62b) | researcher | claude-sonnet-5 | 1 702 | Agent/skill editor attachment research |

Concurrent pairs: spec-creator (a1bad62b) ‖ ↳ researcher (a27ed66d), spec-creator (a1bad62b) ‖ ↳ researcher (a3319746), ↳ researcher (a27ed66d) ‖ ↳ researcher (a3319746)

## Duplicated reading

A path opened by more than one participant. Each row is context paid for twice:
the second reader spent its own tokens on bytes another had already summarised.

| path | readers | opens |
|---|---|---|
| `server/INSIGHTS.md` | 3: spec-creator (a1bad62b), ↳ researcher (a27ed66d), ↳ researcher (a3319746) | 8 |
| `client/INSIGHTS.md` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a27ed66d) | 4 |
| `server/src/vendor/shared/contracts/trace.ts` | 2: main loop, spec-creator (a1bad62b) | 4 |
| `server/src/db/schema/context.ts` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a3319746) | 4 |
| `server/src/db/schema/skills.ts` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a27ed66d) | 4 |
| `server/src/db/schema/agents.ts` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a27ed66d) | 4 |
| `server/src/vendor/shared/contracts/platform.ts` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a3319746) | 4 |
| `client/src/lib/hooks/core.ts` | 3: main loop, spec-creator (a1bad62b), ↳ researcher (a3319746) | 4 |
| `reviewer-core/INSIGHTS.md` | 2: main loop, spec-creator (a1bad62b) | 3 |
| `client/messages/en/context.json` | 2: main loop, spec-creator (a1bad62b) | 3 |
| … 8 more | | |

### Repeated commands

- run by 2 participants (main loop, spec-creator (a1bad62b)): `cat server/INSIGHTS.md`

## Friction

**main loop** — 1 failed tool call(s), 0 empty result(s)
- `Bash` — Exit code 1 == subagent_tokens in main transcript? == 8 total 312 drwxr-xr-x@ 9 krasymyr.tretiak wheel 288 Aug 18 22:35 . drwx------@ 4 krasymyr.tretiak wheel 128 Aug 18 20:33 .. lrwxr-xr-x@ 1 krasymyr.tretiak wheel 157 Aug 18 21:01 a1bad62

**spec-creator (a1bad62b)** — 3 failed tool call(s), 0 empty result(s)
- `Bash` — Exit code 1 import { z } from 'zod'; /** * Run trace. The ENTIRE trace of one run is persisted as a SINGLE * jsonb document in `run_traces` (not per-row). Live events stream via SSE * during the run; the full log is written once on completi
- `AskUserQuestion` — <tool_use_error>Error: No such tool available: AskUserQuestion. AskUserQuestion is not available inside subagents. Complete the task with the tools provided and return findings to the orchestrator.</tool_use_error>
- `Bash` — Exit code 2 ugrep: error: error at position 26 (?m)OQ-1\]\|repo-relative\), `order`\|EC-8 mismatched ( )___/

**↳ researcher (a3319746)** — 0 failed tool call(s), 3 empty result(s)

## Rework

A file one participant wrote and another edited afterwards — the signal that a
dispatch's output needed correcting rather than accepting.

None — no file was written by one participant and re-edited by another.

## Tool histogram

| participant | tools used |
|---|---|
| main loop | Bash 32, Read 3, SendMessage 3, AskUserQuestion 2, Agent 1, ToolSearch 1, Edit 1 |
| spec-creator (a1bad62b) | Bash 40, Edit 18, Read 5, Agent 2, Write 2, AskUserQuestion 1 |
| ↳ researcher (a27ed66d) | Read 25, Bash 14 |
| ↳ researcher (a3319746) | Bash 29, Read 14 |

---

Facts only. Every judgement about them belongs in the retro report.
