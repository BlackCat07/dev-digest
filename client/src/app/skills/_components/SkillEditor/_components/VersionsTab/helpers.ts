/**
 * First meaningful line of a version body, used as its label in the history.
 *
 * `skill_versions` stores only the text — there is no author-written change note
 * and no field to enter one, so the history labels each entry with what the body
 * actually starts with rather than inventing a summary.
 */
export function versionLabel(body: string, fallback: string): string {
  const line = body
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}
