/* Unit-private helpers for the agent editor's Context tab.

   Only this tab's own row model lives here. What the skill editor's Context tab
   needs as well — `move`, `attachedPathsFor`, and the grouping, filter, token
   arithmetic and effective-order rule — lives in `src/lib/context-docs.ts` and
   is imported from there: the two tabs sit in sibling route subtrees which never
   import each other, and a unit's `helpers.ts` is unit-private under the barrel
   convention, so a helper two subtrees reach belongs in `src/lib/`.

   `contextRows` and `ContextRow` stay because they are genuinely this tab's:
   the row model carries an inherited-from-skill case the skill tab has none
   of. */
import type { EffectiveContextDoc, ProjectDoc } from "@devdigest/shared";

/**
 * One rendered row.
 *
 * `agent` and `skill` mirror `EffectiveContextDoc.source`; `available` is a
 * discovered document that is in neither set and can be attached. The three
 * cases render differently and the difference is a requirement, not a
 * decoration — an inherited row offers no checkbox and no drag handle at all.
 *
 * `doc` is nullable on the two attached cases and only on those: an attachment
 * stores a PATH, so it outlives the document being deleted from the clone. Such
 * a row still renders, contributing zero tokens, which is the truth about what
 * the next run will carry.
 */
export type ContextRow =
  | { kind: "agent"; path: string; doc: ProjectDoc | null }
  | { kind: "skill"; path: string; doc: ProjectDoc | null; skillName: string }
  | { kind: "available"; path: string; doc: ProjectDoc };

/**
 * The rendered list: the effective set in effective order, then everything else
 * that was discovered, in the order the server listed it (path ascending).
 *
 * Effective first because the order of those rows is the thing being edited and
 * the thing a run obeys; the rest follow as a picker. A discovered document
 * already in the effective set is not repeated below it.
 */
export function contextRows(
  effective: readonly EffectiveContextDoc[],
  docs: readonly ProjectDoc[],
): ContextRow[] {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const inEffective = new Set(effective.map((e) => e.path));

  const rows: ContextRow[] = effective.map((entry) => {
    const doc = byPath.get(entry.path) ?? null;
    return entry.source.kind === "skill"
      ? { kind: "skill", path: entry.path, doc, skillName: entry.source.skill_name }
      : { kind: "agent", path: entry.path, doc };
  });

  for (const doc of docs) {
    if (!inEffective.has(doc.path)) rows.push({ kind: "available", path: doc.path, doc });
  }
  return rows;
}
