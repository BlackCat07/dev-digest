import { describe, it, expect } from "vitest";
import type { AgentSkillLink, SkillWithUsage } from "@devdigest/shared";
import { filterByQuery, linkedIdsInOrder, move, orderForAgent } from "./helpers";

/**
 * The reorder arithmetic, tested directly.
 *
 * jsdom does not meaningfully simulate HTML5 drag-and-drop — `dragstart`/`drop`
 * carry no DataTransfer and the browser's own reordering never happens — so the
 * handlers in SkillsTab cannot be driven from a test. These pure functions are
 * everything those handlers actually decide.
 */

function skill(id: string, name = id): SkillWithUsage {
  return {
    id,
    name,
    description: "",
    type: "custom",
    source: "manual",
    body: "",
    enabled: true,
    version: 1,
    evidence_files: null,
    usage: { used_by: 0, pull_rate: null, accept_rate: null, findings_30d: 0 },
  };
}

const ids = (list: readonly SkillWithUsage[]) => list.map((s) => s.id);

describe("move", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an item down", () => {
    expect(move(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up", () => {
    expect(move(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns a copy, never mutating the input", () => {
    const out = move(list, 0, 1);
    expect(list).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(list);
  });

  it("is a no-op for the same index or an out-of-range one", () => {
    // A drop onto nothing must leave the order alone rather than throwing —
    // the handler fires on any drop target, including the gaps.
    expect(move(list, 1, 1)).toEqual(list);
    expect(move(list, -1, 2)).toEqual(list);
    expect(move(list, 0, 9)).toEqual(list);
  });
});

describe("orderForAgent", () => {
  const all = [skill("c"), skill("a"), skill("b")];

  it("puts linked skills first, in link order, and the rest alphabetically", () => {
    const links: AgentSkillLink[] = [
      { agent_id: "ag", skill_id: "b", order: 0 },
      { agent_id: "ag", skill_id: "c", order: 1 },
    ];
    expect(ids(orderForAgent(all, links))).toEqual(["b", "c", "a"]);
  });

  it("sorts everything alphabetically when nothing is linked", () => {
    expect(ids(orderForAgent(all, []))).toEqual(["a", "b", "c"]);
  });

  it("ignores a link whose skill is no longer in the workspace", () => {
    // The link list and the skill list are two queries; a deleted skill can be
    // in one and not the other for a render.
    const links: AgentSkillLink[] = [{ agent_id: "ag", skill_id: "ghost", order: 0 }];
    expect(ids(orderForAgent(all, links))).toEqual(["a", "b", "c"]);
  });
});

describe("linkedIdsInOrder", () => {
  it("keeps only linked ids, in the dragged order", () => {
    const ordered = [skill("b"), skill("x"), skill("a")];
    expect(linkedIdsInOrder(ordered, new Set(["a", "b"]))).toEqual(["b", "a"]);
  });

  it("dragging past an unlinked row does not attach it", () => {
    // Unlinked rows are still draggable targets in the list; sending one would
    // silently add a skill the user never checked.
    const ordered = [skill("unlinked"), skill("linked")];
    expect(linkedIdsInOrder(ordered, new Set(["linked"]))).toEqual(["linked"]);
  });

  it("is empty when the last skill is detached", () => {
    expect(linkedIdsInOrder([skill("a")], new Set())).toEqual([]);
  });
});

describe("filterByQuery", () => {
  const all = [skill("s1", "secret-leakage-gate"), skill("s2", "no-then-chains")];

  it("matches on name, case-insensitively", () => {
    expect(ids(filterByQuery(all, "SECRET"))).toEqual(["s1"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterByQuery(all, "   ")).toHaveLength(2);
  });
});
