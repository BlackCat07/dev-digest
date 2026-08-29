/* Route: /repos/:repoId/multi-agent (Configure a multi-agent run). Thin route
   entry — the screen, its two-step selection state and its i18n are colocated
   under _components/ConfigureRunView.

   This path is not free to move: `vendor/ui/nav.ts` ships the sidebar entry
   `{ key: "multi-agent", href: "/repos/:repoId/multi-agent" }` and
   `components/app-shell/helpers.ts` lights that key for any path containing
   `/multi-agent`, so the nav entry is a dead link the moment this file is not
   here. The results view sits one segment below, at
   `/repos/:repoId/multi-agent/:number`.

   No <Suspense> around the view, for the reason the sibling pulls, context and
   conventions routes each document: this route is dynamic (`ƒ`, because of
   `[repoId]`), so a boundary would make the server emit the fallback instead of
   the screen — a blank first paint with every gate still green. */
import { ConfigureRunView } from "./_components/ConfigureRunView";

export default async function MultiAgentConfigurePage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ConfigureRunView repoId={repoId} />;
}
