/**
 * Project Context — the markdown documents a repository already carries, and the
 * ones an agent or a skill has been told to send with a review.
 *
 * A NEW FILE rather than fields on `SpecFile` (./platform.js), and the reason is
 * that the two answer different questions. `SpecFile` is one document's TEXT —
 * path, content, size, mtime — and it stays exactly that, gaining its first
 * consumer and no field. `ProjectDoc` is one document's LISTING, which needs the
 * root it was found under, a type label, a token estimate and a count of the
 * agents that would notice its removal; none of those belong on a shape whose
 * job is to carry content. `RunTrace.specs_read` (./trace.js) likewise stays
 * `string[]`, so every trace already stored keeps reading. Nothing here edits an
 * existing symbol.
 *
 * Two properties of these shapes are worth stating once, because a consumer that
 * assumes otherwise fails silently:
 *
 *  - **Paths are stored; text never is.** An attachment names a repository and a
 *    repo-relative path, so a run reads whatever the clone holds at that moment.
 *    Editing a document in the clone changes the next review with nothing
 *    re-saved — and equally, a document deleted from the clone degrades that run
 *    rather than breaking the attachment.
 *  - **An empty list is not an answer on its own.** The walk comes back empty
 *    both when the repository has no documents and when it has no clone at all.
 *    `status` and `reason` are what separate the two, the same job ./prior-prs.js
 *    gives its own envelope for an empty history.
 */
import { z } from 'zod';

/**
 * Which kind of document this is, derived from the root it was found under —
 * never from its contents.
 *
 * `insight` also covers an `INSIGHTS.md` matched by filename outside every
 * configured root: this repository keeps its insights at each package root
 * rather than in an `insights/` directory, so that filename rule is the only
 * thing that finds them at all. `other` is the honest label for a configured
 * root that is none of the three, and it exists so the list's grouping always
 * has a name to group under.
 */
export const ProjectDocType = z.enum(['spec', 'doc', 'insight', 'other']);
export type ProjectDocType = z.infer<typeof ProjectDocType>;

/**
 * How much of the repository's documents the answer actually covers.
 *
 *  - `ok`          — the walk completed; the list is everything it found.
 *  - `partial`     — the list is real but incomplete: the document cap was hit,
 *                    or part of the tree could not be read. `reason` says which.
 *  - `unavailable` — nothing was searched. An empty list here is NOT a claim
 *                    that the repository holds no documents.
 */
export const ProjectDocListStatus = z.enum(['ok', 'partial', 'unavailable']);
export type ProjectDocListStatus = z.infer<typeof ProjectDocListStatus>;

/**
 * One document as the list shows it — metadata only, never the text.
 *
 * `size` is bytes on disk; `tokens` is the approximate figure `ceil(characters
 * / 4)`, the same rule the client uses beside a prompt slot. The two are not
 * derivable from one another and both are shown, because a reader deciding what
 * to attach is spending context, not disk. The token figure is deliberately an
 * estimate rather than a tokenizer count: it exists to show that a document
 * costs context, not to bill anyone, and one shared rule is what keeps the
 * number beside a row and the number beside the assembled block from drifting.
 *
 * `used_by_agents` counts the agents whose effective set contains this path,
 * including an agent that reaches it through a DISABLED skill — the figure
 * answers "would removing this document affect anyone", not "is it in flight
 * right now", so it can legitimately disagree with what a given run carries.
 */
export const ProjectDoc = z.object({
  /** Repo-relative, e.g. `specs/project-context.md`. Unique within a clone. */
  path: z.string(),
  doc_type: ProjectDocType,
  /** The searched root it was found under, e.g. `specs/`; the grouping key. */
  root: z.string(),
  /** Bytes on disk. */
  size: z.number().int(),
  /** Approximate: `ceil(characters / 4)`. */
  tokens: z.number().int(),
  /** ISO. Null when the filesystem reported no modification time. */
  updated_at: z.string().nullable(),
  used_by_agents: z.number().int(),
});
export type ProjectDoc = z.infer<typeof ProjectDoc>;

/**
 * Response of the repository's document list.
 *
 * Read-only and derived on every request: no row of its own, no cache, no
 * freshness rule, and nothing enqueued. `roots` is the roots that were actually
 * searched — the empty state names them, so a reader can tell "there are no
 * documents" from "you are looking in the wrong place". `total` is the count
 * BEFORE the cap, so a full page is never read as the whole set; `truncated` is
 * what says the list was cut.
 */
export const ProjectDocList = z.object({
  /** Ordered by path ascending, which is already a total order within a clone. */
  docs: z.array(ProjectDoc),
  /** The roots actually searched, in the order they were searched. */
  roots: z.array(z.string()),
  /** Matching documents found before `docs` was capped. */
  total: z.number().int(),
  truncated: z.boolean(),
  status: ProjectDocListStatus,
  /**
   * Why the status is not `ok`, in words — null exactly when it is. Free text
   * rather than an enum because the one case the requirement names it for is
   * "the repository has no local clone", where the value of the field is that
   * it names the missing thing.
   */
  reason: z.string().nullable(),
});
export type ProjectDocList = z.infer<typeof ProjectDocList>;

/**
 * One document attached to an owner — an agent or a skill.
 *
 * An attachment is unique per (owner, repository, path): the same document may
 * hang off several owners, off any one owner exactly once, and `order` is its
 * position within that owner. The repository is part of the identity because an
 * owner may hold a different set per repository, and a run only ever sees the
 * set matching the pull request's repository. The owner itself is not a field —
 * it is whatever the route addressed.
 */
export const ContextAttachment = z.object({
  repo_id: z.string(),
  /** Repo-relative to that repository's clone root. */
  path: z.string(),
  order: z.number().int(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/**
 * Body of the write that sets an owner's attachments: the COMPLETE ordered list
 * for one repository, not an add/remove delta.
 *
 * Two consequences a caller must honour. Toggling one document sends every path
 * that is still attached, in order — sending only the toggled one detaches
 * everything else, silently and successfully. And the write is scoped to
 * `repo_id`: rows the owner holds against its OTHER repositories are left
 * alone, because the screen that sends this is open on one repository and can
 * neither show nor intend the set it would otherwise erase.
 *
 * `repo_id` is validated as a uuid here rather than left a bare string: it is
 * client-supplied and reaches a `repos.id` comparison, where a malformed value
 * is a database type error rather than the `404 not_found` the caller deserves.
 */
export const ContextAttachmentInput = z.object({
  /** The repository whose attachment rows this array replaces, in full. */
  repo_id: z.string().uuid(),
  /** Ordered, repo-relative. Empty detaches everything for that repository. */
  paths: z.array(z.string().min(1)),
});
export type ContextAttachmentInput = z.infer<typeof ContextAttachmentInput>;

/**
 * Where a document in an agent's effective set came from.
 *
 * A discriminated union rather than a nullable skill id, because the two cases
 * are rendered differently and the difference is a rule, not a decoration: a row
 * inherited from a skill is labelled with that skill and offers neither a detach
 * control nor a drag handle, while the agent's own row offers both. A nullable
 * id invites a caller to render the absence as "unknown".
 */
export const ContextDocSource = z.discriminatedUnion('kind', [
  /** Attached to the agent directly. */
  z.object({ kind: z.literal('agent') }),
  z.object({
    kind: z.literal('skill'),
    skill_id: z.string(),
    /** Carried so the row can name its skill without a second lookup. */
    skill_name: z.string(),
  }),
]);
export type ContextDocSource = z.infer<typeof ContextDocSource>;

/**
 * One document of an agent's effective set, after its own attachments and those
 * of its enabled skills have been merged.
 *
 * The merge is: the agent's own in their order, then each ENABLED skill's in
 * skill-link order and, within a skill, in that skill's attachment order —
 * deduplicated by path with the first occurrence winning. So a document attached
 * both directly and through two skills appears once, at the agent's position,
 * with `source` naming the agent. `order` is the position in that merged
 * sequence, which is also the order the assembled prompt carries.
 */
export const EffectiveContextDoc = z.object({
  path: z.string(),
  source: ContextDocSource,
  order: z.number().int(),
});
export type EffectiveContextDoc = z.infer<typeof EffectiveContextDoc>;
