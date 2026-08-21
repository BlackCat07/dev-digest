/* Context tab — the project documents this agent sends with its prompt.

   The shape is `SkillsTab.tsx` transposed onto documents, and the four things
   that file already gets right are kept verbatim in spirit: every mutation
   posts the WHOLE ordered path array (there is no diff to compute and no
   partial update to reconcile against a stale order), the dragged row lives in
   a ref rather than state, `onDragOver` calls `preventDefault()` or `onDrop`
   never fires, and `?? []` sits inside the memo rather than outside it.

   Two things are new. Inherited rows — documents an enabled skill contributes —
   are shown in effective order and labelled with their skill, but offer no
   checkbox and no drag handle: they are attached in that skill, not here, and a
   control that pretended otherwise would lie about what the next run carries.
   And reordering has a keyboard equivalent, because drag-and-drop alone is not
   an accessible reorder: every row control is a real focusable button with an
   accessible name, the two Move buttons carry the reorder in one keystroke, and
   ArrowUp/ArrowDown on the focused drag handle does the same thing the handle
   does with a pointer.

   The repository is the shell's active one (`useActiveRepo`), the same source
   the Project Context screen reads. An attachment is scoped to a repository, so
   without one there is nothing to list and nothing to write. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  attachedPathsFor,
  attachedTokenTotal,
  effectiveContextDocs,
  move,
} from "@/lib/context-docs";
import {
  useAgentContextDocs,
  useProjectDocs,
  useSetAgentContextDocs,
} from "@/lib/hooks/project-context";
import { contextRows } from "./helpers";
import { useSkillContributions } from "./useSkillContributions";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();

  const docsQuery = useProjectDocs(repoId);
  const attachments = useAgentContextDocs(agent.id);
  const skills = useSkillContributions(agent.id, repoId);
  const setDocs = useSetAgentContextDocs();

  /**
   * The row being dragged, in a REF rather than state.
   *
   * `dragstart` → `dragover` → `drop` can all arrive before React commits, so a
   * state value still reads as its previous one inside those handlers' closures
   * and the drop silently does nothing. The index is only ever read by handlers
   * and never rendered, so a ref is both correct and enough — reading it during
   * render would be `react-hooks/refs`, an Error that fails the build.
   */
  const dragFrom = React.useRef<number | null>(null);
  // This one IS rendered (the drop-target outline), so it stays state.
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  // `?? []` inside the memo, not outside: a fresh [] on every render changes the
  // dependency identity every time and defeats every memo below it.
  const docs = React.useMemo(() => docsQuery.data?.docs ?? [], [docsQuery.data]);
  const agentPaths = React.useMemo(
    () => attachedPathsFor(attachments.data ?? [], repoId),
    [attachments.data, repoId],
  );

  // Derived during render, never mirrored into state: the total and the badge
  // move the moment a toggle lands, with nothing to keep in sync. None of this
  // is expensive enough to memoize, and `skills.contributions` is a fresh array
  // each render anyway, so a memo here would recompute regardless.
  const effective = effectiveContextDocs(agentPaths, skills.contributions);
  const rows = contextRows(effective, docs);
  const tokenTotal = attachedTokenTotal(
    docs,
    effective.map((entry) => entry.path),
  );

  const commit = (paths: string[]) => {
    if (!repoId) return;
    setDocs.mutate({ agentId: agent.id, repo_id: repoId, paths });
  };

  /**
   * Attach or detach one document, sending every path that is still attached.
   *
   * The write is a replacement, not a delta: sending only the toggled path
   * detaches everything else, with a 200 and a successful invalidation to say
   * so. Attaching appends, because the new document is last in the order a run
   * will read.
   */
  const toggle = (path: string) =>
    commit(
      agentPaths.includes(path)
        ? agentPaths.filter((p) => p !== path)
        : [...agentPaths, path],
    );

  /** Move an attached document one position, the keyboard equal of a drag. */
  const moveBy = (path: string, delta: number) => {
    const from = agentPaths.indexOf(path);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= agentPaths.length) return;
    commit(move(agentPaths, from, to));
  };

  const reset = () => {
    dragFrom.current = null;
    setDragOver(null);
  };

  const onDrop = (targetRow: number) => {
    const sourceRow = dragFrom.current;
    reset();
    if (sourceRow == null) return;
    const source = rows[sourceRow];
    const target = rows[targetRow];
    // Only the agent's own rows have an order to change. Inherited and
    // unattached rows are legitimate drop targets in the DOM, and resolving
    // them here rather than in the markup keeps the rejection in one place.
    if (source?.kind !== "agent" || target?.kind !== "agent") return;
    // Indices resolve against the attached array — the order that is actually
    // sent — never against the rendered row index, which counts inherited and
    // unattached rows the request knows nothing about.
    const from = agentPaths.indexOf(source.path);
    const to = agentPaths.indexOf(target.path);
    if (from < 0 || to < 0 || from === to) return;
    commit(move(agentPaths, from, to));
  };

  if (docsQuery.isLoading || attachments.isLoading || skills.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (docsQuery.isError || attachments.isError) {
    return (
      <ErrorState
        body={t("agentTab.loadError")}
        onRetry={() => {
          void docsQuery.refetch();
          void attachments.refetch();
        }}
      />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("agentTab.heading")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("agentTab.badge", { attached: agentPaths.length, discovered: docs.length })}
        </Badge>
        <span
          className="tnum"
          style={s.total}
          aria-live="polite"
          aria-label={t("agentTab.tokenTotalLabel")}
        >
          {t("agentTab.tokenTotal", { tokens: tokenTotal })}
        </span>
      </div>

      <p style={s.hint}>{t("agentTab.hint")}</p>

      {rows.length === 0 ? (
        <EmptyState
          icon="FileText"
          title={t("agentTab.empty.title")}
          body={t("agentTab.empty.body")}
        />
      ) : (
        <ul style={s.list}>
          {rows.map((row, i) => {
            if (row.kind === "skill") {
              return (
                <li
                  key={row.path}
                  style={s.inheritedRow}
                  title={t("agentTab.inheritedNote")}
                >
                  <span style={s.handleSpacer} aria-hidden="true" />
                  <span className="mono" style={s.path}>
                    {row.path}
                  </span>
                  <span style={s.inherited}>
                    {t("agentTab.inherited", { skill: row.skillName })}
                  </span>
                  <span className="tnum" style={s.tokens}>
                    {t("row.tokens", { count: row.doc?.tokens ?? 0 })}
                  </span>
                </li>
              );
            }

            const attached = row.kind === "agent";
            const position = attached ? agentPaths.indexOf(row.path) : -1;

            return (
              <li
                key={row.path}
                draggable={attached}
                onDragStart={() => {
                  dragFrom.current = i;
                }}
                onDragOver={(e) => {
                  if (dragFrom.current == null) return;
                  // Without preventDefault the browser refuses the drop outright
                  // and `onDrop` never fires at all.
                  e.preventDefault();
                  // Resolved HERE, in a handler: reading a ref during render is
                  // a React rule violation that fails the build.
                  setDragOver(dragFrom.current === i ? null : i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(i);
                }}
                onDragEnd={reset}
                style={s.row(attached, dragOver === i)}
              >
                {attached ? (
                  <button
                    type="button"
                    style={s.handle}
                    aria-label={t("agentTab.dragHandle", { path: row.path })}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      // The handle is the reorder affordance; from the keyboard
                      // it reorders too, rather than scrolling the panel.
                      e.preventDefault();
                      moveBy(row.path, e.key === "ArrowUp" ? -1 : 1);
                    }}
                  >
                    <Icon.Menu size={14} />
                  </button>
                ) : (
                  <span style={s.handleSpacer} aria-hidden="true" />
                )}

                <button
                  type="button"
                  role="checkbox"
                  aria-checked={attached}
                  aria-label={t("agentTab.toggle", { path: row.path })}
                  onClick={() => toggle(row.path)}
                  disabled={setDocs.isPending || !repoId}
                  style={s.checkbox(attached)}
                >
                  {attached && <Icon.Check size={11} style={s.checkIcon} />}
                </button>

                <span className="mono" style={s.path}>
                  {row.path}
                </span>
                {/* The word, beside the checked state: attachment is never
                    conveyed by colour alone. */}
                <span style={s.state}>
                  {attached ? t("agentTab.attached") : t("agentTab.notAttached")}
                </span>
                <span className="tnum" style={s.tokens}>
                  {t("row.tokens", { count: row.doc?.tokens ?? 0 })}
                </span>

                {attached && (
                  <>
                    <button
                      type="button"
                      style={s.move}
                      aria-label={t("agentTab.moveUp", { path: row.path })}
                      disabled={position <= 0}
                      onClick={() => moveBy(row.path, -1)}
                    >
                      <Icon.ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      style={s.move}
                      aria-label={t("agentTab.moveDown", { path: row.path })}
                      disabled={position < 0 || position >= agentPaths.length - 1}
                      onClick={() => moveBy(row.path, 1)}
                    >
                      <Icon.ArrowDown size={12} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ContextTab;
