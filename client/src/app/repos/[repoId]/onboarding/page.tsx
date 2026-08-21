/* Route: /repos/:repoId/onboarding (Onboarding Tour). Thin route entry — the
   screen and all five of its states live under _components/OnboardingView.
   No streaming boundary wraps the view, no loading.tsx and no per-segment
   error.tsx: this route is dynamic (`ƒ`, because of `[repoId]`), so a boundary
   makes the server emit the fallback INSTEAD of the screen (client/INSIGHTS.md,
   2026-08-04), and AC-44 needs the error inside the shell, not replacing it. */
import { OnboardingView } from "./_components/OnboardingView";

export default async function OnboardingTourPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <OnboardingView repoId={repoId} />;
}
