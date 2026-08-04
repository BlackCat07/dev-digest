import { describe, it, expect } from "vitest";
import { countBySeverity, SEVERITY_LEVELS, totalOf } from "./severity";

describe("countBySeverity", () => {
  it("tallies the three contract levels", () => {
    expect(
      countBySeverity([
        { severity: "CRITICAL" },
        { severity: "CRITICAL" },
        { severity: "WARNING" },
        { severity: "SUGGESTION" },
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it("ignores a severity outside the enum", () => {
    // `findings.severity` is a plain text column, so a stray value is storable.
    // It counts towards a total findings count but lands in no bucket — mirrors
    // the server's countFindingsBySeverity.
    expect(countBySeverity([{ severity: "INFO" }, { severity: "WEIRD" }])).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
  });

  it("returns a fresh object per call, never a shared one", () => {
    // Callers hold these per run/per PR; a shared object would let one row's
    // mutation leak into every other.
    const first = countBySeverity([]);
    first.CRITICAL += 1;
    expect(countBySeverity([]).CRITICAL).toBe(0);
  });
});

describe("totalOf", () => {
  it("sums the three levels", () => {
    expect(totalOf({ CRITICAL: 1, WARNING: 2, SUGGESTION: 3 })).toBe(6);
  });

  it("reads absent counts as zero", () => {
    expect(totalOf(null)).toBe(0);
    expect(totalOf(undefined)).toBe(0);
  });
});

describe("SEVERITY_LEVELS", () => {
  it("is worst-first — the display order for every counter and chip row", () => {
    expect(SEVERITY_LEVELS).toEqual(["CRITICAL", "WARNING", "SUGGESTION"]);
  });
});
