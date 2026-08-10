/* FilterBar — search box, status chips, sort select, and refresh for the PR list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Button, TextInput, SelectInput } from "@devdigest/ui";
import { STATUS_FILTERS } from "../../constants";
import { s } from "../../styles";

export function FilterBar({
  active,
  onActive,
  query,
  onQuery,
  sort,
  onSort,
  onRefresh,
  refreshing,
}: {
  active: string;
  onActive: (k: string) => void;
  query: string;
  onQuery: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("prReview");
  const sortOptions = [
    { value: "newest", label: t("list.sort.newest") },
    { value: "oldest", label: t("list.sort.oldest") },
  ];
  return (
    <div style={s.filterBar}>
      {/* Every control is wrapped in `s.control`, which is the only thing giving
          this row a single height — the kit's Chip, Button, TextInput and
          SelectInput are all naturally different sizes and none takes a style
          prop. See CONTROL_HEIGHT in ../../constants. */}
      <div style={s.filterChips}>
        <div style={s.searchControl}>
          <TextInput value={query} onChange={onQuery} placeholder={t("list.filterPlaceholder")} />
        </div>
        {STATUS_FILTERS.map(({ key, labelKey }) => (
          <div key={key} style={s.control}>
            <Chip active={active === key} onClick={() => onActive(key)}>
              {t(`list.filter.${labelKey}`)}
            </Chip>
          </div>
        ))}
      </div>
      <div style={s.filterActions}>
        <div style={s.control}>
          <SelectInput value={sort} onChange={onSort} options={sortOptions} mono={false} />
        </div>
        <div style={s.control}>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? t("list.refreshing") : t("list.refresh")}
          </Button>
        </div>
      </div>
    </div>
  );
}
