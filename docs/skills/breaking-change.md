# Breaking change: a published contract is immutable by default

Every exported route, handler signature, and shared schema is a published
contract the moment anything outside its own file calls it. Flag a change in
this diff that an existing caller cannot survive without being edited.

What breaks a caller:

- A request field that became required, changed type, or disappeared.
- A route path, HTTP method, or success status code that changed.
- An exported function that gained a required parameter, lost one, or
  reordered them.
- A changed default, which silently alters behaviour for callers that omit
  the field.

**Bad** — an optional field becomes required in place; every existing client
that omits it now fails validation:

```ts
// before
assigneeId: z.string().uuid().optional(),
// after
assigneeId: z.string().uuid(),
```

**Good** — the same need served additively; old callers keep working:

```ts
assigneeId: z.string().uuid().optional(),
autoAssign: z.boolean().default(false),   // new capability, opt-in
```

Severity: a break whose every call site is updated in the same diff is a
SUGGESTION (note it and move on); with callers in this repository left stale it
is a WARNING; when the caller is outside this repository and cannot be updated
in lockstep, CRITICAL. Cite the `file:line` of the breaking line itself, and
name the caller that breaks — or say explicitly that no call site was visible
in the provided context.
