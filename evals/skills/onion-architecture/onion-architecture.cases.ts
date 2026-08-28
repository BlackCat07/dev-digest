import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// An 8-file diff adding a cross-repo insights feature. Every individual import in it is LEGAL:
// the core imports only the port ring, the port ring imports only zod and a node builtin, the
// repository is the sole drizzle importer, and no adapter imports a module. `depcruise` reports
// this patch green. The three defects are compositions — legal per edge, illegal in the sum —
// which is why no dependency-cruiser rule fires and no grep finds them.
//
// Measured 2026-08-22 over 5 runs per skill version (see
// .claude/skills/onion-architecture-workspace/iteration-4/detection-frequency.md): all three
// composite leaks were found by 10/10 runs, so RECALL does not discriminate here. What the runs
// disagreed on was whether the report reasons correctly about the GATE — 3 of 10 asserted a rule
// would fire that structurally cannot. That is what cases 1 and 4 below are built to catch.
const COMPOSITE_PROMPT = `Review this diff against DevDigest's backend layering rules.

${fx("insights-composite.diff")}`;

export const cases: SkillCase[] = [
  {
    // The grounding gate is the cheap deterministic tier: three identifiers any correct report
    // must name. It is a filter on "is there anything to judge", NOT a verdict — token presence
    // cannot tell a report that FAULTED a file from one that merely discussed it. That distinction
    // is what the judge is for, and trying to score recall on substrings alone was measured to
    // return a false pass on 46/46 planted entries.
    name: "traces all three composite leaks and names the chain, not the endpoint",
    kind: "quality",
    prompt: COMPOSITE_PROMPT,
    grounding: ["node:fs", "AgentRunRow", "markWindowClosed"],
    practices: [
      "flags that reviewer-core is transitively impure and names BOTH ends of the chain — reliability.ts importing the VALUE DEFAULT_WEIGHTS from @devdigest/shared, and contracts/insights.ts calling readFileSync at module scope. Naming only one end does not count",
      "flags that InsightsRepositoryPort.runsInWindow returning AgentRunRow puts the Drizzle schema into the contract, so the port is not a boundary a fake can satisfy",
      "cites the `as unknown as AgentRunRow` cast in adapters/insights/mocks.ts as the evidence for that finding, rather than arguing it from the port file alone",
      "flags that the service's two sequential writes (recordSnapshot then markWindowClosed) are not atomic because the transaction is opened inside the repository, and notes that the service's own comment claims otherwise",
      "names the documented rule identifier for each finding (`OA-DEEP-001`, `OA-DEEP-002`, `OA-INFRA-003`) rather than describing the problem only in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
    ],
    // 6 practices, measured 5/6 on gemini-2.5-flash: 1.0 makes any single miss fatal.
    // 0.8 needs 5 of 6 — one miss tolerated, four would still fail.
    threshold: 0.8,
    maxTurns: 20,
  },
  {
    // The traps. Both are things the skill explicitly ASKS for, so flagging either inverts the
    // rule the reviewer is meant to be applying. T1 held 10/10 in the measured runs; T2 held 5/5
    // on the new skill version and 3/5 on the old, the only difference either version produced.
    name: "does not invert the rules it is applying — narrow deps and structural satisfaction stay unflagged",
    kind: "quality",
    prompt: COMPOSITE_PROMPT,
    practices: [
      "does not report InsightsService taking a narrow InsightsDeps rather than the whole Container as a problem — that is the shape the skill asks of a new service",
      "does not report adapters/insights/window-clock.ts implementing WindowClockPort without importing it as a problem — structural satisfaction is what keeps the adapter a leaf",
      "stays scoped to structural, layering and DI findings; does not turn naming, formatting or test coverage into an architecture violation",
    ],
    threshold: 1.0,
    maxTurns: 20,
  },
  {
    // KNOWN FAILING, deliberately kept: 0/10 across both skill versions. Every run flagged the
    // db/rows.ts import in helpers.ts alongside the one in ports.ts and prescribed removing both.
    // Neither version of SKILL.md says Row->DTO mapping in helpers.ts is a Row type's legitimate
    // home, so this is a gap in the skill, not run variance. It stays in the suite so the
    // benchmark's `always_failing` flag keeps pointing at it until rules.md is amended.
    name: "distinguishes the same Row import in a port signature from the same one in helpers.ts",
    kind: "quality",
    prompt: COMPOSITE_PROMPT,
    practices: [
      "does not report helpers.ts importing AgentRunRow from db/rows.js as a violation — it is the same symbol as the port finding but in its prescribed place, mapping Row to DTO",
      "makes the distinction explicit: the defect is the Row type appearing in a PORT SIGNATURE, not the import itself",
    ],
    threshold: 1.0,
    maxTurns: 20,
  },
  {
    // The discriminating case. Recall is saturated at 10/10, so what is left to measure is
    // whether the reviewer reasons correctly about what the gate can and cannot see. Three of ten
    // measured runs failed this: `row-types-stay-in-persistence` was claimed to fire on ports.ts
    // (its `from` is `(service|routes).ts`), and one run claimed `ports-import-nothing` turns the
    // gate red on `node:fs` (its `to.path` is `^src/(?!vendor/shared)`, which node: never matches).
    name: "attributes findings to the gate correctly instead of inventing a rule that would fire",
    kind: "quality",
    prompt: COMPOSITE_PROMPT,
    practices: [
      "states that the dependency-cruiser gate passes on this patch, or equivalently that no rule catches these defects",
      "does not claim `ports-import-nothing` fires on the node:fs import — its `to.path` is `^src/(?!vendor/shared)`, which a node: specifier never matches",
      "does not claim `row-types-stay-in-persistence` fires on ports.ts or helpers.ts — its `from` path is restricted to service.ts and routes.ts",
    ],
    // Stays at 1.0, and stays RED on google/gemini-2.5-flash. Measured 2026-08-24: asked directly
    // whether the gate fires, that model asserted `ports-import-nothing` flags the `node:fs` import
    // and that `row-types-stay-in-persistence` catches ports.ts AND helpers.ts — both structurally
    // impossible, and both the exact false positives this case was built to catch. 0/3 is the
    // CORRECT verdict. Lowering the threshold or softening the practices here would suppress a true
    // positive, which is the one thing an eval must never do. The finding is about the model, not
    // the case: this skill needs a reviewer that can read a dependency-cruiser config.
    threshold: 1.0,
    maxTurns: 20,
  },
];
