# Retro: Multi-Agent Review, spec through verdict — 2026-08-25

| | |
|---|---|
| Session | `a4a08885-d493-477d-a64f-c70b8fbb4930` |
| Source | **deep** (transcripts measured with `scripts/collect.py`) |
| Participants | 27 (main + 26 subagents, 2 nested) |
| Uncached tokens | **15 525 884** — of which 13 473 342 (87%) cache-creation, 2 046 675 output |
| Cache reads | 573 814 257 (reported separately; not part of the headline) |
| Wall-clock | 364m, 350m summed across agents |
| Outcome | SPEC-06 `implemented`, 105 AC. 126 files, +16 921 / −206. Server 842 → 933 tests, client 455 → 491. `depcruise` unchanged at 22 warnings while the tree grew 245 → 255 modules. |

## Where the cost went

| Participant | Uncached | Share | Model |
|---|---|---|---|
| 18 × `implementer` | 7 159 155 | 46.1% | opus |
| **main loop** | **2 761 996** | **17.8%** | opus |
| `spec-creator` #1 | 1 214 838 | 7.8% | opus |
| `plan-verifier` | 867 499 | 5.6% | sonnet |
| `architecture-reviewer` | 847 204 | 5.5% | sonnet |
| `implementation-planner` | 834 634 | 5.4% | opus |
| `doc-writer` | 771 274 | 5.0% | sonnet |
| 2 × `researcher` (nested) | 712 341 | 4.6% | sonnet |
| `spec-creator` #2 (amendment) | 356 943 | 2.3% | opus |

Two findings the raw totals hide.

**Cache creation is the bill.** 87% of uncached tokens were cache *writes*, not
generation. So the cost of a dispatch tracks the number of turns that re-write a
growing prompt prefix, far more than it tracks prompt length or answer length. A
27-participant run with 2 938 turns pays that 2 938 times.

**Tier is the whole lever.** The three `sonnet` roles plus the two nested
`researcher`s did **20.6% of the uncached work for 4.6% of the spend**. That is the
tier multiple applied to the cache-creation column — the dominant one. No prompt
trimming available anywhere in this run comes close to it.

## What was hard

Very little, and that is itself a finding — friction was not where the money went.
Two failed tool calls in the main loop (a `cd` that persisted between calls; an
`AskUserQuestion` payload rejected for Cyrillic JSON escaping), one or two in a
handful of subagents, five empty results in `plan-verifier`.

The one visible inefficiency: four separate implementers each ran the identical
`sed -n '411,700p' .claude/.plans/multi-agent-review/plan.md`, hunting the same
shared-constraints block in a 947-line file.

## What worked

- **`sonnet` for verification and documentation.** `plan-verifier` reported "I found
  nothing you hadn't already logged" and its arithmetic checked out (44+2 = 46
  requirements, 14+2 = 16 Done-conditions). The tier was sufficient, not merely cheap.
- **Both reviewers dispatched in one message**, read-only and non-overlapping: 8m36s
  and 8m18s concurrently instead of ~17m serially. Safe because the parent's own
  Done-condition sweep had already gone green, so the diff could not move underneath
  them.
- **Three-way wave concurrency actually achieved**, confirmed by the collector's
  concurrent-pairs list for waves 1–4 and 6.
- **Mutation verification by implementers** — the highest-value-per-token thing in the
  run. Four independent agents each found a gate that was green for the wrong reason
  (a `waitFor` satisfied by a loading state; a sort passing with tiebreakers deleted; a
  rate-limit test passing with the limiter unregistered; a test file green under
  `vitest` and red under `tsc`). None was visible by reading.

## Duplicated reading

| Path | Readers | Opens |
|---|---|---|
| `.claude/.plans/multi-agent-review/plan.md` | 18 | **122** |
| `server/INSIGHTS.md` | 12 | **84** |
| `client/INSIGHTS.md` | 12 | 75 |
| `specs/multi-agent-review.md` | 10 | 65 |

### The same four documents were read 346 times

This is the largest recoverable waste in the run, and unlike the screenshot problem it is
not one mistake — it is a structural property of handoff-by-file that nobody had measured
before.

#### The journals: a fix that was applied and still failed

The [2026-08-18 retro](./2026-08-18-project-context-spec.md) had already found this, at
one third the scale: 8 opens of `server/INSIGHTS.md` across 3 participants. Its
recommendation was to carry the relevant entries in the dispatch instead of citing the
path.

**That recommendation was followed completely.** The plan's `## Constraints` section
quotes ~35 journal entries **verbatim, with their dates**. Every one of the 18 implementer
briefs repeated the entries bearing on that task's paths, under a heading reading
`## INSIGHTS — read for you at Phase 0, take as read, do not open the journals`.

The journals were opened **159 times by 12 participants** anyway.

**Why, and it is not disobedience.** Root `CLAUDE.md`'s session protocol says:

> **Before answering** — not merely before editing — read the relevant package's
> `INSIGHTS.md` **in full** and emit a one-line receipt per file… No answer about a
> package's code ships before its receipt.

The dispatch was instructing agents to break a standing repository rule. The rule won,
which is the correct outcome — an agent that lets a prompt override `CLAUDE.md` is a worse
agent. Several reports show the conflict being resolved consciously: T16's says *"the two
floating-promise entries the trigger rests on were referenced by date rather than carried,
so I opened the journal"* — a precise, defensible reason.

So the lesson supersedes the 2026-08-18 one on sufficiency: **carrying the entries is
necessary and not sufficient. The exemption has to be written into the protocol itself.**
A dispatch cannot buy its way out of a rule; only the rule can.

#### The plan: 122 opens of 947 lines

| Path | Readers | Opens | Size |
|---|---|---|---|
| `.claude/.plans/multi-agent-review/plan.md` | 18 | **122** | 947 lines |
| `server/INSIGHTS.md` | 12 | **84** | 1 019 lines |
| `client/INSIGHTS.md` | 12 | **75** | 662 lines |
| `specs/multi-agent-review.md` | 10 | **65** | 1 486 lines |

The plan is *meant* to be read — it is the handoff artifact, and every implementer is told
to read it in full. That is the design working. What is not working is the ratio: each
implementer needs its own task section (~40 lines) plus the shared constraints (~90 lines),
and reads 947 to get them.

The collector caught the symptom directly. **Four separate implementers ran the byte-
identical command**:

```
sed -n '411,700p' .claude/.plans/multi-agent-review/plan.md
```

and three more ran `sed -n '412,700p'` and `sed -n '411,560p'` over the same block. Seven
agents independently rediscovered where the shared constraints live and paged them in one
range at a time. That is not one agent being wasteful; it is seven agents solving the same
navigation problem the artifact handed them.

#### What it is worth fixing

The three levers, in order of size:

1. **Per-task extracts.** Emit `tasks/T<n>.md` beside `plan.md` — that task's section plus
   the shared constraints, ~150 lines instead of 947. `plan.md` stays whole as the record
   and as `plan-verifier`'s source, so nothing is lost. Removes most of the 122 opens and
   all seven duplicate `sed` ranges.
2. **The protocol exemption** (above). Removes most of 159 journal opens.
3. **The spec.** 65 opens of 1 486 lines. Most implementers need one or two `AC-n`, and the
   plan already cites them by number in each task's `Satisfies` line. Telling implementers
   *"the plan's requirement text is authoritative; open the spec only to check an `AC-n` the
   plan quotes ambiguously"* would cut most of it — but this is the weakest of the three,
   because reading the criterion you are building against is rarely waste.

## What was missed

### The screenshots never reached the agent that needed them most

This is the run's most expensive single mistake, and the cheapest one to have avoided.

**The mechanism.** The user supplied six screenshots of the feature in chat. The parent
saw them. `spec-creator` did not — **a subagent does not inherit images from the parent's
conversation**, and nothing in the dispatch said so. `spec-creator` said so itself, in its
own report: *"Design material: supplied as the parent's textual description of five
screenshots. No image files are reachable in the repo… so the analysis is against the
description, not the pixels."* It flagged the gap honestly and worked anyway, because a
subagent has no channel to ask.

So the spec was written against a **prose paraphrase of a design**, which is a third
source of truth sitting between the images and the code. It diverged, as a third source
always does.

**What it produced.** The spec's AC-29 required a disagreement group to be emitted only
when **two or more agents flagged** a code location. Comparing that rule to the actual
Columns screen afterwards:

| Group on the screen | Agents that flagged it |
|---|---|
| `src/middleware/ratelimit.ts:28` — "Magic number 3600" | **one** (Junior Mentor) |
| `src/middleware/ratelimit.ts:52` — "429 response shape" | **one** (Customer-Facing) |

Under the shipped rule, the design's own reference screen would have rendered **zero
groups**. The feature's headline block would have been empty on the exact data it was
designed against.

Three further divergences came out of the same comparison: the group's title is a
synthesised label (`429 response shape` appears in no finding), the pull-request picker
lists open pull requests only (five entries against a badge reading seven), and every
finding row carries a category tag.

**The rule was already written down.** `Conflict`'s doc-comment in
`server/src/vendor/shared/contracts/observability.ts` states the correct entry condition
in its first sentence. The spec cited that symbol for its *field list* and did not read
the sentence above it. So the failure was not "nobody knew" — it was "the one participant
who could have checked was looking at prose instead of at the design, and skimmed the
contract".

**What it cost.**

| Item | Uncached | Model |
|---|---|---|
| `spec-creator` re-run to amend SPEC-06 | 356 943 | opus |
| The parent's manual re-sync of `plan.md` | part of the main loop's 2.76M | opus |
| Fix-round item F-5 — the missing `configure.noOpenPulls` key | part of fix round 1 | opus |
| Fix-round item F-6 — a grep gate mis-scoped during the same sync | part of fix round 1 | opus |

F-5 and F-6 deserve naming as a second-order cost: they exist because the parent changed a
requirement during the re-sync and did not propagate it to every task that depended on it.
An amendment mid-flight is not just the amendment — it is every downstream artifact that
quietly still says the old thing.

**The fix costs nothing.** The `Read` tool accepts image files. Writing the six screens to
`docs/design/multi-agent-review/*.png` and putting the **paths** in the dispatch would have
let `spec-creator` look at the pixels. One `Write` per image, one line per path.

**The general rule.** Any artifact the parent can see and a subagent cannot — an image, a
pasted log, a terminal scrollback, a diff shown in chat — has to reach the subagent as a
**file path**, not as a paraphrase. Paraphrasing is not a degraded copy; it is a new
document that will disagree with the original, and the disagreement surfaces after the
work is built on it.

## What the dispatch got wrong

**Model tier is hard-coded in the skill, not chosen per task.** `run-plan` fixes
`implementer = opus` for every task. The tasks were not homogeneous: T2 (schema edit
plus a generated migration) was 232 140 uncached over 37 turns in 4m22s, the cheapest and
most mechanical of the eighteen, and its Done-condition is the shape of `git status`.

The tempting generalisation is wrong and worth recording: **the other "mechanical" tasks
were not mechanical.** T5 (message keys plus a nav entry) found that the sidebar's
ordering invariant is asserted in an unrelated feature's test file; T6 (a file move plus
three imports) found that `vi.mock` specifiers written at route depth resolve silently to
nothing after a relocation. Those are exactly the findings a weaker tier would have
missed. The recommendation is therefore not "downgrade the simple ones" but "make the
model a per-task field the planner sets with a reason".

**The parent's own turn count is the second-largest line item and the least examined.**
2.76M uncached over 398 turns. Every subagent report returns in full and the parent then
re-states it; with 26 dispatches that is structural, but the *degree* was the parent's
choice — per-wave bookkeeping was spread across several turns where one would have done.

## Every problem the run hit

The two above are the expensive ones. These are the rest, in the order they appeared, so
the next run recognises them rather than rediscovering them. "Caught by" matters as much
as the problem: it says which safety net actually earned its place.

### Stopped the run before anything was dispatched

| # | Problem | Caught by | Cost if it had slipped |
|---|---|---|---|
| 1 | **No `node_modules` in any of the five packages.** Every Done-condition in the plan invokes `./node_modules/.bin/*`. Not one gate could have run. | Phase 0 validation | 16 implementer dispatches, ~1.2M opus tokens, every report reading `gate did not run`, and a diff nobody had verified |
| 2 | **The spec was `Status: draft`.** `/run-plan` requires an explicit human decision to build from a draft. | Phase 0 validation | Building against criteria nobody had agreed to; `doc-writer` unable to flip the status at the end |

Both were cleared by a human decision in under two minutes. Phase 0 paid for the entire
run in its first thirty seconds — this is the strongest argument in the retro for never
skipping it.

### Found during the build, by the work itself

| # | Problem | Caught by | Note |
|---|---|---|---|
| 3 | **The executor ran agents sequentially**, contradicting the design's "parallel fan-out", the header copy, and the whole premise of a time estimate that takes the *maximum* of the agents' durations. | `spec-creator`, reading the code rather than the description | The design had been wrong about the product for as long as the screen existed |
| 4 | **`reviews.run_id` has an index but no unique constraint**, so the natural `leftJoin` from `agent_runs` multiplies one run into several rows and renders one agent as two columns. | T7, before writing the join | Would have shipped as a visual duplicate nobody could explain |
| 5 | **Fastify hands a body-less request to zod as `null`, not `undefined`**, so a `.default({})` never fires and an existing tolerated route starts returning 422. | T10, by probing both cases before choosing | Would have broken `POST /pulls/:id/review` for its existing callers |
| 6 | **`@fastify/rate-limit` is not registered under `NODE_ENV=test`**, so a rate-limit assertion passes with the limiter deleted. | T10, by mutation | A permanently vacuous test |
| 7 | **A required port method breaks every hand-built `Store` fake**, visible only to `tsc -p tsconfig.eslint.json` — main typecheck rc=0, eslint clean, `vitest` fully green with four errors present. | Fix round 2, by running the eslint-project typecheck and diffing the count | A +4 baseline regression handed to the next feature |
| 8 | **The multi-run create path cannot be made atomic.** A transaction would put `void executeRuns(...)` inside it, so background work would read `agent_runs` on a different pooled connection against uncommitted rows. | Fix round 1, returning `blocked` with four reasons | The wrong fix, shipped confidently |

Items 4–7 were all found by **mutation** — breaking the thing a test should catch and
checking for red. Four independent agents did this without being told to for items 4–6.
It is the highest-value-per-token behaviour in the run.

### Defects the parent introduced

These are mine, and they are the pattern worth watching: **all four are a mid-flight
change that was not propagated to every artifact that depended on it.**

| # | Problem | How it surfaced |
|---|---|---|
| 9 | **T1's Done-condition expected "five pre-existing differing files"; four appear** — `adapters.ts` sits outside the `contracts/` directory the command diffs, so it can never show up there. | T1 reported it; harmless, but it would have failed `plan-verifier` |
| 10 | **T13's `EventSource` grep gate is mis-scoped.** It greps a whole directory for a string the *same brief* mandates in a test stub. Its green output could never distinguish "the view opens no `EventSource`" from "the required stub is missing". | T13 refused to rename the stub to satisfy it, and supplied two correctly scoped substitutes |
| 11 | **F-5: AC-105 arrived in the design-review sync and its message key never did.** T5 shipped nine `configure.*` keys from a list written before the amendment; T12 then had no string for the state the amendment created. | T12, which correctly reported rather than writing a literal |
| 12 | **Two plan clauses collided on one line** — AC-87 requires the picker's strings to come from the `runs` namespace, and the merged-PR warning it was told to preserve lived in `prReview`. | T11, which resolved it and said so |

The lesson is not "be more careful". It is that **an amendment mid-flight is not the
amendment — it is every downstream artifact that still quietly says the old thing**, and
nothing in the loop re-validates the plan against the spec after the spec changes.

### Found by review, after the build

| # | Problem | Caught by |
|---|---|---|
| 13 | **AC-68 could not be met**: `AgentColumn` carries no `error` field, so a failed run's reason never reaches the client — the repository selected `agent_runs.error` and the mapper dropped it. The spec contradicted itself, listing the contract as "used unchanged". | T13, escalating rather than widening a contract it may not touch |
| 14 | **A two-phase write with no transaction** in `createMultiAgentRun`. | `architecture-reviewer` |
| 15 | **The same duration formatter in two route subtrees** — the promotion trigger `DDG-UI-002` describes. | `architecture-reviewer` |
| 16 | **Stale references to the trace drawer's old path** in a spec and a journal, after the relocation. | T6, by a read-only grep of files it could not edit |

### Housekeeping problems worth naming

| # | Problem | Note |
|---|---|---|
| 17 | **A leaked tool artifact (`</content></invoke>`) sat inside the spec's `## History`**, written by an earlier `spec-creator` pass. The parent saw it in a `tail` and did not flag it. | Found and removed by `doc-writer`. Renders as inert text; invisible on a normal read |
| 18 | **`server/package.json`'s `build` does not copy `src/prompts` → `dist/prompts`**, so all six prompt templates are absent from a compiled build. Pre-existing; this feature added a seventh consumer. | Escalated, not fixed — it is a deployment decision |
| 19 | **Cross-sibling test noise at wave barriers.** T5's first run showed five failures in a file T6 was mid-move on; T6 then reported `partial` over a test T5 had already fixed. | Both agents behaved correctly — neither touched the other's files — and the barrier re-run settled it. The cost is one extra suite run per wave |
| 20 | **The architecture review went stale.** Two fix rounds and the journal appends landed after it, so `/pr-self-review` could not cite it and had to re-derive the boundary pass. | Structural: reviewers run before fixes, and fixes invalidate them |

---

## How to cut the cost

Ordered by size. The first three are worth more than everything else combined.

### 1 — Choose the model per task, not per skill · saves the most

`run-plan` hard-codes `implementer = opus`. Measured this run: the three `sonnet` roles
plus two nested `researcher`s did **20.6% of the uncached work for 4.6% of the spend**.
Because 87% of the bill is cache creation, the tier multiplier applies to almost the whole
invoice, not just to the generated part.

**But do not reach for the obvious version of this.** The tasks that *looked* mechanical
were not: T5 (message keys plus a nav entry) found that the sidebar's ordering invariant is
asserted in an unrelated feature's test file; T6 (a file move plus three imports) found
that `vi.mock` specifiers written at route depth resolve silently to nothing after a
relocation. Those are exactly what a weaker tier misses.

The defensible version: **a `Model:` field per task, set by the planner with a written
reason**, starting with tasks whose Done-condition is purely mechanical. T2 (schema edit
plus a generated migration, verified by the shape of `git status`) is the clearest
candidate — it was already the cheapest and fastest of the eighteen at 232k / 37 turns /
4m22s.

### 2 — Cut what every dispatch has to read · saves ~0.5–1M uncached

Per-task extracts (`tasks/T<n>.md`, ~150 lines instead of 947) plus the protocol exemption
for journals carried in the brief. Between them these address 122 + 159 = **281 of the
run's 346 duplicated opens** of the four hot documents.

### 3 — Reduce the parent's turn count · the second-largest line item

The main loop was **2.76M uncached, 17.8% of the run, over 398 turns**. At ~4.8k
cache-create per turn, the turn count *is* the cost. Every subagent report returns in full
and the parent then re-states it; with 26 dispatches that is structural in kind but not in
degree. Batch the per-wave bookkeeping — save every report of a wave in one call, fold the
ledger update into the next dispatch's turn, and never re-narrate a report the reader can
open.

### 4 — Give subagents the artifacts, not descriptions of them · saves a re-run

Costed at 357k opus plus two fix-round items this run. One `Write` per image and a path in
the dispatch.

### 5 — Re-validate the plan against the spec after any amendment · saves a fix round

Four of this run's defects (items 9–12) are one failure mode: a mid-flight change not
propagated. A cheap mechanical check — every `AC-n` the amended spec added appears in some
task's `Satisfies`, and every message key a task's Acceptance names exists in the
catalogue — would have caught F-5 before T12 hit it.

### What is *not* worth cutting

- **Phase 0.** Thirty seconds of validation caught two problems that would each have
  wasted the entire run.
- **The `sonnet` verification pair.** `plan-verifier` re-ran every item it did not mark
  `yes`, confirmed the parent's arithmetic, and reported finding nothing new — which is
  what a verification pass looks like when the work upstream was sound, not a sign it was
  redundant.
- **Mutation verification by implementers.** Four "green for the wrong reason" gates found
  for almost nothing.
- **The parent re-running every Done-condition itself.** It is a handful of `Bash` calls
  and it is what made it safe to run both reviewers in parallel.

## Proposed changes

Wording proposed, nothing applied — each of these changes every future run.

**1 — root `CLAUDE.md`, Session protocol.** Resolve the conflict that produced 159
journal opens:

> Exception: when a dispatch carries an `## INSIGHTS, read for you` block quoting entries
> verbatim with their dates, the receipt is the line `taken as read from the dispatch`,
> and the journal is not opened. Opening it anyway is right only when that block carries
> no entry for a package you are about to edit — say so in the receipt when you do.

**2 — `implementation-planner`.** Emit `tasks/T<n>.md` beside `plan.md`: that task's
section plus the shared constraints block. The implementer reads ~150 lines rather than
947; `plan.md` remains the record and the verifier's source.

**3 — `implementation-planner` + `run-plan`.** Add a `Model:` field per task, with a
one-line reason, and have `run-plan` honour it instead of the blanket `opus`.

**4 — `docs/agent-prompts/`.**

> Subagents do **not** inherit images from the chat. A design, screenshot or mock an
> agent must work against is saved to a file and the dispatch passes the **path** —
> `Read` reads images. A prose description of a design is a third source of truth and it
> will diverge from the other two.

**5 — `run-plan` SKILL.md, Phase 1.** Batch the per-wave bookkeeping: save every report
of a wave in one call, update the ledger in the same call as the next dispatch, and do
not re-narrate a report the reader can open.

## Facts

`collect.py` output is reproduced verbatim in the session record; the ledger, dispatch
order, duplicated-reading and friction tables quoted above are unedited excerpts from it.
Re-run with `python3 .claude/skills/workflow-retro/scripts/collect.py --session a4a08885-d493-477d-a64f-c70b8fbb4930`.
