/* Pure helpers private to AgentPicker. */

/**
 * The multi-agent results route for the pull request this picker is mounted on:
 * `/repos/:repoId/pulls/:number` → `/repos/:repoId/multi-agent/:number`.
 *
 * Derived from the pathname rather than from `useParams()` on purpose. The
 * header is handed `pr` and `prId`, not the route segments, and `PrDetailView`
 * — which would have to thread `repoId` down — is not this task's to change.
 * `usePathname` is also the hook the rest of this subtree already leans on, so
 * no existing test has to learn a new `next/navigation` export.
 *
 * Returns `null` rather than a guess when the path is not a pull-request route:
 * a `String.replace` that silently missed would navigate to the page the reader
 * is already on and read as "the button did nothing".
 */
export function resultsRoute(pathname: string | null | undefined): string | null {
  const m = /^\/repos\/([^/]+)\/pulls\/([^/]+)/.exec(pathname ?? "");
  return m ? `/repos/${m[1]}/multi-agent/${m[2]}` : null;
}
