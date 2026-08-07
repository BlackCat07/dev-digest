/* CategoryFilter — the category picker on the Conventions actions row.

   Why this exists instead of `SelectInput` from `@devdigest/ui`: that primitive
   carries its own metrics (10px padding, 14px font) and stands ~9px taller than
   a `Button`. On this screen it sits in a row with four buttons, where the
   mismatch is the first thing you see. `SelectInput` takes neither a size nor a
   style prop, and `vendor/ui` is extend-by-new-file — restyling it here would
   change its height on Settings and in the agent editor too.

   So: a local control that borrows Button's box model exactly. Native <select>
   underneath, so keyboard, screen readers and the platform's own dropdown all
   keep working. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export interface CategoryOption {
  value: string;
  label: string;
}

export function CategoryFilter({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: CategoryOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div style={s.wrap}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={s.select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon.ChevronsUpDown size={13} style={s.chevron} />
    </div>
  );
}

export default CategoryFilter;
