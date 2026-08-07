/* Last-resort boundary: catches throws in the ROOT layout itself, which
 * `error.tsx` cannot — it lives inside that layout.
 *
 * Two consequences of replacing the root layout, both deliberate:
 *   1. It must render its own <html> and <body>.
 *   2. Nothing from the layout is available — no globals.css, so no CSS custom
 *      properties, and no next-intl provider, so no translations. The styles
 *      below are therefore hard-coded literals rather than `var(--…)` tokens and
 *      the copy is English. This is the one place the project's styling
 *      convention (styles.ts + tokens) cannot apply.
 */
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("root layout error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#e6edf3",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            DevDigest failed to start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#8b949e", marginBottom: 20 }}>
            {error.message || "The application shell could not be rendered."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontSize: 13,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "#21262d",
              color: "#e6edf3",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
