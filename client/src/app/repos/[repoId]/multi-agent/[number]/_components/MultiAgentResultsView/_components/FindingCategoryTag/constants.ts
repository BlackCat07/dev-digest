import type { FindingCategory } from "@devdigest/shared";
import type { Category } from "@devdigest/ui";

/**
 * The five categories a finding can carry, as a runtime list.
 *
 * It exists because the two type-level statements of this set live in different
 * packages and the wire sits between them: `FindingCategory` in the shared
 * contract is the five-value enum, `Category` in the design system is the same
 * five keys of its icon/label registry, and `AgentColumnFinding.category` is
 * plain `string` — the underlying column is `text` with no CHECK constraint, so
 * the server passes it through without parsing rather than pretending to know.
 *
 * Typing the elements as the INTERSECTION of the two unions is the check: the
 * day the contract gains a sixth category, or the design system drops one, this
 * literal stops compiling instead of silently rendering a blank tag. Nothing
 * else in the tree ties the two together.
 *
 * A runtime array rather than a value import from `@devdigest/shared`: importing
 * a value from that barrel pulls its ESM `.js` re-exports into webpack and 500s
 * every route that reaches it (`client/INSIGHTS.md`, 2026-08-03).
 */
export const FINDING_CATEGORIES: readonly (FindingCategory & Category)[] = [
  "bug",
  "security",
  "perf",
  "style",
  "test",
] as const;
