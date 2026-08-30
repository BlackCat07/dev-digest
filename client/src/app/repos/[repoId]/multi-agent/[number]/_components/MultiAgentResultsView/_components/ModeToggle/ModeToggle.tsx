/* ModeToggle — "Columns | Tabs", the one control that switches how a multi-run
   is read (AC-60).

   A `radiogroup` rather than two buttons or a checkbox, following the diff
   viewer's order toggle: the two options are mutually exclusive views of one
   result set, which is exactly what a radio group means, and it gives arrow-key
   navigation between them for free. `aria-label` names what is being chosen, so
   a screen reader announces the choice rather than just one of two words.

   The selection is not this component's state: it is a search param the view
   owns and passes down, so a reload and a shared link both restore it (AC-61). */
"use client";

import { useTranslations } from "next-intl";
import { RESULTS_MODES, type ResultsMode } from "../../constants";
import { s } from "./styles";

export function ModeToggle({
  value,
  onChange,
}: {
  value: ResultsMode;
  onChange: (next: ResultsMode) => void;
}) {
  const t = useTranslations("runs");

  return (
    <div role="radiogroup" aria-label={t("results.modeLabel")} style={s.group}>
      {RESULTS_MODES.map((mode) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) onChange(mode);
            }}
            style={s.option(active)}
          >
            {t(`results.mode.${mode}`)}
          </button>
        );
      })}
    </div>
  );
}

export default ModeToggle;
