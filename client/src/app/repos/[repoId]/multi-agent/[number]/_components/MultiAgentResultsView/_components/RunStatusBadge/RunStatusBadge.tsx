/* RunStatusBadge — one column's run status, as a WORD (AC-67, AC-88).

   Shared by both modes because the rule it carries must not exist twice: the
   status is always spelled out and the colour only reinforces it, so a reader
   who cannot distinguish the tokens still reads "Running", "Done", "Failed" or
   "Cancelled". `Badge`'s `dot` puts the colour beside the word rather than
   inside it, which is what keeps the word the carrier.

   It is also what makes AC-67 testable: "running" is readable by an
   accessible-name query because it is text, not a spinner. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { STATUS_COLOR } from "./constants";

export function RunStatusBadge({ status }: { status: AgentColumn["status"] }) {
  const t = useTranslations("runs");
  return (
    <Badge color={STATUS_COLOR[status]} dot>
      {t(`results.status.${status}`)}
    </Badge>
  );
}

export default RunStatusBadge;
