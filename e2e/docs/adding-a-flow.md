# Adding a flow

The procedure, and the two things about this harness that are easy to learn the hard way.
For what a flow *is* — the JSON shape, the locator reference — read
[`../README.md`](../README.md) first.

## Before you write anything: can this be a unit test?

A flow costs ~seconds of real browser time and can only assert what is **visible**. Reach
for one when the value is in the wiring — routes, tabs, a click reaching real data through
the real API. Leave semantics to `client`'s vitest suite: filtering logic, empty states,
error branches.

Flow `04` is the worked example of that split. It clicks the severity filter and asserts the
CRITICAL finding is still there — the *mechanics*. It cannot assert that the WARNING finding
**disappeared**, so `FindingsPanel.test.tsx` covers the semantics.

## The constraint that decides your assertions

**Every locator this harness has is positive.** `wait --text`, `wait --url`,
`find role|text|label` all assert *presence*. There is no "assert absent", so:

- "X is shown after clicking" → expressible.
- "Y is hidden after clicking" → **not expressible**. Assert the positive complement
  instead (clear the filter, then wait for `Y` to come back — flow `04`'s last two steps),
  and cover the disappearance in a unit test.

Write the flow around that from the start rather than discovering it at step 12.

## Steps

### 1. Name the file

`specs/NN-name.flow.json`. **Filenames run in lexical order**, and the number is the only
thing that orders them — pick the next free `NN`. Flows share one browser session, so a flow
inherits whatever page the previous one left behind; do not rely on that, start with an
`open`.

### 2. Write the flow

```json
{
  "name": "one line, shown in the pass/fail summary",
  "description": "why this flow exists, what it covers, what it deliberately does NOT",
  "steps": [
    { "cmd": ["open", "{BASE}/"], "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"], "label": "land on the PR list" }
  ]
}
```

- `cmd` is passed **verbatim** to the `agent-browser` CLI. `{BASE}` in any arg is replaced
  with `E2E_BASE_URL` (trailing slash trimmed).
- `label` is what a failure prints — write it as the thing that was supposed to happen, not
  the command. `"the WARNING finding returns once the filter is cleared"` beats
  `"wait --text N+1"`.
- `description` is the only place the flow's *reasoning* survives. Say what it asserts, what
  it can't, and which unit test covers the rest. Flow `04`'s description is the model.
- Optional `"assert": { "stdoutIncludes": "…" }` adds a substring check on the command's
  stdout, on top of its exit code.

### 3. Keep it read-only

Flows target the seeded demo data — repo `acme/payments-api`, PR #482, the seeded agents —
so nothing triggers a model call and no API key is needed. A flow that starts a review would
spend money and stop being deterministic.

### 4. Verify

```sh
npm run e2e:hermetic
```

**Not `npm test`.** The hermetic script boots an isolated, freshly-seeded stack on alternate
ports; `npm test` runs against whatever stack is already up. Flows `02`/`04`/`05` follow the
home redirect to the **first** repo, so against your dev DB — which has other imported repos
— they land on the wrong one and fail. That failure is the DB, not your flow.

### 5. When it fails

A failing step prints the `agent-browser` stderr, not a diff. Two moves:

- re-run that one `cmd` by hand from `e2e/`;
- flip `agent-browser.json` to `"headed": true` and watch it.

A `wait` that never resolves fails on timeout (`E2E_STEP_TIMEOUT`, default 60s), which looks
identical to "the element is named something else". Check the name first.

## Checklist

- [ ] Next free `NN-` prefix; starts with its own `open`.
- [ ] Deterministic locators only — never the AI `chat` command.
- [ ] Every assertion is a `wait`, and every assertion is positive.
- [ ] Read-only against the seeded data.
- [ ] `description` states what it covers *and* what it leaves to unit tests.
- [ ] Labels read as intentions.
- [ ] Green under `npm run e2e:hermetic`.
- [ ] If the UI text it waits on is i18n, the string still exists in
      `client/messages/en/` — a renamed message silently breaks the flow.
