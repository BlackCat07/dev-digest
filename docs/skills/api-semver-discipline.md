# Semver discipline for a published contract

A change to a published contract has to be visible in the version. Flag a diff
that makes a breaking change without saying so.

Which bump a change demands:

- **Major** — a removal, a rename, a new required field or parameter, a changed
  type, a changed default, a changed status code, or a narrowed accepted input.
- **Minor** — new optional surface: an added endpoint, an added optional field,
  a widened accepted input.
- **Patch** — behaviour unchanged from a caller's point of view.

Then check whether the diff carries it. The version lives in `package.json`,
and the human-readable record in a changelog; a breaking change with neither
touched in the same diff is the finding. Cite the `file:line` of the breaking
change itself, and state which bump it demands and what the diff actually did.

Do not speculate about a version file you were not shown — if the diff does not
include one, say that the bump could not be verified rather than asserting it is
missing.
