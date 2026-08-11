/* FindingsPanel — severity filter + hide-low-confidence + j/k navigation +
   FindingCard list, wiring the accept/dismiss action hook (A2).

   The severity filter lives HERE, not at tab level: it is the header of ONE
   findings list, and this panel is mounted once per review run. So the chip
   counts always describe the cards directly beneath them, and each run filters
   independently. (An earlier version put a chip row above the TIMELINE — that
   had no basis in the design and made several chip rows share one state.) */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, FindingScope, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SeverityFilter } from "../SeverityFilter";
import { ScopeFilter } from "../ScopeFilter";
import { countBySeverity } from "@/lib/severity";
import { countByScope } from "@/lib/scope";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  // ISOLATE filter, local to this run: a level means "only this level", null
  // means no filtering.
  const [severity, setSeverity] = React.useState<Severity | null>(null);
  // The scope filter is a SECOND, orthogonal isolate. It defaults to null on
  // purpose: with nothing set, in-scope, out-of-scope and unlabelled findings
  // all render — this feature annotates, it never drops.
  const [scope, setScope] = React.useState<FindingScope | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const scopeCounts = React.useMemo(() => countByScope(findings), [findings]);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severity, scope),
    [findings, hideLow, severity, scope],
  );

  // Filtering shrinks `shown`, but focusIdx isn't otherwise reset — leaving the
  // j/k cursor pointing past the end, so no card looks focused.
  React.useEffect(() => setFocusIdx(0), [severity, scope, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {/* Nothing to filter in an empty run — show just its empty state. */}
        {findings.length > 0 && (
          <>
            <SeverityFilter counts={counts} active={severity} onChange={setSeverity} />
            <div style={s.divider} />
            <ScopeFilter counts={scopeCounts} active={scope} onChange={setScope} />
          </>
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
