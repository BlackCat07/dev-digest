/* diff-viewer — unified-diff viewer with optional inline GitHub comments.

   Public surface, in two tiers:

   1. `DiffViewer` + `DiffCommentApi` — the whole thing, for a caller that wants a
      flat list of files. `DiffTab` uses this as its degradation path.
   2. The COMPOSITION KIT below, added for L03b's Smart Diff, which needs the same
      rendering under its own grouped, findings-aware file card.

   The second tier is deliberately narrow and deliberately feature-agnostic. It
   exports the parser, the line renderer, the style helpers and the annotation
   partitioner — everything needed to build a different file card — but NOT
   `FileCard` itself, because that component's disclosure state and auto-expand
   rule are the parts Smart Diff replaces.

   Named exports, never `export *`: this barrel is a unit's public API, and the
   line between "reusable here" and "internal" is the thing being stated.

   The alternative was widening `FileCard` with role, summary, badge and per-line
   finding props and making its `open` controlled. That was rejected: it pushes a
   feature's concepts into a component two other callers share, and one of those
   callers is a smoke test asserting the plain rendering. `CodeLine` is shared
   instead — see its three optional props — so inline commenting cannot drift
   between the two file cards. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";

export { CodeLine } from "./CodeLine";
export { OutdatedComments } from "./OutdatedComments";
export { parsePatch, type Line } from "./helpers";
export { AUTO_EXPAND_MAX_LINES } from "./constants";
export { s as diffStyles, chevronFor, lineRowFor, lineSignFor } from "./styles";
export {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
} from "./comments";
