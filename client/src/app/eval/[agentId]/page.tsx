/* Route: /eval/:agentId — one agent's eval history: three metric cards, the
   metric-trend chart, the selectable recent-runs table and the comparison
   modal.

   Thin route entry, in the house shape: `params` is a promise in Next 15 and is
   awaited here so the view takes a plain string. No <Suspense>, for the reason
   `/eval/page.tsx` gives — this route is dynamic (`[agentId]`), so the search
   param hook the view uses costs nothing and a boundary would swap the screen
   for its fallback on first paint. */
import { AgentEvalView } from "./_components/AgentEvalView";

export default async function AgentEvalPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentEvalView agentId={agentId} />;
}
