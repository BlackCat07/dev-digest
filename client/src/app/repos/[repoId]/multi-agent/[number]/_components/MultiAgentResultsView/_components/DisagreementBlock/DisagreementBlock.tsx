/* DisagreementBlock — the locations the agents did not all agree on (AC-77…AC-82).

   It mounts once in `MultiAgentResultsView`, OUTSIDE the mode branch, so it
   renders below the results in columns mode and in tabs mode from one place. A
   copy per mode is how the two drift.

   Four things here are load-bearing:

   1. **The client groups nothing.** The groups, the stances and the counts
      arrive computed in `MultiAgentRun.conflicts`. Recomputing any of them in
      the browser would produce a second answer that disagrees with the one
      every other reader of that record sees.
   2. **`Show only conflicts` keeps the groups with TWO OR MORE flaggers** and
      hides the single-flagger ones, which are the majority. The reasoning is in
      `constants.ts` and it is the opposite of what the control's name suggests.
   3. **An agent that did not flag renders the WORDS `did not flag`** (AC-79),
      never a neutral colour on its own — the same rule that keeps every
      severity spelled out beside its badge (AC-88).
   4. **A multi-run with no groups still renders the block** (EC-10), carrying
      the empty statement. Omitting it would leave the reader unable to tell
      "the agents agreed" from "this screen forgot to draw something".

   A group's title is the deterministic fallback (the highest-severity finding's
   title) until note synthesis lands, and a short synthesised label afterwards —
   so a title, and with it the order of two groups sharing a file and a line,
   can change once mid-poll (EC-32). Nothing here depends on it being stable. */
"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox, SeverityBadge } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { groupKey, visibleGroups } from "./helpers";
import { s } from "./styles";

export function DisagreementBlock({ groups }: { groups: readonly Conflict[] }) {
  const t = useTranslations("runs");
  const headingId = useId();
  const [onlyConflicts, setOnlyConflicts] = useState(false);

  // Derived during render, never mirrored into state: the filter is a function
  // of one boolean and the server's list, and a stored copy would go stale on
  // the next poll.
  const visible = visibleGroups(groups, onlyConflicts);

  return (
    <section aria-labelledby={headingId} style={s.block}>
      <div style={s.head}>
        <h2 id={headingId} style={s.heading}>
          {t("conflicts.title")}
        </h2>

        {/* No filter where there is nothing to filter: a control that can only
            turn a single empty statement into the same empty statement is
            noise. */}
        {groups.length > 0 && (
          <Checkbox
            checked={onlyConflicts}
            onChange={setOnlyConflicts}
            label={<span style={s.filterLabel}>{t("conflicts.onlyConflicts")}</span>}
          />
        )}
      </div>

      {visible.length === 0 ? (
        <p style={s.empty}>{t("conflicts.empty")}</p>
      ) : (
        <>
          {/* AC-80 — said once, above the panels, and only where there are
              sentences for it to be about. */}
          <p style={s.synthesised}>{t("conflicts.synthesisedNote")}</p>
          <div style={s.groups}>
            {visible.map((group) => (
              <ConflictPanel key={groupKey(group)} group={group} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One contended location: where it is, what it is called, and what every agent
 * of the multi-run said about it (AC-78).
 *
 * A `<section>` carrying `role="group"` rather than a `<div>`: the explicit role
 * keeps a screen's worth of panels out of the landmark list, while the SECTION
 * element still scopes the heading below — which inside a `<div>` would turn
 * each panel's header into a page-level `banner` landmark, once per group. It
 * is named by its own header rather than by an `aria-label`, so the name is the
 * text already on screen and no copy is invented in this unit.
 */
function ConflictPanel({ group }: { group: Conflict }) {
  const labelId = useId();

  return (
    <section role="group" aria-labelledby={labelId} style={s.panel}>
      <div id={labelId} style={s.panelHead}>
        <span className="mono" style={s.location}>
          {group.file}:{group.line}
        </span>
        <span style={s.groupTitle}>{group.title}</span>
      </div>

      {/* `role="list"` is spelled out because the grid display strips list
          semantics in Safari, and the cells are a list of peers — one per agent
          of the multi-run, in the order the server returned them. */}
      <ul role="list" style={s.cells}>
        {group.takes.map((take) => (
          // Keyed on the agent id, never on the name: `agents.name` carries no
          // unique constraint and two agents may legally share one.
          <StanceCell key={take.agent_id} take={take} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One agent's stance on one location.
 *
 * `SeverityBadge` WITHOUT `compact`: the compact variant renders the icon alone
 * and drops the label (`client/INSIGHTS.md`, 2026-08-24), and this badge is the
 * only statement of the verdict in the cell — dropping the word would leave
 * colour and glyph as its sole carriers, which AC-88 forbids.
 *
 * The note is rendered as the sentence it is and nothing branches on it. It may
 * be empty — that is the state the whole screen is in until synthesis lands,
 * and every one after a synthesis that failed or timed out (AC-38) — in which
 * case the cell is the agent's name and its verdict, with no empty paragraph
 * left behind.
 */
function StanceCell({ take }: { take: ConflictTake }) {
  const t = useTranslations("runs");

  return (
    <li style={s.cell}>
      <span style={s.agentName}>{take.persona}</span>

      {take.verdict === "ignored" ? (
        <span style={s.didNotFlag}>{t("conflicts.didNotFlag")}</span>
      ) : (
        <SeverityBadge severity={take.verdict} />
      )}

      {take.note.trim() !== "" && <p style={s.note}>{take.note}</p>}
    </li>
  );
}

export default DisagreementBlock;
