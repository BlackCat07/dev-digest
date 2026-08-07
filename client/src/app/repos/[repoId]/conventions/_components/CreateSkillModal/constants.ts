import type { SkillType } from "@devdigest/shared";

/**
 * What an extracted skill is filed as unless the user says otherwise.
 *
 * The server applies the same default when the field is absent; this exists so
 * the select opens on the value that would be written rather than on the first
 * entry of `SKILL_TYPES`.
 */
export const DEFAULT_TYPE: SkillType = "convention";

/**
 * The height of a `SelectInput` box, so the Enabled toggle can sit on the same
 * centre line as the Type select beside it.
 *
 * Measured from the primitive rather than guessed: `10px` padding top and
 * bottom, a `1px` border each side, around a 14px `<select>` (~21px line box) —
 * `vendor/ui/kit/SelectInput.tsx`. It takes no size or style prop and is
 * extend-by-new-file, so borrowing its box model by hand is the same approach
 * `CategoryFilter` takes with `Button`. If that primitive's padding changes,
 * this is the number to change with it.
 */
export const SELECT_BOX_HEIGHT = 42;
