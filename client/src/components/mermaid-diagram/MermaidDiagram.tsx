"use client";

import React from "react";

let seq = 0;

/** Mermaid diagrams must start with a known graph keyword. Anything else
 *  (prose, JSON like {"type":"Buffer"...}, empty) is not a diagram → skip. */
const MERMAID_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;

function looksLikeMermaid(src: string): boolean {
  return MERMAID_RE.test(src.trim());
}

/**
 * Renders a mermaid diagram string to inline SVG. mermaid is imported lazily
 * (client-only). We VALIDATE with mermaid.parse({suppressErrors}) before
 * rendering — mermaid otherwise injects a "Syntax error" bomb graphic into the
 * DOM on bad input instead of throwing. Junk/unparseable input renders nothing,
 * unless the caller supplies `fallback`.
 */
export function MermaidDiagram({
  chart,
  fallback = null,
}: {
  chart: string;
  /**
   * Rendered in place of the diagram when this component decides the string is
   * not a renderable diagram. Defaults to `null`, which is the historical
   * behaviour — render nothing rather than a broken box.
   *
   * A caller cannot make this decision itself. There are TWO failure modes and
   * this component swallows both: a string that does not match `MERMAID_RE`,
   * and one that matches it and is then rejected by `mermaid.parse`. A caller
   * pre-validating with its own copy of the regex would catch the first and
   * miss the second — an unquoted `/` inside a node label passes `MERMAID_RE`
   * and fails the parse — and it would have to import `mermaid` to catch the
   * second, which is exactly the lazy client-only import this component owns.
   * So the notice a screen wants to show instead comes in as a prop.
   */
  fallback?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"pending" | "ok" | "invalid">("pending");

  React.useEffect(() => {
    let cancelled = false;
    const src = (chart ?? "").trim();
    if (!looksLikeMermaid(src)) {
      setState("invalid");
      return;
    }
    setState("pending");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        // parse first; suppressErrors → returns false (no throw, no DOM bomb).
        const valid = await mermaid.parse(src, { suppressErrors: true });
        if (cancelled) return;
        if (!valid) {
          setState("invalid");
          return;
        }
        const { svg } = await mermaid.render(`dd-mermaid-${seq++}`, src);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setState("ok");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  // Not a (valid) diagram → the caller's fallback, or nothing rather than a
  // broken box when it supplied none.
  if (state === "invalid") return <>{fallback}</>;

  return (
    <div
      ref={ref}
      style={{
        display: state === "ok" ? "flex" : "none",
        justifyContent: "center",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        overflowX: "auto",
      }}
    />
  );
}

export default MermaidDiagram;
