/* SkillBody — a skill's markdown body rendered as a DOCUMENT.

   Why not `<Markdown>` from @devdigest/ui: that primitive is deliberately
   "inline + GFM" — it styles p/strong/code/a and nothing else, because its
   callers are one-paragraph finding rationales. react-markdown still emits real
   <h2>/<ul>/<li> for a skill body, but unstyled they collapse into an
   undifferentiated wall of text under the app's CSS reset, and a four-section
   rubric becomes unreadable exactly where a user is meant to VET it.

   Adding heading and list styling to the vendored primitive would change how
   every existing consumer renders — a rationale containing `##` would suddenly
   grow a heading. `vendor/ui` is extend-by-new-file, not restyle-in-place, so
   this renderer lives here instead. The overlap with the primitive is the
   inline elements only. */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "./styles";

export function SkillBody({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div style={s.wrap}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: c }) => <h1 style={s.h1}>{c}</h1>,
          h2: ({ children: c }) => <h2 style={s.h2}>{c}</h2>,
          h3: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          // Markdown allows h4–h6; a skill body has no use for that depth, and
          // rendering them at h3's weight beats leaving them unstyled.
          h4: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          h5: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          h6: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          p: ({ children: c }) => <p style={s.p}>{c}</p>,
          ul: ({ children: c }) => <ul style={s.list}>{c}</ul>,
          ol: ({ children: c }) => <ol style={s.orderedList}>{c}</ol>,
          li: ({ children: c }) => <li style={s.li}>{c}</li>,
          strong: ({ children: c }) => <strong style={s.strong}>{c}</strong>,
          code: ({ children: c }) => (
            <code className="mono" style={s.code}>
              {c}
            </code>
          ),
          pre: ({ children: c }) => (
            <pre className="mono" style={s.pre}>
              {c}
            </pre>
          ),
          blockquote: ({ children: c }) => <blockquote style={s.quote}>{c}</blockquote>,
          hr: () => <hr style={s.hr} />,
          a: ({ children: c, href }) => (
            // A skill body can come from an imported file, so any link in it is
            // untrusted: no target="_blank" without noreferrer, and no bare
            // javascript: href reaching the DOM.
            <a
              href={href?.startsWith("javascript:") ? undefined : href}
              rel="noreferrer noopener"
              style={s.a}
            >
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default SkillBody;
