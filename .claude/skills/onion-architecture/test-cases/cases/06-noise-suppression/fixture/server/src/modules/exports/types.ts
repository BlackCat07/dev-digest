import { z } from 'zod';

/**
 * F13 — export bundles.
 *
 * The shapes below are the whole vocabulary of the feature. Everything that acts
 * on them is a free function further down: given the same inputs they return the
 * same output, which is what makes the assembly testable without a database.
 */
export const ExportFormat = z.enum(['json', 'csv', 'markdown']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportRequest = z.object({
  format: ExportFormat,
  prNumbers: z.array(z.number().int().positive()).min(1).max(50),
  includeFindings: z.boolean().default(true),
});
export type ExportRequest = z.infer<typeof ExportRequest>;

export const ExportItem = z.object({
  prNumber: z.number().int(),
  title: z.string(),
  score: z.number().int().nullable(),
  findingCount: z.number().int(),
});
export type ExportItem = z.infer<typeof ExportItem>;

/** Rows → the requested serialisation. Pure; the caller owns the bytes. */
export function render(items: ExportItem[], format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(items, null, 2);
  if (format === 'csv') {
    const head = 'pr_number,title,score,finding_count';
    const body = items.map(
      (i) => `${i.prNumber},"${i.title.replace(/"/g, '""')}",${i.score ?? ''},${i.findingCount}`,
    );
    return [head, ...body].join('\n');
  }
  return items
    .map((i) => `- **#${i.prNumber}** ${i.title} — score ${i.score ?? 'n/a'} (${i.findingCount})`)
    .join('\n');
}

/** Stable ordering so two exports of the same window are byte-identical. */
export function orderItems(items: ExportItem[]): ExportItem[] {
  return [...items].sort((a, b) => a.prNumber - b.prNumber);
}

/** The filename the download is offered under. */
export function filenameFor(format: ExportFormat, workspaceSlug: string): string {
  const ext = format === 'markdown' ? 'md' : format;
  return `${workspaceSlug}-export.${ext}`;
}
