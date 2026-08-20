/* Pure helpers for the Smart Diff viewer (L03b): the three-way join, the
   expansion rule, and the on-diff/off-diff partition. No React, no DOM. */
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES, type Line } from "@/components/diff-viewer";
import {
  GROUP_ORDER,
  LINE_ID_PREFIX,
  OFFDIFF_ID_PREFIX,
  SEVERITY_RANK,
} from "./constants";
import type { SmartFileVm, SmartGroupVm, ViewRole } from "./types";

/** Paths from three sources have to meet, so they all pass through this first. */
function normalize(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

/**
 * Do two paths name the same changed file?
 *
 * Exported because a second consumer needs the SAME comparison the view model
 * uses: a target handed to this tab from elsewhere on the screen (a review-focus
 * row, a link) has to be matched against `pr.files` before the reader can be told
 * their file is not here, and matching it a second way would let a file be
 * simultaneously "expanded" by one rule and "missing" by another.
 */
export function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** Worst severity first, then by line, so a file's list reads top-down by urgency. */
function byUrgency(a: FindingRecord, b: FindingRecord): number {
  const rank = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
  return rank !== 0 ? rank : a.start_line - b.start_line;
}

/**
 * The findings of the newest review PER AGENT — the same reduction the server does.
 *
 * **This is what makes the badge mean "problems in this file" rather than "review
 * rows that mentioned it".** A review fans out over agents and writes one `reviews`
 * row each, so re-running an agent adds a row rather than replacing one. Summing
 * every row therefore GROWS the count on every re-run: measured on a real PR with
 * two agents run twice, `src/modules/tasks/routes.ts` showed **11 findings** while
 * the server's `finding_lines` for the same file was `[13, 40]` — two lines, because
 * the server collapses the superseded rows and the client did not. Four of those 11
 * were the same 200-vs-201 status-code problem, worded differently by two agents on
 * two runs.
 *
 * Deliberately NOT applied to `PrDetailView`'s `allFindings`, which feeds the
 * "Agent runs" tab badge: that number sums every run on purpose, so it equals the PR
 * list's FINDINGS column (`server/INSIGHTS.md`, 2026-08-03). The two bases are
 * different because the questions are: that badge asks "how much has been said about
 * this PR", this one asks "where do I look". So the reduction lives here, in the
 * feature, and changes nothing else on the screen.
 *
 * `reviews` MUST be newest-first — `GET /pulls/:id/reviews` orders `created_at DESC`
 * and this function does no sorting, exactly as its server twin
 * (`modules/smart-diff/findings.ts`) documents.
 */
export function latestFindingsPerAgent(reviews: readonly ReviewRecord[]): FindingRecord[] {
  const seen = new Set<string>();
  const out: FindingRecord[] = [];
  for (const review of reviews) {
    if (review.kind !== "review") continue;
    // Falls back to the ROW id: `reviews.agent_id` is nullable, and the seeded
    // review has it null — keying on the raw value would collapse every agent-less
    // row into one bucket and drop all but the first.
    const key = review.agent_id ?? `row:${review.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...review.findings);
  }
  return out;
}

/**
 * Join the response, the PR's files and the review's findings into one view model.
 *
 * **`pr.files` is the spine, not `smartDiff.groups`.** Every changed file appears
 * exactly once whatever the response says, because this tab is the only place a
 * reviewer can see the diff at all — a partial or stale response must not be able
 * to make a file invisible. A path the response did not classify lands in
 * `unclassified`, which renders last and only when non-empty.
 *
 * **Findings come from the review rows, never from `finding_lines`.** The rows are the
 * only source carrying `severity` (the badge colour and the blocker dot) and
 * `dismissed_at`, so they have to be authoritative — but the caller must first reduce
 * them with {@link latestFindingsPerAgent}, or the badge counts review ROWS that
 * mentioned a file instead of problems in it. With that reduction the badge and
 * `finding_lines` describe the same set, which is what makes either of them worth
 * trusting. `finding_lines` stays in the contract and is simply not rendered; if that
 * ever changes, this query gains a cache-invalidation coupling it does not have today.
 *
 * Dismissed findings are excluded, matching `ReviewRunAccordion`'s blocker count.
 */
export function buildViewModel(
  files: readonly PrFile[],
  smartDiff: SmartDiff | null | undefined,
  findings: readonly FindingRecord[],
): SmartFileVm[] {
  const roleByPath = new Map<string, ViewRole>();
  const summaryByPath = new Map<string, string | null>();
  for (const group of smartDiff?.groups ?? []) {
    for (const file of group.files) {
      roleByPath.set(normalize(file.path), group.role);
      summaryByPath.set(normalize(file.path), file.pseudocode_summary ?? null);
    }
  }

  const findingsByPath = new Map<string, FindingRecord[]>();
  for (const finding of findings) {
    if (finding.dismissed_at) continue;
    const key = normalize(finding.file);
    const list = findingsByPath.get(key);
    if (list) list.push(finding);
    else findingsByPath.set(key, [finding]);
  }

  return files.map((file) => {
    const key = normalize(file.path);
    const own = (findingsByPath.get(key) ?? []).slice().sort(byUrgency);
    return {
      path: file.path,
      role: roleByPath.get(key) ?? "unclassified",
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      patch: file.patch ?? null,
      summary: summaryByPath.get(key) ?? null,
      findings: own,
      hasBlockers: own.some((f) => f.severity === "CRITICAL"),
    };
  });
}

/** The view model bucketed into groups, in reading order, empty buckets omitted. */
export function groupFiles(files: readonly SmartFileVm[]): SmartGroupVm[] {
  const groups: SmartGroupVm[] = [];
  for (const role of GROUP_ORDER) {
    const members = files.filter((f) => f.role === role);
    if (members.length > 0) groups.push({ role, files: members });
  }
  return groups;
}

/**
 * Does this file start expanded? Precedence: FINDINGS > ROLE > SIZE.
 *
 * A finding always wins, whatever group the file is in — the reviewer came for the
 * findings, and a jump to one would have to open the file anyway. Boilerplate and
 * wiring never open themselves, which is what satisfies the acceptance criterion
 * that a lock file starts collapsed (a lock file has no findings, so nothing
 * overrides its role). Size gates only the no-findings case, so a 3 000-line
 * generated core file does not dump itself on the page and `AUTO_EXPAND_MAX_LINES`
 * keeps the meaning it already had in the flat viewer instead of growing a second
 * threshold beside it.
 *
 * Consequence worth naming: before any review has run, only small core files are
 * open. That is intended — the tab shows structure first — and it is why the group
 * headers carry counts.
 */
export function initialOpen(file: SmartFileVm): boolean {
  return (
    file.findings.length > 0 ||
    (file.role === "core" && file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES)
  );
}

/**
 * Split a file's findings into the ones a rendered line can host and the ones it
 * cannot.
 *
 * The same idea as `partitionThreads` in the diff-viewer, and it exists for the
 * same reason: a patch is an excerpt, so an annotation can point at a line that is
 * simply not on screen — GitHub truncates large patches, and a finding may have
 * been grounded against an older head. Dropping those silently would make the badge
 * count disagree with what the file shows, so they render as a footer instead and
 * the count stays honest.
 *
 * Keyed on the NEW side only: findings carry head-side line numbers, so a `del`
 * line's old number is never a target.
 */
export function partitionFindings(
  findings: readonly FindingRecord[],
  lines: readonly Line[],
): { byLine: Map<number, FindingRecord[]>; offDiff: FindingRecord[] } {
  const rendered = new Set<number>();
  for (const line of lines) {
    if ((line.kind === "add" || line.kind === "ctx") && line.newNo != null) rendered.add(line.newNo);
  }

  const byLine = new Map<number, FindingRecord[]>();
  const offDiff: FindingRecord[] = [];
  for (const finding of findings) {
    if (!rendered.has(finding.start_line)) {
      offDiff.push(finding);
      continue;
    }
    const list = byLine.get(finding.start_line);
    if (list) list.push(finding);
    else byLine.set(finding.start_line, [finding]);
  }
  return { byLine, offDiff };
}

/**
 * Decoration for every line a multi-line finding spans, so the extent of the
 * problem is visible even though only its start line carries a badge.
 *
 * Returns the worst severity covering each rendered line. A finding whose start
 * line is off-diff still decorates whatever part of its range IS on screen — the
 * range is what the reviewer needs to see, and it is independent of where the badge
 * can be anchored.
 */
export function severityByLine(
  findings: readonly FindingRecord[],
  lines: readonly Line[],
): Map<number, string> {
  const out = new Map<number, string>();
  const rendered = new Set<number>();
  for (const line of lines) {
    if ((line.kind === "add" || line.kind === "ctx") && line.newNo != null) rendered.add(line.newNo);
  }

  for (const finding of findings) {
    const end = Math.max(finding.start_line, finding.end_line);
    for (let n = finding.start_line; n <= end; n += 1) {
      if (!rendered.has(n)) continue;
      const current = out.get(n);
      const better =
        current == null ||
        (SEVERITY_RANK[finding.severity] ?? 99) < (SEVERITY_RANK[current] ?? 99);
      if (better) out.set(n, finding.severity);
    }
  }
  return out;
}

/**
 * DOM id of one rendered line.
 *
 * A stable anchor, not a scroll target of this tab's own: a badge press leaves for
 * the finding's card rather than moving within the file. Resolve one with
 * `document.getElementById`, never `querySelector` — a path contains `/` and `.`,
 * which are legal in an HTML id but are selector syntax, so a selector would need
 * `CSS.escape` and would silently match nothing without it.
 */
export function lineId(path: string, line: number): string {
  return `${LINE_ID_PREFIX}-${path}-RIGHT-${line}`;
}

/** DOM id of a file's off-diff findings footer. */
export function offDiffId(path: string): string {
  return `${OFFDIFF_ID_PREFIX}-${path}`;
}
