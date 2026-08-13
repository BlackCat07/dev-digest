/* SeverityTag — a severity as icon + word, e.g. a red octagon and "blocker".

   Its own component rather than `SeverityBadge` from `@devdigest/ui` for one
   reason: that primitive renders `SEV[severity].label`, which is "Critical", and on
   this screen the design calls a CRITICAL finding a **blocker** (a vocabulary
   `ReviewRunAccordion` already uses one tab away with "N blockers"). Only the noun
   differs — the colour and the icon still come from the single-source `SEV`
   registry, so this is not a fourth copy of it.

   Never colour alone: the icon and the word ship together, so the severity survives
   a monochrome display and a colour-blind reader (WCAG 1.4.1).

   Takes a `string`, not the contract's `Severity`: `findings.severity` is untyped
   `text` in the database, so an unknown value is reachable and must degrade rather
   than throw. See `SEVERITY_WORD`. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, SEV } from "@devdigest/ui";
import { SEVERITY_WORD, SEVERITY_WORD_FALLBACK } from "../../constants";

export function SeverityTag({
  severity,
  count,
}: {
  severity: string;
  /**
   * How many findings this tag stands for. Rendered as `×N` only when above 1.
   *
   * Needed because a line can host several findings and only ONE tag fits on the
   * row: without the multiplier the visible tags undercount, and the file header's
   * "11 findings" could not be reconciled with the 8 tags below it. Measured on a
   * real PR: 31 findings landed on 23 distinct lines, so 8 were invisible.
   *
   * A bare `×N` rather than a translated string — a multiplication sign and a
   * numeral read the same in every locale this app ships, and `SeverityBadge` in
   * `vendor/ui` already renders a bare count the same way.
   */
  count?: number;
}) {
  const t = useTranslations("prReview");
  const token = SEV[severity as keyof typeof SEV] ?? SEV.INFO;
  const word = SEVERITY_WORD[severity] ?? SEVERITY_WORD_FALLBACK;
  return (
    <Badge color={token.c} bg={token.bg} icon={token.icon}>
      {t(`smartDiff.severity.${word}`)}
      {count != null && count > 1 ? ` ×${count}` : ""}
    </Badge>
  );
}
