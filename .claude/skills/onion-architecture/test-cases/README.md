# onion-architecture — test cases

Six review cases that measure whether this skill changes what a reviewer finds. They
travel **with** the skill: `package_skill` bundles this directory, so a delivered
`.skill` arrives with its evals already configured.

> **Why `test-cases/` and not `evals/`** — `package_skill.py` carries
> `ROOT_EXCLUDE_DIRS = {"evals"}`, so a root-level `evals/` directory is stripped out of
> the `.skill` archive. Naming it `evals/` would silently defeat the point of keeping the
> cases here.

## The cases

| Case | Planted | Traps | What it measures |
|---|---|---|---|
| `01-webhooks` | 3 | 4 | Transport running its own query; a service constructing a concrete adapter; a sibling-module reach |
| `02-core-purity` | 3 | 1 | `node:fs`, `process.env` and a `server/` import inside `reviewer-core` |
| `03-notifications` | 3 | 4 | An adapter importing a feature service; `platform/` importing module internals; a raw SDK in a module |
| `04-over-layering` | 3 | 4 | **No dependency violation at all.** Repository + service + entity + `domain/` folder for one table and one consumer |
| `05-warn-drift` | 3 | 3 | Every violation is `warn`, so `depcruise --output-type err` exits 0 and the gate looks green |
| `06-noise-suppression` | 1 | 3 | One real violation among three legitimate look-alikes. Measures false positives, not recall |

`04` and `05` are the two that isolate this skill from the repository around it: `04`
depends on the "when NOT to add a layer" thresholds, which exist nowhere else in the tree,
and `05` on `warn` being known drift rather than headroom.

## Layout

```
cases/<id>/
├── case.json                prompt, assertions, planted count
├── expected.md              prose answer key, for a human and for the LLM grader
├── expected-findings.json   machine-readable: what was planted, which look-alikes are legitimate
└── fixture/                 the code under review, as a mirror of the real repo tree
```

## `expected-findings.json` — scoring without a model

`expected.md` is prose, so grading it needs a model. `expected-findings.json` carries the
same ground truth in a form a runner can score directly, which is what makes a CI job
affordable:

- **`planted[]`** — each entry has `file`, `lines`, `rule` (an `OA-*` ID from
  [`../rules.md`](../rules.md)), `gate`, `severity`, `summary`, `fix`, and `match`: tokens
  that locate the passage.
- **`traps[]`** — legitimate look-alikes, each with `why_legitimate`.

> **Measured correction (2026-08-21).** An earlier version of this file claimed recall could
> be scored deterministically by matching `file` + a `match` token against the prose report.
> **That was tested against the 12 graded reports and it does not work**: the matcher returned
> "found" for all 46 planted entries, including the 6 the LLM grader failed, and adding
> word-boundary matching plus a 700-character proximity window changed nothing (87% agreement
> both ways). The reason is not lexical — token presence cannot separate "the report discussed
> this file" from "the report faulted it", and approval and criticism occupy the same
> paragraph. The `isolated_without_skill` run on `04-over-layering` *praised* `TagEntity` and
> the `domain/` folder while naming both.
>
> So `match` is a **locator for a human or a grader**, not a scorer. While the run's output is
> prose, the comparison is prose too. The fix is to make the *output* structured rather than
> the comparison clever: have each run emit `outputs/findings.json` — `{file, rule, verdict,
> severity}` per finding, with `rule` an `OA-*` ID — and then recall becomes a set
> intersection, trap false-positives become "is there a `verdict: violation` entry on a trap
> file", and noise becomes "how many entries carry no `rule`". All three are then genuinely
> deterministic, and the grader is left only with what needs judgement: whether the named fix
> is concrete and whether the reasoning holds.
- **`not_scored[]`** — items deliberately excluded, with the reason. Both `04` and `06`
  exclude "the service takes the whole `Container`": `OA-APP-004` tells *new* services to
  take narrow ports and reserves "not a refactor target" for the three named existing ones,
  so either call is defensible.

The `rule` IDs are a contract, not a label: the hygiene gate fails if a case cites an ID
that is not in `../rules.md`, if it names a file that is not in the fixture, if the planted
count disagrees with `case.json`, or if a planted entry has no `match` tokens. All four
checks are mutation-verified.

The fixture tree is mirrored (`fixture/server/src/modules/<name>/…`) on purpose: the
**path** tells the reviewer which ring a file sits in, so no comment has to, and the case
stays honest.

## Two rules that keep a case meaningful

**1. A fixture never describes its own defect.** It is production code as its author would
have written it — an author who does not know it is wrong. Doc-comments are welcome and
should read like the real thing; what they must not do is name the rule being broken. This
is the failure mode that actually happens: three of these six cases leaked on the first
draft, once by copying a real doc-comment verbatim from `server/src/modules/settings/`
("the only layer that touches this table"). Run the hygiene gate:

```sh
scripts/check-fixture-hygiene.sh
```

**2. The run under test must not read `expected.md`.** The answer keys live beside the
fixtures, so nothing but the prompt keeps them apart. Every run prompt must forbid the
`expected.md` files explicitly, and — because a prompt is not an enforcement mechanism —
a runner should grep the transcript for reads of `expected.md` and mark the run
**invalid** rather than passing. Note this got sharper when the cases moved in here: the
with-skill arm is told to read this skill's directory, which is now also where the answers
are.

## Prompts are portable

`case.json.prompt` carries a `{{FIXTURE}}` placeholder rather than a path. A runner
substitutes the absolute path to `cases/<id>/fixture`, which is what lets these cases run
after the skill is delivered somewhere else.

## Running the arms

A meaningful comparison needs the baseline handicapped correctly, and there are two
different questions to ask:

| Arm | Skill | Repo | Question answered |
|---|---|---|---|
| `with_skill` | yes | yes | Does the skill add anything **given** this repo's own docs and gate config? |
| `without_skill` | no | yes | — baseline for the above. `.claude/skills/` must be off-limits, or the repo's own `CLAUDE.md` points the agent straight at the skill |
| `isolated_with_skill` | yes | no | Does the skill **contain** knowledge the model lacks? |
| `isolated_without_skill` | no | no | — baseline for the above |

Measured 2026-08-21 on these six cases: the isolated pair separated by **+0.28** pass rate,
the in-repo pair by **0.00**. `server/.dependency-cruiser.cjs` carries the rule names,
severities and the ratchet rationale in its own comments, `server/CLAUDE.md` states the
no-raw-SDK rule in prose, and `grep`ping `src/modules/` is enough to reject an entity class
— so in-repo the skill is largely redundant. Keep both pairs; reporting only the in-repo
delta understates the skill, and reporting only the isolated delta overstates it.

Results, grading and benchmarks go to the sibling `onion-architecture-workspace/`, never
here.

## CI

Two tiers, because the eval runs cost real model calls and are not deterministic:

- **every push** — `scripts/check-fixture-hygiene.sh`. Free, fast, catches the leak class.
- **on a schedule, plus a path filter on `.claude/skills/**`** — the eval runs. Use at
  least 3 repeats per case and gate on a floor (`pass_rate >= 0.8`), not on an exact
  figure: measured spread across these cases at n=1 was ±19–25%, so a single-run gate
  would be flaky. Report before blocking.

One routing note if these files land in a PR: `pr-self-review`'s `routing.md` Part 1 keys
on `server/src/**`, which this tree does not match — but its cross-cutting rule routes any
hunk touching `octokit`, `simple-git`, `process.env` or a token to the `security` skill, and
these fixtures contain all four by design. Add an exclusion row for
`.claude/skills/*/test-cases/**` or the self-review will report the planted defects as
CRITICAL and the merge hook will block the PR.
