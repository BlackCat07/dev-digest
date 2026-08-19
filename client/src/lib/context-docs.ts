/**
 * Project-context helpers shared by the screens that read a repository's
 * documents.
 *
 * Lives in `src/lib/` rather than beside a component because three route
 * subtrees need it: the Project Context screen
 * (`repos/[repoId]/context/_components/*`), the agent editor's Context tab
 * (`agents/[id]/_components/AgentEditor/_components/ContextTab`) and the skill
 * editor's (`skills/_components/SkillEditor/_components/ContextTab`). A unit's
 * `helpers.ts` is unit-private under the barrel convention, so a helper two
 * subtrees reach belongs here — the same reason `src/lib/skill.ts` exists.
 *
 * Everything here is a RUNTIME value, and that is why it is not in
 * `@devdigest/shared`. A runtime import from that package resolves under
 * `tsc --noEmit` and under vitest and then breaks `next dev`/`next build` with
 * "Can't resolve './contracts/*.js'" — a 500 on every route that transitively
 * reaches it (`INSIGHTS.md`, Recurring Errors, 2026-08-03). Client imports of
 * the contracts stay `import type`; this file is their runtime mirror.
 */
import type { ContextAttachment, EffectiveContextDoc, ProjectDoc } from "@devdigest/shared";
import { estimateTokens } from "./skill";

/**
 * Re-exported so every project-context caller counts tokens through the one
 * function, rather than growing a second `ceil(chars / 4)` beside a component.
 *
 * The guarantee this protects is not cosmetic: `ProjectDoc.tokens` is computed
 * server-side with the same rule, so a per-row figure, a combined total and a
 * figure taken from a document's own text all have to agree. Two
 * implementations of "approximately" is how they stop agreeing.
 */
export { estimateTokens };

/** One root's documents, for the list's grouped rendering. */
export interface ContextDocGroup {
  /** The searched root the documents were found under, e.g. `specs/`. */
  root: string;
  docs: ProjectDoc[];
}

/**
 * Group a document list by the root it was found under.
 *
 * The root is taken from `ProjectDoc.root` — the server derives it from where
 * the document was actually found and never from the path text, so an
 * `INSIGHTS.md` matched by filename outside every configured root still carries
 * a group to sit under. Groups come back in the order their first document
 * appears, which for a path-ascending list is stable across requests.
 */
export function groupDocsByRoot(docs: readonly ProjectDoc[]): ContextDocGroup[] {
  const groups = new Map<string, ContextDocGroup>();
  for (const doc of docs) {
    const group = groups.get(doc.root);
    if (group) group.docs.push(doc);
    else groups.set(doc.root, { root: doc.root, docs: [doc] });
  }
  return [...groups.values()];
}

/**
 * Case-insensitive filter over a document's path.
 *
 * Path only, deliberately: the list never holds document text, so matching
 * anything else would silently search a field the reader cannot see. An empty
 * or whitespace-only query returns the input unfiltered rather than nothing.
 */
export function filterDocsByPath(docs: readonly ProjectDoc[], search: string): ProjectDoc[] {
  const q = search.trim().toLowerCase();
  if (!q) return [...docs];
  return docs.filter((doc) => doc.path.toLowerCase().includes(q));
}

/**
 * An owner's attached paths for ONE repository, in the order a run reads them.
 *
 * Both `GET /agents/:id/context` and `GET /skills/:id/context` answer with the
 * attachments across EVERY repository that owner holds a set for — neither
 * takes a repository query parameter — because an agent or a skill can be
 * attached in more than one. A tab is open on one repository, so the rest are
 * filtered out here rather than rendered as rows whose paths point at another
 * clone and which this repository's runs never carry.
 *
 * `path` is the tiebreaker on equal `order` for the same reason the server's
 * read carries one: without it the sequence is left to the database, and the
 * rendered order — which is also the order the next prompt carries — could
 * differ between two reads of an unchanged set.
 */
export function attachedPathsFor(
  attachments: readonly ContextAttachment[],
  repoId: string | null | undefined,
): string[] {
  if (!repoId) return [];
  return attachments
    .filter((a) => a.repo_id === repoId)
    .slice()
    .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
    .map((a) => a.path);
}

/** One skill's contribution to an agent's effective set, in that skill's own order. */
export interface ContextSkillContribution {
  skill_id: string;
  skill_name: string;
  /** Ordered, repo-relative — that skill's attachments for the active repository. */
  paths: readonly string[];
}

/**
 * Merge an agent's own attachments with those of its skills, the way a run does.
 *
 * The rule mirrors the contract's `EffectiveContextDoc` and the server's
 * assembly exactly: the agent's own paths in their order first, then each
 * skill's in skill-link order and, within a skill, in that skill's attachment
 * order — deduplicated by path with the FIRST occurrence winning. So a document
 * attached both directly and through two skills appears once, at the agent's
 * position, with `source` naming the agent.
 *
 * Two things the caller owns rather than this function, because both are
 * lookups it already has and neither is derivable from a path list: pass only
 * ENABLED skills (a disabled skill contributes nothing to a run), and pass only
 * the attachments matching the active repository (a run only ever sees the set
 * for the pull request's repository). Passing more here would render rows that
 * no run would carry.
 *
 * `source` keeps the discriminated shape rather than a nullable skill id so a
 * caller branches on `source.kind`: an inherited row is labelled with its skill
 * and offers neither a detach control nor a drag handle, and a nullable id
 * would invite rendering the absence as "unknown".
 */
export function effectiveContextDocs(
  agentPaths: readonly string[],
  skills: readonly ContextSkillContribution[],
): EffectiveContextDoc[] {
  const seen = new Set<string>();
  const effective: EffectiveContextDoc[] = [];

  for (const path of agentPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    effective.push({ path, source: { kind: "agent" }, order: effective.length });
  }

  for (const skill of skills) {
    for (const path of skill.paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      effective.push({
        path,
        source: { kind: "skill", skill_id: skill.skill_id, skill_name: skill.skill_name },
        order: effective.length,
      });
    }
  }

  return effective;
}

/**
 * Approximate combined token cost of an attached set, for the running total
 * beside the picker.
 *
 * Derived from the discovered documents on every call — the caller computes it
 * during render from the current attached paths rather than mirroring it into
 * state, so it moves the moment a row is toggled with nothing to keep in sync.
 *
 * A path with no matching discovered document contributes 0 and is not an
 * error: an attachment survives the document being deleted from the clone (the
 * path is what is stored, never the text), and that run degrades rather than
 * failing. The total then understates by exactly the document that is no longer
 * there, which is the truth about what the next prompt will carry.
 */
export function attachedTokenTotal(
  docs: readonly ProjectDoc[],
  attachedPaths: readonly string[],
): number {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  let total = 0;
  for (const path of attachedPaths) total += byPath.get(path)?.tokens ?? 0;
  return total;
}

/**
 * Move the item at `from` to index `to`, returning a NEW array.
 *
 * Out-of-range indices return the list unchanged rather than throwing: a drop
 * onto nothing, or a "move up" from the first row, is a no-op and not an error.
 *
 * Generic on purpose. The two Context tabs that reorder with it pass different
 * row models — the agent tab's carries an inherited-from-skill case the skill
 * tab has none of — so narrowing this to one of them would re-create in the
 * type system the duplication it was promoted here to remove.
 */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
