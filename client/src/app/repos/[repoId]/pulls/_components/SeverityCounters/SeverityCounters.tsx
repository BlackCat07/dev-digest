/* SeverityCounters — "⊙2 ⚠1 ⚡3", one icon+number per severity.

   Rendered on three surfaces, all read-only (the FILTER control is
   `SeverityFilter` on the PR detail page, not these):
     the PR list's FINDINGS column      (zero="dash")
     a PR-detail timeline row           (zero="hide")
     a review-run accordion header      (zero="hide")

   Only NON-ZERO levels render, always worst-first, so the strip stays short and
   a PR with three criticals reads as red at a glance.

   `zero` is load-bearing, not cosmetic: on the timeline an all-zero "—" would
   collide with the cost badge's own "—" (RunHistory.test.tsx asserts a single
   dash there), so those surfaces pass "hide".

   No i18n inside — this renders only icons and numbers; labels live in
   messages/en at the call sites, same as RunCostBadge. */
"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingsBySeverity } from "@devdigest/shared";
import { SEVERITY_LEVELS, totalOf } from "@/lib/severity";
import { s } from "./styles";

export function SeverityCounters({
  counts,
  zero = "dash",
  dotted = false,
  title,
}: {
  /** Absent counts are treated exactly like all-zero. */
  counts: FindingsBySeverity | null | undefined;
  /** What an all-zero set renders as: an em-dash, or nothing at all. */
  zero?: "dash" | "hide";
  /** Dotted underline, signalling that a hover panel is attached. */
  dotted?: boolean;
  /** Native tooltip on the whole strip. */
  title?: string;
}) {
  if (totalOf(counts) === 0) {
    if (zero === "hide") return null;
    return (
      <span style={s.dash} title={title}>
        —
      </span>
    );
  }

  return (
    <span style={s.row} title={title}>
      {SEVERITY_LEVELS.filter((level) => counts![level] > 0).map((level) => {
        const sev = SEV[level];
        const I = Icon[sev.icon];
        return (
          <span key={level} style={s.counter(sev.c, dotted)}>
            <I size={12} />
            <span className="tnum">{counts![level]}</span>
          </span>
        );
      })}
    </span>
  );
}
