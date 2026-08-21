# Spec: Onboarding Generator | Spec ID: SPEC-02 | Status: approved
Supersedes: —

A developer who has never seen a repository can open one screen and get a grounded, five-part
tour of it — what the architecture is, which files carry the load, how to run it, what to read
first, and what to do first — generated from the repository's own index with a single model
call, and honest about what it could not see.

## Problem & why

DevDigest already knows a great deal about a repository it has imported: an import graph, a
PageRank over that graph, per-file endpoint and cron facts, a token-budgeted repo map, and an
index state that says how complete all of it is. Every one of those facts today serves a
**pull request**. Nothing serves the person who has just been handed the repository and has
no pull request to look at yet.

The plumbing for this feature exists and is unused, in more places than for any feature so
far — the same shape `server/INSIGHTS.md` records for the conventions extractor (2026-08-06)
and for Project Context (2026-08-18), and the reason that entry gives for searching contracts
and message catalogues before the module tree:

- **The contracts.** `Onboarding`, `OnboardingSection` and `OnboardingLink` sit under an
  `// ---- Onboarding ----` heading in both copies of the shared contracts.
- **The table.** `onboarding` (`repo_id` primary key, `json`, `generated_at`) shipped in the
  **first** migration and has no reader and no writer anywhere in the server.
- **The prompt.** `onboarding.system.md` is a written, parameterised system prompt — five
  sections supplied through `{{sections}}`, mermaid rules, grounding rules, an explicit
  untrusted-data clause — paired with no schema, no `schemaName` and no mock fixture.
- **The model choice.** `FEATURE_MODELS`' first entry is `onboarding` / "Onboarding Tour" /
  "Writes the per-repo onboarding tour", defaulting to a flash-class OpenRouter model. It has
  zero callers outside the resolver's own test.
- **The index reads.** `RepoIntel.getTopFilesByRank` and `RepoIntel.getCriticalPaths` are
  implemented, and their doc comments name this feature — "T3: onboarding reading-path +
  critical paths".
- **The client.** `shell.json` carries `nav.onboarding-tour: "Onboarding Tour"`, a whole
  `messages/en/onboarding.json` namespace is written, and `activeKeyFor` already returns the
  key `onboarding-tour`.
- **Even the engine.** `structured.ts` explains its JSON-parsing order with the example
  "markdown code blocks in an onboarding `body`", and `grounding.ts` names onboarding among
  the full-file scanners.

Exactly two things are missing: a **server module** that turns those facts into a tour, and a
**screen** that reads it. Everything else is either already there or is a decision this spec
records.

The feature also has a second purpose, which is why the call budget is a requirement rather
than a preference: it is the demonstration that a genuinely useful generated artefact can cost
**one** model call, because everything expensive was computed deterministically first.

## Goals / Non-goals

**Goals**

- **G1** Produce, per repository, a five-part tour: architecture overview, critical paths, how
  to run locally, a guided reading path, and first tasks.
- **G2** Derive every fact the tour rests on deterministically — from the repository index, the
  import graph and the repository's declared command sources — before any model call.
- **G3** Order the reading path by the index's own file rank, not alphabetically and not by
  date.
- **G4** Turn those facts into prose with **one** structured model call, and make the number of
  provider round-trips and the cost of that call observable.
- **G5** When the index is incomplete or the model call fails, show a deterministic skeleton
  with an honest status and a named reason — never an error page and never a silent
  half-answer.
- **G6** Say, on the screen, what the tour was generated from and how old it is.

**Non-goals** — each with its reason, because each is something a reader of the design will
otherwise assume is included.

- **N1 Onboarding to DevDigest itself.** The tour is about the **repository under review**.
  This is settled by the code, not chosen here: the `onboarding` table is keyed by `repo_id`,
  the feature-model entry says "the per-repo onboarding tour", and the design's breadcrumb is
  `acme/payments-api › Onboarding Tour` with the entry in the **WORKSPACE** sidebar group,
  which is the repository-scoped group.
- **N2 Any change to `reviewer-core`.** A server-side structured call reaches the model through
  the container's `LLMProvider` port exactly as the conventions extractor and the intent
  classifier do; the engine is imported only for the provider implementation the container
  already wires. Its existing behaviour — `parseWithRepair` re-validating against the Zod
  schema, `toJsonSchema` stripping numeric-range keywords, `wrapUntrusted` — is **relied upon
  and unchanged**.
- **N3 More than one structured model call per generation.** No file-selection pass, no
  per-section call, no map-reduce. The deterministic layer does the selecting.
- **N4 Writing the tour into the repository.** The workspace setting `sync_to_folder` exists,
  defaults to `true`, and its Settings copy promises that "onboarding tours and digests are
  written to the repo folder" — and **no code acts on it**. This feature does not begin to,
  and the reason is the same one Project Context recorded under its own N4: the clone is a
  read-only mirror that `sync` puts through `git reset --hard origin/<branch>`, and the
  `GitClient` port carries no write, commit, branch or push method at all. A tour written into
  the clone is deleted by the next resync, with no error and nothing in the log. **Decided on
  2026-08-19: the tour lives in the database only, and `sync_to_folder` stays unread.**
- **N5 Automatic or scheduled regeneration.** A tour is generated when a person asks for it. A
  screen that regenerates itself spends money on every visit.
- **N6 Switching on `hotness`.** The index's `rank` is defined as `pagerank × (1 + hotness)`
  and `hotness` is written as a literal `0`, because the clone is shallow — depth 1 at clone,
  depth 50 at resync — so there is no churn window to measure. **Decided on 2026-08-19:
  `hotness` stays `0`.** The reading path is ordered by `rank`, which *is* the requirement's
  formula by definition (AC-5); its recency half is **inert today**, and the spec says so
  rather than implying a recency signal the system does not have. The `hotness` column exists
  precisely so the term can be switched on later **without a schema change** — but switching it
  on means deepening the clone or adding a commit-history pass, which is a change to the
  **indexing pipeline** and is out of this feature's scope.
- **N7 A per-user, per-branch or per-pull-request tour.** One tour per repository, at the
  repository's default branch, keyed by `repo_id`. Any user of the workspace may read it and
  regenerate it, and everyone sees the same one — so a regeneration replaces what a colleague
  was reading (AC-28).
- **N8 Tour history or versions.** A generation replaces the stored tour. Nothing keeps the
  previous one.
- **N9 A file viewer inside DevDigest.** The design's `Open` control has no in-app destination:
  the only code view this product has is the pull-request diff viewer, which is PR-scoped. It
  therefore links **out**, to the file on the repository host at the SHA the tour was generated
  from (AC-47).
- **N10 Executing anything.** DevDigest never runs a command it derived or a command the model
  returned. The run-locally section is text to copy.
- **N11 A `routes_and_apis` section.** The shipped prompt template mentions one; the design and
  the requirement both name five sections and that is not among them. The endpoint facts feed
  the architecture section instead.
- **N12 Translation.** The prompt template takes a `{{language}}` and there is no configured
  source for it. English, filled as a constant, with no picker (EC-23).
- **N13 A cost or usage screen.** The call count and cost are recorded and logged (AC-12,
  AC-13); putting them on the tour screen is a proposal, not a requirement.
- **N14 A shared or public tour link.** `Share link` copies **this screen's URL** and nothing
  else (AC-46) — no token, no public route, no expiry. A link that reads without a session
  would be this product's first unauthenticated read path into a private repository's
  structure, and that is its own feature with its own authorization design.

**Smallest version still worth shipping.** The deterministic fact collection, the single
structured call, the stored tour, and a screen that renders the five sections with an honest
status. First tasks and the diagram are the two parts that could be dropped and still leave the
demo intact — open an unfamiliar open-source repository, read the tour, and check the logs for
one call and its cost.

## User stories

- **US-1** As a developer new to a repository, I want a short architecture overview grounded in
  that repository's real files, so I can orient without reading the whole tree.
- **US-2** As a developer new to a repository, I want to know which files are load-bearing and
  why, so I know what I must not break.
- **US-3** As a developer new to a repository, I want the commands that actually start it
  locally, taken from what the repository declares rather than from folklore.
- **US-4** As a developer new to a repository, I want a numbered reading order with one line of
  justification per file, so my first hour is spent in the right files.
- **US-5** As a developer new to a repository, I want two or three concrete first tasks with a
  starting path, so my first contribution is not choosing what to contribute.
- **US-6** As a reader of a generated document, I want to know how complete the underlying
  index was and when the tour was generated, so I can tell a thin tour from a stale one.
- **US-7** As a maintainer, I want to regenerate the tour on demand after the repository has
  moved on.
- **US-8** As the person paying for the model, I want to see how many calls a generation made
  and what it cost.
- **US-9** As a security-conscious user, I want the commands a tour shows me to come from
  declared, inspectable sources rather than from prose a stranger wrote.

## Acceptance criteria (EARS)

### AC-1 … AC-30 — server

- **AC-1** — WHEN a client requests a repository's onboarding tour and one has been generated,
  the system **shall** answer its sections in the fixed order `architecture`,
  `critical_paths`, `run_locally`, `reading_path`, `first_tasks`.
  `Verify: test` — *observable: two consecutive reads of an unchanged tour return the five
  `kind` values in that same order; the order is the contract's, not the model's, so a model
  that returns them shuffled cannot reorder the screen.*
- **AC-2** — WHERE no tour has ever been generated for a repository, the system **shall**
  answer `200` with no sections and a generation state of `never_generated`.
  `Verify: test` — *observable: a freshly imported repository answers `200`, not `404`; a
  local-first tool with nothing generated yet is an ordinary state, exactly as the blast-radius
  contract already treats a missing index.*
- **AC-3** — WHEN a generation is requested for a repository, the system **shall** answer `202`
  with a job identifier without holding the request open for the model call.
  `Verify: test` — *observable: the response returns in under a second while the mock provider
  has not yet been called; this mirrors `POST /repos/:id/resync`, which is the existing
  long-running-work shape in this server.*
- **AC-4** — WHILE a generation is running for a repository, the system **shall** refuse a
  second generation request for that repository rather than starting a second one.
  `Verify: test` — *observable: two requests in flight produce one accepted response and one
  conflict, and the mock provider records exactly one call.*
- **AC-5** — The reading path **shall** be ordered by the index's file rank descending — the
  quantity the index defines as `pagerank × (1 + hotness)` — and not alphabetically, and not by
  modification date.
  `Verify: test` — *observable: for a fixture index whose ranks are `0.9`, `0.5`, `0.1` on
  paths that sort alphabetically in the opposite order, the reading path returns them
  rank-first. `hotness` is `0` for every file today (N6), so the product currently equals
  PageRank; the criterion is written against the defined quantity so that switching hotness on
  later changes the data and not this requirement.*
- **AC-6** — The reading path **shall** exclude any path the index classifies as a test,
  specification, declaration, migration or tool-config file.
  `Verify: test` — *observable: a fixture index whose two highest-ranked paths are
  `src/a.test.ts` and `vitest.config.ts` yields neither; this is the same junk filter the
  conventions sampler already uses, and reusing it is what keeps two features from disagreeing
  about what "a real source file" means.*
- **AC-7** — The critical paths **shall** be the index's dependency chains, seeded from the
  five highest-ranked files and followed at most two hops.
  `Verify: test` — *observable: at most five chains, each of two or three paths, each path
  distinct within its chain.*
- **AC-8** — Every repository path a stored tour names — in a link, a critical path, a reading
  path entry or a first task — **shall** exist in that repository's index.
  `Verify: test` — *observable: a model response naming `src/does-not-exist.ts` has that item
  dropped and the rest of the section stored; the tour never shows a path that cannot be
  opened.*
- **AC-9** — WHEN a generation runs, the system **shall** issue exactly one structured model
  request.
  `Verify: test` — *observable: the mock provider records one `completeStructured` call for one
  generation, whatever the size of the repository.*
- **AC-10** — WHEN a generation runs, the system **shall** make at most **two** provider
  round-trips — the structured request and at most one schema-repair reprompt.
  `Verify: test` — *observable: the `attempts` figure recorded for a generation is never above
  2, and a provider that returns a schema-violating payload twice ends the generation as
  degraded instead of trying a third time. This criterion exists because the provider's own
  retry count defaults to **2**, i.e. three round-trips, and the per-request `timeoutMs` field
  is silently ignored — both recorded in `server/INSIGHTS.md` (2026-08-06). Without it, "one
  call" is a description of the code and not a budget. Two is the decided ceiling: one
  round-trip with no repair at all wastes a whole generation whenever a model returns a nearly
  valid payload.*
- **AC-11** — The structured request **shall** be bounded by a deadline of **75 000 ms**,
  after which the generation completes without it.
  `Verify: test` — *observable: with a provider that never resolves, the generation finishes
  and stores a degraded tour; the bound is an explicit race, because the request field that
  looks like a timeout is not read. 75 s leaves 45 s of the job runner's 120 s hard timeout for
  fact collection and persistence.*
- **AC-12** — WHEN a generation completes, the system **shall** record against that
  repository's tour the model identifier, the number of provider round-trips, the input and
  output token counts, and the cost in USD.
  `Verify: test` — *observable: after one generation, all five figures are readable back; the
  round-trip count is the one figure **no** existing feature in this server records — neither
  `convention_scans` nor `pr_intent` nor `agent_runs` has a column for it — so it is new work,
  not a read of something already there.*
- **AC-13** — WHEN a generation completes, the system **shall** emit one log line naming the
  repository, the model, the round-trip count, the token counts and the cost.
  `Verify: demonstration` — *observable: generating a tour prints a single line carrying all
  five figures. Today no structured-call site in this server logs either the cost or the call
  count, so "check the number of calls and the cost in the logs" is not satisfiable without
  this criterion.*
- **AC-14** — The model a generation uses **shall** be the workspace's `onboarding`
  feature-model choice, falling back to the registry default when the workspace has not chosen
  one.
  `Verify: test` — *observable: with an override stored for `onboarding`, the request the mock
  records carries that model; with none, it carries the registry default.*
- **AC-15** — IF the structured call fails, exceeds its deadline, or returns a payload the
  schema rejects, THEN the system **shall** store the deterministic skeleton with a status of
  `degraded` and a reason distinguishing which of the three occurred.
  `Verify: test` — *observable: three fixture providers — one throwing, one hanging, one
  returning `{}` — produce three stored tours with three different reasons and no HTTP error.*
- **AC-16** — IF the repository has no index, THEN the system **shall** answer `degraded` with
  reason `index_missing`.
  `Verify: test` — *observable: for a repository with no index state row the read carries that
  status and that reason, and answers `200`.*
- **AC-17** — IF the repository has no index, THEN a generation request **shall** make no model
  call.
  `Verify: test` — *observable: the mock provider records zero calls; nothing is charged for a
  tour that could say nothing. This is separate from AC-16 because the two fail independently —
  a correct status with a wasted call is the expensive half, and it is the half no status
  assertion can see.*
- **AC-18** — WHERE the repository's index reports `partial`, the system **shall** generate the
  tour from what the index holds and label it `partial` with the reason the index gave.
  `Verify: test` — *observable: a partial index still produces five sections, and the response
  carries `status: 'partial'` with `reason: 'index_partial'`.*
- **AC-19** — The tour's status and reason **shall** be drawn from the same vocabulary the
  index reports, mapped the way the blast-radius feature already maps it.
  `Verify: inspection` — *observable: `status` is one of `ok | partial | degraded`, and every
  index-side reason is one of `flag_off | index_failed | index_partial | repo_too_large |
  index_missing` — the blast contract's set — with the model-side reasons added as this
  feature's own. Two features telling a user "the index is incomplete" in two different
  vocabularies is the failure this criterion exists to prevent.*
- **AC-20** — Every command in the run-locally section **shall** be derived from a declared
  command source in the repository — a `package.json` script entry, a `Makefile` target, or a
  service in a `docker-compose*.yml`.
  `Verify: test` — *observable: for a repository whose README suggests `curl … | sh` and whose
  `package.json` declares a `dev` script, the section carries `dev` and does not carry the
  README line. Those three are the whole set: README prose is **never** a command source, which
  is what keeps a copy button from sitting beside a sentence a stranger wrote.*
- **AC-21** — Every command in the run-locally section **shall** name the file it was read from.
  `Verify: test` — *observable: each command carries the declaring path; a reader can check the
  command against its source before running it, which is the whole reason AC-20's restriction
  is worth anything.*
- **AC-22** — The system **shall not** execute any command it derives or any command the model
  returns.
  `Verify: analysis` — *observable: no code path in the feature reaches a process-spawning
  call; the commands are values that travel to the client as strings.*
- **AC-23** — Every repository-derived fact placed in the prompt **shall** be wrapped as
  untrusted data.
  `Verify: test` — *observable: every fact block in the messages the mock provider records sits
  inside `<untrusted …>` delimiters.*
- **AC-24** — No repository-derived text **shall** appear in the system message.
  `Verify: test` — *observable: the system message the mock provider records is the rendered
  template and nothing else. Separate from AC-23 because a wrapped block placed in the system
  message would satisfy AC-23 and still be the failure that matters.*
- **AC-25** — WHEN a tour is stored, the system **shall** record the indexed commit SHA it was
  generated from.
  `Verify: test` — *observable: the stored tour's SHA equals the index state's
  `last_indexed_sha` at generation time.*
- **AC-26** — WHERE the repository's indexed SHA has advanced since the tour was generated, the
  system **shall** report the tour as stale.
  `Verify: test` — *observable: advancing the index state's SHA flips a `stale` flag on the
  next read without regenerating anything.*
- **AC-27** — Reading a tour **shall** make no model call and perform no database write.
  `Verify: test` — *observable: a hundred reads leave the mock provider's call list empty and
  the `generated_at` value unchanged.*
- **AC-28** — WHEN a generation succeeds, the system **shall** replace the repository's single
  stored tour.
  `Verify: test` — *observable: two generations leave exactly one stored tour for that
  repository; the table is keyed by repository and holds no history (N8).*
- **AC-29** — The system **shall** resolve the repository within the caller's workspace before
  reading any index row or any file from the clone.
  `Verify: test` — *observable: a repository id belonging to another workspace answers
  not-found, and no clone path is resolved.*
- **AC-30** — WHEN a model response carries more items than a section's cap allows, the system
  **shall** keep the first items in the order returned and discard the excess, rather than
  truncating an item.
  `Verify: test` — *observable: a response with twenty first tasks stores six whole tasks, not
  six-and-a-fragment. The caps themselves are in `## Non-functional`.*

### AC-31 … AC-47 — client

- **AC-31** — WHERE a repository is active, the client **shall** offer an `Onboarding Tour`
  entry in the `WORKSPACE` sidebar group, between `Pull Requests` and `Project Context`.
  `Verify: test` — *observable: the sidebar renders the three entries in that order; the label
  and its message key already exist.*
- **AC-32** — WHILE the add-a-repository screen is open, the client **shall not** mark the
  `Onboarding Tour` sidebar entry as active.
  `Verify: test` — *observable: on the add-repository route the active sidebar key is not
  `onboarding-tour`. Today it is: the active-key helper matches any path containing
  `/onboarding`, and the add-repository screen lives at exactly that path (EC-25).*
- **AC-33** — WHEN the tour screen loads for a repository with no tour, the client **shall**
  show a single empty state offering generation.
  `Verify: test` — *observable: one empty state renders and five empty section cards do not.*
- **AC-34** — WHILE a generation is running, the client **shall** show a running state on the
  screen while the rest of the shell stays navigable.
  `Verify: test` — *observable: the running indicator renders and the sidebar links are still
  present and clickable in the same tree.*
- **AC-35** — WHEN a tour is present, the client **shall** render its five sections in the
  order the server returned them, each reachable from an on-this-page rail.
  `Verify: test` — *observable: five section headings render in server order and the rail
  carries five links that resolve to them.*
- **AC-36** — The client **shall** render each section's markdown body with a renderer that
  displays headings, lists and fenced code blocks.
  `Verify: test` — *observable: a body containing `## Heading`, `- item` and a fenced block
  renders a heading element, a list element and a code block. The vendored `<Markdown>`
  primitive maps only `p`, `strong`, `code` and `a`, so a document-shaped body collapses into
  one undifferentiated wall of text through it — `client/INSIGHTS.md`, 2026-08-05 — and that
  primitive is do-not-touch, so this feature brings its own renderer rather than widening it.*
- **AC-37** — WHERE a section carries a diagram, the client **shall** render it as a diagram.
  `Verify: test` — *observable: the architecture section's diagram string reaches the diagram
  renderer rather than being printed as text.*
- **AC-38** — IF a section's diagram cannot be rendered, THEN the client **shall** render the
  rest of that section and report the diagram as unavailable in its place.
  `Verify: test` — *observable: an invalid diagram string leaves the section's body and links
  rendered, with an inline notice where the diagram would be, and no thrown render.*
- **AC-39** — WHEN a run-locally command's copy control is used, the client **shall** place
  that command's exact text on the clipboard.
  `Verify: test` — *observable: the clipboard write receives the command string verbatim,
  including any trailing comment, and nothing is executed.*
- **AC-40** — The client **shall** show, beside the title, how many files the tour was
  generated from and how long ago it was generated.
  `Verify: test` — *observable: both figures render from the tour's own recorded values, not
  from the current index state, so an old tour does not claim today's coverage.*
- **AC-41** — WHERE a tour is stale or partial, the client **shall** show a notice above the
  sections naming the reason, with the sections still rendered below it.
  `Verify: test` — *observable: the notice and all five sections are in the tree at once — the
  shape the blast-radius card already uses for a partial index, where hiding the data would be
  less honest than labelling it.*
- **AC-42** — WHERE a tour is degraded, the client **shall** show the deterministic skeleton
  under a notice naming the cause.
  `Verify: test` — *observable: the degraded notice names the reason and the skeleton's
  sections render; the copy does not read as a complete tour.*
- **AC-43** — IF a reason value is one the client does not recognise, THEN the client **shall**
  show its generic notice rather than the raw value.
  `Verify: test` — *observable: an unknown reason renders the generic sentence, not an enum
  literal and not a message-key path.*
- **AC-44** — IF the tour request fails, THEN the client **shall** show an inline error on this
  screen while the shell stays navigable.
  `Verify: test` — *observable: the error text renders inside the screen and the sidebar and
  breadcrumb are still in the tree.*
- **AC-45** — Every control on the tour screen **shall** be operable without a pointer.
  `Verify: demonstration` — *observable: regenerate, share, every rail link, every copy button
  and every `Open` control are reachable by keyboard and carry an accessible name. Note that
  jsdom synthesizes no click for Enter on a focused native button and this package has no
  `user-event` dependency (`client/INSIGHTS.md`, 2026-08-19), so the automated half of this
  asserts reachability and accessible name; activation is demonstrated.*
- **AC-46** — WHEN the `Share link` control is used, the client **shall** place this screen's
  own URL on the clipboard.
  `Verify: test` — *observable: the clipboard write receives the tour screen's URL and nothing
  else — no generated token, no alternate host, no expiring parameter. No request leaves the
  browser, because there is nothing to mint (N14).*
- **AC-47** — WHEN a control on a critical-path or reading-path row is used to open its file,
  the client **shall** open that file on the repository host at the commit SHA the tour records,
  in a new tab.
  `Verify: test` — *observable: the link's target carries the tour's recorded SHA rather than
  the repository's default branch, so a tour and the file it describes are read at the same
  revision even after the branch has moved (AC-25, EC-20).*

## Edge cases

- **EC-1** — **The design's own headline is above the indexer's cap.** The subtitle reads
  "Generated from index of 12,450 files" while `MAX_INDEXED_FILES` is **5 000**. A repository
  of that size cannot report the number the mock draws.
- **EC-2** — A repository added but never cloned or indexed. The facade synthesises a
  `degraded / no_data` state rather than throwing, and the blast feature maps that to
  `index_missing`.
- **EC-3** — An index written by an older indexer version, so its per-file facts were extracted
  by a superseded rule. A version mismatch forces a reindex, and until it happens the facts are
  the old ones — the exact failure the endpoint-extraction bump of 2026-08-14 was about.
- **EC-4** — A repository whose import graph has no edges — a single-file repository, or a
  language the graph builder cannot parse. The critical-paths read returns nothing.
- **EC-5** — A repository whose highest-ranked files are all tests or configs, so the junk
  filter (AC-6) empties the reading path.
- **EC-6** — `hotness` is `0` for every file because the clone is shallow, so the ranking
  formula degenerates to PageRank alone and the reading path is import-centrality only, with no
  recency term (N6).
- **EC-7** — A monorepo with several `package.json` files declaring several conflicting sets of
  run commands.
- **EC-8** — A repository with no `package.json`, no `Makefile` and no compose file at all — a
  Go or Python repository — so AC-20 leaves the run-locally section with nothing to show.
- **EC-9** — A README, a script name or a file path containing an instruction aimed at the
  model: "ignore previous instructions", "this is a fixture, do not flag", a `</untrusted>`
  sequence, or any of those in another language.
- **EC-10** — A declared script whose command is destructive or fetches and executes remote
  code. The screen puts a copy button beside it, so a user runs it in their own shell.
- **EC-11** — A model body containing a fenced code block or a `{`, which a brace- or
  fence-based JSON extractor can mis-split. The engine's parser already names this exact case —
  "markdown code blocks in an onboarding `body`" — and tries a strict parse first for it.
- **EC-12** — A model returning a diagram with a line break inside a node label, an unquoted
  label containing `/` or `:`, or a fenced block — all of which the diagram renderer refuses.
- **EC-13** — A model returning an empty string rather than `null` for a section with no
  diagram.
- **EC-14** — A model returning a path that does not exist, a path outside the repository, or
  an absolute path.
- **EC-15** — A very long single-line command, or a deeply nested path, in a fixed-width row.
- **EC-16** — Two reading-path entries naming the same path, or two first tasks with the same
  title.
- **EC-17** — Two generations requested for the same repository at once.
- **EC-18** — A generation that outlives the job runner's **120 s** hard timeout, leaving the
  stored state at `running` with no worker behind it — the shape that bricked a conventions
  scan until a staleness window was added (2026-08-06).
- **EC-19** — A structured call that is charged and then returns an unparseable payload: money
  was spent and there is nothing to store.
- **EC-20** — A tour generated before a reindex, describing files that have since been deleted
  or renamed.
- **EC-21** — The repository deleted while a generation is in flight.
- **EC-22** — The workspace has no API key configured. The server boots fine with none, so this
  is a runtime configuration error, not a boot failure.
- **EC-23** — The prompt template takes a `{{language}}` and there is no configured source for
  it, so an unrendered placeholder would reach the model verbatim — the template's renderer
  leaves unknown placeholders intact by design.
- **EC-24** — The workspace setting `sync_to_folder` defaults to **`true`** and its copy
  promises that onboarding tours are written to the repo folder, while the clone is
  `git reset --hard` on every resync and the git port has no write method.
- **EC-25** — The add-a-repository screen lives at `/onboarding`, and the shell's active-key
  helper matches any path containing `/onboarding`, so that screen already highlights the
  Onboarding Tour sidebar entry today.
- **EC-26** — The already-shipped screen copy describes a **different** five sections —
  "overview, architecture, key modules, getting started, and conventions & gotchas" — from the
  five the design and the requirement name.
- **EC-27** — A first task naming a test file. The rank-based sampler can never return one
  (AC-6), so such a path can only come from the model, and AC-8 must still be able to confirm
  it exists.
- **EC-28** — A stored tour written under an earlier shape. A `jsonb` column read back by a
  cast rather than a parse arrives with keys absent, not null — the failure recorded twice in
  `server/INSIGHTS.md` (2026-08-02, 2026-08-19).
- **EC-29** — A repository whose default branch is empty, or whose clone contains no source
  file the indexer supports.

## Cross-module interactions

Two packages, one direction. `client` calls `server`; `server` reads its own index, the clone
and the model provider. `reviewer-core` is reached only as the provider implementation the
container already wires, and changes in no way (N2).

```mermaid
sequenceDiagram
    participant Client as client — Onboarding Tour screen
    participant Api as server — onboarding module
    participant Intel as server — repoIntel facade
    participant Clone as the repository clone on disk
    participant Llm as the injected LLM provider

    Client->>Api: read this repository's tour
    Api-->>Client: sections, status and reason, generated-at, indexed sha, staleness

    Client->>Api: generate
    Api-->>Client: accepted, with a job identifier
    Api->>Intel: index state, top files by rank, dependency chains, file facts, repo map
    Intel-->>Api: deterministic facts, carrying the index status
    Api->>Clone: read the declared command sources, path-confined
    Clone-->>Api: script, target and service declarations
    Api->>Llm: ONE structured request — facts as untrusted data
    Llm-->>Api: five sections, or a failure
    Api->>Api: drop items naming paths the index does not hold; apply caps
    Note over Api: on failure, store the deterministic skeleton with a reason
    Client->>Api: read again
    Api-->>Client: the stored tour, with model, round-trips, tokens and cost recorded
```

Two directions that must **not** exist:

- **The client never reaches the index or the clone.** Everything on the screen arrives through
  the tour read, so a partial index is a value on the payload rather than a second request the
  screen has to correlate.
- **The tour module never reaches another feature module's internals.** The index is reached
  through the `repoIntel` facade and the model through the container's provider port — the two
  boundaries this server already enforces.

## Contracts

The shared cross-package contract and its hand-made client copy are do-not-touch and
coordination only; a spec is where that agreement is recorded. Both copies move together, and
**every addition is a new symbol** — nothing existing is reshaped.

**Already present, and used unchanged:**

| Type | What it gives us |
|---|---|
| `FeatureModelId` / `FEATURE_MODELS` | The `onboarding` entry, its label and its default model. No change. |
| `Provider`, `FeatureModelChoice` | The model resolution this feature reuses. No change. |
| `StructuredRequest` / `StructuredResult` | The call shape and, crucially, `attempts`, `tokensIn`, `tokensOut` and `costUsd` — so AC-12 and AC-13 need no new port field. |

**New symbols, in both copies:**

| Type | Must carry |
|---|---|
| `OnboardingSectionKind` | the five kinds: `architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks` |
| `OnboardingStatus` | `ok`, `partial`, `degraded` — the same three the blast and prior-PRs contracts use |
| `OnboardingReason` | the index-side set `flag_off`, `index_failed`, `index_partial`, `repo_too_large`, `index_missing`, plus this feature's own `model_failed`, `model_timeout`, `model_invalid`, `no_commands_declared` |
| `OnboardingCommand` | the command text, the file it was declared in, and its ordinal |
| `OnboardingPathNote` | a repository path and a one-line reason — the row shape both `critical_paths` and `reading_path` render |
| `OnboardingTask` | a title, a repository path or directory, and a complexity of `low`, `medium` or `high` |
| `OnboardingTourSection` | a kind, a title, a markdown body, an optional mermaid diagram, up to four links, and the per-kind items above |
| `OnboardingTour` | the ordered sections, the status and reason, the generation state, the generated-at time, the indexed SHA it was generated from, whether it is stale, the files indexed and skipped, and the model, round-trip count, token counts and cost of the generation |

**Deliberately not changed:**

- **`Onboarding`, `OnboardingSection` and `OnboardingLink` stay exactly as they are, and the
  new types are added alongside them.** They predate this design and carry no per-kind items,
  no status, no provenance and no cost, so they cannot express what the screen renders — but
  the answer is to extend, not to reshape, and the rule is the repository's own. Root
  `CLAUDE.md`, on the two `vendor/shared` copies: *"When a change is agreed, extend with a new
  file rather than reshaping an existing symbol."* Reshaping a symbol that two hand-synced
  copies both declare is how those copies drift. The three existing types are **deliberately
  untouched**; they are not a cleanup item and no task should remove them.
- **`SettingsKnown` is not extended.** `sync_to_folder` already exists on it and this feature
  does not act on it (N4).
- **The sidebar nav catalogue is route config, not a primitive.** Its own doc comment says
  adding a route entry is permitted while restyling a nav item is not, and that only routes
  which exist belong there. AC-31's entry is added when the route exists.

## Non-functional

Every figure below is a **requirement, accepted on 2026-08-19**. The ones that came from an
existing constant or a measurement say which; the rest were proposed here and accepted as
stated. The reasoning stays beside each number so a later reader can move it deliberately
rather than re-derive it.

**perf**

- Reading a stored tour: **p95 < 200 ms** server-side, at five sections and ≤ 20 links,
  excluding cold start. It is one row read and a parse.
- Deterministic fact collection: **p95 < 3 s** at 5 000 indexed files. Every input is a read
  over already-persisted tables — file rank, file edges, file facts — plus a repo-map cache
  hit; nothing re-parses the clone.
- The structured call is bounded by a **75 000 ms** deadline (AC-11), leaving ≥ 45 s of the job
  runner's 120 s hard timeout for collection and persistence. The intent classifier's
  equivalent bound is 75 s, chosen the same way.
- Reading a tour: **0** model calls and **0** database writes (AC-27).

**scale, as caps with their behaviour**

- **≤ 5 000 files indexed** — the indexer's existing `MAX_INDEXED_FILES`. Above it the index
  finishes `partial` and the tour is labelled `partial` (AC-18) rather than refused. The
  headline figure the screen shows is **files indexed and files skipped**, which the index
  records, and never a repository-wide total the system has not counted (EC-1).
- Facts handed to the model, in one prompt: **≤ 200** ranked paths, **≤ 5** dependency chains
  of ≤ 3 paths each (the existing seed and depth constants), **≤ 40** endpoint facts, a repo
  map of **≤ 1 500 tokens** (the existing default budget), **≤ 60** declared commands —
  **≤ 12 000 prompt tokens** in total. The token ceiling is the one that binds, for the reason
  the conventions extractor records: a file count is two orders of magnitude away from a token
  count.
- A stored tour: exactly **5** sections, **≤ 8** critical-path rows, **≤ 10** reading-path
  entries, **≤ 6** first tasks, **≤ 4** links per section, **≤ 4 000** characters per body.
  Excess is discarded whole (AC-30). These bound a stored tour to roughly 40 KB.

**rate**

- **≤ 5** generations per repository per hour, and **1** concurrent generation per repository
  (AC-4).
- The tour read is callable **≤ 60 req/min per workspace**.

**security**

- **Workspace-scoped; the repository lookup is the authorization check** (AC-29), performed
  before any index read and before any path is resolved against the clone.
- Every repository-derived fact reaches the model as **untrusted, delimiter-wrapped data**, and
  none of it reaches the system message (AC-23, AC-24).
- Commands come only from **declared** sources, each attributed to the file it was read from
  (AC-20, AC-21); prose is never a command source, because a copy button beside a sentence a
  stranger wrote is an execution primitive.
- **Nothing is executed** (AC-22) and **nothing is written into the clone** (N4).
- Reads of the clone are path-confined to the clone root, with the prefix re-checked after
  symlink resolution.

**a11y**

- **WCAG 2.2 AA.** Every control keyboard-operable (AC-45). Status is carried by a word, not by
  colour alone — including the first-task complexity badge, which is a word plus its level.

**cost**

- Not budgeted, deliberately. The token ceiling above bounds the input; the cost of a
  generation is **recorded and logged** (AC-12, AC-13) so a real figure can be observed before
  anybody sets a limit against a made-up one.

## Inputs (provenance)

| Input | Comes from | Owned by | Exists today? |
|---|---|---|---|
| Index state, files indexed and skipped | the repo-intel facade's index state read | us | **yes** — and it always answers, synthesising a degraded state when there is no row |
| Ranked file paths for the reading path | the facade's top-files-by-rank read, over `file_rank` | us | **yes** — implemented, junk-filtered, and its doc comment names this feature |
| Dependency chains for critical paths | the facade's critical-paths read, over `file_edges` + `file_rank` | us | **yes** — implemented, seeded from five roots at two hops |
| The `rank` those two reads order by | the indexer's PageRank over the dependency-cruiser import graph | us | **yes** — `rank = pagerank × (1 + hotness)`, with `hotness` written as a literal `0` (N6) |
| Endpoint and cron facts | `file_facts`, written by the indexer | us | **yes** — but only correct at indexer version 3 or later (EC-3) |
| A structural summary of the repository | the facade's repo map, token-budgeted and cached per commit | us | **yes** |
| Declared run commands | `package.json` scripts, `Makefile` targets, `docker-compose*.yml` services, read path-confined from the clone | the repository being toured — i.e. **not us** | **no** — nothing in this server parses a `package.json`, a README, a Dockerfile or a compose file for anything |
| Stack facts (languages, frameworks, dependencies) | not available deterministically | — | **no** — there is no language or framework detector anywhere; the architecture section rests on the repo map, the endpoint facts and the ranked paths instead |
| The five section titles and bodies | one structured model call | the model | **no** — but the system prompt is written and parameterised, and the model choice is registered |
| The model and provider | the workspace's `onboarding` feature-model choice | the workspace | **yes** — with zero callers today |
| Round-trips, tokens, cost | the structured result | us | **partly** — the result carries all four; **no feature in this server records a call count**, and none logs cost |
| The stored tour | the `onboarding` table | us | **partly** — the table shipped with the initial schema carrying only a repository key, a JSON blob and a generated-at time, and needs the provenance fields of `## Contracts` |
| The screen's copy and nav label | the client's message catalogues | us | **yes, already written** — including a `generate.body` sentence naming a different five sections (EC-26) |
| The diagram renderer | the client's existing diagram component | us | **yes** |

## Untrusted inputs

**Almost everything this feature reads is foreign text**, and the one output it produces is
text a user is invited to copy into a shell. Both halves are data, never commands.

- File paths, script names, script bodies, compose service names, endpoint strings and the repo
  map are all derived from a repository DevDigest cloned. Every one of them enters the prompt
  inside untrusted delimiters, in the user message (AC-23, AC-24). The system message is the
  rendered template and nothing else.
- The wrapper escapes any attempt to close it, so a file whose contents include `</untrusted>`
  cannot break out of its own block (EC-9).
- The system prompt already carries its own untrusted-data clause, and the injection guard
  appended on the review path is written to disregard "ignore", "do not flag" and "this is only
  a fixture" **in any language**. This spec adds no pattern matching of its own: matching
  hostile phrasing only ever catches one phrasing.
- **The model's own output is untrusted too**, and this is the part specific to this feature.
  Every path it returns is checked against the index before it is stored (AC-8), and every
  command it shows was derived by us from a declared source rather than written by it (AC-20).
  A tour that invented `rm -rf` and put a copy button beside it would be a security failure,
  not a quality one.
- A repository path is untrusted in a second sense: it is a filesystem path derived from foreign
  content, so every read of the clone is path-confined with the prefix re-checked after symlink
  resolution.
- This spec's own text reaches a reviewing model as untrusted, delimiter-wrapped data. It
  therefore addresses no model and contains no instruction to one.

## Traceability

| AC | Serves | Package | Verify |
|---|---|---|---|
| AC-1 | US-1, US-2, US-3, US-4, US-5, EC-28 | server | test |
| AC-2 | US-6, EC-2 | server | test |
| AC-3 | US-7 | server | test |
| AC-4 | EC-17 | server | test |
| AC-5 | US-4, G3 | server | test |
| AC-6 | US-4, EC-5 | server | test |
| AC-7 | US-2, EC-4 | server | test |
| AC-8 | US-1, US-2, EC-14, EC-27 | server | test |
| AC-9 | US-8, G4 | server | test |
| AC-10 | US-8, EC-19 | server | test |
| AC-11 | perf budget, EC-18 | server | test |
| AC-12 | US-8 | server | test |
| AC-13 | US-8 | server | demonstration |
| AC-14 | US-7 | server | test |
| AC-15 | US-6, EC-11, EC-12, EC-19, EC-22 | server | test |
| AC-16 | US-6, EC-2, EC-29 | server | test |
| AC-17 | US-8, EC-2 | server | test |
| AC-18 | US-6, EC-1, scale cap | server | test |
| AC-19 | US-6, EC-3 | server | inspection |
| AC-20 | US-3, US-9, EC-7, EC-10 | server | test |
| AC-21 | US-3, US-9 | server | test |
| AC-22 | US-9, security | server | analysis |
| AC-23 | US-9, EC-9, security | server | test |
| AC-24 | US-9, security | server | test |
| AC-25 | US-6, EC-20 | server | test |
| AC-26 | US-6, EC-20 | server | test |
| AC-27 | perf budget | server | test |
| AC-28 | US-7 | server | test |
| AC-29 | security scope, EC-21 | server | test |
| AC-30 | scale cap, EC-16 | server | test |
| AC-31 | US-1 | client | test |
| AC-32 | EC-25 | client | test |
| AC-33 | US-7, EC-2 | client | test |
| AC-34 | US-7 | client | test |
| AC-35 | US-1, US-2, US-3, US-4, US-5 | client | test |
| AC-36 | US-1, EC-11 | client | test |
| AC-37 | US-1 | client | test |
| AC-38 | EC-12, EC-13 | client | test |
| AC-39 | US-3, US-9 | client | test |
| AC-40 | US-6, EC-1 | client | test |
| AC-41 | US-6, EC-20 | client | test |
| AC-42 | US-6, EC-4, EC-5, EC-8 | client | test |
| AC-43 | US-6 | client | test |
| AC-44 | US-6 | client | test |
| AC-45 | a11y budget, EC-15 | client | demonstration |
| AC-46 | US-6 | client | test |
| AC-47 | US-2, US-4, EC-20 | client | test |
| — | EC-6 | — | `accepted` — the ranking degenerates to PageRank alone while the clone is shallow, and the spec says so rather than pretending to a recency term it has not measured (N6). AC-5 is written against the defined quantity, so switching hotness on later — an indexing-pipeline change, out of scope — needs no criterion change. |
| — | EC-8 | — | `accepted` — a repository declaring no commands gets a run-locally section that says so, with reason `no_commands_declared`. Guessing a command for a Go or Python repository is precisely what AC-20 exists to forbid; AC-42 renders the honest empty case. |
| — | EC-23 | — | `accepted` — English only (N12), so the language placeholder is filled with a constant. It is listed because an unrendered placeholder reaches the model verbatim, so the constant is load-bearing rather than cosmetic. |
| — | EC-24 | — | `accepted` — decided on 2026-08-19: the tour lives in the database only, so `sync_to_folder` stays untouched and unread, exactly as it is today (N4). This spec does not make the promise its copy makes, and does not remove the copy either; changing a shipped string is a product decision of its own. |
| — | EC-26 | — | `accepted` — decided on 2026-08-19: **the design wins.** The five sections are the design's five (AC-1), and the shipped `generate.body` sentence is the stale artefact, reworded as part of this feature's client work under AC-33. It needs no criterion of its own because the criterion it would duplicate is AC-1. |

## Open questions — none, all fourteen resolved 2026-08-19

Four were blocking; the user answered each on the default this spec proposed. Nine more were
accepted at their stated default. One was answered by the repository rather than by a person.
**Every decision now lives in the section that owns it** — this table is an index into the
body, not a second place to read the requirement from.

| # | Decided | Now lives in |
|---|---|---|
| OQ-1 | **`hotness` stays `0`.** The reading path is ordered by the index's `rank`, which *is* `pagerank × (1 + hotness)` by definition; the recency half is inert today. The column exists so the term can be switched on with no schema change, but doing so is an **indexing-pipeline** change and is out of scope. | AC-5, **N6**, EC-6's `accepted` row |
| OQ-2 | **`Share link` copies this screen's URL** — no token, no public route, no expiry. | **AC-46**, **N14** |
| OQ-3 | **The tour lives in the database only.** `sync_to_folder` stays unread. | **N4**, EC-24's `accepted` row |
| OQ-4 | **At most two provider round-trips** — the request plus at most one schema-repair reprompt — with the count and the cost recorded and logged. | AC-10, AC-12, AC-13 |
| OQ-5 | **The design's five sections win.** The shipped `generate.body` copy naming a different five is reworded as part of this feature. | AC-1, AC-33, N11, EC-26's `accepted` row |
| OQ-6 | **The threshold is the indexer's existing `MAX_INDEXED_FILES` of 5 000.** Above it the tour is still generated and labelled `partial`, and the caption reports files indexed and skipped rather than a total nothing counted. | AC-18, AC-40, `## Non-functional` (scale), EC-1 |
| OQ-7 | **Declared sources are `package.json` scripts, `Makefile` targets and `docker-compose*.yml` services.** README prose is never one. | AC-20, AC-21, `## Non-functional` (security) |
| OQ-8 | **At most six first tasks**, each naming a path or directory the index holds, each with a complexity of `low`, `medium` or `high`. | AC-8, AC-30, `## Contracts` (`OnboardingTask`), `## Non-functional` (scale), EC-27 |
| OQ-9 | **`Open` goes to the file on the repository host, at the SHA the tour records, in a new tab.** | **AC-47**, N9 |
| OQ-10 | Read p95 < 200 ms; fact collection p95 < 3 s at 5 000 files; a 75 000 ms deadline on the model call; ≤ 5 generations per repository per hour; ≤ 60 reads per minute per workspace. | AC-11, `## Non-functional` (perf, rate) |
| OQ-11 | Into the prompt: ≤ 200 ranked paths, ≤ 40 endpoint facts, ≤ 60 declared commands, ≤ 12 000 prompt tokens. Out of the model: 8 critical-path rows, 10 reading-path entries, 6 first tasks, 4 links per section, 4 000 characters per body, excess discarded whole. | AC-30, `## Non-functional` (scale) |
| OQ-12 | **English**, filled as a constant, with no picker. | N12, EC-23's `accepted` row |
| OQ-13 | **One tour per repository, shared across the workspace.** Any user may read and regenerate it, so a regeneration replaces what a colleague was reading. | N7, N8, AC-28 |
| OQ-14 | **Extend, never reshape.** Answered by root `CLAUDE.md` on the two `vendor/shared` copies — *"When a change is agreed, extend with a new file rather than reshaping an existing symbol"* — not by a product decision. `Onboarding`, `OnboardingSection` and `OnboardingLink` are deliberately untouched and are not a cleanup item. | `## Contracts` |

`Status` stays **`draft`**. An empty `## Open questions` is the precondition for a human to
promote a spec to `approved`; it is not the promotion, and no agent may grant it.

## History

2026-08-19 — spec written.
2026-08-19 — all fourteen open questions resolved by the user; each decision moved into the
section that owns it, `## Non-functional` promoted from proposals to accepted requirements, and
AC-46 (`Share link`) and AC-47 (`Open`) added for the two decisions that had no criterion.
`Status` unchanged at `draft`.
2026-08-19 — approved by the user. `## Open questions` was empty, which is the
precondition; the promotion itself is the human decision `docs/specs-convention.md`
reserves for a person.
