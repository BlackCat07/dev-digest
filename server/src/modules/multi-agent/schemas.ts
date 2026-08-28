/**
 * The zod schema this module owns: what the persisted synthesis blob must look
 * like to be believed.
 *
 * The wire contracts themselves — `MultiAgentRun`, `AgentColumn`, `Conflict` —
 * live in `@devdigest/shared` and are not restated here, and the route's `:id`
 * is the shared `IdParams` from `modules/_shared/schemas.ts`, imported by
 * `routes.ts` exactly as every other module imports it. What is here is the ONE
 * shape neither of those describes: the jsonb column `multi_agent_runs.notes`,
 * which is internal storage rather than a wire shape, and which was left
 * untyped in `db/schema/runs.ts` on purpose so that its reader PARSES it —
 * jsonb read back from Postgres is a boundary, and a boundary is never cast.
 */
import { z } from 'zod';

/**
 * One stance sentence: what the synthesis said agent X's position at (file,
 * line) was.
 *
 * `agent_id` is the grouping's own agent key, so a run whose agent row was
 * deleted is keyed by its prefixed run id (`run:<uuid>`) rather than by null —
 * which is why this is a plain string and not a uuid.
 */
export const StanceNote = z.object({
  file: z.string(),
  line: z.number().int(),
  /** {@link GroupLabel.title} — the same discriminator, for the same reason. */
  title: z.string().optional(),
  agent_id: z.string(),
  note: z.string(),
});
export type StanceNote = z.infer<typeof StanceNote>;

/**
 * One synthesised group heading.
 *
 * **A file and a line do NOT identify a group**, which is what this record
 * assumed until 2026-08-28. `EC-9` allows two groups to share both and be
 * separated only by their titles — two agents flagging intersecting ranges with
 * unrelated titles do not merge — and on a real run three groups shared
 * `test/tasks.test.ts:70`. Keyed by location alone, the last label written won
 * the lookup and all three groups rendered the SAME heading, while the other two
 * synthesised labels sat unused in the blob. The read then also handed React
 * three identical keys.
 *
 * `title` is the group's DETERMINISTIC fallback title (AC-31) — the one it shows
 * before a label arrives. Both sides hold it: the writer takes it off the
 * `MaterialLocation` it sent, the reader off the `Conflict` before the label
 * replaces it. It is a content key, so if the grouping rule ever changes the
 * match simply stops and the group keeps its fallback title — the same state as
 * "not synthesised yet", which the read already handles (AC-38). A positional
 * key would instead attach a label to the wrong group, silently.
 *
 * Optional because blobs written before this field existed must still parse;
 * see `mergeSynthesis` for how those are matched without it.
 */
export const GroupLabel = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string().optional(),
  label: z.string(),
});
export type GroupLabel = z.infer<typeof GroupLabel>;

/**
 * The whole of `multi_agent_runs.notes`: the stance sentences and the group
 * labels, as two flat arrays.
 *
 * Two arrays rather than one nested document so a missing note and a missing
 * label degrade INDEPENDENTLY — a group with a label and no notes renders its
 * heading with empty sentences, and a group with notes and no label keeps the
 * deterministic fallback title. That is the whole reason the column exists in
 * this shape (see the doc-comment on the column in `db/schema/runs.ts`).
 *
 * Both arrays default to empty so a blob written with only one of them still
 * parses. The parse itself is all-or-nothing at the blob level: a value this
 * schema rejects is treated as "not synthesised", which is a state the read
 * already renders (every note empty, every title falling back — AC-38), so
 * there is no partial-recovery path to get wrong.
 *
 * NOT `.strict()`: a blob carrying a key a later version added must still read
 * back rather than collapse the whole synthesis to nothing.
 */
export const MultiAgentNotes = z.object({
  notes: z.array(StanceNote).default([]),
  labels: z.array(GroupLabel).default([]),
});
export type MultiAgentNotes = z.infer<typeof MultiAgentNotes>;
