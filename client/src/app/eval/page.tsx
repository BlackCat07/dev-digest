/* Route: /eval — the workspace eval dashboard (one row per agent, plus a
   cross-agent list of recent batches).

   Thin route entry: the screen, its period filter, its `Run all agents` write
   and its i18n are colocated under `_components/EvalDashboardView`.

   Deliberately NOT wrapped in <Suspense>. The view reads `useSearchParams()`
   for the period, which forces a client-side-rendering bailout only on a
   STATICALLY prerendered route; a boundary here would make the server emit the
   fallback instead of the screen — a blank first paint that once passed
   typecheck and every unit test while two e2e flows failed on a black
   rectangle (`client/INSIGHTS.md`, 2026-08-04). */
import { EvalDashboardView } from "./_components/EvalDashboardView";

export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
