# run-plan — why this shape

Provenance and rationale for [`SKILL.md`](SKILL.md). Authored in this repo; no
upstream, so no entry in `../../../skills-lock.json`.

Named for its input, not its verb. An earlier draft was `/implement`, and the name
was wrong for one concrete reason: a skill called `implement` gets triggered by
"implement feature X" when no plan exists, and every such trigger ends in a Phase 0
refusal. `run-plan` cannot be invoked by accident, and "implement the plan at
`<path>`" is kept as a trigger phrase so nothing is lost.

## What it is

A runner for the **lower half** of the chain in
[`../../agents/README.md`](../../agents/README.md): plan → diff → verified →
reviewed → documented → verdict. It dispatches five agents and invokes two skills,
and it writes nothing outside `.claude/.plans/<feature>/`.

## Why it starts at the plan

The first version of this skill (`sdd-run`, 2026-08-18, superseded by this one) ran
the whole chain from a change request. It was wrong in one specific way: it hid the
two places where a human is the point.

- **`spec-creator` ends in an approval.** `Status: draft` → `approved` means a
  person agreed to the acceptance criteria. A runner that dispatches the spec writer
  and then keeps going has made that approval a formality, which is the exact failure
  `spec-creator` is built to prevent.
- **`implementation-planner` ends in a question.** `multi-agent` and `single-agent`
  produce genuinely different plans, and the planner has no channel to a person.
- **Both are expensive on their own.** The planner's measured floor is 130 264
  tokens for a *trivial* single-package plan (2026-08-10). Folded into a longer run,
  that cost stops being visible — and a cost nobody sees is a cost nobody decides
  about.

Run by hand, each of those is a deliberate step with a readable output. So the line
is drawn at the plan, and the plan arrives as a **file** — which is also what makes
the handoff verbatim rather than paraphrased.

## What is switched off, and what each cut costs

Recorded here so that a later reader can tell a decision from an omission.

| Cut | Saves | Costs |
|---|---|---|
| `test-writer` not dispatched | one `opus` agent run per feature | `DDG-TEST-003` is unenforced by any agent. The obligation does not disappear: `/pr-self-review` raises a missing seam test at Phase 7. Mitigation is a plan whose `## Tests` rows carry `Owner: implementer` — the implementer already holds `Write` and `react-testing-library`, so those tests are free |
| `architecture-reviewer` on `sonnet` | most of a review dispatch | judgement about layering gets weaker. The countermeasure is structural and already in that agent: a finding must cite a line inside a changed hunk, quote the code and name the rule, and a CRITICAL without a `failure_scenario` is downgraded. **The signal to revert is rising false positives** — findings that cite a real line and a real rule but describe a violation that is not there |
| `plan-verifier` on `sonnet` | most of a second review dispatch | raises the risk of its one documented failure — a fluent summary that reads like verification. The countermeasure is arithmetic the parent checks in seconds: counts add up, one row per item in the plan's order, every `yes` carries a locator or command output |
| `spec-creator`, `implementation-planner` outside the skill | nothing — they still run | one more manual step each, on purpose |

## Two design choices worth not re-litigating

**The parent re-runs every Done-condition before dispatching a reviewer (Phase 2).**
It costs a handful of `Bash` calls and it buys two things: a red sweep means the diff
is about to change, so a reviewer dispatch would review code that will not survive —
skip straight to remediation; and a green sweep is what makes it safe to run both
reviewers **in parallel**. It does **not** replace `plan-verifier`, which still checks
every `R<n>` and every `T<n>` on its own evidence.

**What the verifier no longer does is re-run the commands that were already green**
(changed 2026-08-21). Those had run twice — once in the implementer, once in this
sweep — and a third full `tsc` + `vitest` + `depcruise` pass sat on the critical path
to confirm what two independent runs already agreed on. The verifier now re-runs,
verbatim, the Done-condition of **every item it would mark anything other than `yes`**,
and reports which commands it ran and which it took from the sweep. Two independent
runs is still the point exactly where the two sides might disagree; it was never worth
paying for where they do not. This is the rule [remediation.md](remediation.md) already
applied in the fix loop — *re-verify the items that were not `yes`, not all of them* —
and the two are now consistent.

**The fix loop has two exits, not one.** `--max-fix` (default 2) bounds honest
attempts. *No progress* — a round after which the re-review reports the same ids,
still present — stops earlier and means something different: the approach was wrong,
not that three tries were made. Which exit fired is recorded, because the human
reads those two outcomes differently. See [remediation.md](remediation.md).

## Compared with two reference designs

Two independent implementations of the same idea were reviewed on 2026-08-18 — an
`sdd-run` that covered the whole chain, and a `run-plan` that draws the line at the
plan exactly where this one does. The convergence with the second is high and worth
recording, because it is evidence the line is in the right place: starting at the
plan, `spec-creator` and `implementation-planner` run manually, the orchestrator
never implementing or reviewing itself, `implementer ×N` by DAG over non-overlapping
Owned paths, `architecture-reviewer` ‖ `plan-verifier` in parallel and both on
`sonnet`, a bounded fix loop that re-reviews only changed files, and never pushing.
Eight decisions, reached separately.

Adopted from them: a configurable fix limit, the *no progress* exit condition,
`README.md` beside `SKILL.md`, the `key:value` argument style (`plan:`, `mode:`,
`max-fix:`), explicit trigger phrases, the plan-parsing caveat, and the
`/pr-self-review` ↔ `architecture-reviewer` dedup. Deliberately not adopted:

- **`docs/plans/<feature>.md` as the plan's home.** That directory does not exist
  here and `.claude/agents/spec-creator.md:161` says so explicitly. More importantly
  it is a **tracked** path, so every plan and every fix plan would move the
  `diff-hash.sh` fingerprint and make the `/pr-self-review` verdict stale.
  `.claude/.plans/` is gitignored for exactly that reason.
- **`critical/high` and `missing/partial` as severities.** This repo's scales are
  `CRITICAL` / `WARNING` / `SUGGESTION` and
  `yes` / `yes (differently)` / `partial` / `no` / `not checked`. A second scale is
  the fastest way to make an artefact untrusted (`../../agents/README.md`).
- **Handing a raw findings list to an implementer.** It refuses one, correctly. The
  triage-and-fix-plan step in `remediation.md` exists because of that, and because a
  *structural* finding must go back to `implementation-planner` rather than to an
  implementer that will block on it.
- **`tile.json`.** Not a convention here — it exists in one skill,
  `fastify-best-practices`, as an artefact of its vendored upstream.
- **"coverage comes from the implementers' self-verify".** It does not, and this is
  the most consequential difference. `implementer.md` defines its verification as
  *the package still type-checks, and **the tests that were already there** still
  pass* — it writes a new test only when the plan told it to. So switching
  `test-writer` off and calling implementer self-verify the coverage story leaves the
  coverage at zero while the run reads green. The mechanism here is a plan whose
  `## Tests` rows carry `Owner: implementer`, plus the knowledge that a missing seam
  test resurfaces as a `/pr-self-review` finding at Phase 7.
- **Reviewers in parallel unconditionally.** Parallel is right *when the diff has
  stopped moving*, which is what Phase 2's parent-run Done-condition sweep
  establishes. Without that sweep, a red Done-condition means both reviewer
  dispatches were spent on code that is about to be rewritten. Phase 2 costs a
  handful of `Bash` calls and it is what makes Phase 3's parallelism safe rather than
  lucky.
- **"fully autonomous, because the plan was approved by hand".** Approval is treated
  here as a **check**, not an assumption: Phase 0 greps the spec's `Status:` line and
  the plan's `EXECUTION MODE:` token, because a plan that was never actually approved
  looks exactly like one that was.

## Unverified

**Nobody has run this skill end to end.** It is procedure, not tested behaviour.
The first run should be `--dry-run` on a real plan (it validates, prints the waves
and the budget, and dispatches nothing), then a single-wave plan, then a real one.

One thing it cannot check about itself: whether a `sonnet`
`architecture-reviewer` holds its precision bar on a real diff. That wants an eval
before it wants more prose.

The other used to be whether `AskUserQuestion` from the parent reaches a human.
Half of that is now settled: it does **not** work from inside a subagent (measured
2026-08-18, `docs/retro/2026-08-18-project-context-spec.md`), which is why Phase 0
makes the parent settle every contract- or threshold-shaping question **before** it
dispatches. The parent's own `AskUserQuestion` runs in the main loop and works.
