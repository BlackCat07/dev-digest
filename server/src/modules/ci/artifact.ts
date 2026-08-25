import { unzipSync } from 'fflate';
import { CI_RESULT_FILE_NAME, CiResultArtifact } from '@devdigest/shared';

/**
 * Decoding one downloaded artifact, as a total function.
 *
 * `Uint8Array | null` in, a discriminated result out — never a throw, because
 * every one of these outcomes is an ordinary thing that happens to a CI run and
 * each has to become a stored row carrying its own named reason. A run whose
 * artifact expired is a run that HAPPENED; dropping it would report it as a run
 * that did not (AC-24).
 *
 * The four reasons are the four cases, and they are pairwise distinct on purpose:
 * a single catch-all `artifact_unreadable` would satisfy "record a reason" and
 * tell the person reading the CI Runs screen nothing about which of four quite
 * different things went wrong.
 *
 *   `artifact_missing`      — no artifact of that name on the run: expired, or a
 *                             cancelled run that uploaded nothing. This is the
 *                             `null` the GitHub port returns rather than throwing.
 *   `artifact_unreadable`   — bytes arrived and are not a readable zip.
 *   `result_file_missing`   — a readable zip with no `devdigest-result.json` in it.
 *   `result_unparseable`    — the file is there and does not parse against the
 *                             result contract (`{}` is the canonical case).
 *
 * `safeParse`, not `parse`: AC-24 needs the failure as a VALUE. A throw here would
 * have to be caught somewhere up the call chain and mapped back into one of these
 * four names, which is the same code with a worse control flow.
 */

export const CI_ARTIFACT_REASONS = [
  'artifact_missing',
  'artifact_unreadable',
  'result_file_missing',
  'result_unparseable',
] as const;

export type CiArtifactReason = (typeof CI_ARTIFACT_REASONS)[number];

export type CiArtifactRead =
  | { ok: true; artifact: CiResultArtifact }
  | { ok: false; reason: CiArtifactReason };

/**
 * A fifth reason, and the one thing the decoder above cannot know.
 *
 * AC-24 lists FOUR cases and asks each to carry its own distinct reason — but two
 * of them, an expired artifact and a cancelled run that uploaded nothing, arrive
 * here as the identical `null`. A pure function of bytes cannot tell them apart
 * and should not pretend to; the run's own `conclusion` is what separates them,
 * and only the caller holds it. So the decode stays four-valued and
 * {@link reasonForMissingArtifact} refines its `artifact_missing` where the run
 * says the job never got as far as uploading.
 */
export const CI_RUN_CANCELLED_REASON = 'run_cancelled';

export type CiRunReason = CiArtifactReason | typeof CI_RUN_CANCELLED_REASON;

/**
 * The reason a run carries, given what the decode said and how the run ended.
 *
 * Only `artifact_missing` is ambiguous: a cancelled run has no artifact because
 * it was stopped, and calling that "missing" would report a cancellation as an
 * expiry — two things a reader would act on quite differently.
 */
export function reasonForMissingArtifact(
  reason: CiArtifactReason,
  conclusion: string | null,
): CiRunReason {
  if (reason === 'artifact_missing' && conclusion === 'cancelled') {
    return CI_RUN_CANCELLED_REASON;
  }
  return reason;
}

export function readResultArtifact(bytes: Uint8Array | null): CiArtifactRead {
  if (bytes === null || bytes.length === 0) {
    return { ok: false, reason: 'artifact_missing' };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, reason: 'artifact_unreadable' };
  }

  // Matched on the last path segment: `upload-artifact` preserves the uploaded
  // path, so the same file arrives as `devdigest-result.json` from a repository
  // root and as `some/dir/devdigest-result.json` from anywhere else.
  const name = Object.keys(entries).find((k) => basename(k) === CI_RESULT_FILE_NAME);
  if (name === undefined) return { ok: false, reason: 'result_file_missing' };

  const raw = entries[name];
  if (raw === undefined) return { ok: false, reason: 'result_file_missing' };

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false, reason: 'result_unparseable' };
  }

  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'result_unparseable' };

  return { ok: true, artifact: parsed.data };
}

/**
 * Last segment of a zip entry name.
 *
 * Written out rather than taken from `node:path`: a feature module may import no
 * `node:` specifier, and a zip entry always uses `/` regardless of the platform
 * that produced it, so `path.basename` would be the wrong function anyway.
 */
function basename(entry: string): string {
  const cut = entry.lastIndexOf('/');
  return cut === -1 ? entry : entry.slice(cut + 1);
}
