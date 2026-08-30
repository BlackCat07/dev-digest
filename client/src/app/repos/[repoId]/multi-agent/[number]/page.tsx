/* Route: /repos/:repoId/multi-agent/:number — the multi-agent results view.

   Thin route entry: it awaits `params`, hands the two segments to one view and
   returns. Everything the screen does — the two modes, the poll, the trace
   drawer, the four empty/error states — is colocated under
   `_components/MultiAgentResultsView`.

   The path is the Configure-run screen's own destination: that screen (and the
   pull-request page's agent picker) both push
   `/repos/:repoId/multi-agent/:number` after starting a fan-out, so this file
   is where those two navigations land.

   `:number` is the pull request's NUMBER, not its row uuid, matching
   `/repos/:repoId/pulls/:number`. The view resolves number → uuid through the
   cached pulls list, exactly as `PrDetailView` does, because every PR API is
   keyed by the uuid.

   No <Suspense> around the view even though it reads `useSearchParams()`: the
   CSR-bailout rule is about STATICALLY prerendered routes, and this one is
   dynamic (`ƒ`, because of `[repoId]`/`[number]`), so the hook costs nothing —
   while a boundary makes the server emit the fallback INSTEAD of the screen.
   That shipped a blank first paint once with every gate green
   (`client/INSIGHTS.md`, 2026-08-04), and `client/CLAUDE.md` states the rule. */
import { MultiAgentResultsView } from "./_components/MultiAgentResultsView";

export default async function MultiAgentResultsPage({
  params,
}: {
  params: Promise<{ repoId: string; number: string }>;
}) {
  const { repoId, number } = await params;
  return <MultiAgentResultsView repoId={repoId} number={number} />;
}
