/* Route: /ci-runs — every agent review this workspace ran inside CI.

   Thin route entry: the table, its three data states, its refresh write and its
   i18n are colocated under `_components/CiRunsView`. There is no dynamic
   segment here, so there are no `params` to await.

   Deliberately NOT wrapped in <Suspense>. `/ci-runs` is a client-fetched screen;
   a boundary here would make the server emit the fallback instead of the screen
   — a blank first paint that once passed typecheck and every unit test while two
   e2e flows failed on a black rectangle (`client/INSIGHTS.md`, 2026-08-04). */
import { CiRunsView } from "./_components/CiRunsView";

export default function CiRunsPage() {
  return <CiRunsView />;
}
