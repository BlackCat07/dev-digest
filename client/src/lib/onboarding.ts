/**
 * Onboarding Tour helpers, shared by the tour screen and its section cards.
 *
 * These are RUNTIME values, deliberately not imported from `@devdigest/shared`.
 * A runtime import from that package breaks `next dev` / `next build` with
 * "Can't resolve './contracts/*.js'" — as a 500 on every route that
 * transitively reaches it — while `tsc --noEmit` and vitest both stay green
 * (`INSIGHTS.md`, Recurring Errors, 2026-08-03). Every import of the contract
 * below is `import type`; this file is the runtime mirror, exactly as
 * `conventions.ts`, `severity.ts` and `skill.ts` are for theirs.
 *
 * They live in `src/lib/` rather than in a unit's `helpers.ts` because more than
 * one unit reads them — the screen renders the notice and the caption, the
 * section card builds the file links — and a unit's `helpers.ts` is unit-private
 * under the barrel convention (`INSIGHTS.md`, Codebase Patterns, 2026-08-02, the
 * same reason `src/lib/format.ts` exists).
 *
 * Nothing here is React, fetches anything, or reads the message catalogue: the
 * reason lookup returns a KEY and the caller words it, so one wording lives in
 * `messages/en/onboarding.json` and not two.
 */
import { formatAge } from "./format";
import { githubBlobUrl } from "./github-urls";
import type { OnboardingReason, OnboardingTour } from "@devdigest/shared";

/**
 * The sentence rendered for a reason this build has no wording for.
 *
 * Relative to the `onboarding` namespace, so a component holding
 * `useTranslations("onboarding")` resolves it as `onboarding.reason.generic`.
 */
const GENERIC_REASON_MESSAGE_KEY = "reason.generic";

/**
 * `OnboardingReason` → the message key that words it.
 *
 * Keys are relative to the `onboarding` namespace: `reason.flag_off` here is
 * `onboarding.reason.flag_off` in `messages/en/onboarding.json`, which is what a
 * component holding `useTranslations("onboarding")` resolves it to.
 *
 * `satisfies` rather than a bare annotation is load-bearing twice over: it makes
 * the compiler reject this file the day `OnboardingReason` grows a tenth value
 * with no wording, and it rejects a key that is not in the enum. The widened
 * `Record<string, string>` annotation is what then allows a lookup by a value the
 * contract has grown and this build has not — see {@link reasonMessageKey}.
 */
const REASON_MESSAGE_KEY: Readonly<Record<string, string>> = {
  flag_off: "reason.flag_off",
  index_failed: "reason.index_failed",
  index_partial: "reason.index_partial",
  repo_too_large: "reason.repo_too_large",
  index_missing: "reason.index_missing",
  model_failed: "reason.model_failed",
  model_timeout: "reason.model_timeout",
  model_invalid: "reason.model_invalid",
  no_commands_declared: "reason.no_commands_declared",
} satisfies Record<OnboardingReason, string>;

/**
 * The message key wording one `reason`, with a generic sentence as the default.
 *
 * **A lookup with a fallback, never a `switch` that falls through to the raw
 * value.** A server one version ahead can send a reason this build has never
 * heard of; rendering it would put an enum literal (`model_timeout`) on the
 * screen, and passing an unknown key to `next-intl` puts the KEY PATH there
 * instead while logging `IntlError: MISSING_MESSAGE` into stderr — a green test
 * run and a broken screen. Both are the failure this function exists to prevent,
 * so an unrecognised value resolves to a key whose wording is a complete
 * sentence in its own right.
 *
 * The parameter is a bare `string` on purpose: a value that IS in
 * `OnboardingReason` is exactly the case that needs no fallback, so typing it as
 * the enum would make the interesting input unrepresentable.
 *
 * `null` — a tour whose status is `ok` — also answers with the generic key. The
 * caller decides WHETHER to word a reason at all (it does so only when the tour
 * is not `ok`), so this is the safe answer rather than the expected path.
 */
export function reasonMessageKey(reason: string | null | undefined): string {
  if (reason == null) return GENERIC_REASON_MESSAGE_KEY;
  return REASON_MESSAGE_KEY[reason] ?? GENERIC_REASON_MESSAGE_KEY;
}

/**
 * Which notice belongs above the sections, or `null` for none.
 *
 * The three values are also the message sub-namespaces — `notice.stale.*`,
 * `notice.partial.*`, `notice.degraded.*` — so the caller words a notice without
 * a second branch of its own.
 *
 * One notice, in this precedence: `degraded` first, then `partial`, then
 * `stale`. The order is what the reader most needs to know before reading a word
 * of the tour. A degraded tour is not a tour at all — its sections exist because
 * the contract fixes five, so telling that reader "the repository has moved on"
 * would describe a document that was never written. Staleness is last because it
 * is the only one of the three that says nothing about whether what is below is
 * TRUE: it was true at the commit the tour records.
 */
export type OnboardingNoticeLevel = "degraded" | "partial" | "stale";

export function noticeLevel(
  tour: Pick<OnboardingTour, "status" | "stale">,
): OnboardingNoticeLevel | null {
  if (tour.status === "degraded") return "degraded";
  if (tour.status === "partial") return "partial";
  return tour.stale ? "stale" : null;
}

/** The figures behind the caption beside the tour's title. */
export interface TourProvenance {
  /** Files the index had covered when THIS tour was generated. */
  files: number;
  /** Files it had skipped then. */
  skipped: number;
  /** How long ago the tour was written, as a unit (`"3h"`, `"11d"`) — never a sentence. */
  age: string;
}

/**
 * What this tour was generated from, for `meta.generated` / `meta.filesSkipped`.
 *
 * Reads the tour's OWN recorded figures and never the current index state. The
 * two part company the moment the repository is re-indexed, and a caption built
 * from today's index would credit an old tour with coverage it never saw — which
 * is the same claim `stale` exists to deny.
 *
 * `age` comes from `src/lib/format.ts` rather than a second formatter here: it
 * already renders a null timestamp as `"—"` and never as `"now"`, so a tour with
 * no `generated_at` cannot read as a fresh one.
 */
export function tourProvenance(
  tour: Pick<OnboardingTour, "files_indexed" | "files_skipped" | "generated_at">,
): TourProvenance {
  return {
    files: tour.files_indexed,
    skipped: tour.files_skipped,
    age: formatAge(tour.generated_at),
  };
}

/**
 * Where a path the tour names lives on the repository host, or `null`.
 *
 * `indexedSha` is the tour's own `indexed_sha`, so the link opens the file as it
 * was when the tour was written. A branch name would point at whatever landed
 * since — code this tour never read, at line numbers it never counted.
 *
 * `null` when there is no SHA (a degraded tour generated with no index has none)
 * or no `full_name` for the repository, so the caller renders no control rather
 * than a link that resolves to a 404. The URL itself is built by
 * `githubBlobUrl`, which owns the path encoding; there is deliberately no second
 * host string in this feature.
 */
export function tourFileUrl(
  repoFullName: string | null | undefined,
  indexedSha: string | null | undefined,
  path: string,
): string | null {
  if (!repoFullName || !indexedSha) return null;
  return githubBlobUrl(repoFullName, indexedSha, path);
}
