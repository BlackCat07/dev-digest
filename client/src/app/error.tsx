/* Route error boundary for everything below the root layout.
 *
 * Before this existed, a render-time throw anywhere in a screen took the whole
 * app to Next's error overlay in dev and to a blank document in production —
 * the class of failure `INSIGHTS.md` (2026-08-03) records as "500 on every route
 * that transitively imports it".
 *
 * Query failures do NOT arrive here: TanStack Query returns them as state, and
 * each screen renders its own inline ErrorState with a retry. This boundary is
 * for the unexpected — a bad import, a null deref in a view, a broken contract.
 *
 * Scope note: with a single root layout there is nothing for a per-segment
 * error.tsx to preserve that this one does not, so the app deliberately has two
 * boundaries (here + global-error.tsx) rather than one per screen. Segment-level
 * boundaries start paying off once AppShell moves into nested layouts.
 */
"use client";

import { useEffect } from "react";
import { ErrorState } from "@devdigest/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production.
    console.error("route error", error.digest ?? "", error);
  }, [error]);

  return (
    <ErrorState
      fullScreen
      title="Something went wrong"
      body={error.message || "This screen failed to render."}
      onRetry={reset}
    />
  );
}
