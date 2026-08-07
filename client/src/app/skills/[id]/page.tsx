import { SkillsWorkbench } from "../_components/SkillsWorkbench";

/* Route: /skills/:id — the same workbench with one skill selected. Deliberately
   NOT wrapped in <Suspense>: this route is dynamic, so `useSearchParams` costs
   nothing here, and a boundary would make the server emit the fallback instead
   of the screen (see client/CLAUDE.md and INSIGHTS.md 2026-08-04). */
export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillsWorkbench id={id} />;
}
