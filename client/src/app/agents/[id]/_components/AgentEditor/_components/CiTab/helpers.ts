/**
 * Helpers private to the CI tab.
 *
 * `ciStatusCell` used to live here. The CI Runs table is its second consumer, so
 * it moved to `src/lib/ci.ts` beside the display table it reads — promote on the
 * second consumer, never in anticipation, and never by copying.
 */

/** Size of a generated file, for the preview's list. */
export function formatFileSize(contents: string): string {
  const bytes = contents.length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
