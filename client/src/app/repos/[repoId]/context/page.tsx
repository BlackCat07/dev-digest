/* Route: /repos/:repoId/context (Project Context). Thin route entry — the
   screen, its filter and selection state and its i18n are colocated under
   _components/ContextView.

   No <Suspense> around the view, for the same reason the sibling conventions
   and pulls routes document: this route is dynamic (`ƒ`, because of
   `[repoId]`), so a boundary would make the server emit the fallback instead
   of the screen. No loading.tsx and no per-segment error.tsx either — the view
   owns both states inline, because AC-31 requires the error to sit BESIDE the
   list with the rest of the screen still usable, which a segment-level
   error.tsx cannot do (it replaces the segment). */
import { ContextView } from "./_components/ContextView";

export default async function ProjectContextPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ContextView repoId={repoId} />;
}
