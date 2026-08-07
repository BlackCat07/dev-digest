import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab). Thin route entry — the grid, its search, its add
   menu and the import drawer are colocated under _components/SkillsListView.
   Selecting a card goes to /skills/:id, which renders the rail + editor. */
export default function SkillsPage() {
  return <SkillsListView />;
}
