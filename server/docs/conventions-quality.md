# Why most extracted "conventions" are noise, and what this pipeline does about it

A model asked *"what are this repository's conventions?"* does not count. It reads a sample
and infers, so a habit appearing in two of the eighty files it was handed comes back stated
as a rule, with a confident-sounding number attached. That is where the noise in tools like
this comes from, and it is the problem the extractor is built around.

Four failure modes, and what catches each:

| Failure | Example | Caught by |
|---|---|---|
| **Invented rule** | *"All public route handlers return `Result<T, ApiError>"* — true in two sampled files, false in the repo | the miner, then the adherence count |
| **True but worthless** | *"Use meaningful variable names"* | the prompt's exclusions; partly the occurrence floor |
| **Duplicate of the linter** | a rule ESLint already enforces | the prompt (asked for explicitly); **not** yet enforced mechanically — see *Level 4* |
| **Citation to nowhere** | `src/api/users.ts:23` where no such line exists | the evidence gate |

## The four levels

### Level 1 — the evidence gate

Every citation is read back off the clone. The file must exist inside the clone root, and
the snippet must appear as a **contiguous run of non-blank lines**. Contiguity is what stops
a "snippet" stitched together from three corners of a file; ignoring blank lines is what
stops a dropped empty line failing an otherwise perfect citation.

Two details do more work than they look like they should:

- **Line numbers are corrected, not validated.** When a snippet is found at a different line
  than claimed, the stored range is where it *actually is*. That is what makes the
  "open on GitHub" link land on the right lines rather than near them.
- **Trivial snippets are refused.** `}` and `});` are real lines in every file, and a
  nearest-match search would "verify" them against anything. Without the floor, verification
  becomes a rubber stamp.

Catches the citation-to-nowhere case entirely. Catches invented rules only when the model
also invents the citation — which, notably, it often does not.

### Level 2 — the miner, before the model

Before anything is asked, the sample is counted mechanically: `await` against `.then()`,
named against default exports, `interface` against `type`, `import type` against plain,
alias against relative imports, logger against `console`, and four more. Those counts go
into the prompt as facts, with the instruction that a rule contradicting one of them is
wrong however reasonable it sounds.

The model's job shrinks from *work out what is true here* to *phrase the rule and pick the
evidence* — the part it is good at. `await 312 · .then() 4` is not something it can talk
itself out of.

Two limitations, stated in the code as well:

- The counters are **lexical**, so an occurrence inside a string or comment counts. Making
  them exact would mean parsing every file per counter, and the ratios exist to tell 312:4
  from 2:60 — a few miscounted comment lines do not move that. Where accuracy is cheap
  (imports), the ast-grep parser is used instead of a regex.
- The sample arrives from `getConventionSamples`, which filters tests out **by design**.
  Nothing can mine a `testing` fact, so that category reaches the model with no measured
  backing and leans entirely on Level 3.

### Level 3 — the adherence count, after the model

The model must return two patterns per rule: one matching a line that follows it, one
matching a line that breaks it. Both are run over the scanned corpus, and `confidence`
becomes the counted conforming share. The model's own estimate survives only when no count
was possible, and is then capped below every measured rule's floor — so an unchecked rule
can never sort above a checked one.

Then two floors, and both are needed. The ratio alone passes "2 conforming, 0 violating" at
a perfect 100% off two coincidences; the occurrence count alone passes a rule broken as
often as it is kept.

An unmeasurable rule is **kept and flagged**, not dropped. *"Modules are registered
statically in one file"* has no line-level pattern and is one of the more valuable things a
newcomer could be told; dropping every structural convention to keep the numbers tidy would
be the wrong trade.

Measured on `BlackCat07/typescriptdemo` (26 sampled files, one scan): 20 rules proposed, 19
kept, **1 dropped for low adherence, 0 for unverifiable evidence**. Rules that survived with
counted adherence included *"Use named exports only"* at 69/73 and *"Throw HTTP errors using
the `errors` factory"* at 21/23.

### Level 4 — not built, and what it would take

Documented rather than implemented, in rough order of value per unit of work.

| Idea | What it buys | Cost |
|---|---|---|
| **Exclude what ESLint enforces** — read `eslint.config.*`, drop candidates duplicating an enabled rule | kills the whole "duplicate of the linter" class, which nothing currently catches mechanically | small |
| **Read `CLAUDE.md` / `README` / `docs/`** as an extra source | a repo that documents its rules yields the highest-confidence candidates almost free | small |
| **Rejection memory** — feed previously rejected rules back as negative examples | today a rejected rule is merely not re-proposed; teaching the model *why* would improve the next scan's precision | small |
| **Dedup against existing skills** via pgvector (`embedder` is already wired) | stops re-proposing what a skill already says | medium |
| **Learn from review history** — findings the user accepted are direct evidence of a real house rule; dismissed ones are negative signal | surfaces conventions that are invisible in the code itself | medium |
| **Per-layer scans** with their own thresholds (`server/**` separate from `client/**`) | layer-specific rules instead of one averaged mush; the sampler already stratifies, the thresholds do not | medium |

## Two things that were tried and abandoned

Both are recorded in `INSIGHTS.md` with the measurements; summarised here because they look
like obvious improvements and are not.

**Grepping the clone for adherence.** One `CodeIndex.grep` per pattern meant up to sixty
walks of the working tree in a single scan. On a 26-file repository that alone consumed the
whole time budget — the clone also contained a committed `.pnpm-store` of thousands of files
that the walk had no reason to visit. Counting over the corpus the scan has already read is
faster *and* more defensible: the denominator becomes the indexed, rank-filtered source,
which is the only body of code a house rule can be said to hold across. A package cache is
not one.

**Tuning batch size to fit the job timeout.** Extraction is one model call per category, and
`JobRunner` allows a job 120 seconds. Concurrency 4 (three waves) and 5 (two waves) were each
measured, and each both fit and overran on different runs of the *same* repo and model —
per-wave latency swung from ~35s to over 105s. A wave-level deadline made it worse: one slow
call discarded four good answers, and on the slow end the scan returned nothing at all. What
works is **per-call deadlines with maximum concurrency**: every call gets the full remaining
budget, whatever answers in time is kept, and the scan reports `partial`. Don't predict
provider latency — bound it.

## Reading the numbers on screen

- **A confidence bar alone means nothing.** The line under it is the point: `312 of 343
  places follow this` is a count; `the model's own estimate` is not. Both render as a bar.
- **`partial` is not a failure.** It means the scan succeeded over less than the whole
  repository — capped sample, or the time budget cut it short.
- **The dropped counters are the credibility of the list.** Five candidates with no context
  read as "this repo has five conventions". "Twelve proposed, seven could not be
  substantiated" is the more useful fact, and the one that makes the five believable.
- **A perfect ratio on a small denominator is weak.** `6 of 6` clears the floors but means
  the matcher was narrow. The raw counts are shown for exactly this reason — a percentage
  alone would hide it.
