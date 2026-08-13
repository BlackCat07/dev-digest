/* SmartDiffGroupHeader — the coloured swatch, the role, what it means, and how
   many files are under it.

   The description is the point of the header. "Boilerplate · 4 files" tells a
   reviewer what the group is called; "Generated / mechanical — skim" tells them what
   to DO with it, which is the whole product claim of ordering the diff at all. */
"use client";

import { useTranslations } from "next-intl";
import { GROUP_TOKEN } from "../../constants";
import type { ViewRole } from "../../types";
import { s } from "./styles";

export function SmartDiffGroupHeader({ role, count }: { role: ViewRole; count: number }) {
  const t = useTranslations("prReview");
  return (
    <div style={s.row}>
      <span aria-hidden="true" style={s.swatch(GROUP_TOKEN[role])} />
      <span style={s.label}>{t(`smartDiff.groups.${role}.label`)}</span>
      <span style={s.description}>{t(`smartDiff.groups.${role}.description`)}</span>
      <span className="tnum" style={s.count}>
        {t("smartDiff.filesCount", { count })}
      </span>
    </div>
  );
}
