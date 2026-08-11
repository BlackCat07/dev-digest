/* visibleFindings — the scope isolate, and the sharp edge that comes with it.

   The edge (intent-layer.md, Behaviour #12): isolating a scope hides UNLABELLED
   findings as well as the other label. Both representations of "unlabelled"
   occur in real rows — `scope: null` from the DB column, and the key missing
   altogether on anything written before the Intent Layer — so both appear here. */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { visibleFindings } from "./helpers";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: o.id,
    file: "src/api/limits.ts",
    start_line: 10,
    end_line: 12,
    rationale: "…",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const IN = finding({ id: "in", scope: "in_scope" });
const OUT = finding({ id: "out", scope: "out_of_scope" });
const NULL_SCOPE = finding({ id: "null-scope", scope: null });
/** Pre-Intent-Layer row: no `scope` key at all. */
const NO_SCOPE = finding({ id: "no-scope" });

const ALL = [IN, OUT, NULL_SCOPE, NO_SCOPE];

const ids = (rows: FindingRecord[]) => rows.map((f) => f.id).sort();

describe("visibleFindings — scope isolate", () => {
  it("shows every finding, labelled or not, with no scope filter set", () => {
    // The default. This feature annotates and never drops, so an unlabelled
    // finding has to survive both `null` and `undefined` for the scope argument.
    expect(ids(visibleFindings(ALL, false, null, null))).toEqual(ids(ALL));
    expect(ids(visibleFindings(ALL, false))).toEqual(ids(ALL));
  });

  it("isolating a scope also hides the UNLABELLED findings, not just the other label", () => {
    expect(ids(visibleFindings(ALL, false, null, "in_scope"))).toEqual(["in"]);
    expect(ids(visibleFindings(ALL, false, null, "out_of_scope"))).toEqual(["out"]);
  });

  it("isolates scope independently of severity and hide-low-confidence", () => {
    const rows = [
      finding({ id: "in-crit", scope: "in_scope", severity: "CRITICAL" }),
      finding({ id: "in-low", scope: "in_scope", confidence: 0.4 }),
      finding({ id: "out-crit", scope: "out_of_scope", severity: "CRITICAL" }),
    ];
    // Scope narrows to two, hide-low drops the 0.4 one.
    expect(ids(visibleFindings(rows, true, null, "in_scope"))).toEqual(["in-crit"]);
    // Both axes at once: CRITICAL ∩ in_scope.
    expect(ids(visibleFindings(rows, false, "CRITICAL", "in_scope"))).toEqual(["in-crit"]);
    // A severity the isolated scope has none of is empty, not unfiltered.
    expect(visibleFindings(rows, false, "SUGGESTION", "in_scope")).toEqual([]);
  });
});
