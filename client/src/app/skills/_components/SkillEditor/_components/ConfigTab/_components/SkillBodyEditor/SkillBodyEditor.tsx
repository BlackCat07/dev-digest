/* SkillBodyEditor — the markdown body as a line-numbered editor.

   Not the vendored `<Textarea>`: that primitive brings its own border, radius and
   background, so nesting it inside a framed editor draws a box inside a box. It
   is a form field; this is a code surface — one frame holding a filename bar, a
   gutter and the text.

   Highlighting an EDITABLE field means two stacked layers showing the same string:
   a coloured <pre> underneath, and a textarea on top whose glyphs are transparent
   but whose caret is not. Every metric that affects glyph position is shared from
   `styles.ts` — if the two ever diverge the caret stops sitting on the character
   it is editing. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { MIN_LINES } from "./constants";
import { s } from "./styles";

/**
 * Colour one source line. Deliberately line-based and tiny: a real markdown
 * tokenizer would have to agree with the textarea character-for-character, and
 * the payoff here is only "headings and bullets stand out while writing".
 */
function lineStyle(line: string): React.CSSProperties | undefined {
  if (/^\s*#{1,6}\s/.test(line)) return s.heading;
  if (/^\s*[-*+]\s/.test(line)) return s.bullet;
  return undefined;
}

export function SkillBodyEditor({
  value,
  onChange,
  filename,
  dirty,
  tokensLabel,
  unsavedLabel,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  filename: string;
  dirty: boolean;
  tokensLabel: string;
  unsavedLabel: string;
  ariaLabel: string;
}) {
  const lines = React.useMemo(() => value.split("\n"), [value]);
  // A trailing newline yields a final empty element — that IS a real line to the
  // caret, so it gets a number too. Pad short bodies so the frame has presence.
  const gutter = React.useMemo(
    () =>
      Array.from({ length: Math.max(lines.length, MIN_LINES) }, (_, i) => i + 1).join("\n"),
    [lines.length],
  );

  return (
    <div style={s.frame}>
      <div style={s.bar}>
        <Icon.FileText size={14} style={s.barIcon} />
        <span className="mono" style={s.filename}>
          {filename}
        </span>
        {dirty && <span style={s.unsaved}>{unsavedLabel}</span>}
        <span style={s.tokens}>{tokensLabel}</span>
      </div>

      <div style={s.scroll}>
        <pre className="mono" style={s.gutter} aria-hidden="true">
          {gutter}
        </pre>
        <div style={s.codeWrap}>
          {/* The visible text. aria-hidden because the textarea below carries the
              same content and is what a screen reader should read. */}
          <pre className="mono" style={s.highlight} aria-hidden="true">
            {lines.map((line, i) => (
              <span key={i} style={lineStyle(line)}>
                {/* An empty line still needs a glyph-height row, and the newline
                    must be inside the span or the last line loses its height. */}
                {line || " "}
                {"\n"}
              </span>
            ))}
            {/* Pad to MIN_LINES so the caret can be placed in the empty space. */}
            {"\n".repeat(Math.max(0, MIN_LINES - lines.length))}
          </pre>
          <textarea
            className="mono"
            style={s.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-label={ariaLabel}
            // A skill body is markdown, and browsers "helpfully" rewrite quotes
            // and dashes in a plain textarea — which would silently edit the text
            // the model receives.
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    </div>
  );
}

export default SkillBodyEditor;
