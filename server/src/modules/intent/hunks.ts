/**
 * `@@` headers, taken from the stored patch text.
 *
 * Built from `pr_files.patch` and deliberately NOT from the parsed `DiffHunk`:
 * `src/adapters/git/diff-parser.ts` matches
 * `/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/` and keeps only the four
 * numbers, DISCARDING everything after the closing `@@`. That discarded tail is
 * the enclosing function or class name that git puts there, and it is the single
 * most useful signal a scope classifier gets from a diff it is not allowed to
 * read the body of — "@@ -12,7 +12,9 @@ export function upsertIntent(" says what
 * changed in a way that "@@ -12,7 +12,9 @@" never will.
 *
 * So do NOT "simplify" this to the parsed structure. Taking the headers from
 * `DiffHunk` would silently throw the tail away and leave the classifier with
 * four line numbers per hunk, and nothing about that failure would be visible in
 * a test that only counts headers.
 *
 * Nothing else from the patch is ever used: no `+`/`-` line reaches the model.
 */

/**
 * Every `@@ … @@ …` line of one file's patch, VERBATIM and in order.
 *
 * A trailing `\r` (a patch stored with CRLF endings) is dropped, because it is
 * an encoding artefact rather than part of the header.
 */
export function hunkHeaders(patch: string): string[] {
  return patch.split(/\r?\n/).filter((line) => /^@@ .*$/.test(line));
}
