/* PriorPrs — the "Prior PRs touching these files" footer of the BLAST RADIUS card.

   The card above answers what this change could REACH, read forward out of the
   codebase index. This answers who has already BEEN here, read backward out of
   other pull requests' `pr_files`. Two questions, two endpoints, one card — the
   reviewer asks them together, and the second is what turns "who calls this" into
   "who do I ask".

   PROP-DRIVEN AND PRESENTATIONAL, like every other unit on this screen: it calls no
   data hook, so it mounts with `NextIntlClientProvider` alone and `OverviewTab`
   owns `usePriorPrs`.

   The states carry the feature, exactly as they do in the parent. `pr_files` is
   written ONLY by `GET /pulls/:id`, so a workspace whose pull requests nobody has
   opened has nothing to compare against — and an empty list would then read as "no
   earlier pull request touched this code", which is a claim this block must never
   make by accident. Hence: no bare empty branch below, and the server's `status` is
   what every empty answer is rendered from. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { PrPriorPrs } from "@devdigest/shared";
import { formatAge } from "@/lib/format";
import { s } from "./styles";

export interface PriorPrsProps {
  /** The history answer, or null while it has not been read yet. */
  data: PrPriorPrs | null;
  isLoading: boolean;
  /** Query error — the history could not be READ, distinct from a degraded answer. */
  error: unknown;
  /** Repository uuid, for the in-app link to each earlier PR. */
  repoId: string | null | undefined;
}

export function PriorPrs({ data, isLoading, error, repoId }: PriorPrsProps) {
  const t = useTranslations("blast.prior");
  const [open, setOpen] = React.useState(true);

  if (isLoading) {
    return (
      <div style={s.root}>
        <Skeleton height={14} />
      </div>
    );
  }

  // A history read that FAILED is not a history that is empty, and the card's own
  // data is unaffected — so this is one muted line, not the parent's warn notice.
  if (error != null || !data) {
    return (
      <div style={s.root}>
        <Note icon="AlertTriangle" text={t("error")} />
      </div>
    );
  }

  const rows = data.prs;

  return (
    <div style={s.root}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style={s.headerIcon}>
          <Icon.History size={13} />
        </span>
        {t("label")}
        <span style={s.headerCount}>
          {data.total}
          {/* Down/right rather than down/up: `Icon` carries no `ChevronUp`, and
              `vendor/ui` is extend-by-new-file — this is the same pair the symbol
              rows above already disclose with. */}
          {open ? <Icon.ChevronDown size={13} /> : <Icon.ChevronRight size={13} />}
        </span>
      </button>

      {open && rows.length > 0 && (
        <div style={s.list}>
          {rows.map((pr) => {
            // The shared paths ARE the reason this row is here, so they travel as the
            // row's title attribute rather than being summarised into a score.
            const evidence = t("sharedFiles", {
              count: pr.shared_file_count,
              files: pr.shared_files.join(", "),
            });
            const body = (
              <>
                <span style={s.number}>#{pr.number}</span>
                <span style={s.title}>{pr.title}</span>
                <span style={s.age}>{t("age", { age: formatAge(pr.updated_at) })}</span>
              </>
            );
            // With no repository id there is no route to link to; the row still
            // renders, because the fact is the pull request, not the link.
            return repoId ? (
              <Link
                key={pr.id}
                style={s.row}
                href={`/repos/${repoId}/pulls/${pr.number}`}
                title={evidence}
              >
                {body}
              </Link>
            ) : (
              <span key={pr.id} style={s.row} title={evidence}>
                {body}
              </span>
            );
          })}
        </div>
      )}

      {open && data.truncated && (
        <Note icon="Info" text={t("truncated", { shown: rows.length, total: data.total })} />
      )}

      {/* Every empty answer states which empty it is — the whole point of the
          block. `ok` with nothing found is the only one that is a finding. */}
      {open && rows.length === 0 && data.status === "ok" && <Note icon="Info" text={t("none")} />}

      {data.status === "degraded" && (
        <Note
          icon="Info"
          text={
            data.reason === "no_changed_files" ? t("degraded.noChangedFiles") : t("degraded.noFileLists")
          }
        />
      )}

      {data.status === "partial" && (
        <Note
          icon="AlertTriangle"
          text={t("partial", {
            searched: data.coverage.with_file_lists,
            total: data.coverage.total,
          })}
        />
      )}
    </div>
  );
}

/** One muted line with a leading glyph — the only shape this footer states in. */
function Note({ icon, text }: { icon: "Info" | "AlertTriangle"; text: string }) {
  const Glyph = Icon[icon];
  return (
    <span style={s.note}>
      <span style={s.noteIcon}>
        <Glyph size={12} />
      </span>
      <span>{text}</span>
    </span>
  );
}
