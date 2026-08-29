# Retro: Export to CI (SPEC-05) — 2026-08-25

**The spec this retro is about: `specs/export-to-ci.md`, SPEC-05, "Export to CI".**
Named after the spec on purpose — retros are being collected per specification so
several of them can be compared before anything is changed.

| | |
|---|---|
| Spec | **SPEC-05 — Export to CI** (`specs/export-to-ci.md`) |
| Feature | Deploying a tuned review agent onto GitHub Actions: a four-step export wizard, a committed runner, an agent CI tab, and a CI Runs screen |
| Source | **in context** — agent reports and the `usage` block of each task notification |
| Participants | 11 — main + `spec-creator` (4 dispatches, 1 nested `researcher`) + `implementation-planner` + 5 × `implementer` + `plan-verifier` + `architecture-reviewer` + `doc-writer` |
| Uncached tokens | `not measured — in-context retro`. Subagent totals below are `subagent_tokens`, which is **inclusive of a dispatch's own children** and, for a resumed agent, **cumulative across its dispatches** |
| Wall-clock | 5h 00m wall · 3h 38m API |
| Reported cost | $154.93 total, **$145.93 of it `opus`**; `sonnet` $9.00 |
| Outcome | SPEC-05 `implemented`; 3 commits (`58cee95`, `d9e75db`, `d98f515`); 903 server / 468 client / 53 agent-runner tests; verdict `comment` — 0 CRITICAL |

## Where the cost went

| Participant | Model | `subagent_tokens` | Tool uses | Duration |
|---|---|---|---|---|
| `spec-creator` (4 dispatches, cumulative) | opus | **367k** | 83 | ~33m |
| `implementation-planner` | opus | **322k** | 63 | 21m |
| T3 — server `ci` module | opus | **338k** | 103 | 25m |
| T4 — client CI tab + wizard | opus | 272k | 72 | 21m |
| T2 — `agent-runner` package | opus | 269k | 83 | 20m |
| T1 — contracts, schema, ports | opus | 204k | 55 | 12m |
| T5 — CI Runs screen | opus | 186k | 51 | 10m |
| `plan-verifier` | sonnet | 320k | 77 | 9.5m |
| `architecture-reviewer` | sonnet | 162k | 45 | 4.6m |
| `doc-writer` | sonnet | 160k | 59 | 6.2m |

Roughly 1.96M subagent tokens on `opus` against 642k on `sonnet`.

**The ratio that matters: the three `sonnet` participants carried about a quarter of the
subagent token volume for 6% of the bill — and carried it well.** `plan-verifier` refused to
mark four requirements `yes` on the parent's own green figures and named the exact command
that would settle them; `architecture-reviewer` checked the two `vendor/shared` copies
byte-for-byte on their added lines, which is stricter than the parent's drift-count check.
That is evidence the tier was set too high elsewhere, not that these three got lucky.

The parent's own output was 849k `opus` output tokens, and a known chunk of it is waste —
see *What was missed*.

## What was hard

**1. An acceptance criterion demanded more distinct outcomes than its input can produce, and
only a written test found it.** AC-24 requires four *distinct* named reasons across four
unreadable-artifact cases. An expired artifact and a cancelled run that uploaded nothing
arrive at the decoder as the **identical `null` bytes**, so any function of those bytes yields
at most three. The first run of `test/ci-ingest.test.ts` failed on exactly that — three
distinct where four were asserted. Every gate was green and the criterion reads flawlessly;
the impossibility is only visible at execution.

This is the most expensive failure class in spec-driven work: the spec passes review, the plan
plans it, the implementer builds it, and the contradiction surfaces at the far end.

*Resolution, for the record:* `modules/ci/artifact.ts` stays a pure function of bytes with the
spec's four reasons, and `reasonForMissingArtifact(reason, conclusion)` above it refines
`artifact_missing` to a fifth reason from the workflow run's own `conclusion` — the one source
that can tell the two apart.

**2. The design mocks never reached a single agent — and that was the parent's mistake, not a
platform limit.** `spec-creator` reported *"Design material: relayed as text in the dispatch; no
image or file reachable … derived from the dispatch's descriptions of the five mocks."* That
report is accurate about what it was given and was **misread by the parent as impossibility**.

The images existed as real PNG files the whole time — the harness writes each dropped image to
disk and prints its path in the message itself
(`/var/folders/.../emdash-drop-<uuid>-image.png`, twelve files, 200–540 KB, still present at
retro time). `spec-creator` holds `Read`, and `Read` renders an image. An image **block** cannot
travel through the `Agent` tool's text-only `prompt`; the **file** can, and nobody passed the
paths. The agent then searched the *repository* for design assets, correctly found none, and
said so.

So the spec was written from the parent's paraphrase of the screenshots, and the paraphrase
flattened one detail — the CI tab's
installation rows show the **latest run's status and age**, not the install date.

Cost: an AC-48 amendment **after** the plan was already written, plus edits in five places of
the plan, plus a re-dispatch of `spec-creator`. Also worth recording: **no mock for the CI Runs
screen was ever supplied**, so that screen's column set was built from `ci.json`'s existing
copy against a requirements list that disagrees with it — recorded in the plan as an open
conflict rather than resolved.

**3. Five parallel implementers over shared cross-package contracts.** Two facts had to be
relayed by the parent mid-flight: the runner's CLI shape (`--post-as`) from T2 to T3, and the
client's request shape from T4 to T3. Both are the class where **both sides pass every test and
the feature is broken in production** — a `post_as: none` that posts a review anyway is a green
build in both packages.

## What worked

**The `INSIGHTS` digest in the brief.** The parent read all three journals once at Phase 0 and
quoted the relevant entries, with dates, into each implementer's brief. **None of the five
implementers opened a journal** — all five said so in their receipts. That is ~100 KB of
journal not paid for five more times.

**`sonnet` on the read-only checks.** See *Where the cost went*.

**The parent re-running every Done-condition itself (Phase 2), before dispatching a reviewer.**
It caught three gate defects — Done-conditions written as whole-file greps that flag correct
code — before a reviewer dispatch was spent on a diff that was about to change.

**Naming, in the dispatch, what the verifier must NOT confirm on the parent's word.** The three
items were listed explicitly (the never-executed `.it.test.ts`, `DDG-UI-001`, the unapplied
migration). The verifier honoured all three. A `sonnet` verifier's documented failure mode is a
fluent summary that reads like verification; telling it where the parent's own evidence stops
is what prevented that.

## Duplicated context

**The digest worked only inside `/run-plan`.** Everywhere else, participants read the journals
in full:

| Participant | Model | Read |
|---|---|---|
| `spec-creator` | opus | all three journals in full |
| `implementation-planner` | opus | all three in full — its report: *"INSIGHTS server: 1019 lines, read in full"* |
| `plan-verifier` | sonnet | all three in full |
| `architecture-reviewer` | sonnet | all three in full |
| `doc-writer` | sonnet | all three in full |

Five full reads of ~1,800 lines, two of them at `opus` rates, of a file the parent had already
read and summarised.

**And the planner paid for those bytes twice.** The plan's `## Constraints` section is
`INSIGHTS` entries quoted verbatim — deliberately, so implementers would not re-read them. It
worked, but the planner read ~30k tokens of journal on input and re-emitted them on output.
Exact duplicated-path measurement: `not measured — run deep`.

## What was missed

**`implementation-planner` has no `Write` tool.** Its own report: *"I could not write the plan
to disk. I have no `Write` or `Edit` tool … please persist it **verbatim**."* The parent
retyped **792 lines** at `opus` **output** rates. Pure waste, and trivially fixable —
`.claude/agents/implementation-planner.md:6` reads `tools: Read, Grep, Glob, Bash`.

**Docker was withheld from every implementer and then used by the parent in four seconds.**
`server/test/ci-runs-order.it.test.ts` was written by T3 and never executed, which forced
`plan-verifier` into 3 `partial` + 1 `not checked` and made it spend output describing what
would settle them. The parent then ran it — 8 tests, 0 skips — and closed all four. That run
also proved migration `0022` **applies** to a fresh database, which nothing else had shown.

**`spec-creator` cannot call `AskUserQuestion`**, so its four blocking questions became a
round-trip through the parent. Working as designed, but it means the questions want gathering
*before* the dispatch, not discovered after it.

**Four `spec-creator` dispatches instead of one** (263k → 308k → 341k → 367k cumulative),
because requirements arrived in pieces: the initial brief, then "keep it simple", then four
answered questions, then two criteria decisions, then the mock re-check.

## What the dispatch got wrong

- **Model tier on the two most mechanical tasks.** T1 (contracts, schema, two port methods —
  204k) and T5 (a route, a view, one nav entry — 186k) were the smallest and the most fully
  specified, and both ran `opus`. The three `sonnet` participants in this same run performed
  rigorously on harder judgement work.
- **A blanket Docker prohibition** where a per-task rule was wanted.
- **The parent's paraphrase substituted for design material** — while the files sat on disk with
  their paths printed in the very messages that carried them — and nothing checked the substitute
  against the originals until after the plan existed.
- Minor: the plan's header recorded a stale base (`a4352f5` vs `11e71b3`), and T3's report
  claimed 9 tests in a file that has 8.

## Proposed changes — NOT applied

Recorded for a later pass, once retros from other specs are in. **Nothing in this list was
edited.**

| # | Finding | Lands in | Change |
|---|---|---|---|
| 1 | Planner cannot write its own plan; parent retyped 792 lines at opus output rates | `.claude/agents/implementation-planner.md:6` | add `Write`, scoped to `.claude/.plans/<feature>/` |
| 2 | Five full journal reads outside `/run-plan`'s Phase 0 digest | `.claude/skills/run-plan/SKILL.md` | carry the Phase 0 digest into Phase 3 and Phase 5, not only into the implementer briefs |
| 3 | The parent paraphrased the mocks instead of passing their paths; AC-48 was wrong as a result | `.claude/agents/spec-creator.md` | store mocks at `docs/design/<feature>/` (a temp dir is cleaned by the OS and invisible to later sessions), and have the dispatch **name the paths and instruct the agent to `Read` each one before writing a criterion** — plus name the screens that have **no** mock, so their absence is recorded rather than invented. A folder alone is not enough: the agent *can* `Glob` for it, but relying on it to think of looking is what failed here |
| 4 | Two most mechanical implementer tasks ran `opus` | `docs/agent-prompts/choosing-a-model.md` | a fully-specified mechanical task (contract additions, a route + a view) may run `sonnet`; cite this run's `sonnet` verifier and boundary reviewer as the evidence |
| 5 | Blanket Docker ban left four requirements unverified until the parent spent 4 seconds | `.claude/skills/run-plan/SKILL.md` | "Docker is authorised for a task that owns an `.it.test.ts`" instead of a global prohibition |
| 6 | Four `spec-creator` dispatches | `.claude/skills/` or the dispatch habit | settle the scope directive and the design questions before the first dispatch, since the agent cannot ask |

Estimated effect of 1, 2 and 4 together: **20–30% of this run's cost**, without removing a
single check. Estimate, not a measurement.

## Facts

`not measured — in-context retro.` A deep pass
(`python3 .claude/skills/workflow-retro/scripts/collect.py`) would add: per-participant
uncached vs cache-read, the duplicated-reading table (which paths two agents each opened in
full), per-participant tool histograms and failed-call lists, and achieved concurrency measured
from timestamps. The transcripts for this session are still on disk if that is wanted before
the next spec is built.
