/* Route: /onboarding (add repository). Thin route entry — the screen lives in
   _components/AddRepoView.

   No "use client" here: AddRepoView carries the boundary itself, so the entry
   stays a server component (client/CLAUDE.md — "keep the boundary at the view"). */
import { AddRepoView } from "./_components/AddRepoView";

export default function AddRepoPage() {
  return <AddRepoView />;
}
