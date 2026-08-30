/* The expandable-finding unit's public API.

   Two of the three exports are for its own parent: `AgentTabsPane` renders the
   collapsed row, so it needs the decision type and the styling of the
   disclosure that row becomes, while the panel itself stays this unit's
   business. A widened named barrel, never `export *` — the line between
   "reusable" and "internal" is the thing being stated (`client/INSIGHTS.md`,
   2026-08-11). */
export { FindingDetail, FindingDetail as default } from "./FindingDetail";
export type { FindingDecision } from "./FindingDetail";
export { row as findingRowStyles } from "./styles";
