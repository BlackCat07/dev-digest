/* run-trace-drawer — the Run Trace + Live Log drawer, relocated here from
   `app/repos/[repoId]/pulls/[number]/_components/` because a second route
   subtree (the multi-agent results view) mounts the same drawer. A unit two
   route subtrees share must not sit below one of them, or the second reaches it
   only by an upward cross-route import.

   Public surface: the component (as the default export it has always had, and
   under its own name) plus its props type. Everything else in this folder —
   `constants.ts`, `helpers.ts`, `styles.ts` and the `_components/` children —
   is internal and is not re-exported.

   Named exports, never `export *`: this barrel is the unit's public API, and
   the line between "reusable" and "internal" is the thing being stated. */
export { default, default as RunTraceDrawer } from "./RunTraceDrawer";
export type { RunTraceDrawerProps } from "./RunTraceDrawer";
