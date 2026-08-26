import { describe, it, expect } from "vitest";
import type { EvalTrialRunResult } from "@devdigest/shared";
import { anchorLines, diffLines, outcomesDisagree, tallyTrials } from "./helpers";

const run = (outcome: EvalTrialRunResult["outcome"]): EvalTrialRunResult => ({
  outcome,
  not_run_reason: outcome === "not_run" ? "provider_error" : null,
  expected_count: 1,
  actual_count: outcome === "passed" ? 1 : 0,
  kept_count: null,
  dropped_count: null,
  duration_ms: 1200,
  cost_usd: 0.01,
  actual_output: null,
});

describe("diffLines", () => {
  it("reads the two file headers as context, not as an addition and a deletion", () => {
    // `+++`/`---` open every unified diff. A naive startsWith("+") paints the
    // header green and red before a single real change — the one thing this
    // function exists to get right.
    const kinds = diffLines(
      ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,3 @@", " kept", "+added", "-removed"].join("\n"),
    ).map((l) => l.kind);
    expect(kinds).toEqual(["context", "context", "hunk", "context", "add", "del"]);
  });

  it("keeps empty lines as rows, so the diff does not collapse", () => {
    expect(diffLines("a\n\nb")).toHaveLength(3);
  });
});

describe("anchorLines", () => {
  it("states one number for a single line and a range for several", () => {
    // "src/config.ts:12-12" reads as a mistake to anyone who has read a stack
    // trace, which is the whole reason this is not a template string.
    expect(anchorLines({ file: "x", low_line: 12, high_line: 12 })).toBe("12");
    expect(anchorLines({ file: "x", low_line: 61, high_line: 74 })).toBe("61-74");
    expect(anchorLines(undefined)).toBe("—");
  });
});

describe("tallyTrials", () => {
  it("counts a not_run as a run and NOT as a pass", () => {
    // A run that never reached an answer is not evidence that the finding
    // reproduces; folding it into either side makes a flaky case look decided.
    expect(tallyTrials([run("passed"), run("not_run"), run("failed")])).toEqual({
      runs: 3,
      passed: 1,
    });
    expect(tallyTrials([])).toEqual({ runs: 0, passed: 0 });
  });
});

describe("outcomesDisagree", () => {
  it("is true only once two runs answered differently", () => {
    expect(outcomesDisagree([run("passed"), run("passed")])).toBe(false);
    expect(outcomesDisagree([run("passed"), run("failed")])).toBe(true);
    expect(outcomesDisagree([run("passed")])).toBe(false);
  });
});
