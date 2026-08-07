/* Route: / (root). Thin route entry — the screen, its redirect-to-first-repo
   logic and its styles are colocated under _components/HomeView. */
import { HomeView } from "./_components/HomeView";

export default function HomePage() {
  return <HomeView />;
}
