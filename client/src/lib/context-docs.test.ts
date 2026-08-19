/* Covers the two helpers this module gained when they were promoted out of the
   agent and skill Context tabs — the rest of the module is exercised through
   the screens that use it. Both are shared API now, and a shared helper in
   `src/lib/` is tested at its own level: the two `ContextTab.test.tsx` files
   assert the tabs' behaviour and would not say which of them broke. */
import { describe, it, expect } from "vitest";
import type { ContextAttachment } from "@devdigest/shared";
import { attachedPathsFor, move } from "./context-docs";

const attachment = (repo_id: string, path: string, order: number): ContextAttachment => ({
  repo_id,
  path,
  order,
});

describe("attachedPathsFor", () => {
  it("keeps only the active repository's attachments, in run order", () => {
    // The read answers with every repository the owner holds a set for, so a
    // row from another clone is a path this repository's runs never carry.
    const attachments = [
      attachment("repo-b", "docs/other.md", 0),
      attachment("repo-a", "specs/two.md", 1),
      attachment("repo-a", "specs/one.md", 0),
    ];

    expect(attachedPathsFor(attachments, "repo-a")).toEqual(["specs/one.md", "specs/two.md"]);
  });

  it("breaks a tie on equal order by path, so two reads agree", () => {
    // Without the tiebreaker the sequence is left to the database, and this
    // order is also the order the next prompt carries.
    const attachments = [
      attachment("repo-a", "specs/b.md", 0),
      attachment("repo-a", "specs/a.md", 0),
    ];

    expect(attachedPathsFor(attachments, "repo-a")).toEqual(["specs/a.md", "specs/b.md"]);
  });

  it("returns nothing when no repository is active, and does not mutate its input", () => {
    // An attachment is scoped to a repository: with none there is nothing to
    // list. And the sort must not reorder the caller's query cache in place.
    const attachments = [
      attachment("repo-a", "specs/two.md", 1),
      attachment("repo-a", "specs/one.md", 0),
    ];

    expect(attachedPathsFor(attachments, null)).toEqual([]);
    expect(attachedPathsFor(attachments, undefined)).toEqual([]);
    expect(attachedPathsFor(attachments, "")).toEqual([]);

    attachedPathsFor(attachments, "repo-a");
    expect(attachments.map((a) => a.path)).toEqual(["specs/two.md", "specs/one.md"]);
  });
});

describe("move", () => {
  it("moves an item and always returns a new array", () => {
    const list = ["a", "b", "c"];

    expect(move(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(list, 0, 2)).not.toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("treats an out-of-range or no-op index as an unchanged list, never a throw", () => {
    // A drop onto nothing, or a "move up" from the first row, is a no-op.
    const list = ["a", "b", "c"];

    for (const [from, to] of [
      [1, 1],
      [-1, 1],
      [3, 1],
      [1, -1],
      [1, 3],
    ] as const) {
      expect(move(list, from, to)).toEqual(list);
    }
    expect(move([], 0, 0)).toEqual([]);
  });

  it("stays generic, so a row model with any shape reorders through it", () => {
    // The two Context tabs pass different row models; narrowing this to one of
    // them would re-create the duplication it was promoted here to remove.
    const rows = [
      { kind: "agent", path: "a.md" },
      { kind: "skill", path: "b.md", skillName: "Style" },
    ];

    expect(move(rows, 1, 0)).toEqual([rows[1], rows[0]]);
  });
});
