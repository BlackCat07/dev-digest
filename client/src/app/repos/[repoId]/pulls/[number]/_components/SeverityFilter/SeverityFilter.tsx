/* SeverityFilter — the Agent runs tab's severity counter + filter row.

   ISOLATE semantics, not multi-select toggles: clicking CRITICAL shows ONLY
   critical findings; clicking the active chip again clears the filter. At most
   one level is ever active, which is why this takes a single `active` value
   rather than a set.

   This is the ONE filter control on the page. The per-run counters in the
   timeline and the accordion headers are read-only displays of the same data —
   several chip rows bound to one state, each showing different per-run numbers,
   would leave no way to tell which row is the real filter. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
import type { FindingsBySeverity, Severity } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "@/lib/severity";
import { s } from "./styles";

export function SeverityFilter({
  counts,
  active,
  onChange,
}: {
  /** PR-wide totals across every run — the same basis as the list column. */
  counts: FindingsBySeverity;
  active: Severity | null;
  onChange: (next: Severity | null) => void;
}) {
  const t = useTranslations("prReview");

  return (
    <div style={s.row} role="group" aria-label={t("severityFilter.label")}>
      {SEVERITY_LEVELS.map((level) => {
        const isActive = active === level;
        const chip = (
          <Chip
            active={isActive}
            icon={SEV[level].icon}
            color={SEV[level].c}
            count={counts[level]}
            onClick={() => onChange(isActive ? null : level)}
          >
            {t(`severityFilter.${level.toLowerCase()}`)}
          </Chip>
        );
        // Dim a level with nothing to isolate — unless it is the active one, so
        // the filter always stays clearable from here.
        return counts[level] === 0 && !isActive ? (
          <span key={level} style={s.empty} aria-disabled="true">
            {chip}
          </span>
        ) : (
          <React.Fragment key={level}>{chip}</React.Fragment>
        );
      })}
    </div>
  );
}
