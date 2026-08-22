import { extractFileFacts } from '../../../adapters/codeindex/extract.js';
import { parseFile } from '../../../adapters/astgrep/index.js';
import type { FileFactsRow } from '../types.js';
import { SUPPORTED_EXT } from '../constants.js';

/**
 * Fact extraction for the export bundle: given the paths a bundle covers, return
 * the symbols and endpoints each file declares, so an export can carry the same
 * facts the studio shows without re-walking the clone.
 */
export async function factsForPaths(
  clonePath: string,
  paths: string[],
): Promise<Map<string, FileFactsRow>> {
  const out = new Map<string, FileFactsRow>();

  for (const path of paths) {
    const ext = path.slice(path.lastIndexOf('.'));
    if (!SUPPORTED_EXT.includes(ext)) continue;

    const parsed = await parseFile(clonePath, path);
    if (!parsed) continue;

    out.set(path, extractFileFacts(path, parsed));
  }

  return out;
}
