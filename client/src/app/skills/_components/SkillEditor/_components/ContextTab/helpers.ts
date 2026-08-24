/* Unit-private helpers for the skill editor's Context tab.

   Only this tab's own row model lives here. What the agent editor's Context tab
   needs as well — `move`, `attachedPathsFor`, and the grouping, filter, token
   arithmetic and effective-order rule — lives in `src/lib/context-docs.ts` and
   is imported from there: the two tabs live in sibling route subtrees which
   never import each other, and a unit's `helpers.ts` is unit-private under the
   barrel convention, so a helper two subtrees reach belongs in `src/lib/`.

   `contextRows` and `ContextRow` stay because they are genuinely this tab's:
   a skill's row is attached or available, with none of the agent tab's
   inherited-from-skill case. */
import type { ProjectDoc } from "@devdigest/shared";

/**
 * One rendered row: a document this skill sends, or one it could send.
 *
 * `doc` is nullable on an attached row and only there. An attachment stores a
 * PATH, so it outlives the document being deleted from the clone; such a row
 * still renders, contributing zero tokens, which is the truth about what the
 * next run will carry.
 */
export type ContextRow =
  | { kind: "attached"; path: string; doc: ProjectDoc | null }
  | { kind: "available"; path: string; doc: ProjectDoc };

/**
 * The rendered list: attached documents in their order, then the rest of what
 * was discovered, in the order the server listed it (path ascending).
 *
 * Attached first because their order is the thing being edited and the thing a
 * run obeys; the rest follow as a picker. A discovered document that is already
 * attached is not repeated below.
 */
export function contextRows(
  attachedPaths: readonly string[],
  docs: readonly ProjectDoc[],
): ContextRow[] {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const attached = new Set(attachedPaths);

  const rows: ContextRow[] = attachedPaths.map((path) => ({
    kind: "attached",
    path,
    doc: byPath.get(path) ?? null,
  }));

  for (const doc of docs) {
    if (!attached.has(doc.path)) rows.push({ kind: "available", path: doc.path, doc });
  }
  return rows;
}
