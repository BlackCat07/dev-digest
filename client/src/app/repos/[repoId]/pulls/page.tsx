/* Route: /repos/:repoId/pulls (PR list). Thin route entry — the screen, its
   filter/sort state and its i18n are colocated under _components/PullsView.

   No <Suspense> around the view, deliberately. PullsView reads
   `useSearchParams()`, which forces a client-side-rendering bailout only on a
   STATICALLY prerendered route; this route is dynamic (`ƒ` in the build output,
   because of `[repoId]`), so the view is server-rendered as usual. Wrapping it
   made the server emit the fallback instead of the screen — a blank first paint
   that e2e flows 04/05 caught by clicking a PR row before it appeared. If a
   future route reading searchParams IS static, `next build` fails loudly and the
   boundary belongs there, not here. */
import { PullsView } from "./_components/PullsView";

export default async function PullsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return <PullsView repoId={repoId} />;
}
