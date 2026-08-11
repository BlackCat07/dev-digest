/* ScopeFilter — the in/out-of-scope counter + filter row (L03).

   A UNIT OF ITS OWN, deliberately not a fourth chip inside `SeverityFilter`:
   severity and scope are orthogonal, and that component's tests pin exactly
   three chips plus a dimming rule keyed on the three contract levels.

   Same ISOLATE semantics as its neighbour: clicking "Out of scope" shows ONLY
   out-of-scope findings, clicking the active chip again clears the filter, and
   `null` — the default — shows everything, INCLUDING the unlabelled findings
   that predate the Intent Layer. Nothing is ever hidden by default. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, type IconName } from "@devdigest/ui";
import type { FindingScope } from "@devdigest/shared";
import { SCOPE_VALUES, type FindingsByScope } from "@/lib/scope";
import { s } from "./styles";

/** Icon, colour and message key per label. `Slash` reads as "not this job" without
    borrowing a severity colour — an out-of-scope finding is not a worse finding. */
const CHIP: Record<FindingScope, { icon: IconName; color: string; key: string }> = {
  in_scope: { icon: "Target", color: "var(--ok)", key: "inScope" },
  out_of_scope: { icon: "Slash", color: "var(--text-muted)", key: "outOfScope" },
};

export function ScopeFilter({
  counts,
  active,
  onChange,
}: {
  counts: FindingsByScope;
  active: FindingScope | null;
  onChange: (next: FindingScope | null) => void;
}) {
  const t = useTranslations("prReview");

  return (
    <div style={s.row} role="group" aria-label={t("scopeFilter.label")}>
      {SCOPE_VALUES.map((value) => {
        const isActive = active === value;
        const chip = (
          <Chip
            active={isActive}
            icon={CHIP[value].icon}
            color={CHIP[value].color}
            count={counts[value]}
            onClick={() => onChange(isActive ? null : value)}
          >
            {t(`scopeFilter.${CHIP[value].key}`)}
          </Chip>
        );
        // Dim a label with nothing to isolate — unless it is the active one, so
        // the filter always stays clearable from here.
        return counts[value] === 0 && !isActive ? (
          <span key={value} style={s.empty} aria-disabled="true">
            {chip}
          </span>
        ) : (
          <React.Fragment key={value}>{chip}</React.Fragment>
        );
      })}
    </div>
  );
}
