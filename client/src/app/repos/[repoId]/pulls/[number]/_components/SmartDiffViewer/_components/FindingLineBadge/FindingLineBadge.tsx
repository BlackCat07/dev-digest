/* FindingLineBadge — the severity tag sitting on a decorated diff row, made
   clickable: it opens that finding's card in the Agent-runs tab.

   The finding-level counterpart of `FindingJumpBadge` (which is file-level). Both
   are real `<button type="button">`s for the same reason: `Badge` is a `<span>`, so
   a clickable severity tag cannot be assembled from `vendor/ui` as-is, and a native
   button brings Tab, Enter and Space with it instead of a `role="button"` plus a
   hand-rolled `onKeyDown`.

   It reports ONE finding even when the row hosts several. The tag already leads
   with the worst severity and carries `×N` for the rest, so the click follows the
   tag: the worst finding on the line. The card it lands on sits next to its
   siblings from the same run, which is where the other N−1 are read. */
"use client";

import { useTranslations } from "next-intl";
import { SeverityTag } from "../SeverityTag";
import { s } from "./styles";

export function FindingLineBadge({
  severity,
  count,
  onOpen,
}: {
  /** The worst severity on this row — the tag's colour, icon and word. */
  severity: string;
  /** How many findings this one tag stands for; rendered as `×N` above 1. */
  count: number;
  onOpen: () => void;
}) {
  const t = useTranslations("prReview");

  return (
    <button
      type="button"
      onClick={(e) => {
        // The row is a hover target for the inline-comment affordance, and the
        // file header's disclosure is a button further up the tree — neither
        // should also fire on a badge press.
        e.stopPropagation();
        onOpen();
      }}
      aria-label={t("smartDiff.lineBadgeLabel", { count })}
      style={s.button}
    >
      <SeverityTag severity={severity} count={count} />
    </button>
  );
}
