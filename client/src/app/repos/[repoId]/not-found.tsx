/* 404 boundary for every repo-scoped route: rendered when a screen under
 * /repos/:repoId calls `notFound()` because the id in the URL matches no repo in
 * the workspace (stale link, removed repo, no repo selected).
 *
 * This replaces the identical early return that the PR list and the PR detail
 * each carried inline. One owner for the copy, and the pages stop deciding what
 * a 404 looks like.
 *
 * It renders AppShell itself because this app keeps the shell inside screens
 * rather than in a layout — a not-found boundary replaces the screen, so without
 * this the user would lose the nav. The breadcrumb is intentionally generic: the
 * repo is unknown, and the old version showed a raw uuid here.
 */
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";

export default function RepoNotFoundPage() {
  return (
    <AppShell crumb={[{ label: "Repositories" }]}>
      <RepoNotFound />
    </AppShell>
  );
}
