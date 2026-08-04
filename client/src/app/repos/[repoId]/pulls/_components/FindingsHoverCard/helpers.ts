import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "@/lib/severity";

/**
 * Strip the markdown a rationale carries so a two-line clamp doesn't show raw
 * `**` / backticks. Deliberately not a markdown renderer: the panel is a
 * preview, and `<Markdown>` blocks would break the clamp.
 */
export function stripMarkdown(text: string): string {
  return text.replace(/\*\*|`/g, "");
}

/** Worst-severity-first, so the panel opens on what matters. */
export function sortBySeverity(findings: FindingRecord[]): FindingRecord[] {
  const rank = (s: string) => {
    const i = SEVERITY_LEVELS.indexOf(s as (typeof SEVERITY_LEVELS)[number]);
    return i === -1 ? SEVERITY_LEVELS.length : i;
  };
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** "12" for a single line, "61-74" for a range. */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
