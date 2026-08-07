# Conventions extractor — house rules mined from a repo, verified against it

Scan a cloned repository for the conventions its code actually follows, drop every
candidate whose evidence cannot be found in the code, and hand the survivors to a human
to accept, reject or edit — then compose the accepted ones into a skill.

Client half of this feature:
[`../../client/specs/conventions-extractor.md`](../../client/specs/conventions-extractor.md).
Why the pipeline is shaped this way and what would improve it:
[`../docs/conventions-quality.md`](../docs/conventions-quality.md).

## Behaviour

1. `GET /repos/:id/conventions` returns one payload: the newest `scan` (or `null`), a
   `budget`, every `candidate` for the repo confidence-descending, and the repo's
   `full_name` plus the `sha` its citations are pinned to.
2. `GET /repos/:id/conventions/budget` answers what a scan would cost **without running
   one**: eligible files, planned sample, planned tokens, planned model calls, and an
   estimated cost. It reads `file_rank` and `stat`s the planned sample; it walks no
   directory and reads no file.
3. The budget reports `can_scan: false` with a `blocked_reason` of `not_cloned`,
   `not_indexed` or `scan_running` rather than erroring. Each is a state with its own copy,
   not a failure.
4. `POST /repos/:id/conventions/scan` creates a `queued` scan row, enqueues the job, and
   responds **202** with that row. A second request while one is genuinely in flight is a
   **422**.
5. A `queued`/`running` scan older than `SCAN_STALE_AFTER_MS` is treated as abandoned, so a
   worker that died cannot block the repo forever.
6. A scan samples the repo's ranked, junk-filtered files, subject to four independent
   ceilings — files, tokens, per-file bytes, and elapsed time. Whichever binds first wins.
7. Before the model is asked anything, the sample is **counted**: `await` against `.then()`,
   named against default exports, and eight other comparisons. Those counts go into the
   prompt as facts.
8. Extraction runs **one model call per category**, all racing the scan's remaining time
   budget individually. Whatever answers in time is used; a call that fails or overruns
   costs its category and nothing else.
9. **Every citation is verified against the clone.** A candidate keeps only the citations
   whose file exists and whose snippet is really in it; one with none left is dropped and
   counted in `dropped_unverified`.
10. A verified citation's `start_line`/`end_line` are **corrected to where the snippet
    actually is**, and its stored `snippet` is sliced from the file — not the text the model
    returned. The match is labelled `exact`, `shifted` or `moved`.
11. A citation whose path escapes the clone root, whose file is binary, or whose snippet is
    too short to identify anything is refused.
12. **Adherence is counted, not asked for.** The model supplies a conforming and a violating
    pattern; both are run over the scanned corpus and `confidence` becomes the conforming
    share. The model's self-reported confidence is used only when no count was possible, and
    is then capped at `UNMEASURED_CONFIDENCE_CEILING` so an unchecked rule can never outrank
    a checked one.
13. A measured candidate below `MIN_ADHERENCE`, or with fewer than `MIN_OCCURRENCES`
    conforming hits, is dropped and counted in `dropped_low_adherence`. An unmeasurable
    candidate is kept and flagged.
14. A scan reports `partial` — not `done` — when the sample was capped or the time budget cut
    it short. `done` means it covered what it was asked to.
15. A new scan deletes only `pending` candidates. Accepted, rejected and edited ones survive,
    and a rule matching an existing one by `ruleKey` is not proposed again — **a rejected
    rule never comes back**.
16. `PATCH /conventions/:id` accepts, rejects and edits through one call. Changing the rule
    or rationale text sets `edited`, which is what protects the wording from the next scan.
17. `POST /repos/:id/conventions/skill` composes the **accepted** candidates among the ids
    sent into **one** skill. The status filter is applied server-side against the stored row:
    a rejected or untriaged candidate can never reach a skill body, whatever the request
    contains. Responds **201** with the skill, as a one-element list. There is deliberately
    no per-category shape: which rules belong in one skill is expressed by which candidates
    the user accepts, so a machine split on the taxonomy would cut across that decision.
18. A generated skill is written through the skills module with `source: "extracted"`, its
    cited files in `evidence_files`, and a version-1 snapshot. `type` follows the request and
    defaults to `convention`; `source` is server-owned and never caller-controlled, because
    `extracted` is not a trusted source and the body is delimiter-wrapped on that basis
    before it reaches a prompt.
19. `POST /repos/:id/conventions/skill/preview` runs the same composition and persists
    nothing, so what the modal shows is byte-for-byte what the create call writes.
20. Every route is workspace-scoped. An id from another workspace is a `404`.

## Data

| Field | Computed from |
|---|---|
| `budget.indexed_files` | `repo_index_state.files_indexed` |
| `budget.eligible_files` | `RepoIntel.getConventionSamples` — `file_rank` ordered, tests/configs/migrations filtered out |
| `budget.planned_tokens` | `stat` size of the planned sample ÷ 4, capped at `MAX_SAMPLE_TOKENS` |
| `budget.estimated_cost_usd` | `PriceBook.estimate` for the model `resolveFeatureModel(…, 'conventions')` returns; **null** when no price is known |
| `scan.*` counters | written by the scan itself: `proposed` by the model, `dropped_unverified` by the evidence gate, `dropped_low_adherence` by the floors, `kept` by what was inserted |
| `candidate.evidence` | `conventions.evidence` jsonb — verified citations only |
| `candidate.adherence` | `conventions.adherence_conforming` / `adherence_violating`; **null** together when the rule had no usable pattern |
| `candidate.confidence` | `conforming ÷ (conforming + violating)`, or the capped model estimate when unmeasured |
| `repo.sha` | `convention_scans.commit_sha` — the clone's HEAD when the scan ran |

`eligible_files` comes from `file_rank`, which holds only files the indexer indexed. A
committed package cache (`.pnpm-store`, `.yarn`) therefore never enters a sample and needs
no exclusion rule of its own.

Adherence is counted over the **scanned corpus**, not by grepping the clone. The denominator
is the indexed, rank-filtered source — the only body of code a house rule can be said to
hold across.

## States

| State | What the API returns |
|---|---|
| Repo never scanned | `scan: null`, `candidates: []`, a live budget |
| Repo not cloned | `budget.blocked_reason: "not_cloned"`, `can_scan: false`; existing candidates are still returned |
| Repo not indexed | `blocked_reason: "not_indexed"` — nothing to sample from |
| Scan in flight | `scan.status` is `queued`/`running`; `blocked_reason: "scan_running"` |
| Sample or time capped | `scan.status: "partial"`, with `sampled_files < eligible_files` or categories unscanned |
| Nothing survived | `kept: 0` with `proposed > 0` — a real result, not an empty repo |
| Scan failed | `scan.status: "failed"` with `error` set; the row is never left mid-flight |
| No accepted candidates | `POST …/skill` is a **422**, not an empty skill |

## Non-goals

- **Enforcing a convention.** Nothing here blocks a merge or edits code; the output is a
  skill body a reviewing agent may be given.
- **Repo-wide grep.** Adherence is measured over the scanned corpus, deliberately (see
  *Data*).
- **Scanning a repo DevDigest has not cloned and indexed.** Both are prerequisites and are
  reported as blockers.
- **Severity.** A generated skill assigns none; the reviewing agent's own rubric owns that.
- **Editing verified evidence.** Rule text and category are editable; citations are not —
  they were read out of the code.

## Implementation

| File | Carries |
|---|---|
| `src/modules/conventions/routes.ts` | the five endpoints, and job-handler registration at boot |
| `src/modules/conventions/service.ts` | the pipeline: sample → mine → select → extract → verify → measure → persist |
| `src/modules/conventions/sampler.ts` | subtree filter, layer stratification, token budget |
| `src/modules/conventions/miner.ts` | the deterministic counters that precede the model |
| `src/modules/conventions/verifier.ts` | the evidence gate, path safety, line correction |
| `src/modules/conventions/adherence.ts` | corpus counting, confidence derivation, the floors |
| `src/modules/conventions/composer.ts` | accepted candidates → skill text |
| `src/modules/conventions/budget.ts` | the pre-scan estimate and its blockers |
| `src/modules/conventions/schemas.ts` | the two model-facing shapes |
| `src/prompts/conventions.*.system.md` | the system prompts |
| `src/db/schema/knowledge.ts` | `convention_scans`, `conventions` |
| `src/vendor/shared/contracts/conventions.ts` | the wire contracts (**do-not-touch path** — added as a new file, `ConventionCandidate` untouched) |
| `src/modules/skills/service.ts` | `createExtracted` — the skills module still owns `skills` invariants |

Contract note, per this directory's README: this feature adds
`src/vendor/shared/contracts/conventions.ts` to the do-not-touch vendored package. It is a
**new file**; the pre-existing `ConventionCandidate` in `knowledge.ts` is left exactly as it
was. The one value changed there is the `conventions` entry of `FEATURE_MODELS`, whose
default moved from `openai/gpt-5.4` to `openrouter/deepseek-v4-flash` — Settings writes
`provider: "openrouter"` for every pick, so an OpenAI default was unreachable from the UI.

## History

`2026-08-06` — feature added (L02).
