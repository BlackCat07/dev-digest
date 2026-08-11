/* FindingJumpBadge — "3 findings", clickable, lands the diff on the first one.

   A real `<button type="button">`, which is the whole reason this component exists.
   `Badge` and `SeverityBadge` are `<span>`s, and `Chip` — the one vendor primitive
   that IS a button — only tints its icon, so a severity-coloured clickable badge
   cannot be assembled from the kit as-is. `vendor/ui` is extend-by-new-file, so the
   button is built here rather than by teaching a shared primitive an `onClick`.

   Being a native button is what gives it Tab, Enter and Space for free — no
   `role="button"` plus a hand-rolled `onKeyDown`, which is what the two
   `<div onClick>` disclosures elsewhere in this screen had to do.

   The count is FINDINGS, not `finding_lines`: two findings on one line are two
   problems, and the number has to match what the file lists below and what the
   Agent-runs tab counts. */
"use client";

import { useTranslations } from "next-intl";
import { SeverityTag } from "../SeverityTag";
import { s } from "./styles";

export function FindingJumpBadge({
  path,
  count,
  worst,
  onJump,
}: {
  path: string;
  count: number;
  /** Leads the badge; the file's worst severity, so the colour matches the dot. */
  worst: string;
  onJump: () => void;
}) {
  const t = useTranslations("prReview");

  return (
    <button
      type="button"
      onClick={(e) => {
        // The header's disclosure is a sibling button, not an ancestor — but the
        // row is a click target in spirit, so stop this from reading as "toggle".
        e.stopPropagation();
        onJump();
      }}
      aria-label={t("smartDiff.findingsBadgeLabel", { count, path })}
      style={s.button}
    >
      <SeverityTag severity={worst} />
      <span style={s.count}>{t("smartDiff.findingsBadge", { count })}</span>
    </button>
  );
}
