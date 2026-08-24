/* ContextView — the Project Context screen: every markdown document this
   repository's clone carries, listed in a rail beside the one being read.

   The layout is a full-bleed two-pane reader, not the centred `maxWidth`
   gutter the sibling Conventions screen uses: the document IS the content, so
   it gets the width, and the paths sit in a fixed rail flush against the app
   sidebar. Each pane scrolls itself.

   READ-ONLY, by requirement and not by staging (AC-35). No save, no edit mode,
   no new file, no new folder, no upload — and no resync or re-index button
   either, because those write to the clone this screen reads. The `mode.edit`
   and `editor.save` keys still sitting in `messages/en/context.json` are the
   pre-feature design's, kept so the namespace's history stays legible, and are
   deliberately unread. The design also draws a `Preview | Edit` toggle, a
   `+ / folder / upload / refresh` row and a COVERAGE ring; all three are
   non-goals (N4, N6) and none ships. */
"use client";

import React from "react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useProjectDocs } from "@/lib/hooks/project-context";
import { filterDocsByPath, groupDocsByRoot } from "@/lib/context-docs";
import { DocList } from "../DocList";
import { DocPreview } from "../DocPreview";
import { s } from "./styles";

export function ContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useProjectDocs(repoId);
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const [search, setSearch] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const crumb = [{ label: t("page.crumbWorkspace") }, { label: t("page.crumbContext") }];

  // A :repoId that matches no repo belongs to the repo-scoped 404 boundary that
  // owns that copy for every screen under /repos, exactly as the PR list and
  // the Conventions screen do it.
  if (repoNotFound) notFound();

  // The count rides the heading — `Project Context · 17 documents` — rather than
  // sitting beside the filter, where a 12px label next to a 40px control read as
  // an afterthought. The `·` lives inside the message, matching `row.group`,
  // which is where this product already keeps that separator.
  const railHead = (roots: string[], count: number | null) => (
    <div style={s.railHead}>
      <div className="tnum" style={s.railLabel}>
        {count === null ? t("page.crumbContext") : t("page.heading", { count })}
      </div>
      <span className="mono" style={s.railRepo}>
        {activeRepo?.full_name || t("page.repoFallback")}
      </span>
      {roots.length > 0 && (
        <div className="mono" style={s.railRoots} title={roots.join(" · ")}>
          {roots.join(" · ")}
        </div>
      )}
    </div>
  );

  if (isLoading) {
    // AC-29: shaped like the rail it is about to replace — a group label plus
    // five rows — with the document pane already at its full size beside it, so
    // nothing shifts when the data lands. The vendored `Skeleton` is a bare
    // `div.skeleton` with no role and no aria, which is why a test asserts it
    // through `container.getElementsByClassName`.
    return (
      <AppShell crumb={crumb}>
        <div style={s.shell}>
          <div style={s.rail}>
            {railHead([], null)}
            <div style={s.railScroll}>
              <Skeleton height={12} width={140} style={s.skeletonRow} />
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={32} style={s.skeletonRow} />
              ))}
            </div>
          </div>
          <div style={s.main}>
            <DocPreview repoId={repoId} doc={null} />
          </div>
        </div>
      </AppShell>
    );
  }

  // The envelope, not a bare array: an empty `docs` is never self-explanatory,
  // so the notes below branch on `status`/`reason` rather than on length.
  const docs = data?.docs ?? [];
  const roots = data?.roots ?? [];
  const visible = filterDocsByPath(docs, search);
  const groups = groupDocsByRoot(visible);
  const selected = docs.find((doc) => doc.path === selectedPath) ?? null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.shell}>
        <div style={s.rail}>
          {railHead(roots, visible.length)}

          <div style={s.railTools}>
            <TextInput
              value={search}
              onChange={setSearch}
              mono
              aria-label={t("filter.label")}
              placeholder={t("filter.placeholder")}
            />
          </div>

          {((data && data.status !== "ok" && data.reason) || data?.truncated) && (
            <div style={s.notes}>
              {data && data.status !== "ok" && data.reason && (
                <div style={s.note("warn")}>
                  {data.status === "unavailable"
                    ? t("page.unavailable", { reason: data.reason })
                    : t("page.partial", { reason: data.reason })}
                </div>
              )}

              {/* AC-32: both figures, and the second one is the rows actually
                  rendered rather than `docs.length` — under an active filter
                  those differ, and the sentence has to describe the list the
                  reader is looking at. */}
              {data?.truncated && (
                <div style={s.note("warn")}>
                  {t("page.truncated", { shown: visible.length, total: data.total })}
                </div>
              )}
            </div>
          )}

          <div style={s.railScroll}>
            {/* AC-31: inline, inside the rail. A full-screen error state would
                take the navigation and the breadcrumb away with it, and those
                have to stay usable — the failure is one request's, not the
                screen's. */}
            {isError && (
              <div style={s.listError}>
                <ErrorState title={t("loadError")} />
              </div>
            )}

            {!isError && docs.length === 0 && (
              // AC-30: the sentence names the roots that were actually
              // searched, so "there is nothing here" and "you are looking in
              // the wrong place" stop reading the same.
              <EmptyState
                icon="Folder"
                title={t("empty.title")}
                body={t("empty.body", { roots: roots.join(", ") })}
              />
            )}

            {!isError && docs.length > 0 && visible.length === 0 && (
              <EmptyState
                icon="Search"
                title={t("filter.noMatch.title")}
                body={t("filter.noMatch.body")}
              />
            )}

            {visible.length > 0 && (
              <DocList groups={groups} selectedPath={selectedPath} onSelect={setSelectedPath} />
            )}
          </div>
        </div>

        <div style={s.main}>
          <DocPreview repoId={repoId} doc={selected} />
        </div>
      </div>
    </AppShell>
  );
}

export default ContextView;
