/* Unit-private helpers for BlastRadiusCard. Pure functions only, so each is
   testable without mounting the card. */
import type { BlastDownstream, BlastEndpoint, PrBlastRadius } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/**
 * The commit a `file:line` link must be pinned to.
 *
 * **`indexed_sha`, NOT the PR's head.** The callers in this map are files the PR does
 * not change, and their line numbers come from the index — which was built against
 * the commit `indexed_sha` names. Pinning to the PR's head would point at a tree the
 * line numbers were never measured on, and the link would land a few lines off
 * exactly when the caller file has moved since.
 *
 * `HEAD` is the fallback when the response carries no sha (a degraded map). GitHub
 * resolves it against the default branch, so the link still opens the file at its
 * current line rather than 404-ing on an empty ref.
 */
export function linkRef(blast: Pick<PrBlastRadius, "indexed_sha">): string {
  return blast.indexed_sha ?? "HEAD";
}

/** github.com blob URL for one caller row. */
export function callerUrl(
  repoFullName: string,
  ref: string,
  file: string,
  line: number,
): string {
  return githubBlobUrl(repoFullName, ref, file, line);
}

/** `src/api/public/index.ts:23` — the design's caller label. */
export function fileLineLabel(file: string, line: number): string {
  return `${file}:${line}`;
}

/**
 * Impacted endpoints that no symbol row accounts for.
 *
 * Two real cases produce these, and both would otherwise leave the stat row saying
 * "13 endpoints" above a tree showing none. A route the changed file DECLARES itself
 * (`depth: 0`) belongs to the PR rather than to any symbol; and a route reached from a
 * changed file whose symbols live in a *different* changed file is attributed to
 * neither. Rendering them in their own row is what keeps the figures and the body of
 * the card telling the same story.
 */
export function unattributed(
  impacted: readonly BlastEndpoint[],
  downstream: readonly BlastDownstream[],
): BlastEndpoint[] {
  const claimed = new Set(
    downstream.flatMap((d) => d.impacted.map((e) => `${e.kind}|${e.label}|${e.file}`)),
  );
  return impacted.filter((e) => !claimed.has(`${e.kind}|${e.label}|${e.file}`));
}

/**
 * Names that more than one row in this map declares.
 *
 * A layered codebase legitimately declares `createTask` in `repo.ts` AND in
 * `service.ts`, and one PR can change both. Each row then has its own callers — but
 * two rows reading `createTask()` look like a duplicate rather than two real symbols,
 * so the card appends the declaring file to exactly those. Only the ambiguous ones:
 * putting a path on every row would bury the symbol name the reader is scanning for.
 */
export function ambiguousNames(downstream: readonly BlastDownstream[]): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const d of downstream) seen.set(d.symbol, (seen.get(d.symbol) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
}

/**
 * Escape a label for a mermaid node.
 *
 * Paths and endpoint labels contain `/`, `(`, `)` and spaces, and an unescaped `(`
 * or `"` ends the node definition early — mermaid then fails to parse and
 * `MermaidDiagram` renders its invalid state, so the whole graph disappears because
 * one endpoint had a bracket in it. Quoting the text and stripping quotes from it is
 * what keeps every label safe.
 */
function mermaidLabel(text: string): string {
  return `"${text.replace(/["<>]/g, "")}"`;
}

/**
 * The impact map as a left-to-right mermaid flowchart: changed symbol → callers →
 * endpoints and crons.
 *
 * Direction is meaningful and matches the tree: arrows point the way impact
 * TRAVELS, from the changed symbol out to what depends on it. Node ids are index
 * based (`s0`, `s0c1`) rather than derived from paths, because a path contains
 * characters mermaid reads as syntax.
 *
 * Returns an empty string when there is nothing to draw; the card renders the
 * `graph.empty` copy instead of an empty diagram.
 */
export function buildGraph(downstream: readonly BlastDownstream[]): string {
  if (downstream.length === 0) return "";

  const lines = ["flowchart LR"];
  downstream.forEach((d, si) => {
    const sid = `s${si}`;
    lines.push(`  ${sid}[${mermaidLabel(`${d.symbol}()`)}]`);
    d.callers.forEach((c, ci) => {
      const cid = `${sid}c${ci}`;
      lines.push(`  ${cid}[${mermaidLabel(fileLineLabel(c.file, c.line))}]`);
      lines.push(`  ${sid} --> ${cid}`);
    });
    // Endpoints hang off the symbol rather than off one caller: the map attributes
    // them to the symbol, and drawing a guessed caller→endpoint edge would assert a
    // path the index never resolved.
    d.impacted.forEach((e, ei) => {
      const eid = `${sid}e${ei}`;
      const shape = e.kind === "cron" ? [`(`, `)`] : [`([`, `])`];
      lines.push(`  ${eid}${shape[0]}${mermaidLabel(e.label)}${shape[1]}`);
      lines.push(`  ${sid} --> ${eid}`);
    });
  });
  return lines.join("\n");
}
