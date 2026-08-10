/* BodyPreview — the server-composed skill body, read-only, with line numbers.

   Read-only on purpose: this text is assembled by the server's composer and the
   create call re-composes it, so an edit made here would be silently discarded.
   The Skills Lab editor is where a body becomes editable, after the skill exists.

   Deliberately NOT the Skills Lab's `SkillBodyEditor`: that one is a two-layer
   textarea for editing and lives in another route subtree. Same look, a tenth of
   the machinery. */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

/**
 * Colour one markdown line. Line-based and tiny, matching the editor's: the
 * payoff is only "headings and bullets stand out", and a real tokenizer would be
 * a second markdown implementation to keep in step with the composer.
 */
function toneFor(line: string): CSSProperties | undefined {
  if (/^\s*#{1,6}\s/.test(line)) return s.heading;
  if (/^\s*[-*+]\s/.test(line)) return s.bullet;
  return undefined;
}

export function BodyPreview({
  filename,
  body,
  unsavedLabel,
  tokensLabel,
}: {
  filename: string;
  body: string;
  unsavedLabel: string;
  tokensLabel: string;
}) {
  const lines = React.useMemo(() => body.split("\n"), [body]);

  return (
    <div style={s.frame}>
      <div style={s.bar}>
        <Icon.FileText size={14} style={s.barIcon} />
        <span className="mono" style={s.filename}>
          {filename}
        </span>
        <span style={s.unsaved}>{unsavedLabel}</span>
        <span style={s.tokens}>{tokensLabel}</span>
      </div>

      <div style={s.code}>
        {lines.map((line, i) => (
          <div key={i} style={s.row}>
            <span className="mono" style={s.num} aria-hidden="true">
              {i + 1}
            </span>
            {/* An empty line still needs a glyph-height row. */}
            <span className="mono" style={s.line(toneFor(line))}>
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default BodyPreview;
