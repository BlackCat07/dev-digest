/* Route: /repos/:repoId/conventions (Conventions extractor). Thin route entry —
   the screen, its filter state and its i18n are colocated under
   _components/ConventionsView.

   No <Suspense> around the view, for the same reason the sibling pulls route
   documents: this route is dynamic (`ƒ`, because of `[repoId]`), so a boundary
   would make the server emit the fallback instead of the screen. */
import { ConventionsView } from "./_components/ConventionsView";

export default async function ConventionsPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ConventionsView repoId={repoId} />;
}
