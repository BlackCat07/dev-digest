# Response schema: the shape of a reply is part of the contract

A client is coupled to the exact shape of a response — its envelope, its field
names, their types, and which of them are guaranteed present. Flag a change in
this diff that reshapes what an existing endpoint returns.

What counts as a reshape:

- The envelope changed — a bare array became a wrapped object, or the wrapper
  gained or lost a level.
- A field was removed or renamed, or its type changed.
- A field that was always present became optional or nullable.
- A status code that carried the body changed.

**Bad** — a list endpoint's reply changes from an array to an envelope; every
consumer that does `res.map(...)` breaks at runtime, not at the type-checker:

```ts
// before: GET /tasks -> Task[]
return rows
// after:  GET /tasks -> { data: Task[], meta: {...} }
return { data: rows, meta: buildListMeta(query, rows.length) }
```

**Good** — additive change that no existing consumer can observe breaking:

```ts
// every old field kept, new field optional
return rows.map((row) => ({ ...row, labels: row.labels ?? [] }))
```

If the response type is declared in a shared contract, check that the contract
changed in the same diff — a handler that returns a new shape while the
declared schema still promises the old one is the worst case: flag it as the
contract now lying to its consumers. Cite the `file:line` where the returned
shape changes; name the declared schema it diverges from when one is visible.
