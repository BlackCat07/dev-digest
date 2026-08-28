import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (root CLAUDE.md + the five package
 * CLAUDE.md files + skills + subagents, loaded via settingSources:["project"]) behaves as
 * documented. Organized by scenario, not by artifact, because these behaviors are cross-cutting.
 *
 * BUDGET: 6 Claude sessions, hard cap.
 *   1 × trace (doc routing)  +  1 × trace (dispatch)  +  4 × activation  =  6
 *
 * MERGE POLICY — what a session may hold, and what it may not
 *   `trace` runs ONE session and asserts several facets against the same trace, so every routing
 *   read that a single enumerated task would perform anyway is folded into one case. What cannot
 *   be folded:
 *     - a negative activation (`shouldActivate: false`) needs its own session by definition:
 *       "skill X did not fire" only means something in a session that never asked for X;
 *     - `contrast` is two sessions by construction (treatment + control), so it is not here at
 *       all — see the note at the bottom of this file for when to reintroduce it.
 *   Cost of folding is coarser diagnostics: a red trace says "one of these did not happen", and
 *   the trace in results/records.jsonl tells you which. Each case names how to split it.
 *
 * PATHS ARE VERIFIED AGAINST THIS REPO (2026-08-23). The previous version of this file asserted
 * `server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md` and
 * `reviewer-core/insights/gotchas.md` — none of which exist here (they belong to the course
 * template's tree), so all three cases were un-passable and had never been run (zero workflow
 * records in results/records.jsonl). Every path below was checked with `find` before landing.
 *
 * NESTED CLAUDE.md — MEASURED, 2026-08-23. A package CLAUDE.md DOES appear as an explicit `Read`:
 * the 2026-08-23 run recorded `client/CLAUDE.md` and `server/CLAUDE.md` in `trace.reads`. So
 * asserting one is viable. We still assert the SECOND hop (a file that only the routing names),
 * because that is the discriminating signal: reading the package guide is one step the model takes
 * on its own anyway, while reaching `docs/feature-unit.md` requires having followed the routing.
 *
 * WHAT THE FIRST RUN TAUGHT (2026-08-23, 12 sessions, results/repeat-workflow-baseline.json):
 *   - A `Read` assertion needs a task the INJECTED guide cannot answer. The first version of
 *     trace #1 asked "what must you read before answering", and the model answered correctly in
 *     prose with ZERO tool calls — root CLAUDE.md is in its context, so it had no reason to open a
 *     file. Every sub-question below now asks for CONTENT that lives only inside the target file.
 *   - `maxTurns: 4` was too tight for any prompt that triggers the INSIGHTS protocol: the client
 *     negative spent its budget reading INSIGHTS + CLAUDE.md + docs and got cut mid-sentence.
 */

// Reuse the agent tier's fixture rather than copying the diff — one source of truth, no drift.
// (fixtureReader is colocation-scoped, so this reaches across on purpose.)
const CHECKOUT_DIFF = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../agents/architecture-reviewer/fixtures/checkout-service.diff"),
  "utf8",
);

export const cases: WorkflowCase[] = [
  // --- trace #1 (1 session): the two SECOND-HOP docs, asked as content questions ----------------
  // MEASURED HISTORY of this case (all 2026-08-23, results/records.jsonl):
  //   v1 "what must you read before answering" → 0/2, ZERO tool calls. Root CLAUDE.md is injected
  //      into the session, so the model answered correctly from context. A Read assertion needs a
  //      task the injected guide cannot close.
  //   v2 four content questions (server/INSIGHTS.md, mcp-server/README.md, e2e docs, client docs)
  //      → 0/2, then 1/2. Four independent reads in one session is a conjunction of four coin
  //      flips: the failing runs read the PACKAGE guide (e2e/CLAUDE.md, client/CLAUDE.md) and
  //      decided that was enough, at 8 turns of a 14 ceiling — so it was never a budget problem.
  //   v3 (this one) keeps ONE session but asserts only the two reads that actually discriminate.
  //
  // Why these two and not the other two:
  //   - `server/INSIGHTS.md` was 4/4 — and it is already read as a side effect of the dispatch and
  //     onion cases, so the session protocol is observed for free elsewhere. Asserting it here paid
  //     nothing and could only add a way to go red.
  //   - `mcp-server/README.md` was 4/4 too: the root guide names it so explicitly ("no docs/ — read
  //     mcp-server/README.md") that no model misses it. A criterion nothing ever fails measures
  //     nothing (the README's own doctrine on non-discriminating practices).
  //   - the two kept are the ones the model actually skips: reaching them means following the
  //     routing PAST the package guide into the doc that only its "Deeper context" row names.
  // Both sub-questions demand a fact the package CLAUDE.md does not contain, so the answer cannot
  // come from the injected/read guide — see the confabulation note below.
  //
  // WHY THIS CASE IS JUDGED (v4). The trace tier asserts reads, NOT truth. In the v2 run the model
  // produced a FABRICATED verbatim quote — a heading ("The PR-list table has a three-way
  // hand-synced invariant") attributed to client/CLAUDE.md, which contains no such text. That run
  // went red only because a Read happened to be missing; had it opened the file and lied about the
  // contents, the case would have been green. So this case now carries `practices`: the trace proves
  // it opened the docs, the judge proves it reported what they actually say. Both must hold.
  // Note the cost: practices disable the early stop (there would be no answer to judge), so this
  // session runs to completion and pays one judge call on top.
  // Also: never put a checkable number in the question. v2 asked for "the THREE places" and handed
  // the model the shape of a confident guess.
  // Split if red: one trace per file (2 sessions instead of 1, and the budget goes to 7).
  {
    kind: "trace",
    name: "two second-hop docs answer content questions in one session",
    prompt:
      "Два питання про ЗМІСТ документації цього репо. На кожне знайди потрібний файл за настановами " +
      "репо, прочитай його і відповідай ТІЛЬКИ тим, що в ньому написано — не з пам'яті, не з " +
      "CLAUDE.md, шляхи не вгадуй:\n" +
      "1) у e2e: за якими критеріями там сказано вирішувати, що перевірка має бути браузерним flow, " +
      "а не юніт-тестом;\n" +
      "2) у client: за яким правилом там вирішується, на якому рівні route-дерева має лежати папка " +
      "компонента, і які ДВА конкретні рівні під PR-областю наведені як приклад — назви їхні шляхи.",
    expectFilesRead: ["e2e/docs/adding-a-flow.md", "client/docs/feature-unit.md"],
    practices: [
      "reports the e2e flow-vs-unit-test criterion as the doc states it: a browser flow is for the wiring (routes, tabs, real data arriving through the real API), while filtering logic, empty states and error branches belong in a unit test",
      "names BOTH route levels from the client doc's Rule 1 — `pulls/_components/` and `pulls/[number]/_components/` — and states that a unit reachable from both pages belongs in the higher (shallower) one",
    ],
    threshold: 1.0,
    // No early stop once practices are present, so the session writes a full answer — 14, not 12.
    maxTurns: 14,
  },

  // --- trace #2 (1 session): three subagents dispatched off one diff ----------------------------
  // Measures whether the three agent descriptions are distinct enough to route the same input to
  // review vs plan vs tests. Kept out of trace #1 because this is the only case that spawns nested
  // sessions, so its failure mode (and its cost) is unlike a plain lookup.
  // "ОДНИМ повідомленням і паралельно" is load-bearing: stopWhen only fires on the THIRD Task
  // tool_use, so a sequential dispatch would pay for two full nested subagent runs first and risk
  // the 240s testTimeout. Parallel tool_use blocks arrive in one assistant message, so the session
  // breaks before any nested run finishes.
  // Split if red: three `kind: "dispatch"` cases, one subagent each (that costs 3 sessions, not 1 —
  // do it to diagnose, then merge back).
  {
    kind: "trace",
    name: "one diff routes to architecture-reviewer, implementation-planner and test-writer",
    prompt:
      "Ось diff. Не рецензуй і не плануй сам — розкидай роботу по відповідних сабагентах цього репо, " +
      "ОДНИМ повідомленням і паралельно (три виклики разом): архітектурний аудит цього diff, план " +
      "доробки під нього, і тести, які він винен.\n\n" +
      CHECKOUT_DIFF,
    expectSubagents: ["architecture-reviewer", "implementation-planner", "test-writer"],
    maxTurns: 8,
  },

  // --- activation pair A (2 sessions): engineering-insights, positive + near-miss ---------------
  // The negative is the point: same topic, framed as a question instead of a discovery. A skill
  // that fires on both is not routed by its description, it is just eager.
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    // 4 was too tight — the first run spent 5 turns on this and the second answered in one without
    // engaging the skill at all. 6 gives the session room to actually do the thing being measured.
    maxTurns: 6,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 6,
  },

  // --- activation pair B (2 sessions): onion-architecture vs its frontend twin -------------------
  // Measures description quality rather than skill text: onion-architecture and
  // frontend-ui-architecture answer the same SHAPE of question ("where does this belong?") for two
  // different halves of the repo, and onion's own description ends with "NOT for the client/
  // frontend". The negative is the real signal — an onion activation on a client question is a
  // routing defect that no positive-only case can see.
  {
    kind: "activation",
    name: "onion-architecture activates on a backend layering question",
    // v1 asked "may I put a Drizzle query in service.ts". It scored 1/2, and the failing run shows
    // why: the model read `server/INSIGHTS.md` (69 entries) and answered out of the journal —
    // "дивіться в INSIGHTS записи про архітектуру". The question was already settled by the injected
    // `CLAUDE.md` ("All I/O goes through src/adapters/") and by the journal, so the skill genuinely
    // was not needed and a green measured luck, not routing. Same lesson as trace #1.
    //
    // v2 asks the one judgement that lives ONLY in this skill: the anti-over-layering rule
    // `OA-SIZE-002` ("No rich entity classes… an anemic model is not a defect here"). Verified
    // 2026-08-23 — `OA-*` ids appear in `.claude/skills/onion-architecture/{rules,SKILL}.md` and
    // `test-cases/MEASUREMENTS.md` only: not in any CLAUDE.md, not in any INSIGHTS.md, and not in
    // `server/.dependency-cruiser.cjs`. The depcruise rule NAMES (`routes-no-data-access`,
    // `row-types-stay-in-persistence`) DO live in that config, which is why the prompt asks for
    // neither them nor a generic layering verdict — either would be answerable without the skill.
    prompt:
      "Хочу переробити модуль tags у server «як належить»: додати теку domain/ з класами-сутностями " +
      "Tag, що несуть поведінку, і мапери між ними та рядками БД. Це відповідає архітектурним " +
      "правилам цього репо чи суперечить їм — і як зветься правило, яке це регулює?",
    skill: "onion-architecture",
    shouldActivate: true,
    maxTurns: 6,
  },
  {
    kind: "activation",
    name: "near-miss negative — a client-side placement question must NOT pull onion-architecture",
    prompt:
      "Куди в client покласти хук, який читає список репозиторіїв через TanStack Query, і чому саме туди?",
    skill: "onion-architecture",
    shouldActivate: false,
    // 8, not 6: this prompt triggers the INSIGHTS protocol, and the 2026-08-23 run spent its whole
    // 4-turn budget on INSIGHTS + CLAUDE.md + docs and was cut mid-sentence. The verdict was still
    // correct (no activation), but a truncated session is a bad measurement to rely on.
    maxTurns: 8,
  },
];

/**
 * DELIBERATELY NOT HERE, at this budget:
 *
 * - `contrast` (2 sessions) — the strongest candidate was cross-package spec placement
 *   (`docs/specs-convention.md`, a path a control run has no way to learn). Add it back if we ever
 *   need to prove that CLAUDE.md itself, and not the model's priors, produced a routing read.
 * - a `frontend-ui-architecture` POSITIVE activation — trace #1 already proves the client doc gets
 *   read, and pair B's negative proves onion stays out of the client half; the missing third fact
 *   is that frontend-ui actually fires. That is the first case to add when the budget grows.
 * - the do-not-touch / static-registration / "mcp-server is absent from modules/index.ts on
 *   purpose" family — these are about what the model SAYS, and `runWorkflowCases` has no judge.
 *   They belong either in the skills tier or behind an optional `practices` field on `kind: "trace"`
 *   (≈10 lines in src/dsl/case.ts), not here.
 */
