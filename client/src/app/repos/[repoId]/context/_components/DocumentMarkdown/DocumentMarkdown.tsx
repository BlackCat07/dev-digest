/* DocumentMarkdown — a repository document rendered as a DOCUMENT.

   Why not `<Markdown>` from @devdigest/ui: that primitive is deliberately
   "inline + GFM" — it maps p/strong/code/a and nothing else, because every one
   of its callers is a one-paragraph finding rationale. react-markdown still
   emits real <h2>/<ul>/<li>/<table> for a document-shaped body, but unstyled
   they collapse into one undifferentiated block under the app's reset, and a
   spec read here to decide whether to attach it becomes a wall of text.

   Teaching the primitive headings is the wrong fix and not ours to make:
   `vendor/ui` is extend-by-new-file, and a rationale containing `##` would
   suddenly grow a heading in every findings panel (`INSIGHTS.md`, What Doesn't
   Work, 2026-08-05). So this feature ships its own renderer.

   It is a near-sibling of `app/skills/_components/SkillBody`, which made the
   same call for a skill body. They are NOT shared: sibling route subtrees do
   not import each other, and this one additionally has to render tables — a
   spec's acceptance-criteria matrix is routinely one — which a skill body has
   never needed. If a third consumer appears, the promotion target is
   `src/components/`, not either feature. */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "./styles";

export function DocumentMarkdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div style={s.wrap}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: c }) => <h1 style={s.h1}>{c}</h1>,
          h2: ({ children: c }) => <h2 style={s.h2}>{c}</h2>,
          h3: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          // Markdown allows h4–h6. Rendering them at h3's weight beats leaving
          // them unstyled: an unstyled heading is indistinguishable from body
          // text, which is the one thing AC-34 asks this renderer to prevent.
          h4: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          h5: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          h6: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          p: ({ children: c }) => <p style={s.p}>{c}</p>,
          ul: ({ children: c }) => <ul style={s.list}>{c}</ul>,
          ol: ({ children: c }) => <ol style={s.orderedList}>{c}</ol>,
          li: ({ children: c }) => <li style={s.li}>{c}</li>,
          strong: ({ children: c }) => <strong style={s.strong}>{c}</strong>,
          em: ({ children: c }) => <em style={s.em}>{c}</em>,
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
          table: ({ children: c }) => <table style={s.table}>{c}</table>,
          th: ({ children: c }) => <th style={s.th}>{c}</th>,
          td: ({ children: c }) => <td style={s.td}>{c}</td>,
          blockquote: ({ children: c }) => <blockquote style={s.quote}>{c}</blockquote>,
          hr: () => <hr style={s.hr} />,
          a: ({ children: c, href }) => (
            // The text comes from a repository clone, so every link in it is
            // author-controlled: a `javascript:` href never reaches the DOM,
            // and no link opens a new context without `noreferrer noopener`.
            <a
              href={href?.trim().toLowerCase().startsWith("javascript:") ? undefined : href}
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

export default DocumentMarkdown;
