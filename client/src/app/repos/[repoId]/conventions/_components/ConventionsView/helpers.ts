import type { ConventionScan } from "@devdigest/shared";

/**
 * Unit-private helpers for ConventionsView.
 *
 * `relativeAge` is here rather than in `src/lib/format.ts` because this is the
 * only screen that shows one; the moment a second needs it, that is the file it
 * moves to.
 */

export interface RelativeAge {
  /** The i18n key under `conventions.scan` to render. */
  key: "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo";
  count: number;
}

/**
 * "1h ago" from a timestamp, as a key + count rather than a formatted string —
 * the plural rules belong to next-intl, not to a helper.
 *
 * `now` is a parameter so the test does not depend on the wall clock.
 */
export function relativeAge(iso: string, now: number = Date.now()): RelativeAge {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return { key: "justNow", count: 0 };
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  return { key: "daysAgo", count: Math.floor(hours / 24) };
}

/**
 * Whether the screen should offer the "nothing survived" explanation rather than
 * the first-run empty state.
 *
 * The two look similar and mean opposite things: one says "you have not scanned
 * yet", the other says "we scanned, the model proposed rules, and none could be
 * substantiated". Showing the first after a real scan would quietly hide the
 * most interesting result this tool produces.
 */
export function isAllDropped(scan: ConventionScan | null, candidateCount: number): boolean {
  if (!scan || candidateCount > 0) return false;
  if (scan.status !== "done" && scan.status !== "partial") return false;
  return scan.proposed > 0;
}

/** Rounded to the nearest thousand, as `12k`. Budget figures only. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  return `${Math.round(value / 1000)}k`;
}
