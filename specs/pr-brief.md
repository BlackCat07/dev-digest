# Spec: PR Brief (Why + Risk) | Spec ID: SPEC-03 | Status: draft
Supersedes: —

A reviewer opening a pull request can read, in one card above the diff, what the change does
and why, how risky it is, which risks are real and which files they live in, and which files to
open first — assembled from what DevDigest already derived about this pull request, written by
**one** structured model call that never sees a line of diff text, and cached against the
pull request's state so re-opening it costs nothing.

## Problem & why

Everything a reviewer needs to decide *where to start* is already in this system, and none of
it is in one place. The Intent Layer (L03) knows what the pull request claims to do and where
it is likely to hurt. Blast Radius (L04) knows which symbols moved, who calls them and which
endpoints and crons are downstream. Prior PRs knows who last touched these files. Smart Diff
knows which of the changed files carry the substance. Project Context knows which of the
repository's own documents the team said were relevant. A reviewer today reads four cards and
does the synthesis in their head, once per pull request, every time.

This feature does that synthesis once, cheaply, and writes it down.

The plumbing is partly pre-wired, in the shape `server/INSIGHTS.md` records for the conventions
extractor (2026-08-06), Project Context (2026-08-18) and the onboarding generator — and the
lesson from all three is the search order: grep the **contracts** and the **message
catalogues** before the module tree, because the module tree is the one place a pre-wired
feature leaves no trace.

- **The table.** `pr_brief` (`pr_id` primary key, `json` jsonb) shipped in the **first**
  migration and has no reader and no writer anywhere in the server.
- **The contracts.** `Intent`, `BlastRadius`, `Risk`, `RiskSeverity`, `PrHistory`, `SmartDiff`
  and a composed `PrBrief` sit in both copies of the shared contracts, with no consumer.
- **The model choice.** `FEATURE_MODELS` carries `risk_brief` / "Risk Brief" / "Assesses merge
  risks for a pull request", and it has **zero callers** in `server/src`.
- **The copy.** `client/messages/en/brief.json` exists with `block.{intent,blast,risks,history}`,
  `noRisks`, `noHistory`, `overlap`, `unavailable`, `unavailableHint`.
- **The module slot.** `server/src/modules/index.ts`'s registry doc-comment names `brief` among
  the modules a later lesson adds. There is no `brief` module.
- **The link target.** `client/specs/smart-diff.md` lists "making `file:line` jump here instead
  of to github.com" as a **known-possible, not-yet-built** non-goal, and the per-line DOM
  anchors were deliberately kept for it after an earlier in-diff jump was removed on
  2026-08-12.

Two of those are traps rather than gifts, and this spec resolves both on the record: the
existing `PrBrief` shape is **not** the shape the requirement asks for (`## Contracts`), and
`brief.json`'s keys describe that older shape and once mislabelled the Intent card
(`client/INSIGHTS.md`, 2026-08-10).

The feature has a second purpose, which is why the input budget is a requirement rather than a
preference: it is the demonstration that a useful synthesis costs **one** model call over
**stats and paths only** — no diff bodies, no per-file pass, no map-reduce.

## Goals / Non-goals

**Goals**

- **G1** Produce, per pull request, a brief carrying: what the change does, why, a risk level,
  concrete risks citing real files, and a review-focus list of files to open first.
- **G2** Assemble every input deterministically — from the intent record, the blast map, the
  changed-file list, the linked issue and the repository's attached documents — before any
  model call, and never place a diff hunk body among them.
- **G3** Turn those inputs into the brief with **one** structured model call, inside a fixed
  input budget stated in a unit this repository already counts with.
- **G4** Ground every citation: a risk or a review-focus entry names a file or an endpoint the
  input data actually contained, or it does not survive to storage.
- **G5** Cache the result against the pull request's state, so re-opening the same state makes
  no model call, and give the reader one control that forces a rebuild.
- **G6** Make each review-focus entry navigate to that file in the `Files changed` tab.
- **G7** When an input is missing, an index is incomplete or the model call fails, show an
  honest, deterministic card with a named reason — never an error page, never a silent
  half-answer.

**Non-goals** — each with its reason, because each is something a reader of the design will
otherwise assume is included.

- **N1 Re-specifying Intent, Blast Radius, Prior PRs, Smart Diff or Project Context.** All five
  are built and specified. This feature is a **consumer** of them: it reads their output through
  their existing boundaries and changes none of their behaviour. Where this spec names one of
  them it is stating a dependency, not a requirement on it.
- **N2 Moving the verdict banner onto the Overview tab.** The design's top region — the red
  `Request changes` headline, the `6 findings` / `2 blockers` chips, the `61` PR score and the
  `$0.014 · 8.2K→1.3K` cost line — is the **already-built** `VerdictBanner`, and it renders on
  the `Agent runs` tab from review data. It is review output, not brief output: a brief exists
  before any agent has run. **Decided on 2026-08-19 (OQ-4): the banner does not move.** It
  stays on the `Agent runs` tab, and this card carries its own risk level, its own regenerate
  control and its own cost line. This card renders **below** the tab bar on `Overview` and
  **above** the existing intent and blast cards, which stay exactly where they are.
- **N3 Any change to `reviewer-core`.** The structured call reaches the model through the
  container's `LLMProvider` port exactly as the intent classifier and the onboarding generator
  do. `wrapUntrusted`, `parseWithRepair` and `INJECTION_GUARD` are **relied upon and
  unchanged**. This module assembles its own prompt and therefore does its own wrapping — see
  `## Untrusted inputs`.
- **N4 More than one structured model call per generation.** No file-selection pass, no
  per-risk pass, no summarisation of the inputs. The deterministic layer does the selecting.
- **N5 Sending diff hunk bodies to the model.** Paths, per-file line counts and derived facts
  only. `pr_files.patch` is never read into the model input (AC-9). This is the requirement's
  own constraint and it is what makes the token budget reachable.
- **N6 A second risk vocabulary.** Risks are the existing `Risk` shape — `kind`, `title`,
  `explanation`, `severity`, `file_refs` — the same one `PrIntent.risk_areas` already stores.
  Two vocabularies for one concept is the drift the shared contract exists to prevent.
- **N7 Promoting a brief risk into a review finding.** A risk is not a finding: it carries no
  run, no agent, no accept/dismiss lifecycle and no line-level grounding against a hunk. The
  two lists stay separate.
- **N8 Posting the brief to GitHub.** Nothing is written to the pull request, to a comment or
  to the clone. The clone is a read-only mirror that resync puts through
  `git reset --hard origin/<branch>` and the git port carries no write method
  (`server/INSIGHTS.md`, 2026-08-18).
- **N9 Brief history or versions.** A generation replaces the pull request's single stored
  brief. Nothing keeps the previous one.
- **N10 A per-user or per-branch brief.** One brief per pull request, shared across the
  workspace. A regeneration replaces what a colleague was reading.
- **N11 Scheduled regeneration.** **Decided on 2026-08-19 (OQ-2):** a brief is generated when
  somebody opens the pull request and no stored brief matches its current state (AC-58), or
  when somebody presses regenerate (AC-6). Nothing regenerates on a timer, on a poll, or on a
  webhook, and nothing regenerates a pull request nobody is looking at — so the cost of this
  feature is bounded by attention, not by the size of the workspace.
- **N12 Translation.** English, as every other generated artefact in this product.
- **N13 A review-focus entry that points outside the pull request's changed files.** The
  requirement says every entry is clickable and leads to that file in the changes tab, and a
  file the tab does not contain has nowhere to lead. **Decided on 2026-08-19 (OQ-3): only the
  changed set** (AC-24). The design's fourth review-focus row breaks this and is therefore a
  design bug rather than a feature — see `## Edge cases`, EC-12.

**Smallest version still worth shipping.** The assembly, the single grounded call, the cached
brief keyed on state, and a card showing risk level, what/why and a clickable review-focus
list. The risks list and the token/cost line could be dropped and the demo would still hold:
open a pull request, read why and how risky, click a review-focus row, land on the file.

## User stories

- **US-1** As a reviewer, I want one sentence saying what this pull request changes and one
  saying why, so I can decide whether to review it now without reading the diff.
- **US-2** As a reviewer, I want a risk level I can see at a glance, so a dangerous pull request
  does not look like a safe one.
- **US-3** As a reviewer, I want the concrete risks, each pointing at a real file in this pull
  request, so the level is a claim I can check rather than a mood.
- **US-4** As a reviewer, I want a short list of the files to open first, with a reason each, so
  my first ten minutes are spent in the right place.
- **US-5** As a reviewer, I want a review-focus row to take me straight to that file in the
  changes tab, so the advice and the code are one click apart.
- **US-6** As a reviewer returning to a pull request I read yesterday, I want the same brief
  instantly and no new charge, and I want to be told when the pull request has moved on.
- **US-7** As a reviewer whose pull request has just changed, I want one control that rebuilds
  the brief on demand.
- **US-8** As a reader of a generated document, I want to know what it was and was not built
  from, so I can tell a thin brief from a wrong one.
- **US-9** As the person paying for the model, I want to see that one generation is one call
  inside an agreed input budget, and what it cost.
- **US-10** As a security-conscious user, I want the pull request's description, its linked
  issue and the repository's documents treated as data a stranger wrote, never as instructions.

## Acceptance criteria (EARS)

### AC-1 … AC-35 — server

**Reading, caching and freshness**

- **AC-1** — WHEN a client reads a pull request's brief and a stored brief exists whose cache
  key equals the key computed from that pull request's current state, the system **shall**
  answer the stored brief and make no model call.
  `Verify: test` — *observable: a hundred consecutive reads of an unchanged pull request leave
  the mock provider's call list empty and return byte-identical payloads. This is the
  requirement's own acceptance criterion — re-opening the same state reads the cache.*
- **AC-2** — The cache key **shall** be a digest over exactly these values: the pull request's
  head SHA; its title; its description; its changed-file list as paths with per-file additions
  and deletions; the stored intent's status and derived-at time; the blast map's status and
  indexed SHA; the effective document set's paths in their effective order with each document's
  size in bytes; and a brief-format version identifier.
  `Verify: analysis` — *observable: changing any one of those nine values, with the other eight
  held, produces a different key; changing nothing produces the same key twice. Head SHA alone
  is **not** sufficient and this criterion exists to say so: `pull_requests.body` and `pr_files`
  are written only by the pull-request detail route while `head_sha` is also written by the list
  route, so a SHA-keyed derivation caches a title-only answer forever —
  `server/INSIGHTS.md`, 2026-08-11, measured at 15 of 21 rows.*
- **AC-3** — WHEN a brief is read, the system **shall** report whether the stored brief's key
  equals the key computed from the pull request's current state.
  `Verify: test` — *observable: writing a new `pr_files` row flips a `stale` flag on the next
  read without regenerating anything and without a model call.*
- **AC-4** — IF a generation is requested and the computed key differs from the stored brief's
  key, THEN the system **shall** rebuild the brief.
  `Verify: test` — *observable: with a stored brief in place, changing the pull request's
  description and requesting generation records exactly one new provider call.*
- **AC-5** — IF a generation is requested and the computed key equals the stored brief's key,
  THEN the system **shall** answer the stored brief without a model call.
  `Verify: test` — *observable: two generation requests with nothing changed between them
  record one provider call, not two.*
- **AC-6** — WHERE a generation request carries a force flag, the system **shall** rebuild the
  brief even when the computed key equals the stored key.
  `Verify: test` — *observable: a forced request against an unchanged pull request records a
  second provider call. This is the control that covers what the key cannot — the linked issue's
  body and an edited document of unchanged size are not in the key (EC-9, EC-10), so `force` is
  the only way to pick them up.*
- **AC-7** — Reading a brief **shall** perform no database write.
  `Verify: test` — *observable: the stored brief's generated-at value is unchanged after a
  hundred reads.*
- **AC-8** — WHILE a generation is running for a pull request, the system **shall** refuse a
  second generation request for that pull request rather than starting a second one.
  `Verify: test` — *observable: two requests in flight produce one accepted response and one
  refusal, and the mock provider records exactly one call.*
- **AC-9** — WHERE a generation has been marked running for longer than **5 minutes**, the
  system **shall** treat it as abandoned and allow a new one.
  `Verify: test` — *observable: a row marked running with a start time six minutes old accepts a
  new generation. The window and the reason are the intent classifier's
  `INTENT_STALE_AFTER_MS`: a process that died mid-generation must not brick the card forever,
  which is what happened to a conventions scan before it had one
  (`server/INSIGHTS.md`, 2026-08-06).*

**Assembly and the input budget**

- **AC-10** — The model input **shall** be assembled from exactly these sources and no others:
  the pull request's title, branch and base; its changed-file list with per-file additions and
  deletions; the stored intent record; the blast map's facts; the pull request's description;
  the linked issue's title and body; the prior pull requests overlapping these files; and the
  repository documents of the effective document set.
  `Verify: inspection` — *observable: every string placed in the recorded messages traces to one
  of those eight sources.*
- **AC-11** — No diff hunk body **shall** appear in the model input.
  `Verify: test` — *observable: for a pull request whose every changed file carries a stored
  patch, no substring of any patch appears in the messages the mock provider records. This is
  the requirement's own constraint, and it is what the budget rests on.*
- **AC-12** — The size of the model input **shall** be measured as the sum of
  `ceil(characters / 4)` over the system message and the user message exactly as sent.
  `Verify: test` — *observable: a recorded 4 000-character prompt reports 1 000 tokens. The unit
  is the repository's existing `approxTokens`, which Project Context already counts every one of
  its figures with, so this feature's budget and that one are comparable rather than merely
  similarly named. It is an estimate, not a tokenizer count — it is fixed here so that the
  requirement's "agreed budget" has one meaning across the product.*
- **AC-13** — The model input **shall not** exceed **8 000** approximate tokens.
  `Verify: test` — *observable: for a pull request with 400 changed files, a 40 KB description,
  an 80 KB linked issue and six attached documents, the recorded messages measure at or below
  8 000 by AC-12's rule.*
- **AC-14** — IF the assembled input would exceed the budget, THEN the system **shall** drop
  whole optional sources in this order until it fits — the repository documents, then the prior
  pull requests, then the linked issue, then the blast facts, then the description — until it
  fits.
  `Verify: test` — *observable: with a budget of 100 tokens and sources sized so that only the
  core fits, the recorded messages carry the core and nothing else, in that shedding order.
  Recording the drops is AC-33's job, not this one. Whole sources, not truncated ones: half a
  blast map reads as
  a complete one and is worse than its absence. This differs deliberately from Project Context's
  skip-and-continue over a flat document list (its AC-23) because these sources are **not**
  interchangeable — they have a value order, and the cheapest correct answer is to shed the
  least PR-specific one first.*
- **AC-15** — The core input — the title, the changed-file list and the intent record —
  **shall not** be dropped.
  `Verify: test` — *observable: with a budget too small for everything, the recorded messages
  still carry the changed-file list. Grounding (AC-21, AC-23) is defined against that list, so a
  call made without it cannot produce a checkable answer.*
- **AC-16** — IF the core input alone exceeds the budget, THEN the system **shall** make no
  model call.
  `Verify: test` — *observable: the mock provider records zero calls for a pull request whose
  file list alone overruns; nothing is charged for a call whose answer could not be grounded.
  What is stored instead is AC-57's requirement, kept separate because a correct status with a
  wasted call is the expensive half and it is the half no status assertion can see.*
- **AC-17** — The changed-file list placed in the input **shall** be capped at **200** paths,
  with the number of files omitted reported alongside it.
  `Verify: test` — *observable: a 400-file pull request contributes 200 paths and a stated
  remainder of 200, and the card can say so rather than implying the model saw everything.*

**The call**

- **AC-18** — WHEN a generation runs, the system **shall** issue exactly one structured model
  request.
  `Verify: test` — *observable: the mock provider records one `completeStructured` call per
  generation, whatever the size of the pull request.*
- **AC-19** — WHEN a generation runs, the system **shall** make at most one provider round-trip.
  `Verify: test` — *observable: a provider returning a schema-violating payload ends the
  generation degraded rather than being reprompted. Separate from AC-18 because the provider's
  own retry count defaults to **2** — three round-trips — and the per-request `timeoutMs` field
  is silently ignored (`server/INSIGHTS.md`, 2026-08-06); without this criterion "one call" is a
  description of the code and not a budget. This mirrors the intent classifier's
  `INTENT_MAX_RETRIES = 0`.*
- **AC-20** — The structured request **shall** be bounded by a deadline of **75 000 ms**, after
  which the generation completes without it.
  `Verify: test` — *observable: with a provider that never resolves, the generation finishes and
  stores a degraded brief. The bound is an explicit race because the request field that looks
  like a timeout is not read; 75 s is the intent classifier's figure, chosen on measured
  provider latency variance rather than taste.*
- **AC-21** — The model a generation uses **shall** be the workspace's `risk_brief`
  feature-model choice, falling back to the registry default when the workspace has not chosen
  one.
  `Verify: test` — *observable: with an override stored for `risk_brief`, the request the mock
  records carries that model; with none, it carries the registry default. `risk_brief` is
  already in the registry with zero callers, so this feature is its first consumer and inherits
  an untested code path — the same shape `server/INSIGHTS.md` (2026-08-06) records for
  `conventions`.*

**Grounding — what may survive to storage**

- **AC-22** — Every file reference in a stored risk **shall** name a path that appeared in the
  model input's changed-file list or among the blast map's referenced files.
  `Verify: test` — *observable: a model response citing `src/does-not-exist.ts` stores the risk
  without that reference — the invented one is dropped, not stored and flagged. Comparison is on
  the path only, with a trailing `:line` or
  `:line-line` suffix kept for display — the intent layer's `groundRiskAreas` already
  establishes both rules and the reason for the second: the model is told to cite bare paths and
  routinely appends a range, and rejecting those would drop almost every true reference.*
- **AC-23** — IF every file reference a risk offered was dropped, THEN that risk **shall** be
  dropped.
  `Verify: test` — *observable: a risk citing only invented paths does not reach storage, while
  a risk citing **no** paths at all is kept — "the auth surface is touched" is a legitimate
  whole-pull-request observation and the model was not required to cite anything.*
- **AC-24** — Every stored review-focus entry **shall** name a path that appeared in the model
  input's changed-file list.
  `Verify: test` — *observable: a response whose fourth entry names a file the pull request does
  not change stores three entries; the fourth is dropped. Stricter than AC-22 on purpose: a
  review-focus row's whole
  contract is that it navigates into the `Files changed` tab (AC-40), and that tab renders only
  changed files — a row that cannot navigate is worse than a missing row. Decided on 2026-08-19
  (OQ-3); the blast radius is deliberately **not** an allowed source here, though it is for a
  risk's references under AC-22.*
- **AC-25** — Every endpoint a stored risk or review-focus entry names **shall** appear among
  the blast map's impacted endpoints.
  `Verify: test` — *observable: a response naming `GET /api/does-not-exist` stores the item
  without it; the invented endpoint is dropped. This is the requirement's "files **or
  endpoints** from the input data" half, and
  it needs its own criterion because AC-22's path comparison cannot see an endpoint string.*
- **AC-26** — The stored risk level **shall** be the highest severity among the risks that
  survived grounding, and `low` when none survived.
  `Verify: test` — *observable: a response carrying one `high` and two `low` risks stores
  `high`; a response whose every risk was dropped stores `low`. Derived rather than taken from
  the model, so the badge and the list below it cannot disagree — the same reason the onboarding
  tour's section order is the contract's and not the model's (**OQ-5**).*
- **AC-27** — IF the stored what equals the pull request's title after case and whitespace
  normalisation, THEN the system **shall** store no what and mark the brief partial.
  `Verify: test` — *observable: a response whose what is `Add rate limiting to public API
  endpoints` for a pull request of that title stores a null what. The requirement asks for what
  changed "without restating the pull request's title", and an exact restatement is the one form
  of it that can be checked rather than judged (**OQ-8**).*

**Degradation, provenance and scope**

- **AC-28** — IF the pull request has no changed files recorded, THEN the system **shall** make
  no model call.
  `Verify: test` — *observable: the mock provider records zero calls for a pull request with no
  `pr_files` rows. This is not a rare case: that table is written **only** by the pull-request
  detail route, so a pull request nobody has opened has none — the trap the blast contract
  already names `no_changed_files` (`server/INSIGHTS.md`, 2026-08-11 and 2026-08-15, where 10 of
  14 pull requests in a live workspace had any rows at all).*
- **AC-29** — IF the structured call fails, exceeds its deadline, or returns a payload the
  schema rejects, THEN the system **shall** store a deterministic brief with a degraded status
  and a reason distinguishing which of the three occurred.
  `Verify: test` — *observable: three fixture providers — one throwing, one hanging, one
  returning `{}` — produce three stored briefs with three different reasons and no HTTP error.*
- **AC-30** — WHERE the model call did not produce a brief, the stored brief **shall** carry the
  deterministic facts the assembly already held — the changed-file count, the added and deleted
  line counts, and the blast map's counts — with no risk level, no risks and no review-focus
  entries.
  `Verify: test` — *observable: a degraded brief carries the four figures and three empty
  fields. A deterministic review-focus list is deliberately **not** synthesised: a
  review-focus row is advice plus a reason, and the reason is the only part a model produces
  (**OQ-9**).*
- **AC-31** — WHERE no intent has been derived for the pull request, or its derivation failed,
  the system **shall** generate the brief without it and mark the brief partial.
  `Verify: test` — *observable: a pull request with no intent row still produces a brief, and
  the brief's status is partial rather than ok.*
- **AC-32** — WHERE the blast map's status is not ok, the system **shall** generate the brief
  from what the map holds, mark the brief partial, and carry the reason the map gave.
  `Verify: test` — *observable: a degraded blast map still produces a brief whose reason is the
  map's own value. The vocabulary is the blast contract's — two features telling a user "the
  index is incomplete" in two different words is the failure this prevents — and the reason
  travels rather than being re-derived, because a consumer that re-derives a status from an
  absent optional field invents a third meaning for it (`server/INSIGHTS.md`, 2026-08-14).*
- **AC-33** — WHEN a brief is stored, the system **shall** record one source entry per input it
  was offered, stating for each whether it was used, could not be read, or was dropped over
  budget, and the reason.
  `Verify: test` — *observable: a pull request with no linked issue and one unreadable document
  stores two entries naming those two facts, so the card can say what the brief was not built
  from rather than being silently thinner.*
- **AC-34** — WHEN a brief is stored, the system **shall** record the provider, the model, the
  input and output token counts, the cost in USD, the generation time, the head SHA and the
  cache key it was generated against.
  `Verify: test` — *observable: after one generation all eight values are readable back; a null
  cost means no price is known for the model, which is not the same as a free call.*
- **AC-35** — The system **shall** resolve the pull request within the caller's workspace before
  reading any intent row, blast fact, document or stored brief.
  `Verify: test` — *observable: a pull request id belonging to another workspace answers
  not-found, and no clone path is resolved.*

### AC-36 … AC-53 — client

- **AC-36** — WHERE a pull request is open, the client **shall** render the brief card on the
  `Overview` tab above the intent and blast cards.
  `Verify: test` — *observable: the brief card, the intent card and the blast card are all in
  the tree in that vertical order; neither existing card is removed, and the verdict banner is
  **not** in the `Overview` tree — decided on 2026-08-19 (OQ-4), and asserted here because the
  design draws it at the top of this very section (N2, EC-27).*
- **AC-37** — The card **shall** convey the risk level with a word and an icon in addition to
  colour.
  `Verify: test` — *observable: the accessible text for a high-risk brief contains the level's
  word; the level is discoverable with colour information removed. Colour alone is invisible to
  a large share of readers and to every screen reader, which is why the shared severity badge is
  built as icon plus label.*
- **AC-38** — The card **shall** render what and why as two separately labelled statements.
  `Verify: test` — *observable: two labelled regions render, each with its own text; a brief
  whose what is null renders the why alone rather than an empty labelled region.*
- **AC-39** — The card **shall** render each risk with its severity as a word, its title, its
  explanation and its file references.
  `Verify: test` — *observable: for a brief with two risks, two rows render carrying all four
  parts, and the severity word is present in the accessible text.*
- **AC-40** — WHEN a review-focus entry is activated, the client **shall** navigate to the
  `Files changed` tab with that entry's file targeted.
  `Verify: test` — *observable: activating the row leaves the reader on the diff tab with the
  target file's path carried in the URL, so the navigation survives a reload and a shared link.
  Nothing exposes this today — the tab is already a URL parameter and the diff already carries a
  per-line DOM anchor, but there is no file or line target parameter and nothing consumes the
  anchor; `client/specs/smart-diff.md` lists this exact link as possible and unbuilt.*
- **AC-41** — WHEN the `Files changed` tab opens with a file targeted, it **shall** expand that
  file even where its default state is collapsed.
  `Verify: test` — *observable: targeting a lock file — which starts collapsed, being neither
  small nor `core` nor carrying findings — leaves it expanded. Groups are never collapsible, so
  a file is the only thing that can hide a target.*
- **AC-42** — WHERE a targeted review-focus entry carries a line, the client **shall** scroll
  that line into view clear of the sticky header.
  `Verify: test` — *observable: the targeted line's anchor receives the scroll call, and its
  scroll margin is read from the measured sticky-header height rather than a constant — that
  header is roughly 128 px, ~156 px on a merged or closed pull request and taller again when its
  meta row wraps, so any single value lands some pull requests underneath it
  (`client/INSIGHTS.md`, 2026-08-11).*
- **AC-43** — IF a targeted file is not present in the rendered diff, THEN the client **shall**
  say so on the diff tab rather than leaving the reader on an unchanged view.
  `Verify: test` — *observable: targeting a path absent from the file list renders a notice
  naming the path. This is reachable on real data despite AC-24: the changed-file list the brief
  grounds against comes from `pr_files`, while the diff tab renders one page of at most 100
  files from GitHub, so a large pull request has changed files the tab never receives (EC-3).*
- **AC-44** — WHEN the regenerate control is used, the client **shall** send a request carrying
  the force flag set to true.
  `Verify: test` — *observable: asserted at the `fetch` boundary on the outgoing request body,
  not on the response. A mutation that omits an optional flag is a **silently successful
  no-op**: the intent card's Re-derive button shipped exactly this way, the server returned the
  stored row, the spinner ran and stopped, and nothing happened — precisely in the case users
  press the button for (`client/INSIGHTS.md`, 2026-08-11).*
- **AC-45** — WHILE a generation is running, the card **shall** show a running state while the
  rest of the screen stays usable.
  `Verify: test` — *observable: the running indicator renders while the tab bar, the sidebar and
  the other two cards are still in the tree and interactive.*
- **AC-46** — WHERE no brief has ever been generated for a pull request, the card **shall** show
  a single empty state offering generation.
  `Verify: test` — *observable: one empty state renders; an empty risk list, an empty
  review-focus list and an empty why do not each render their own. This state is **narrow**
  since OQ-2 was decided: opening the pull request starts a generation (AC-58), so the reader
  normally sees the running state instead. It remains reachable in the window before the
  trigger has taken effect, and its control is the manual path when the trigger has not
  produced one — so it offers generation rather than merely announcing absence.*
- **AC-47** — WHILE the brief is loading, the card **shall** render a placeholder shaped like
  the loaded card.
  `Verify: test` — *observable: the placeholder occupies the card's regions, so nothing below it
  jumps when the brief lands.*
- **AC-48** — WHERE a brief is partial or degraded, the card **shall** show a notice naming the
  reason with whatever content the brief holds still rendered below it.
  `Verify: test` — *observable: the notice and the deterministic figures are in the tree at once
  — the shape the blast card already uses for a partial index, where hiding the data would be
  less honest than labelling it.*
- **AC-49** — IF a reason value is one the client does not recognise, THEN the card **shall**
  show its generic notice rather than the raw value.
  `Verify: test` — *observable: an unknown reason renders the generic sentence, not an enum
  literal and not a message-key path.*
- **AC-50** — WHERE the stored brief no longer matches the pull request's current state, the
  card **shall** show a stale notice offering regeneration, with the stored brief still
  rendered.
  `Verify: test` — *observable: a stale brief renders its content and the notice together, and
  regenerating is one control away.*
- **AC-51** — IF the brief request fails, THEN the card **shall** show an inline error while the
  shell stays navigable.
  `Verify: test` — *observable: the error text renders inside the card and the sidebar and
  breadcrumb are still in the tree.*
- **AC-52** — The card **shall** show the generation's input and output token counts and its
  cost.
  `Verify: test` — *observable: the three figures render from the brief's own recorded values.
  The design puts this line on the card, and it is the cheapest possible proof that AC-13's
  budget was respected — a reader can see the input figure without opening a log.*
- **AC-53** — Every control on the card **shall** be operable without a pointer.
  `Verify: demonstration` — *observable: the regenerate control and every review-focus row are
  tab-reachable real controls with accessible names. Note that jsdom synthesises no click for
  Enter on a focused native button and this package has no `user-event` dependency
  (`client/INSIGHTS.md`, 2026-08-19), so the automated half asserts reachability and accessible
  name and the activation is demonstrated.*

### AC-54 … AC-59 — server, added after the first draft

These six are numbered after the client block because they were added at the end of writing:
AC-54 … AC-56 when `## Traceability` showed US-10 served by nothing, AC-57 when AC-16 and
AC-28 turned out to join two behaviours with an "and", and AC-58 … AC-59 on 2026-08-19 when
OQ-2 and OQ-1 were decided and each turned a default into a requirement that no criterion yet
stated. They are **server** criteria and belong beside AC-1 … AC-35; the identifiers are
addresses a plan, a test and a review finding will cite, so they are not renumbered to sit in
place.

- **AC-54** — Every foreign input placed in the model input **shall** be wrapped as untrusted
  data.
  `Verify: test` — *observable: every one of the eight source blocks in the messages the mock
  provider records sits inside untrusted delimiters, and an input containing a closing delimiter
  is escaped rather than able to end its own block.*
- **AC-55** — No foreign text **shall** appear in the system message.
  `Verify: test` — *observable: the system message the mock provider records is the rendered
  template and nothing else. Separate from AC-54 because a correctly wrapped block placed in the
  system message would satisfy AC-54 and still be the failure that matters.*
- **AC-56** — Each foreign input **shall** be wrapped exactly once.
  `Verify: test` — *observable: no recorded block contains a nested untrusted opening delimiter.
  A double-wrapped block reads to the model as data about data, which is what the service-side
  wrapping decision already warns against (`server/INSIGHTS.md`, 2026-08-05) — and it is
  reachable here because this module wraps its own inputs while some of them may already have
  been wrapped by whoever produced them.*
- **AC-57** — IF no model call was made because an input precondition failed — no changed files
  (AC-28), or a core input over budget (AC-16) — THEN the system **shall** store a degraded
  brief naming which precondition failed.
  `Verify: test` — *observable: the two cases produce two stored briefs with two different
  reasons and no HTTP error, so the card can explain itself rather than showing an empty state
  that reads as "nobody has generated one yet".*
- **AC-58** — WHEN a pull request's detail is read and no stored brief matches the key computed
  from its current state, the system **shall** start a generation in the background.
  `Verify: test` — *observable: reading the detail of a pull request with no matching brief
  enqueues exactly one generation and returns without waiting for the model; reading it again
  while that generation is in flight enqueues none (AC-8). Decided on 2026-08-19 (OQ-2). The
  trigger belongs on the **detail** read and nowhere else, and that placement is the whole
  point: `pr_files` and `pull_requests.body` are written only by that route, so a trigger
  anywhere earlier classifies the pull request from its title alone — measured at 15 of 21 rows
  when the intent layer made exactly this mistake (`server/INSIGHTS.md`, 2026-08-11).*
- **AC-59** — The effective document set for a brief **shall** be the union of the effective
  document sets of the enabled agents of the pull request's repository, deduplicated by path
  with the first occurrence winning, ordered by agent and then by attachment order.
  `Verify: test` — *observable: a document attached to two enabled agents appears once, at the
  first agent's position; a document attached only to a **disabled** agent does not appear; and
  a document attached to an agent but belonging to another repository does not appear, because
  each agent's own effective set is already scoped to the pull request's repository. Decided on
  2026-08-19 (OQ-1). This reuses the existing per-agent resolution rather than defining a
  second one — the alternative was a repository-wide walk with no relevance signal at all,
  which would put every document in the repository into a 8 000-token budget.*

## Edge cases

- **EC-1** — A pull request nobody has opened in the studio: `pr_files` is empty, because that
  table is written only by the pull-request detail route. Measured on a live workspace, 10 of 14
  pull requests had any rows at all.
- **EC-2** — `head_sha` advanced by the pull-request list route while `body` and `pr_files` still
  lag behind, so a SHA-only key reports fresh over material that has changed — the exact shape
  that gave 15 of 21 intent rows a title-only derivation.
- **EC-3** — A pull request past GitHub's 100-file page: `files_count` exceeds the file list the
  diff tab receives, so a changed file grounded against `pr_files` may have no row to navigate
  to.
- **EC-4** — `pr_files` carries no unique constraint on (pull request, path), so a duplicate row
  can double-count a path in the changed-file list and in the cache key.
- **EC-5** — No intent row at all; an intent row still `running`; an intent row `failed`; an
  intent whose own `risk_areas` overlap the risks the brief is about to produce.
- **EC-6** — A blast map that is `degraded` (no usable index), `partial` (index covers part of
  the repository), or `ok` with an empty downstream — three different meanings behind the same
  empty arrays.
- **EC-7** — A fully indexed repository reporting `partial` because an early return omitted an
  optional status field, which the consumer cannot read as anything but a third state.
- **EC-8** — No linked issue; a reference that is a pull request number rather than an issue; an
  issue in another repository; an issue whose body is empty; more issue references than the
  fetch budget allows.
- **EC-9** — The linked issue's body edited on GitHub with nothing about the pull request
  changing. Nothing local observes it, so the cache key cannot.
- **EC-10** — An attached repository document edited in place to the same byte size, so its
  entry in the cache key is unchanged.
- **EC-11** — The clone resynced — `git reset --hard origin/<branch>` — between assembly and
  generation, so a document read a moment ago is gone.
- **EC-12** — A review-focus entry naming a file the pull request does not change. The design's
  own fourth row does this: `src/api/users.ts` is neither in the blast tree above it nor
  apparently among the nine changed files.
- **EC-13** — A risk naming an endpoint the blast map does not carry, or naming an endpoint
  string that differs only in method or trailing slash from one it does.
- **EC-14** — A what that restates the pull request's title, and a why that restates the what.
- **EC-15** — Every risk the model returned dropped by grounding, so the risk level is derived
  over an empty set and reads `low` for a pull request the model considered dangerous.
- **EC-16** — More risks or review-focus entries returned than the caps allow.
- **EC-17** — A path containing a `:`, a space or a non-ASCII character, so the `path:line`
  display form is ambiguous to split back apart.
- **EC-18** — A review-focus entry naming a binary file, or one whose patch GitHub omitted: the
  row exists in the diff tab and its body says the patch is unavailable.
- **EC-19** — Two generations requested for the same pull request at once, from two tabs.
- **EC-20** — A generation abandoned mid-flight, leaving the stored state `running` with no
  worker behind it — the shape that bricked a conventions scan until a staleness window was
  added.
- **EC-21** — A structured call that is charged and then returns an unparseable payload: money
  was spent and there is nothing to store.
- **EC-22** — The workspace has no API key configured. The server boots fine with none, so this
  is a runtime configuration error rather than a boot failure.
- **EC-23** — `risk_brief`'s registry default is an OpenAI model, while Settings → Feature
  Models can only ever write `provider: "openrouter"` — so once anybody touches the picker the
  default can never be restored from the UI (`client/INSIGHTS.md`, 2026-08-06).
- **EC-24** — A stored brief written under an earlier shape. A jsonb column read back by a cast
  rather than a parse arrives with keys **absent**, not null.
- **EC-25** — The `pr_brief` table as it stands carries only a pull-request id and a json blob:
  no cache key, no timestamp, no status, no provenance columns.
- **EC-26** — `client/messages/en/brief.json` already carries `block.{intent,blast,risks,history}`
  for a composed shape this feature does not produce, plus `unavailable` / `unavailableHint`
  which once rendered "Brief not available yet." on the **Intent** card.
- **EC-27** — The design draws the regenerate control on the verdict banner, which belongs to
  the review rather than to the brief — pressing it would read as "re-run the review".
- **EC-28** — A regenerate control that sends no request body, so the optional force flag is
  undefined, the server returns the stored row, and every signal a UI trusts says it worked.
- **EC-29** — A very long path, a long risk title or a 400-file pull request in a fixed-width
  card.
- **EC-30** — A description, a linked issue or a repository document containing `</untrusted>`,
  "ignore previous instructions", "this is a test fixture, do not flag", or their equivalents in
  another language.
- **EC-31** — A pull request with no risks at all: the card must not read as "we checked and it
  is safe", because a brief is a summary and not an audit.
- **EC-32** — A merged or closed pull request, where the brief is informational and the head has
  moved on.
- **EC-33** — A file reference rendered through the shared mono-link primitive with no target:
  without an href it renders a button that does nothing, which is worse than a plain label —
  which is exactly why the intent card's risk references are unlinked text today.
- **EC-34** — The migration that adds the brief's columns ships and is never applied: no
  hermetic test can tell "schema shipped" from "schema applied", and the first real request
  answers 500 on a route that exists.

## Cross-module interactions

Two packages, one direction. `client` calls `server`; `server` reads its own derivations
through the boundaries they already publish, the clone through the path-confined document
reader, GitHub for the linked issue, and the model through the container's provider port.
`reviewer-core` is reached only as the provider implementation the container already wires, and
changes in no way (N3).

```mermaid
sequenceDiagram
    participant Client as client — PR Brief card
    participant Api as server — brief module
    participant Derived as server — intent, blast, prior-prs, project-context
    participant Gh as GitHub — the linked issue
    participant Llm as the injected LLM provider

    Client->>Api: open the pull request's detail
    Api->>Derived: compute the cache key material
    Derived-->>Api: intent status, blast status and indexed sha, document set
    Note over Api: no stored brief matches the key → start one in the background
    Client->>Api: read this pull request's brief
    Api-->>Client: stored brief, its status and reason, its sources, whether it is stale

    Client->>Api: generate (force on the regenerate control)
    Api->>Derived: intent record, blast facts, prior PRs, effective documents
    Derived-->>Api: deterministic facts, each carrying its own status
    Api->>Gh: the linked issue's title and body
    Gh-->>Api: issue text, or a recorded reason it could not be read
    Api->>Api: apply the source order and the 8 000-token budget
    Api->>Llm: ONE structured request — every foreign input wrapped as data
    Llm-->>Api: what, why, risks, review focus — or a failure
    Api->>Api: drop citations the inputs do not contain; derive the risk level; apply caps
    Note over Api: on failure, store the deterministic facts with a named reason
    Api-->>Client: the stored brief, with model, tokens, cost and cache key

    Client->>Client: a review-focus row → the Files changed tab, that file targeted
```

Three directions that must **not** exist:

- **The client never reaches the intent, blast or document endpoints for the brief's sake.**
  Everything on the card arrives on the brief payload, so a partial input is a value the card
  reads rather than a second request it has to correlate.
- **The brief module never reaches another feature module's internals.** Each derivation is
  reached through the facade or container binding that module already publishes; an
  `import type` of a sibling's internal type is a real violation and not a free one
  (`server/INSIGHTS.md`, 2026-08-14).
- **Nothing in this feature writes to the intent, blast or prior-PR records.** It is a reader of
  all three.

## Contracts

The shared cross-package contract and its hand-made client copy are do-not-touch and
coordination only; a spec is where that agreement is recorded. Both copies move together, and
**every addition is a new symbol** — nothing existing is reshaped.

**Already present, and used unchanged:**

| Type | What it gives us | Change |
|---|---|---|
| `Risk`, `RiskSeverity` | the exact risk shape the requirement asks for — `kind`, `title`, `explanation`, `severity`, `file_refs` — already stored by `PrIntent.risk_areas` | none |
| `PrIntent`, `IntentStatus` | the intent record and its lifecycle, read as an input | none |
| `PrBlastRadius`, `BlastStatus`, `BlastReason`, `BlastEndpoint`, `BlastCounts` | the blast facts and the status vocabulary this feature's reasons extend rather than duplicate | none |
| `PrHistoryItem` | prior pull requests as an input | none |
| `FeatureModelId`, `FEATURE_MODELS` | the `risk_brief` entry, its label and its default model | none to the enum; see the default-provider question below |
| `StructuredRequest`, `StructuredResult` | the call shape and its `attempts`, `tokensIn`, `tokensOut`, `costUsd`, so AC-34 needs no new port field | none |

**New symbols, in both copies, added alongside the existing ones:**

| Type | Must carry |
|---|---|
| `RiskLevel` | `high`, `medium`, `low` — the requirement's three-value level, distinct from `RiskSeverity` because one is a property of the whole pull request and the other of one risk |
| `BriefStatus` | `ok`, `partial`, `degraded` — the same three the blast, prior-PRs and onboarding contracts already use |
| `BriefReason` | the index-side set carried through from the blast map — `index_missing`, `index_partial`, `index_failed`, `repo_too_large`, `no_changed_files` — plus this feature's own `no_intent`, `inputs_too_large`, `model_failed`, `model_timeout`, `model_invalid`, `restates_title` |
| `BriefSourceKind` | one value per input of AC-10: `pr_title`, `pr_body`, `file_list`, `intent`, `blast`, `linked_issue`, `prior_prs`, `repo_doc` |
| `BriefSourceStatus` | `used`, `unfetched`, `dropped_over_budget` — the third value is this feature's addition, because "we chose not to send it" is a different fact from "we could not read it" |
| `BriefSource` | a kind, a reference, a status, the character count that reached the prompt (null when nothing did), and a human reason (null when there is none) |
| `ReviewFocusItem` | a repository-relative path, an optional line, and a one-line reason |
| `BriefDiffStats` | files changed, files listed in the prompt, additions, deletions |
| `BriefGenerationState` | `never_generated`, `running`, `done` |
| `PrRiskBrief` | the pull request id; a nullable what and why; a nullable risk level; the risks; the review-focus entries; the diff stats; the status and its nullable reason; the sources; the head SHA and the cache key it was generated against; whether it is stale; the generation state; the generated-at time; the provider, model, round-trip count, input and output token counts and cost; and a nullable error |
| `GenerateBriefPayload` | an optional force flag — the same shape and the same meaning as `DeriveIntentPayload` |

**Deliberately not changed:**

- **`PrBrief`, and the `Intent`, `BlastRadius`, `Risks` and `PrHistory` it composes, stay
  exactly as they are.** `PrBrief` is `{ intent, blast, risks, history }` — a composition of
  four whole documents — and the requirement asks for `{ what, why, risk_level, risks,
  review_focus }`, which it cannot express: it has no what, no why, no level and no review
  focus, and its `BlastRadius` member requires a `summary` string only a model can write, which
  is why the L04 contract already declined to produce one. Reshaping it is not the answer and
  the rule is the repository's own — root `CLAUDE.md`, on the two `vendor/shared` copies: *"When
  a change is agreed, extend with a new file rather than reshaping an existing symbol."*
  `PrBrief` is **deliberately untouched**, it is not a cleanup item, and no task should remove
  it.
- **`Risk` is reused verbatim rather than given a brief-specific twin.** Its own contract
  comment already anticipates this: *"The PR Brief will compose the same `Risk` when it lands."*
  `Risk.kind` stays an open string so a model inventing a sixth kind is stored faithfully and
  the card falls back to a neutral icon, rather than the whole brief failing validation.
- **`why` is not used as a name for anything this feature adds.** `contracts/why.ts` is taken by
  `git-why`, the blame-timeline drawer. The field `why` on `PrRiskBrief` is fine; a type, a
  module or a contract file called `why` is not.
- **`FeatureModelId` gains no member.** `risk_brief` is already there and this feature is its
  first consumer. Its **default provider** is a separate matter — see OQ-10, and note that
  changing it is a three-place edit (both contract copies plus the client's feature-model list),
  because the Settings picker writes only one provider.

## Non-functional

Every figure below is either taken from an existing constant — which is said where it is — or
**proposed here and listed in `## Open questions`**. None is asserted as agreed.

**perf**

- Reading a stored brief: **p95 < 200 ms** server-side at ≤ 6 risks, ≤ 6 review-focus entries
  and ≤ 20 source entries, excluding cold start.
- Computing the cache key: **p95 < 300 ms** at 200 changed files and 10 effective documents.
  It is a set of primary-key reads plus one file stat per effective document — no network call,
  no model call, no document read. This budget is now on the **pull-request detail** path too,
  not only the brief read, because that is where the trigger sits (AC-58) — so it is a latency
  cost every reader of a pull request pays, whether or not they look at the card.
- The structured call is bounded by a **75 000 ms** deadline (AC-20), leaving ≥ 45 s of the job
  runner's fixed 120 s for assembly and persistence. This is the intent classifier's figure.
- A generation makes exactly **1** provider round-trip (AC-19); a read makes **0** model calls
  and **0** database writes (AC-1, AC-7).
- Layout stability: **0 px** of vertical movement in the cards below the brief when it lands,
  because the loading placeholder occupies the card's regions (AC-47).

**scale, as caps with their behaviour**

- **≤ 8 000 approximate tokens** of model input, counted by AC-12's rule. Above it, whole
  sources are dropped in the stated order (AC-14); if the core alone overruns, no call is made
  (AC-16).
- **≤ 200** changed paths listed in the prompt, with the remainder reported as a count (AC-17).
- **≤ 4 000** characters of the pull request's description and **≤ 8 000** of the linked issue's
  body — the intent classifier's `MAX_BODY_CHARS` and `MAX_SOURCE_CHARS`, so the two features
  read the same material at the same depth.
- **≤ 5** prior pull requests, each as number, title, merge date and overlapping paths.
- Out of the model: **≤ 6** risks (the intent layer's `MAX_RISK_AREAS`; six chips is already a
  wall), **≤ 3** file references per risk, **≤ 6** review-focus entries, **≤ 280** characters of
  what, **≤ 400** characters of why, **≤ 200** characters per review-focus reason, **≤ 80**
  characters per risk title and **≤ 400** per risk explanation. Excess is discarded whole, never
  truncated mid-item.
- A stored brief is therefore bounded to roughly **8 KB**.

**rate**

- **≤ 10** generations per pull request per hour, and **1** concurrent generation per pull
  request (AC-8). The automatic trigger (AC-58) is subject to **both**, which is what stops a
  reader reloading a pull request from spending ten model calls; a generation refused by either
  bound leaves the stored brief and its stale flag exactly as they were.
- The brief read is callable **≤ 60 req/min per workspace**.

**security**

- **Workspace-scoped; the pull-request lookup is the authorization check** (AC-35), performed
  before any derived row, document or clone path is read.
- Every foreign input reaches the model as **untrusted, delimiter-wrapped data**, wrapped
  exactly once, and none of it reaches the system message (AC-54, AC-55, AC-56).
- **No diff hunk body is sent** (AC-11).
- **Nothing is executed**, and nothing is written to GitHub or to the clone (N8).
- Reads of the clone are path-confined to the clone root with the prefix re-checked after
  symlink resolution — the existing confined document reader, not a second implementation.

**a11y**

- **WCAG 2.2 AA.** Every control keyboard-operable (AC-53). The risk level and each risk's
  severity are carried by a word plus an icon, never by colour alone (AC-37, AC-39).

**cost**

- Not budgeted. The **input** is budgeted (AC-13); the cost of a generation is recorded and
  shown on the card (AC-34, AC-52) so a real figure can be observed before anybody sets a limit
  against a made-up one.

## Inputs (provenance)

| Input | Comes from | Owned by | Exists today? |
|---|---|---|---|
| Pull request title, branch, base, head SHA | `pull_requests`, written by both the list and the detail route | us | **yes** |
| Pull request description | `pull_requests.body`, written **only** by the detail route | the pull request's author — i.e. **not us** | **yes**, and often absent until somebody opens the pull request (EC-1, EC-2) |
| Changed files with per-file additions and deletions | `pr_files`, written **only** by the detail route | GitHub | **yes**, and sparse by default |
| Diff hunk bodies | `pr_files.patch` | GitHub | **present and deliberately unread** (AC-11, N5) |
| Intent, scope and the intent's own risk areas | the stored intent record | us | **yes** — including `status`, `head_sha` and a provenance trail |
| Blast facts: changed symbols, callers, impacted endpoints and crons, counts, status, indexed SHA | the blast map, derived fresh from the persistent index | us | **yes** — no cache, no freshness rule, no model call |
| Prior pull requests overlapping these files | the prior-PRs read over `pr_files` | us | **yes** — and in its `partial` state by default, because `pr_files` is sparse |
| The linked issue's title and body | parsed from the description as `#n` or a same-repository URL, fetched live from GitHub | the issue's author — i.e. **not us** | **partly** — the intent layer already does exactly this and records only the metadata; **no issue body is stored anywhere**, which is why it cannot be in the cache key (EC-9) |
| The relevant repository documents | the Project Context attachment resolution, taken over the repository's **enabled agents** and unioned (AC-59) | the repository being reviewed — i.e. **not us** | **partly** — the per-agent resolution exists and is reused unchanged; the union over enabled agents is new, and is what gives a brief — which has no agent of its own — a document set at all (decided 2026-08-19, OQ-1) |
| Smart Diff's role classification of the changed files | the smart-diff derivation | us | **yes** — not consumed by this spec's criteria; see the proposal in OQ-7 |
| The model and provider | the workspace's `risk_brief` feature-model choice | the workspace | **yes**, with zero callers today (EC-23) |
| Round-trips, tokens, cost | the structured result | us | **yes** — the result already carries all four |
| The stored brief | the `pr_brief` table | us | **partly** — the table exists with a pull-request id and a json blob and **nothing else**; it needs the provenance and cache-key columns of `## Contracts` (EC-25) |
| The card's copy | the client's message catalogues | us | **partly** — `brief.json` exists and describes the older composed shape (EC-26) |
| The link into `Files changed` | the diff tab | us | **no** — the tab is a URL parameter and each diff line already has a DOM anchor, but no file or line target parameter exists and nothing consumes the anchor |

## Untrusted inputs

**Most of what this feature reads is text a stranger wrote**, on a repository that may be
public, and one thing it produces is a list of links a reviewer is invited to click. All of it
is data; none of it is an instruction.

- The pull request's **title and description**, the **linked issue's title and body**, the
  **attached repository documents**, **file paths**, **symbol names**, **endpoint strings** and
  **prior pull-request titles** are all foreign. Every one of them enters the prompt inside
  untrusted delimiters, in the **user** message (AC-54). The system message is the rendered
  template and nothing else (AC-55).
- This module assembles its own prompt rather than going through the review path's assembler, so
  it inherits **no** wrapping automatically. That is the point of the layering decision already
  on the record: where a "is this input trusted?" decision lives is a layering choice, and the
  answer here is the **service**, not the engine (`server/INSIGHTS.md`, 2026-08-05). The
  wrapping is this module's job, done once per input at the boundary where the provenance is
  known — once, never twice (AC-56), because a double-wrapped block reads to the model as data
  about data.
- The wrapper escapes any attempt to close it, so an input containing `</untrusted>` cannot
  break out of its own block (EC-30).
- The injection guard the review path appends is written to disregard "ignore", "do not flag"
  and "this is only a fixture" **in any language**. This spec adds no pattern matching of its
  own: matching hostile phrasing only ever catches one phrasing.
- **The model's own output is untrusted too**, and this is the part specific to this feature.
  Every file reference, every review-focus path and every endpoint it returns is checked against
  the input data before it is stored (AC-22, AC-24, AC-25). A review-focus row pointing at a
  file the pull request never touched is not a quality problem — it is a link a reviewer clicks
  that goes nowhere, and the intent layer already records that reasoning for its own risk chips.
- This spec's own text reaches a reviewing model as untrusted, delimiter-wrapped data. It
  therefore addresses no model and contains no instruction to one.

## Traceability

| AC | Serves | Package | Verify |
|---|---|---|---|
| AC-1 | US-6, G5 | server | test |
| AC-2 | US-6, EC-2, EC-4 | server | analysis |
| AC-3 | US-6, US-8, EC-2 | server | test |
| AC-4 | US-6, US-7 | server | test |
| AC-5 | US-6 | server | test |
| AC-6 | US-7, EC-9, EC-10 | server | test |
| AC-7 | perf budget | server | test |
| AC-8 | EC-19 | server | test |
| AC-9 | EC-20 | server | test |
| AC-10 | US-1, US-8, G2 | server | inspection |
| AC-11 | US-9, G2, security | server | test |
| AC-12 | US-9, G3 | server | test |
| AC-13 | US-9, G3, scale cap | server | test |
| AC-14 | US-8, US-9, EC-29 | server | test |
| AC-15 | US-3, US-4 | server | test |
| AC-16 | US-9, EC-29 | server | test |
| AC-17 | US-9, scale cap, EC-29 | server | test |
| AC-18 | US-9, G3 | server | test |
| AC-19 | US-9, EC-21 | server | test |
| AC-20 | perf budget, EC-20, EC-21 | server | test |
| AC-21 | US-9, EC-22, EC-23 | server | test |
| AC-22 | US-3, G4, EC-12, EC-17 | server | test |
| AC-23 | US-3, G4 | server | test |
| AC-24 | US-4, US-5, G4, EC-12 | server | test |
| AC-25 | US-3, G4, EC-13 | server | test |
| AC-26 | US-2, EC-15 | server | test |
| AC-27 | US-1, EC-14 | server | test |
| AC-28 | US-8, G7, EC-1 | server | test |
| AC-29 | US-8, G7, EC-21, EC-22 | server | test |
| AC-30 | US-8, G7 | server | test |
| AC-31 | US-8, G7, EC-5 | server | test |
| AC-32 | US-8, G7, EC-6, EC-7 | server | test |
| AC-33 | US-8, EC-8, EC-11 | server | test |
| AC-34 | US-6, US-9 | server | test |
| AC-35 | security scope | server | test |
| AC-36 | US-1, US-2 | client | test |
| AC-37 | US-2, a11y budget | client | test |
| AC-38 | US-1 | client | test |
| AC-39 | US-3, a11y budget, EC-31 | client | test |
| AC-40 | US-5, G6 | client | test |
| AC-41 | US-5, G6 | client | test |
| AC-42 | US-5, EC-34 | client | test |
| AC-43 | US-5, EC-3, EC-18 | client | test |
| AC-44 | US-7, EC-28 | client | test |
| AC-45 | US-7 | client | test |
| AC-46 | US-7 | client | test |
| AC-47 | perf budget (layout stability) | client | test |
| AC-48 | US-8, EC-6, EC-7 | client | test |
| AC-49 | US-8 | client | test |
| AC-50 | US-6, US-7, EC-32 | client | test |
| AC-51 | US-8 | client | test |
| AC-52 | US-9 | client | test |
| AC-53 | a11y budget, EC-29, EC-33 | client | demonstration |
| AC-54 | US-10, EC-30, security | server | test |
| AC-55 | US-10, security | server | test |
| AC-56 | US-10, security | server | test |
| AC-57 | US-8, G7, EC-1, EC-29 | server | test |
| AC-58 | US-6, US-7, EC-2, EC-19 | server | test |
| AC-59 | US-3, US-4, EC-11 | server | test |
| — | EC-16 | — | `accepted` — the caps in `## Non-functional` bound what is stored and excess is discarded whole; no criterion of its own, because the criterion it would duplicate is the cap itself. |
| — | EC-24 | — | `accepted` — a brief stored under an earlier shape is read back through a validating parse rather than a cast, and a payload that does not parse is treated as no brief and offered for regeneration. Recorded as an edge case because the failure mode it prevents — an absent key, not a null one — has cost this repository twice. |
| — | EC-25 | — | `accepted` — the existing `pr_brief` table is a name and a json column; the columns of `## Contracts` are new work, and `## Open questions` does not need to ask whether to add them. |
| — | EC-26 | — | `accepted` — the card ships its own message namespace and does not read `brief.json`'s existing keys, which name a shape this feature does not produce. Changing or deleting the shipped file is a separate product decision; leaving it unread costs nothing, and reading it is exactly the mistake that put "Brief not available yet." on the Intent card. |
| — | EC-27 | — | `accepted` — decided on 2026-08-19 (OQ-4, N2): the regenerate control belongs to the brief card and not to the verdict banner, which does not appear on this tab at all, so the design's placement is not followed. AC-36 asserts the banner's absence; this row records that the divergence from the mock is deliberate. |
| — | EC-33 | — | `accepted` — every file reference this card renders carries a real target (AC-40 for a review-focus row; a risk's references are rendered as plain text where no target exists), so the do-nothing-button shape cannot arise. |

## Open questions

Twelve were asked. **The four blocking ones were answered by the user on 2026-08-19**, each on
the default this spec proposed; they are kept below as a record that they were asked and how
they closed, because a plan and a reviewer will want to see both. **Every decision now lives in
the section that owns it** — the four entries below are an index into the body, not a second
place to read the requirement from. Eight remain open at their stated value.

**Decided — 2026-08-19**

| # | Decided | Because | Now lives in |
|---|---|---|---|
| OQ-1 | **The effective document set is the union of the effective document sets of the repository's enabled agents**, deduplicated by path with the first occurrence winning, ordered by agent then by attachment order, and capped by the budget. | It is the only mechanism in this product where a **person** has said "this document is relevant" — a repository-wide walk has no relevance signal at all and would put every document into an 8 000-token budget. Reusing the per-agent resolution also means a brief and a review read the same documents in the same order. | **AC-59**, AC-2, AC-10, AC-14, `## Inputs (provenance)` |
| OQ-2 | **Opening the pull request's detail generates a brief in the background** when no stored brief matches the computed cache key. The regenerate control remains the explicit force path. | The requirement's own acceptance criterion — "re-opening the same pull request state reads the cache with no new model call" — presupposes that a first open produced one. The detail route is also the **only** writer of `pull_requests.body` and `pr_files`, so it is the one place a trigger sees the material it is classifying. | **AC-58**, AC-6, AC-46, **N11**, `## Non-functional` (perf, rate), `## Cross-module interactions` |
| OQ-3 | **A review-focus entry may cite only files in the pull request's changed set.** | Its whole contract is that it navigates into the `Files changed` tab, and that tab contains only changed files — a row that cannot navigate is worse than a missing row. **Consequence: the design's fourth review-focus row, `src/api/users.ts`, is a design bug rather than a feature**, and is recorded as one. A risk's file references are deliberately wider (AC-22), because a risk is not required to be clickable. | **AC-24**, AC-22, **N13**, EC-12 |
| OQ-4 | **The verdict banner does not move.** It stays on the `Agent runs` tab; the brief card carries its own risk level, its own regenerate control and its own cost line. | The banner is review output and a brief exists before any agent has run, so on the `Overview` tab of an un-reviewed pull request it would be an empty headline. Duplicating a built component across two tabs is a separate product decision with its own cost. | **N2**, AC-36, EC-27, `## Traceability` (EC-27's row) |

**Still open — the spec carries the stated value**

- **OQ-5** — `[NEEDS CLARIFICATION: AC-26 risk-level source]` The spec derives the level from
  the highest surviving risk severity, with no risks meaning `low`. *Alternative:* the model
  returns the level directly, which lets it say "high" for a pull request whose individual risks
  are each low — at the cost of a badge that can contradict the list beneath it.
- **OQ-6** — `[NEEDS CLARIFICATION: AC-2 cache-key material]` The nine values are derived from
  what the server can observe locally with no network call and no model call. Confirm the list —
  in particular that the intent's derived-at time and the blast map's indexed SHA belong in it,
  and that a document's byte size is an acceptable stand-in for its content (EC-10).
- **OQ-7** — `[NEEDS CLARIFICATION: AC-17 changed-file cap and its ordering]` 200 paths is
  proposed; at roughly 14 tokens a path that is about a third of the budget. The paths are
  currently listed in `pr_files` order. *Proposal worth weighing:* order them by Smart Diff's
  role — `core`, then `wiring`, then `boilerplate` — so a 400-file pull request spends the cap
  on the files that carry the change rather than on its lock file.
- **OQ-8** — `[NEEDS CLARIFICATION: AC-27 restated-title handling]` The spec stores no what and
  marks the brief partial. *Alternatives:* store it anyway and let the reader judge; or reprompt
  once, which costs a second round-trip and contradicts AC-19.
- **OQ-9** — `[NEEDS CLARIFICATION: AC-30 degraded-card content]` The spec shows the
  deterministic figures and no review-focus list. *Alternative:* synthesise a deterministic
  review focus from Smart Diff's `core` group, highest churn first — useful, but each row would
  have no reason beside it, and a reason is what a review-focus row is for.
- **OQ-10** — `[NEEDS CLARIFICATION: the `risk_brief` default model]` It is registered as
  `openai` / `gpt-4.1`, and Settings → Feature Models writes `provider: "openrouter"` for every
  pick — so the moment anybody touches the picker the default can never be restored from the UI.
  *Proposed default:* change it to an OpenRouter model, which is a **three-place** coordinated
  edit (both `vendor/shared` copies and the client's feature-model list). *Alternative:* leave
  it and accept EC-23.
- **OQ-11** — `[NEEDS CLARIFICATION: AC-42 link precision]` The requirement says a review-focus
  row leads to the **file**; the design draws `path:line`. The spec navigates to the file and
  scrolls to the line when the entry carries one. Confirm that a line is wanted at all, since it
  makes the model responsible for a number nothing grounds against a hunk.
- **OQ-12** — `[NEEDS CLARIFICATION: `## Non-functional` figures]` The latency budgets, the
  caps, the rate limits and the ≤ 8 KB stored size are proposals except where a figure is
  identified as an existing constant. The one figure that is **not** a proposal is the 8 000
  approximate tokens of AC-13, which comes from the requirement.

`Status` stays **`draft`**. Eight questions are still open, and an empty `## Open questions` is
the precondition for a human to promote a spec to `approved` — it is not the promotion, and no
agent may grant it.

## History

2026-08-19 — spec written.
2026-08-19 — the four blocking questions answered by the user, each on the default the spec
proposed. Each decision moved into the section that owns it, and two of them turned a default
into a requirement no criterion yet stated: **AC-58** (the detail read triggers a generation)
for OQ-2, and **AC-59** (the effective document set is the union over enabled agents) for
OQ-1. AC-36 gained the assertion that the verdict banner is absent from `Overview`, N11 was
narrowed from "automatic regeneration" to "scheduled regeneration", and the cache-key latency
budget moved onto the pull-request detail path where the trigger now sits. OQ-5 … OQ-12 remain
open. `Status` unchanged at `draft`.
