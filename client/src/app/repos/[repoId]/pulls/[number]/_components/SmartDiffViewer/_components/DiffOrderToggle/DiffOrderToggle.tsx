/* DiffOrderToggle — "Smart order | Original order".

   A `radiogroup` rather than two buttons or a checkbox: the two options are mutually
   exclusive views of one list, which is what a radio group means, and it gives arrow-key
   navigation between them for free. `aria-label` names the group so a screen reader
   announces what is being chosen, not just which of two words is selected. */
"use client";

import { useTranslations } from "next-intl";
import { s } from "./styles";

export type DiffOrder = "smart" | "original";

export function DiffOrderToggle({
  value,
  onChange,
  smartDisabled,
}: {
  value: DiffOrder;
  onChange: (next: DiffOrder) => void;
  /** True when the grouping is unavailable, so "Smart order" cannot be chosen. */
  smartDisabled?: boolean;
}) {
  const t = useTranslations("prReview");
  const options: readonly DiffOrder[] = ["smart", "original"];

  return (
    <div role="radiogroup" aria-label={t("smartDiff.order.legend")} style={s.group}>
      {options.map((option) => {
        const active = option === value;
        const disabled = option === "smart" && !!smartDisabled;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={disabled || undefined}
            // `aria-disabled` rather than `disabled`, so the control stays
            // focusable and a screen-reader user can discover why it is inert —
            // the same call `SeverityFilter` makes for a zero-count chip.
            onClick={() => {
              if (!disabled && !active) onChange(option);
            }}
            style={s.option(active, disabled)}
          >
            {t(`smartDiff.order.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
