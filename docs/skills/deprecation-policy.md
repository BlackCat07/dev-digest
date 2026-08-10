# Deprecation policy: mark it obsolete, do not silently remove it

Public surface is retired in two steps — first deprecate, then remove in a
later major version. Flag a diff that removes or renames a published symbol,
route, or field in one step, with nothing left behind to carry existing
callers.

A correct retirement leaves, in the same diff:

- the old symbol still exported, forwarding to the new one;
- a deprecation marker on it (`@deprecated` JSDoc, or the framework's
  deprecation header on a route) naming the replacement;
- a changelog line saying when the removal will happen.

**Bad** — a rename that strands every caller at once:

```ts
// before
export async function listTasks(projectId: string) { ... }
// after — old name gone, callers break with no warning
export async function listTasksPaged(projectId: string, query: ListQuery) { ... }
```

**Good** — the same rename with a forwarding wrapper:

```ts
export async function listTasksPaged(projectId: string, query: ListQuery) { ... }

/** @deprecated Use listTasksPaged. Removed in v3. */
export async function listTasks(projectId: string) {
  return listTasksPaged(projectId, DEFAULT_LIST_QUERY)
}
```

Severity: removal or rename with no forwarding path is a WARNING, and CRITICAL
when callers outside this repository depend on it. A removal that the same
diff shows was already deprecated in a previous release is correct — say so
rather than flagging it. Cite the `file:line` of the removed or renamed
surface, and name the replacement the caller should move to.
