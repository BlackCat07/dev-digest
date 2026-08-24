/* SmartDiffViewer helpers — the three-way join, the expansion rule, and the
   on-diff/off-diff partition.

   Pure, so these are the cheap tests that pin the decisions. The rendering tests in
   `SmartDiffViewer.test.tsx` cover what a reader sees; these cover what would be
   silently wrong even while the screen looked fine. */
import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES, parsePatch } from "@/components/diff-viewer";
import {
  buildViewModel,
  fileCardId,
  groupFiles,
  initialOpen,
  latestFindingsPerAgent,
  lineId,
  partitionFindings,
  severityByLine,
} from "./helpers";

const PATCH = [
  "@@ -10,4 +10,6 @@ export const config = {",
  "   port: 3000,",
  '+  stripeKey: "sk_live_x",',
  "+  redisUrl: process.env.REDIS_URL,",
  " };",
].join("\n");

function file(path: string, over: Partial<PrFile> = {}): PrFile {
  return { path, additions: 2, deletions: 0, patch: PATCH, ...over } as PrFile;
}

let n = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  n += 1;
  return {
    id: `f-${n}`,
    review_id: "r-1",
    severity: "WARNING",
    category: "bug",
    title: `Finding ${n}`,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function response(groups: SmartDiff["groups"]): SmartDiff {
  return {
    groups,
    split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
  };
}

const CORE_WIRING_BOILERPLATE = response([
  {
    role: "core",
    files: [
      {
        path: "src/logic.ts",
        pseudocode_summary: "doThing",
        additions: 10,
        deletions: 0,
        finding_lines: [],
      },
    ],
  },
  {
    role: "wiring",
    files: [
      {
        path: "src/config.ts",
        pseudocode_summary: null,
        additions: 2,
        deletions: 0,
        finding_lines: [12],
      },
    ],
  },
  {
    role: "boilerplate",
    files: [
      {
        path: "package-lock.json",
        pseudocode_summary: null,
        additions: 90,
        deletions: 4,
        finding_lines: [],
      },
    ],
  },
]);

const FILES = [file("src/logic.ts"), file("src/config.ts"), file("package-lock.json")];

describe("latestFindingsPerAgent", () => {
  /** Rows arrive NEWEST-FIRST, the way `GET /pulls/:id/reviews` orders them. */
  function review(id: string, agentId: string | null, findings: FindingRecord[], kind = "review"): ReviewRecord {
    return { id, pr_id: "pr-1", agent_id: agentId, run_id: null, kind, findings } as unknown as ReviewRecord;
  }

  /**
   * The regression this function exists for, measured on a real PR before it existed:
   * two agents run twice each, and `src/modules/tasks/routes.ts` showed **11 findings**
   * while the server's `finding_lines` for that file was `[13, 40]`. Re-running an
   * agent has to REPLACE its findings, not add to them.
   */
  it("keeps only an agent's newest row, so a re-run replaces rather than accumulates", () => {
    const out = latestFindingsPerAgent([
      review("r4", "api-contract", [finding({ id: "new-1" }), finding({ id: "new-2" })]),
      review("r3", "general", [finding({ id: "new-3" })]),
      review("r2", "api-contract", [finding({ id: "old-1" }), finding({ id: "old-2" })]),
      review("r1", "general", [finding({ id: "old-3" })]),
    ]);
    expect(out.map((f) => f.id).sort()).toEqual(["new-1", "new-2", "new-3"]);
  });

  it("unions across agents, because two agents are two opinions", () => {
    const out = latestFindingsPerAgent([
      review("r2", "perf", [finding({ id: "a" })]),
      review("r1", "security", [finding({ id: "b" })]),
    ]);
    expect(out).toHaveLength(2);
  });

  it("ignores summary rows", () => {
    const out = latestFindingsPerAgent([
      review("r2", "general", [finding({ id: "sum" })], "summary"),
      review("r1", "general", [finding({ id: "real" })], "review"),
    ]);
    expect(out.map((f) => f.id)).toEqual(["real"]);
  });

  it("keys an agent-less review on its own row id, so the seeded review still counts", () => {
    // `reviews.agent_id` is nullable and the seeded review has it null; a raw key
    // would collapse both of these into one bucket.
    const out = latestFindingsPerAgent([
      review("r2", null, [finding({ id: "a" })]),
      review("r1", null, [finding({ id: "b" })]),
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns nothing for a PR with no reviews", () => {
    expect(latestFindingsPerAgent([])).toEqual([]);
  });
});

describe("buildViewModel — the join", () => {
  it("attaches the role and the summary from the response", () => {
    const vm = buildViewModel(FILES, CORE_WIRING_BOILERPLATE, []);
    expect(vm.map((f) => [f.path, f.role])).toEqual([
      ["src/logic.ts", "core"],
      ["src/config.ts", "wiring"],
      ["package-lock.json", "boilerplate"],
    ]);
    expect(vm[0]!.summary).toBe("doThing");
    expect(vm[1]!.summary).toBeNull();
  });

  /**
   * The property that makes this tab safe. A partial or stale response must never be
   * able to hide a changed file, because this is the only screen that shows the diff
   * — so `pr.files` is the spine and an unclassified path gets a visible bucket.
   */
  it("keeps a file the response did not classify, as unclassified", () => {
    const vm = buildViewModel(
      [...FILES, file("src/surprise.ts")],
      CORE_WIRING_BOILERPLATE,
      [],
    );
    expect(vm).toHaveLength(4);
    expect(vm.find((f) => f.path === "src/surprise.ts")!.role).toBe("unclassified");
  });

  it("renders every file even when the response is missing entirely", () => {
    const vm = buildViewModel(FILES, null, []);
    expect(vm.map((f) => f.path)).toEqual(FILES.map((f) => f.path));
    expect(vm.every((f) => f.role === "unclassified")).toBe(true);
  });

  it("joins findings by path, and marks a CRITICAL file as blocking", () => {
    const vm = buildViewModel(FILES, CORE_WIRING_BOILERPLATE, [
      finding({ file: "src/config.ts", severity: "CRITICAL" }),
      finding({ file: "src/config.ts", severity: "WARNING", start_line: 13 }),
    ]);
    const config = vm.find((f) => f.path === "src/config.ts")!;
    expect(config.findings).toHaveLength(2);
    expect(config.hasBlockers).toBe(true);
    // Worst first, so the badge's colour and the dot agree.
    expect(config.findings[0]!.severity).toBe("CRITICAL");
    expect(vm.find((f) => f.path === "src/logic.ts")!.hasBlockers).toBe(false);
  });

  /**
   * The badge has to agree with the Agent-runs tab, which counts blockers with
   * `!f.dismissed_at`. Counting dismissed findings here would put two different
   * numbers for one PR on two tabs of one screen.
   */
  it("excludes dismissed findings", () => {
    const vm = buildViewModel(FILES, CORE_WIRING_BOILERPLATE, [
      finding({ file: "src/config.ts", dismissed_at: "2026-08-11T00:00:00Z" }),
    ]);
    expect(vm.find((f) => f.path === "src/config.ts")!.findings).toHaveLength(0);
  });

  it("joins a finding whose path is written differently", () => {
    const vm = buildViewModel(FILES, CORE_WIRING_BOILERPLATE, [
      finding({ file: "./src/config.ts" }),
    ]);
    expect(vm.find((f) => f.path === "src/config.ts")!.findings).toHaveLength(1);
  });

  it("does not attach a finding by path suffix", () => {
    const vm = buildViewModel(FILES, CORE_WIRING_BOILERPLATE, [finding({ file: "config.ts" })]);
    expect(vm.every((f) => f.findings.length === 0)).toBe(true);
  });
});

describe("groupFiles — the order", () => {
  /** "Core first" is the feature, so it is asserted as an order, not as membership. */
  it("returns core, wiring, boilerplate, unclassified in that order", () => {
    const vm = buildViewModel(
      [file("package-lock.json"), file("src/surprise.ts"), file("src/config.ts"), file("src/logic.ts")],
      CORE_WIRING_BOILERPLATE,
      [],
    );
    expect(groupFiles(vm).map((g) => g.role)).toEqual([
      "core",
      "wiring",
      "boilerplate",
      "unclassified",
    ]);
  });

  it("omits an empty group rather than rendering a zero-count heading", () => {
    const vm = buildViewModel([file("src/logic.ts")], CORE_WIRING_BOILERPLATE, []);
    expect(groupFiles(vm).map((g) => g.role)).toEqual(["core"]);
  });
});

describe("initialOpen — precedence FINDINGS > ROLE > SIZE", () => {
  const vm = (path: string, sd: SmartDiff, findings: FindingRecord[] = [], over: Partial<PrFile> = {}) =>
    buildViewModel([file(path, over)], sd, findings)[0]!;

  it("keeps a lock file collapsed — the acceptance criterion", () => {
    expect(initialOpen(vm("package-lock.json", CORE_WIRING_BOILERPLATE))).toBe(false);
  });

  it("keeps a wiring file with no findings collapsed", () => {
    expect(initialOpen(vm("src/config.ts", CORE_WIRING_BOILERPLATE))).toBe(false);
  });

  it("opens a small core file", () => {
    expect(initialOpen(vm("src/logic.ts", CORE_WIRING_BOILERPLATE))).toBe(true);
  });

  it("keeps a HUGE core file with no findings collapsed", () => {
    const big = vm("src/logic.ts", CORE_WIRING_BOILERPLATE, [], {
      additions: AUTO_EXPAND_MAX_LINES + 1,
      deletions: 0,
    });
    expect(initialOpen(big)).toBe(false);
  });

  /**
   * The precedence that resolves the one real conflict in the brief: "keep
   * boilerplate collapsed" versus "auto-expand files with findings". Findings win —
   * a jump would have to open the file anyway — and the lock file still starts
   * collapsed because a lock file has no findings to override its role.
   */
  it("opens a BOILERPLATE file that has a finding", () => {
    const flagged = vm("package-lock.json", CORE_WIRING_BOILERPLATE, [
      finding({ file: "package-lock.json" }),
    ]);
    expect(initialOpen(flagged)).toBe(true);
  });

  it("opens an unclassified file only by the size rule not applying to it", () => {
    // `unclassified` is not `core`, so size never opens it; only a finding does.
    expect(initialOpen(vm("src/surprise.ts", CORE_WIRING_BOILERPLATE))).toBe(false);
    expect(
      initialOpen(vm("src/surprise.ts", CORE_WIRING_BOILERPLATE, [finding({ file: "src/surprise.ts" })])),
    ).toBe(true);
  });
});

describe("partitionFindings — nothing is dropped", () => {
  const lines = parsePatch(PATCH);

  it("anchors a finding whose line the patch renders", () => {
    const { byLine, offDiff } = partitionFindings([finding({ start_line: 12 })], lines);
    expect(byLine.get(12)).toHaveLength(1);
    expect(offDiff).toEqual([]);
  });

  it("sends a finding on a line outside the patch to offDiff, not to nowhere", () => {
    const { byLine, offDiff } = partitionFindings([finding({ start_line: 999 })], lines);
    expect(byLine.size).toBe(0);
    expect(offDiff).toHaveLength(1);
  });

  it("keeps the total honest: on-diff plus off-diff equals what went in", () => {
    const input = [finding({ start_line: 12 }), finding({ start_line: 999 }), finding({ start_line: 11 })];
    const { byLine, offDiff } = partitionFindings(input, lines);
    const anchored = [...byLine.values()].reduce((sum, list) => sum + list.length, 0);
    expect(anchored + offDiff.length).toBe(input.length);
  });

  it("puts two findings on one line under one key", () => {
    const { byLine } = partitionFindings(
      [finding({ start_line: 12 }), finding({ start_line: 12, severity: "CRITICAL" })],
      lines,
    );
    expect(byLine.get(12)).toHaveLength(2);
  });
});

describe("severityByLine — the extent of a finding", () => {
  const lines = parsePatch(PATCH);

  it("decorates every rendered line a multi-line finding spans", () => {
    const map = severityByLine([finding({ start_line: 11, end_line: 13 })], lines);
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([11, 12, 13]);
  });

  it("emits one badge but decorates the range", () => {
    const multi = [finding({ start_line: 11, end_line: 13 })];
    expect(partitionFindings(multi, lines).byLine.size).toBe(1);
    expect(severityByLine(multi, lines).size).toBe(3);
  });

  it("keeps the worst severity where two findings overlap", () => {
    const map = severityByLine(
      [
        finding({ start_line: 11, end_line: 13, severity: "SUGGESTION" }),
        finding({ start_line: 12, end_line: 12, severity: "CRITICAL" }),
      ],
      lines,
    );
    expect(map.get(12)).toBe("CRITICAL");
    expect(map.get(11)).toBe("SUGGESTION");
  });

  it("decorates the on-screen part of a finding that starts off-diff", () => {
    const map = severityByLine([finding({ start_line: 1, end_line: 12 })], lines);
    expect(map.get(11)).toBe("WARNING");
    expect(map.has(1)).toBe(false);
  });
});

describe("lineId", () => {
  it("builds an id that getElementById can find but a selector could not", () => {
    const id = lineId("src/api/users.ts", 45);
    expect(id).toBe("sd-line-src/api/users.ts-RIGHT-45");
    // The `/` and `.` are exactly why the code uses getElementById.
    expect(id).toContain("/");
    expect(id).toContain(".");
  });
});

describe("fileCardId", () => {
  it("builds a per-file id distinct from any of that file's line ids", () => {
    const id = fileCardId("src/api/users.ts");
    expect(id).toBe("sd-file-src/api/users.ts");
    // The two prefixes must not collide: the card is the anchor for a target with
    // no line, and a line id is the anchor for one with a line.
    expect(id).not.toBe(lineId("src/api/users.ts", 45));
    expect(id.startsWith("sd-line")).toBe(false);
  });
});
