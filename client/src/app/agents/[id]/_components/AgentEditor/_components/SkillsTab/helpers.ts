import type { AgentSkillLink, SkillWithUsage } from "@devdigest/shared";

/**
 * Move the item at `from` to index `to`, returning a NEW array.
 *
 * Extracted as a pure function because jsdom does not meaningfully simulate
 * HTML5 drag events — the drag handlers themselves cannot be unit-tested, so the
 * arithmetic that they drive is what has to be covered directly.
 *
 * Out-of-range indices return the list unchanged rather than throwing: a drop
 * onto nothing is a no-op, not an error.
 */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * Order the workspace's skills for the tab: linked ones first in prompt order,
 * then the rest alphabetically.
 *
 * The tab lists EVERY skill, not just the linked ones, because attaching is the
 * primary action here — a picker you have to open first would hide it. Linked
 * ones lead because their order is the thing being edited.
 */
export function orderForAgent(
  skills: readonly SkillWithUsage[],
  links: readonly AgentSkillLink[],
): SkillWithUsage[] {
  const rank = new Map(links.map((l, i) => [l.skill_id, i]));
  const linked = skills
    .filter((s) => rank.has(s.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = skills
    .filter((s) => !rank.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...linked, ...rest];
}

/** Case-insensitive filter over name, description and type. */
export function filterByQuery(skills: SkillWithUsage[], query: string): SkillWithUsage[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description} ${s.type}`.toLowerCase().includes(q));
}

/**
 * The ordered skill ids to POST after a drag.
 *
 * Reordering only ever rearranges the LINKED subset: an unlinked row can be
 * dragged around visually, but sending it would silently attach it. The dragged
 * order is therefore filtered back down to what is actually linked.
 */
export function linkedIdsInOrder(
  ordered: readonly SkillWithUsage[],
  linkedIds: ReadonlySet<string>,
): string[] {
  return ordered.filter((s) => linkedIds.has(s.id)).map((s) => s.id);
}
