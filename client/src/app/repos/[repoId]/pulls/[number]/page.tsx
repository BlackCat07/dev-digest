/* Route: /repos/:repoId/pulls/:number (PR detail). Thin route entry — the screen,
   its tab/trace URL state and its styles are colocated under
   _components/PrDetailView.

   No <Suspense> around the view — this route is dynamic, so `useSearchParams()`
   causes no CSR bailout. See the PR-list route for the full reasoning. */
import { PrDetailView } from "./_components/PrDetailView";

export default async function PRDetailPage({
  params,
}: {
  params: Promise<{ repoId: string; number: string }>;
}) {
  const { repoId, number } = await params;
  return <PrDetailView repoId={repoId} number={number} />;
}
