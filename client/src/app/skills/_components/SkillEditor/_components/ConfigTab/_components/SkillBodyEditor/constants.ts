/** Metrics for the skill body editor.
 *
 *  The highlight layer and the textarea are two stacked elements showing the same
 *  text — every one of these MUST be identical on both, or the caret drifts away
 *  from the glyphs. They live here so there is one place to change them. */

export const FONT_SIZE = 12.5;
export const LINE_HEIGHT = 21;
export const PAD_Y = 12;
export const PAD_X = 16;
export const GUTTER_WIDTH = 46;

/** Scroll after this; the form below must stay reachable on a laptop screen. */
export const MAX_HEIGHT = 460;

/** Keep the editor a sensible size when the body is nearly empty. */
export const MIN_LINES = 12;
