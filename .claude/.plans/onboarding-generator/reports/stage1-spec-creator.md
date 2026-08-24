# Stage 1 — `spec-creator`

Two dispatches: the spec was written first with fourteen open questions, four of them
BLOCKING; the human answered, and a second dispatch closed all fourteen.

---

## 2026-08-19 — first dispatch: the spec

# Spec written — Onboarding Generator

**Status: complete.** The spec is `draft` and needs a human to approve it. **Four questions are BLOCKING** — they lead this report because an assumption on any of them changes what gets built, not just a number in it.

As of `7bc2916` (`L05-spec-driven-development`); 1 file added, 1 index row, nothing committed.

### Open questions — the four BLOCKING ones first

**OQ-1 — BLOCKING. Does this feature switch `hotness` on?**
The brief's formula `PageRank × (1 + hotness)` is *verbatim the formula the index schema already defers*. `server/src/db/schema/repo-intel.ts:95-98` says: *"DECISION (Option B): rank = pagerank, hotness is always 0 in v1 (the clone is shallow; no churn window). The `hotness` column stays so hotness can be switched on later WITHOUT a schema change — `rank` would then become `pagerank * (1 + hotness)`."* Turning it on means deepening the clone (depth 1 at clone, 50 at resync) or adding a commit-history pass to the indexer — a change to the *indexing pipeline*, not to this feature.
**Default: no.** AC-5 orders the reading path by the index's `rank`, which *is* the formula by definition and equals PageRank while hotness is 0. The requirement's formula is satisfied; its recency half is inert, and the spec says so.

**OQ-2 — BLOCKING. What does `Share link` share?**
There is no sharing of any kind in this product, no link tokens, and a local single-workspace auth provider. A publicly readable link is a new *unauthenticated read path into a private repository's structure*.
**Default: it copies this screen's URL to the clipboard.** No token, no public route, no expiry.

**OQ-3 — BLOCKING. Does the tour get written into the repository folder?**
`sync_to_folder` exists on the settings contract with default **`true`**, and its shipped copy says *"On — onboarding tours and digests are written to the repo folder"* — and **no code anywhere reads it** (three hits total: two contract copies and the seed default). Honouring it means writing into a clone that `git reset --hard`s on every resync, through a `GitClient` port with no write method.
**Default: no (N4).**

**OQ-4 — BLOCKING. Does "one structured call" mean one provider round-trip, or one logical call with a bounded repair?**
The provider's retry count defaults to **2** (three round-trips) and `StructuredRequest.timeoutMs` is silently ignored — `server/INSIGHTS.md`, 2026-08-06. So "one call" is not what happens unless it is specified, and the demo is literally "check the number of calls in the logs".
**Default: at most two round-trips** — the request plus at most one schema-repair reprompt — counted and logged (AC-10, AC-12, AC-13).

Ten non-blocking questions, each with a default already written into the spec: OQ-5 which five sections (the shipped copy names a different five); OQ-6 the large-repo threshold (default `MAX_INDEXED_FILES` = 5 000); OQ-7 which command sources count as declared; OQ-8 first-task count and grounding; OQ-9 where `Open` goes; OQ-10 latency and rate; OQ-11 the caps on both sides of the model call; OQ-12 language; OQ-13 who may generate; OQ-14 extend the contracts vs reshape the three existing `Onboarding*` symbols.

### Coverage

```
INSIGHTS server:        ~35 entries, 8 relevant (2026-08-06 StructuredRequest.timeoutMs ignored /
  maxRetries defaults to 2; 2026-08-06 getConventionSamples + junk-path filtering; 2026-08-06
  JobRunner 120s + a discarded job.done kills the process; 2026-08-14 tryPersistentBlast — every
  exit must set an optional field a consumer branches on; 2026-08-18 a feature can arrive
  four-fifths pre-wired; 2026-08-18 the clone is reset --hard, ruling out in-place writes;
  2026-08-19 a spec's examples become the tests; 2026-08-19 jsonb read back by a cast, keys absent)
INSIGHTS client:        ~24 entries, 4 relevant (2026-08-05 vendored <Markdown> is inline-only;
  2026-08-10 no user-event dependency; 2026-08-19 jsdom sends no click for Enter; 2026-08-10 a
  feature's copy belongs in its own namespace)
INSIGHTS reviewer-core: 1 entry, 1 relevant (2026-08-07 Anthropic rejects numeric-range keywords;
  parseWithRepair re-validates and reprompts — load-bearing for the call budget)
INSIGHTS e2e:           not read — feature does not touch it
INSIGHTS mcp-server:    not read — feature does not touch it
```

**Design supplied:** three screenshots read directly (`13.png`, `14.png`, `15.png`). `16.png` not opened — the dispatch says it is the brief's text.
**Existing specs checked before naming the file:** `ls specs/ */specs/` plus `rg -l onboarding` — no onboarding spec exists. `specs/project-context.md` (SPEC-01) **names this feature as its N8**: *"The Onboarding Generator and its Onboarding Tour screen. A separate feature with its own spec."*

### Research delegated

| Question | Mode | What came back | Used where |
|---|---|---|---|
| Which deterministic facts exist for the five parts, and which have none? | repo | `getTopFilesByRank`/`getCriticalPaths` are **implemented**, not stubs; `file_rank` carries `pagerank`/`hotness`/`rank`/`percentile` with hotness a literal `0`; endpoint facts exist; **stack and "how to run locally" have no deterministic source at all** — nothing parses a `package.json`, README, Dockerfile or compose file | `## Inputs (provenance)`, AC-5 … AC-7, AC-20, N11, OQ-7 |
| How does a server feature make one structured call, and how do calls/cost become observable? | repo | No `reviewer-core` change needed. `StructuredResult` already carries `attempts`/tokens/`costUsd`. **Nothing in this server logs cost or call count anywhere, and no column counts calls** — `convention_scans` has cost but no tokens and no call count | AC-9 … AC-14, N2, `## Contracts` |
| What is the existing "index is incomplete" vocabulary, and what caps govern a large repo? | repo | `IndexStatus`/`DegradedReason` → per-feature `ok\|partial\|degraded` + reason, exactly as `blast/service.ts:statusOf`/`toReason` maps it; the client ladder is warn-above-data for partial, muted-with-reason for degraded, generic copy for an unknown reason; `MAX_INDEXED_FILES = 5000`; `sync_to_folder` defaults `true` and **nothing acts on it** | AC-16 … AC-19, AC-38 … AC-41, N4, OQ-3, OQ-6, `## Non-functional` |

A `## Not found` from the second researcher is the load-bearing one: *no feature in this server records a call count and none logs cost*. That turns "check the number of calls and the cost in the logs" from a free demo step into two acceptance criteria (AC-12, AC-13).

### Spec written

| File | Spec ID | Packages | Why here (the placement rule) |
|---|---|---|---|
| `specs/onboarding-generator.md` | SPEC-02 | server, client | Touches more than one package, so `docs/specs-convention.md` puts it in root `specs/` as **one** file with per-package AC sections. `reviewer-core` is **not** a package of this feature — verified: a server structured call goes through the container's `LLMProvider` port, and the engine is imported only for the provider implementation the container already wires. |

Index row added to `specs/README.md`.

45 acceptance criteria (AC-1 … AC-30 server, AC-31 … AC-45 client), 29 edge cases, 13 non-goals, 9 user stories, 14 open questions.

### The six questions

| # | Category | Resolved from | Unresolved → question |
|---|---|---|---|
| 1 | Scope & boundary | SPEC-01's N8 names this feature; the design's breadcrumb and WORKSPACE sidebar placement settle that the tour is about the **reviewed repository**, not DevDigest; `FEATURE_MODELS` says "the per-repo onboarding tour" | OQ-3 (write to the repo folder), OQ-5 (which five sections) |
| 2 | Actors & triggers | Explicit generation only; `POST /repos/:id/resync`'s 202-and-poll shape is the precedent for long work | OQ-13 (who may generate; one shared tour per repo) |
| 3 | Data & provenance | Facade reads, `file_rank`, `file_edges`, `file_facts`, repo map all exist; the `onboarding` table shipped in the first migration with no reader | **Two of five sections have no deterministic source** — "how to run locally" needs a new command reader (OQ-7); "stack" has none at all and is folded into the architecture section |
| 4 | Failure & degradation | Reused verbatim: `blast/service.ts`'s `statusOf`/`toReason` mapping, the warn-above-data ladder, `index_missing` for a never-indexed repo | OQ-6 (behaviour above the file cap) |
| 5 | Cross-module contract | server → client only; `reviewer-core` unchanged; nine new shared symbols named in `## Contracts`, three existing ones left untouched | OQ-14 (extend vs reshape — the three existing `Onboarding*` symbols become orphans) |
| 6 | Trust & limits | Every fact is foreign text; the shipped system prompt already carries an untrusted clause; the model's **own output** is untrusted too (AC-8 checks every path against the index) | OQ-4 (call budget), OQ-10/OQ-11 (latency, rate, caps) |

### Self-check

1. **pass** — 45/45 EARS with `shall`. Verified by script; `rg '\*\*should\*\*|\*\*may\*\*|\*\*will\*\*'` returns nothing.
2. **fail, fixed** — AC-16, AC-19 and AC-21 each joined two responses with "and" (`answer degraded … and shall make no model call`; `derived from a declared source … and shall name the file`; `wrapped as untrusted … and none shall appear in the system message`). Split into six, the whole file renumbered, and the traceability table rebuilt. Re-verified by script: every criterion now contains exactly one `shall`.
3. **pass** — each was asked "what diff makes this false?". AC-24 and AC-17 exist *because* of that test: a wrapped block placed in the system message satisfies AC-23, and a correct degraded status with a wasted model call satisfies AC-16.
4. **pass** — 45/45 carry a `Verify:` from the four methods **and** an italic observable. Methods used: `test`, `analysis`, `inspection`, `demonstration`.
5. **pass** — every threshold is either an existing constant (`MAX_INDEXED_FILES` 5 000, repo map 1 500 tokens, 5 chain roots, 2 hops, JobRunner 120 s, the intent classifier's 75 s) or is in `## Open questions` with a proposed default (OQ-6, OQ-10, OQ-11). The 75 000 ms in AC-11 is anchored on the existing intent-classifier bound and still restated in OQ-10.
6. **fail, fixed** — `rg -n 'src/|adapters|container|migration'` returned 10 hits. Two were bugs and are gone: `## Contracts` opened by naming the do-not-touch directory (now "the shared cross-package contract and its hand-made client copy"), and `## Inputs` said "shipped in the first migration with `repo_id`, `json`, `generated_at`" (now "shipped with the initial schema carrying only a repository key, a JSON blob and a generated-at time"). The remaining eight are: fixture paths **inside a toured repository** (`src/a.test.ts`, `src/does-not-exist.ts` — not DevDigest's layout), the word "migration" as a *file kind the junk filter drops in the toured repo*, boundary statements in `## Cross-module interactions` and N2 which the convention explicitly permits, and one Problem-&-why statement of what already exists. No criterion names a DevDigest file, folder, layer or wiring step.
7. **pass** — `rg -in 'wave|owned path|task T[0-9]|estimate|sprint'` returns nothing. The "smallest version still worth shipping" paragraph names scope, not order.
8. **pass** — 45 traceability rows for 45 criteria, contiguous 1…45, verified by script. All 9 `US` and all 29 `EC` appear in the table; five `EC` are explicitly `accepted` with reasons (EC-6 hotness inert, EC-8 no declared commands, EC-23 language constant, EC-24 the unread `sync_to_folder` setting, EC-26 the stale shipped copy).
9. **pass** — both filled. `## Cross-module interactions` carries a sequence diagram of 5 participants; `## Contracts` names nine new types and their fields, three types deliberately unchanged, and no file path.
10. **pass** — numbers with conditions under `perf` / `scale` / `rate` / `security` / `a11y`, plus an explicit `cost — not budgeted, deliberately` with its reason (the figure is recorded and logged so a real one can be observed before a limit is set against a made-up one).
11. **pass** — answered at length. Two directions: the repository's text into the prompt, and **the model's own output**, which AC-8 and AC-20/AC-21 treat as untrusted.
12. **pass** — all twelve upper-half sections present.
13. **pass** — root `specs/`, two packages. Not `e2e/specs/`.
14. **pass** — `rg -o 'SPEC-[0-9]+' ... | sort -u | tail -1` was `SPEC-01`; this is `SPEC-02`, `Status: draft`.
15. **pass** — row added to `specs/README.md`.
16. **pass** — two hits for "ignore"/"do not flag" and both are *quoted descriptions of hostile phrasings* (EC-9 and `## Untrusted inputs`), in the same shape SPEC-01 uses. No sentence addresses a model.
17. **pass** —
```
 M specs/README.md
?? PROMPT.md
?? specs/onboarding-generator.md
```
`PROMPT.md` was already untracked before this dispatch and is not mine.

### Design findings

| # | Finding | Where in the design | Kind | In the spec as |
|---|---|---|---|---|
| 1 | **The headline number is above the indexer's own cap.** "Generated from index of 12,450 files" while `MAX_INDEXED_FILES` is 5 000. The system cannot produce that figure today. | 13.png subtitle | corner case | EC-1, AC-18, AC-40, OQ-6 — the caption reports files **indexed and skipped**, never a repo-wide total nothing counted |
| 2 | **The "Critical paths" card shape does not match what the facade returns.** The mock shows four `path — reason` rows; `getCriticalPaths` returns dependency **chains** (`string[][]`), at most 5, of 2–3 paths each. | 13.png Critical paths | cross-module gap | AC-7 + the `OnboardingPathNote` row shape in `## Contracts` |
| 3 | **A first task cites a path the ranked sampler can never surface.** `test/ratelimit.test.ts` — the junk filter drops `.test.`, so it can only come from the model. | 15.png First tasks | cross-module gap | EC-27, AC-8 (every path checked against the index, not drawn from the sample) |
| 4 | **`Open` has no in-app destination.** DevDigest's only code view is the PR diff viewer, which is PR-scoped. | 13.png Critical paths rows | missing state | N9 + OQ-9 (default: the file on the repository host at the tour's SHA) |
| 5 | **The sidebar entry is already lit by a different screen.** `activeKeyFor` matches any path containing `/onboarding`, and the add-a-repository screen lives at exactly `/onboarding`. | 13.png sidebar | corner case | EC-25, AC-32 |
| 6 | **The shipped copy names a different five sections** — "overview, architecture, key modules, getting started, and conventions & gotchas" in `client/messages/en/onboarding.json`. | contradicts all three frames | cross-module gap | EC-26, OQ-5 (design wins; the copy is reworded) |
| 7 | **No empty state, no loading state, no error state, no partial state, no degraded state is drawn.** All five frames show a fully populated, fully successful tour. | all three frames | missing state | AC-33 (empty), AC-34 (running), AC-38/39 (partial, stale), AC-42 (degraded), AC-43/44 (error, unknown reason) |
| 8 | **No "too much data" state.** No cap is drawn on critical paths, reading-path entries or first tasks; the mock shows 4 / 3 / 3. | all three frames | missing state | AC-30 + the caps in `## Non-functional`, OQ-11 |
| 9 | **The prose body needs a renderer the app does not have.** The architecture card shows paragraphs with inline code; the vendored `<Markdown>` maps only `p`/`strong`/`code`/`a`, so headings and lists collapse into a wall of text — and it is do-not-touch. | 13.png Architecture overview | corner case | AC-36 |
| 10 | **The diagram has no failure state.** Mermaid refuses labels with line breaks, unquoted `/` or `:`, and fences — the shipped prompt template spends six lines warning about exactly this. | 13.png diagram | missing state | EC-12, EC-13, AC-38 |
| 11 | **A copy button beside a command derived from foreign text is an execution primitive.** The mock's commands (`pnpm install`, `docker compose up -d postgres redis`) are plausible; a hostile repository's README would put `curl … \| sh` in the same box. | 14.png / 15.png How to run locally | corner case | AC-20, AC-21, AC-22, EC-10, US-9, the `security` budget |
| 12 | **Nothing on screen says how complete the index was.** The subtitle gives a file count and an age but no coverage or status. | 13.png subtitle | missing state | AC-39, AC-40, AC-41 |
| 13 | Collapse chevrons are drawn on every card but no collapsed state is shown, and no persistence of the collapsed set is implied. | all three frames | UX proposal | proposal only — not a requirement |
| 14 | Showing the last generation's model, round-trip count and cost on the screen would make the demo's "check the logs" step unnecessary. | absent from the design | UX proposal | proposal only — not a requirement (N13) |
| 15 | An "export as markdown" control is a more honest answer to `Share link` than a URL copy, and needs no new authorization surface. | 13.png Share link | UX proposal | proposal only — not a requirement (named inside OQ-2) |

### Deviations

- **The whole file was renumbered once, after writing.** Self-check item 2 caught three criteria joining two responses; splitting them shifted every ID. Traceability, `## Non-functional`, `## Untrusted inputs` and the accepted-edge-case rows were all re-pointed, and contiguity 1…45 re-verified by script.
- **I read `server/src/prompts/onboarding.system.md` and the schema comment in `server/src/db/schema/repo-intel.ts` myself** rather than waiting for the researchers. Both turned out to be the two most consequential files in the dispatch — the prompt is already written and parameterised, and the schema comment states the hotness decision verbatim.

### Blocked

Nothing.

### Not done

- **The mermaid diagram is `not checked`.** I cannot render it. Paste it into <https://mermaid.live/> before trusting it.
- **Whether the `onboarding` table is actually *applied* to the running dev database is `not checked`.** It shipped in `0000_init.sql`, so it is far likelier applied than a recent migration — but `server/INSIGHTS.md` (2026-08-19) records a feature passing every gate and 500-ing on its first request for exactly this reason. Settle with `select table_name from information_schema.tables where table_name = 'onboarding';`.
- **`e2e/` and `mcp-server/` were `not checked` beyond confirming the feature does not touch them.** A browser flow for the new screen is `test-writer`'s.
- **`server/src/modules/repo-intel/service.ts` past line 240 was `not checked` by the third researcher**, so whether `MAX_INDEXED_FILES` is *enforced* (its comment says "documented now, enforced in the pipeline") is unconfirmed. This matters to OQ-6: if it is not enforced, `repo_too_large` may never be set by anything.

### For the parent

**INSIGHTS candidates — entry-format ready, for `server/INSIGHTS.md` → Codebase Patterns. Not appended by the agent.**

- **2026-08-19** — **The Onboarding Generator is the most pre-wired feature in this repository so far, and the one artefact that names it hardest is a prompt file, which no contract or catalogue grep would find.** Beyond the four places the 2026-08-06 conventions entry predicts and the six the 2026-08-18 Project Context entry predicts, onboarding also has a **written, parameterised system prompt** — `src/prompts/onboarding.system.md`, with `{{sections}}` and `{{language}}` placeholders, mermaid rules and an untrusted-data clause — paired with no Zod schema, no `schemaName` and no mock fixture; a table that shipped in `0000_init.sql`; two facade methods whose doc comments name it ("T3: onboarding reading-path + critical paths"); the first `FEATURE_MODELS` entry; and comments inside `reviewer-core` (`llm/structured.ts` explains its parse order with "markdown code blocks in an onboarding `body`"; `grounding.ts` lists onboarding among the full-file scanners). Extend the 2026-08-18 search order with a fourth place: **`src/prompts/`**. Evidence: `src/prompts/onboarding.system.md`, `src/db/schema/context.ts` (`onboarding`), `src/modules/repo-intel/service.ts` (`getTopFilesByRank`, `getCriticalPaths`), `../reviewer-core/src/llm/structured.ts`.

- **2026-08-19** — **No feature in this server records how many model calls it made, and none logs a cost — so "one call" is an unverifiable claim today.** `StructuredResult` carries `attempts`, `tokensIn`, `tokensOut` and `costUsd`, but `convention_scans` stores only a summed `cost_usd` (no tokens, no call count), `pr_intent` stores per-call figures while *assuming* one call, and `agent_runs`/`run_traces.stats` do the same for a review. The `RunLogger` mirrors engine events to pino, and none of those events carries either figure. So a requirement of the form "check the number of calls and the cost in the logs" is new observability work, not a read of something already there — worth knowing before a lesson promises it as a demo step. Evidence: `src/vendor/shared/adapters.ts` (`StructuredResult.attempts`), `src/db/schema/knowledge.ts` (`conventionScans`), `src/platform/run-logger.ts`.

- **2026-08-19** — **A settings field can ship with a default of `true` and a UI sentence promising behaviour that no code implements and that the architecture forbids.** `SettingsKnown.sync_to_folder` is `z.boolean().default(true)` in both contract copies and in the seed, and `client/messages/en/settings.json` says "On — onboarding tours and digests are written to the repo folder". Three hits total across both packages — the two declarations and the seed — and no reader anywhere. Meanwhile the clone is `git reset --hard origin/<branch>` on every resync and the `GitClient` port has no write method (2026-08-18, this file), so honouring it is a separate feature. A defaulted-on setting that nothing reads is worse than a missing one: the next feature in its area inherits a promise it cannot keep. Evidence: `src/vendor/shared/contracts/platform.ts` (`SettingsKnown.sync_to_folder`), `src/db/seed.ts`, `../client/messages/en/settings.json` (`workspace.syncOn`).

**Candidate for `client/INSIGHTS.md` → Codebase Patterns (also not appended):**

- **2026-08-19** — **`activeKeyFor` matches nav keys by `pathname.includes(...)`, and one of those matches is already wrong.** `if (pathname.includes("/onboarding")) return "onboarding-tour"` lights the *Onboarding Tour* sidebar entry while the user is on the **add-a-repository** screen, which lives at exactly `/onboarding`. The nav entry does not exist yet so nothing renders as active today, but the collision lands the moment it is added. Substring matching over a flat route space needs the more specific pattern first, or an exact-prefix rule. Evidence: `src/components/app-shell/helpers.ts` (`activeKeyFor`), `src/app/onboarding/page.tsx`, `messages/en/shell.json` (`nav.onboarding-tour`).

**Implemented specs this feature contradicts:** none. `specs/project-context.md` (SPEC-01, `implemented`) *anticipates* this feature in its N8 and needs no edit.

**No `CLAUDE.md` or convention wording proposed.** The one thing worth a human decision is OQ-14: the repository's extend-don't-reshape rule leaves `Onboarding`, `OnboardingSection` and `OnboardingLink` as three orphaned contract symbols. That is a coordination decision, not a rule change.

---

## 2026-08-19 — second dispatch: closing all fourteen questions

The human answered the four blocking questions, all on the proposed defaults. OQ-14 was
answered by the repository rather than by a product decision — root `CLAUDE.md` on
`vendor/shared` says a change *"extends with a new file rather than reshaping an existing
symbol"* — and the remaining nine were accepted at their stated defaults.

### What changed

**No `[NEEDS CLARIFICATION]` string ever existed in the file** — the agent used `See **OQ-n**` pointers instead. All fourteen are now gone from the body; the only surviving `OQ-` occurrences are the fourteen row labels inside the resolved-questions table, which is an index into the body rather than a second place to read a requirement from.

**`## Open questions` → `## Open questions — none, all fourteen resolved 2026-08-19.`** Replaced the 90-line question list with a 14-row table: question → decision → *the section it now lives in*. Modelled on SPEC-01's own resolved-questions table, which `docs/specs-convention.md` permits (`## Open questions` "must be empty to reach `approved`" — an empty section, not an absent one). Closes with the note that `Status` stays `draft` because an empty section is the *precondition* for promotion, not the promotion.

**Decisions moved into the sections that own them:**

| Decision | Where it now reads outright |
|---|---|
| OQ-1 `hotness` stays 0 | **N6**, rewritten — states the recency half is **inert today**, that the column exists so the term can be switched on *without a schema change*, and that switching it on is an **indexing-pipeline change, out of scope**. AC-5 unchanged (already written against the defined quantity). EC-6's `accepted` row reworded to match. |
| OQ-2 `Share link` | **new AC-46** + **new N14**. N14 gives the reason a public link is a separate feature (first unauthenticated read path into a private repo's structure). The markdown-export idea is gone from the file entirely. |
| OQ-3 no repo-folder write | **N4** — now ends "**Decided on 2026-08-19: the tour lives in the database only, and `sync_to_folder` stays unread.**" EC-24's `accepted` row no longer says "pending". |
| OQ-4 two round-trips | **AC-10** — the observable now says two is the *decided* ceiling and why one-with-no-repair was rejected. |
| OQ-5 design's five sections | EC-26's `accepted` row — "decided on 2026-08-19: **the design wins**", copy reworded under AC-33. |
| OQ-7 declared command sources | **AC-20** — observable now states the three are "the whole set" and README prose is **never** a source. |
| OQ-9 `Open` destination | **new AC-47** (repository host, at the tour's recorded SHA, new tab) + **N9** rewritten to link out rather than to state an absence. |
| OQ-11 caps | **AC-30** — dropped the deferral pointer; the caps stand in `## Non-functional`. |
| OQ-12 English | **N12** — "filled as a constant, with no picker". |
| OQ-13 one shared tour | **N7** — extended with the workspace-shared consequence: a regeneration replaces what a colleague was reading. |
| OQ-14 extend, never reshape | **`## Contracts`** — rewritten to quote root `CLAUDE.md` verbatim (*"When a change is agreed, extend with a new file rather than reshaping an existing symbol"*), state the three types are **deliberately untouched**, and say explicitly they are **not a cleanup item and no task should remove them**. The word "orphan" is gone. |
| OQ-6, OQ-8, OQ-10 | Already stated in `## Non-functional` / `## Contracts` / AC-8 / AC-18; only the preamble needed changing. |

**`## Non-functional` preamble** flipped from *"Every figure is a **proposed** requirement until a human accepts it … the ones that did not are in `## Open questions`"* to *"Every figure below is a **requirement, accepted on 2026-08-19**"*, keeping the which-came-from-a-constant distinction and the reasoning beside each number.

**Two new criteria, appended so nothing renumbered:** AC-46 and AC-47, both client. Heading updated `AC-31 … AC-45` → `AC-31 … AC-47`; traceability gained `| AC-46 | US-6 | client | test |` and `| AC-47 | US-2, US-4, EC-20 | client | test |`.

**`## History`** gained a second dated line recording the resolution, the two added criteria and that `Status` is unchanged.

File is 745 lines (was 805 — the question list was longer than the table replacing it). `Status: draft`. Index row in `specs/README.md` untouched and still `draft`.

### Self-check re-run

1. **EARS / `shall` — pass.** 47/47 use a pattern and say `shall`; `rg '\*\*(should|may|will)\*\*'` over the criteria section returns nothing.
2. **One behaviour per AC — pass.** Scripted: every criterion's statement half contains exactly one `**shall`. The two new ones are single-behaviour by construction (AC-46 places a URL on the clipboard; AC-47 opens a file at a SHA).
4. **`Verify:` present — pass.** 47/47 carry a method from the four **and** an italic observable. AC-46 and AC-47 are both `Verify: test`.
5. **No invented numbers — pass.** No number is deferred any more, because there is nowhere left to defer to; every figure now stands in `## Non-functional` or in a criterion as an accepted requirement. Grepping for `proposed`/`proposal`/`Default:` returns four hits, all past-tense narration (the Non-functional preamble, the resolved-table intro, the History line) or N13's UX-proposal disclaimer — none is a deferred value.
8. **Traceability — pass.** 47 rows, contiguous 1…47, one per criterion. All 9 `US` and all 29 `EC` still appear; the five `accepted` rows survive with their reasons, three of them reworded to state a decision instead of pointing at a question.
17. **Write scope —**
```
 M specs/README.md
?? HOME-TASK05.md
?? PROMPT.md
?? specs/onboarding-generator.md
```
Still exactly one spec file and one index row from the agent. `HOME-TASK05.md` is new since the first check and is not the agent's.

Not re-run, because the edit could not affect them: items 3, 6, 7, 9–16. One note on item 6 all the same — the new `## Contracts` paragraph quotes root `CLAUDE.md` and names `vendor/shared` as a *rule citation*, not as a placement instruction, which is the same use SPEC-01 makes of it.

The spec is `draft` and needs a human to promote it.

---

**What the parent did next:** committed the spec as `cb5226b`, then the human approved it and
the parent recorded the promotion to `Status: approved` as `e2cd58c` — the one transition
`docs/specs-convention.md` reserves for a person.
