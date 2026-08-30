/**
 * Multi-Agent Review — the tunable numbers the grouping rule and the one
 * synthesis call are defined against.
 *
 * This file imports NOTHING. It is read by `grouping.ts`, which is pure: no
 * database, no container, no clock, no `node:` specifier. A number that the spec
 * fixes lives here and nowhere else, so the one figure this feature cannot
 * justify from first principles is visible in one place instead of buried in a
 * comparison — the shape `modules/brief/constants.ts` already uses.
 *
 * The synthesis half at the bottom keeps the same property, which is why the
 * feature-model id it resolves against is NOT here: that constant needs
 * `FeatureModelId` from the contract, and one type import would cost this file
 * the "imports nothing" it is worth more for. It lives beside its only use, in
 * `notes.ts`.
 */

/**
 * Two findings' titles are treated as the same problem when the Jaccard index of
 * their normalised token sets reaches this value (AC-26).
 *
 * **THIS THRESHOLD IS UNVALIDATED.** It was chosen from the worked examples in
 * SPEC-06 and has never been measured against real multi-agent output:
 * `"Magic number 3600"` against `"Hard-coded 3600 magic number"` scores 0.6 and
 * must group; `"Magic number 3600"` against `"Missing error handling"` scores 0
 * and must not. Every value from roughly 0.1 to 0.6 satisfies both examples, and
 * nothing in this repository says which of them is right.
 *
 * What would revalidate it: a sample of real fan-outs — the same pull requests
 * reviewed by several agents — on which the **false-merge rate** (two unrelated
 * problems collapsed into one group) and the **false-split rate** (one problem
 * reported as two groups) are counted by hand. Move the number only with those
 * two counts in front of you; raising it trades false merges for false splits
 * and there is currently no evidence about which the reader minds more.
 *
 * It appears exactly once in this module, as this constant (AC-28). An inline
 * literal anywhere under `src/modules/multi-agent/` is a defect, and this task's
 * Done-condition greps for one.
 */
export const TITLE_SIMILARITY_THRESHOLD = 0.4;

/**
 * Shortest token a normalised title keeps (AC-27).
 *
 * Two characters and under are articles, prepositions and stray initials — `"a"`
 * in `"Hard-coded 3600: a magic number!"` — which carry no signal about *which*
 * problem a title names but do inflate the union and so depress every Jaccard
 * score. Digits are NOT length-filtered beyond this rule: `3600` is the most
 * identifying token a magic-number finding has.
 *
 * This is the whole of the stop-word handling, on purpose. A hand-written list of
 * English stop words would be a second unvalidated constant with no evidence
 * behind it, and this rule already removes what such a list would target — so
 * none is to be introduced without the measurement
 * {@link TITLE_SIMILARITY_THRESHOLD} names.
 */
export const MIN_TITLE_TOKEN_LENGTH = 3;

/* ─── the one synthesis call (T16) ────────────────────────────────────────── */

/**
 * Wall-clock bound on the stance-note call, raced explicitly (AC-40).
 *
 * **Required, and it bounds something the request cannot.**
 * `StructuredRequest.timeoutMs` is silently ignored — the timeout is fixed when
 * the OpenAI client is CONSTRUCTED, and nothing reads the per-request field
 * (`server/INSIGHTS.md`, 2026-08-06). So the only bound that exists is the one
 * the caller races, and this is it.
 *
 * 60 000 ms rather than the brief's 75 000: this call is one short sentence per
 * agent per contended location plus one heading each, over facts already
 * computed, and it runs off the executor's completion where nothing is waiting
 * on it. An answer that has not arrived in a minute costs nothing to abandon —
 * the multi-run then renders exactly as it does before any synthesis, with every
 * note empty and every title falling back (AC-38).
 */
export const NOTES_CALL_DEADLINE_MS = 60_000;

/**
 * Provider retries allowed on the synthesis call: none, i.e. at most ONE
 * round-trip (AC-40).
 *
 * Must be passed explicitly, because the provider's own `maxRetries` defaults to
 * **2** — three attempts of up to 90 s each, which is 270 s for one sentence per
 * agent. It bounds a DIFFERENT quantity from {@link NOTES_CALL_DEADLINE_MS} and
 * neither alone bounds anything: the deadline bounds wall-clock, this bounds
 * spend, and retries inside the provider are invisible to the race until they
 * have already been paid for.
 */
export const NOTES_MAX_RETRIES = 0;

/**
 * Name of the model-facing schema, sent as the `json_schema` / tool name.
 *
 * LOAD-BEARING rather than descriptive: `MockLLMProvider.structuredBySchema`
 * keys its fixtures on `req.schemaName` and falls back to the generic
 * `structured` fixture instead of erroring when nothing matches, so a value that
 * does not match the schema's own name silently feeds a test the wrong fixture
 * (`server/INSIGHTS.md`, 2026-08-06).
 */
export const NOTES_SCHEMA_NAME = 'MultiAgentNotesDraft';

/** The language every stance sentence and every group label is written in. */
export const NOTES_LANGUAGE = 'English';

/**
 * The most contended locations one call may carry.
 *
 * A bound on the prompt, not on the feature: a fan-out of eight agents over a
 * large diff can produce more groups than fit comfortably in one request, and
 * the honest way to keep the call to ONE (AC-102) is to send the first N groups
 * in the read's own order rather than to make a second call. A group past the
 * cap keeps its deterministic title and empty notes — which is the same state
 * every group is in before the synthesis runs at all (AC-38), so nothing renders
 * differently for it.
 */
export const MAX_SYNTHESIS_GROUPS = 25;

/**
 * The most findings of ONE agent offered as material for one group.
 *
 * An agent contributes one stance per group however many findings it reported
 * there (EC-11); this caps how many of them the model is shown while it phrases
 * that one sentence. Two is what the worked examples need.
 */
export const MAX_MATERIAL_FINDINGS_PER_AGENT = 2;

/** A finding's rationale, truncated before it is offered as material. */
export const MAX_MATERIAL_RATIONALE_CHARS = 400;

/**
 * Storage caps for what comes BACK, applied before the blob is persisted.
 *
 * Hygiene, not a defence and not a branch: a note is rendered as a sentence and
 * a label as a heading, and nothing in this server or the client decides
 * anything from either (AC-38's "a response containing an instruction is data").
 * The caps exist so one runaway answer cannot put a kilobyte of text into a
 * panel heading, and they are deliberately generous — the client must still
 * tolerate a label longer than the prompt asked for, because a model that
 * ignored "short" is exactly what these numbers assume.
 */
export const MAX_LABEL_CHARS = 120;
export const MAX_NOTE_CHARS = 400;

/**
 * How long a parent with NO runs yet is treated as a fan-out still starting.
 *
 * `createMultiAgentRun` commits the parent and only then writes one `agent_runs`
 * row per agent — the two cannot join a transaction, and the module's `discard`
 * documents why. In the window between them the newest parent has ZERO runs, so
 * a predicate that asks only "has a `running` run?" answers *no* and lets a
 * second fan-out through. That window is the whole of the AC-9 defect: a lock
 * around the check does not close it, because there is nothing yet to see.
 *
 * So a parent with no runs counts as in flight — but only for a bounded time. A
 * process killed between the two writes would otherwise leave a parent that
 * refuses every future fan-out for that pull request, forever, with nothing to
 * clear it; the same reasoning the engine already applies when it reaps orphaned
 * `running` runs on boot. Generous on purpose: it only has to outlast N inserts
 * on one connection.
 */
export const MULTI_RUN_STARTING_MS = 30_000;
