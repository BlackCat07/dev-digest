/* FindingCategoryTag — a finding's category, as the small tag the design draws
   beside the title (AC-63, AC-104).

   Shared by both modes on purpose. Columns mode renders it on every row and
   tabs mode renders it on the collapsed row AND keeps it on the expanded one,
   so the narrowing and the choice of primitive are stated once here rather than
   in three rows that can drift apart. It is the second consumer that earned it
   the promotion out of either child and into their common parent's
   `_components/`.

   It carries no colour of its own: `CategoryTag` renders an icon and the
   category's WORD, so the tag names the category in text and never signals it
   by colour alone (AC-88). */
"use client";

import { CategoryTag } from "@devdigest/ui";
import { FINDING_CATEGORIES } from "./constants";

/**
 * Renders nothing at all for a value the contract does not know.
 *
 * `AgentColumnFinding.category` is a free string, so a row can legitimately
 * arrive carrying something outside the five. A tag reading a category the
 * product has no vocabulary for is worse than no tag: the reader cannot act on
 * it, and a fallback value would attribute a category the agent never chose.
 */
export function FindingCategoryTag({ category }: { category: string }) {
  const known = FINDING_CATEGORIES.find((c) => c === category);
  if (!known) return null;
  return <CategoryTag category={known} />;
}

export default FindingCategoryTag;
