/* Skills tab — attach, detach and reorder the skills this agent sends with its
   prompt.

   Every mutation posts the WHOLE ordered id array to POST /agents/:id/skills,
   because that is what the endpoint takes. There is no diff to compute and no
   partial update to reconcile against a stale order. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, SkillWithUsage } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLOR } from "@/lib/skill";
import { filterByQuery, linkedIdsInOrder, move, orderForAgent } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const skills = useSkills();
  const links = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const [query, setQuery] = React.useState("");
  /**
   * The row being dragged, in a REF rather than state.
   *
   * `dragstart` → `dragover` → `drop` can all arrive before React commits a
   * render, and a state value would still read as its previous one inside those
   * handlers' closures — the drop then silently does nothing. The index is only
   * ever read by handlers, never rendered, so a ref is both correct and enough.
   */
  const dragFrom = React.useRef<number | null>(null);
  // This one IS rendered (the drop-target outline), so it stays state.
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  // `?? []` inside the memo, not outside: a fresh [] on every render would
  // change the dependency identity every time and defeat every memo below it.
  const all = React.useMemo(() => skills.data ?? [], [skills.data]);
  const linkList = React.useMemo(() => links.data ?? [], [links.data]);
  const linkedIds = React.useMemo(() => new Set(linkList.map((l) => l.skill_id)), [linkList]);

  // The full ordered list is the source of truth for a drag; the filter is a
  // view over it, so filtering never reorders anything.
  const ordered = React.useMemo(() => orderForAgent(all, linkList), [all, linkList]);
  const shown = filterByQuery(ordered, query);

  const commit = (next: SkillWithUsage[], ids: Set<string>) =>
    setSkills.mutate({ agentId: agent.id, skillIds: linkedIdsInOrder(next, ids) });

  const toggle = (skill: SkillWithUsage) => {
    const next = new Set(linkedIds);
    if (next.has(skill.id)) next.delete(skill.id);
    else next.add(skill.id);
    commit(ordered, next);
  };

  const onDrop = (targetIndexInShown: number) => {
    const source = dragFrom.current == null ? undefined : shown[dragFrom.current];
    const target = shown[targetIndexInShown];
    if (!source || !target || source.id === target.id) return reset();
    // Indices are resolved against `ordered`, not `shown`: with a filter active
    // the two differ, and moving to a position in the filtered view would put
    // the skill somewhere else entirely in the real prompt order.
    const from = ordered.findIndex((sk) => sk.id === source.id);
    const to = ordered.findIndex((sk) => sk.id === target.id);
    if (from >= 0 && to >= 0) commit(move(ordered, from, to), linkedIds);
    reset();
  };

  const reset = () => {
    dragFrom.current = null;
    setDragOver(null);
  };

  if (skills.isLoading || links.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }
  if (skills.isError) {
    return <ErrorState body={ts("page.loadError")} onRetry={() => skills.refetch()} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedIds.size, total: all.length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>

      {shown.length === 0 ? (
        <span style={s.none}>{ts("page.empty.title")}</span>
      ) : (
        <div style={s.list}>
          {shown.map((skill, i) => {
            const linked = linkedIds.has(skill.id);
            return (
              <div
                key={skill.id}
                // Only a linked row participates in reordering — dragging an
                // unlinked one would have to attach it as a side effect.
                draggable={linked}
                onDragStart={() => {
                  dragFrom.current = i;
                }}
                onDragOver={(e) => {
                  if (dragFrom.current == null) return;
                  // Without preventDefault the browser refuses the drop outright
                  // and `onDrop` never fires at all.
                  e.preventDefault();
                  // Resolve "is this the row being dragged?" HERE, in a handler —
                  // reading a ref during render is a React rule violation and
                  // fails `next build`.
                  setDragOver(dragFrom.current === i ? null : i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(i);
                }}
                onDragEnd={reset}
                style={s.row(linked, dragOver === i)}
              >
                <span style={s.handle(linked)} aria-hidden="true">
                  <Icon.Menu size={14} />
                </span>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={linked}
                  aria-label={skill.name}
                  onClick={() => toggle(skill)}
                  disabled={setSkills.isPending}
                  style={s.checkbox(linked)}
                >
                  {linked && <Icon.Check size={11} style={s.checkIcon} />}
                </button>
                <span className="mono" style={s.name}>
                  {skill.name}
                </span>
                {/* A linked-but-disabled skill silently contributes nothing to
                    the prompt; say so rather than letting it look active. */}
                {linked && !skill.enabled && (
                  <span style={s.disabledNote}>{ts("preview.disabled")}</span>
                )}
                <span style={s.typeBadge(SKILL_TYPE_COLOR[skill.type])}>
                  {ts(`listItem.type.${skill.type}`)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SkillsTab;
