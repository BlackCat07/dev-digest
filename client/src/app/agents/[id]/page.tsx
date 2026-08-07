/* Route: /agents/:id (Agent Editor). Thin route entry — the screen, its
   two-column layout styles and its tab state are colocated under
   _components/AgentDetailView.

   No <Suspense> around the view — this route is dynamic, so `useSearchParams()`
   causes no CSR bailout. See the PR-list route for the full reasoning. */
import { AgentDetailView } from "./_components/AgentDetailView";

export default async function AgentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentDetailView id={id} />;
}
