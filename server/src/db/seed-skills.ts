import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Built-in skill bodies used by the seed (L02).
 *
 * A skill body is CONFIGURATION TEXT injected into a reviewing agent's prompt as
 * the "## Skills / rules" section — it is never executed and grants no
 * capability. Write them the way `docs/agent-prompts/README.md` says to write a
 * reviewer prompt: checkable statements, no JSON-shape instructions, no
 * alternate severity scale, no "return N findings" quota.
 *
 * The DB row is the source of truth at run time; editing a body here only
 * affects freshly seeded workspaces.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  enabled: boolean;
  body: string;
  evidenceFiles?: string[];
}

const PR_QUALITY_RUBRIC = `# PR Quality Rubric

Evaluate the pull request against the following dimensions. For each, return a
finding only when the issue is **worth the author's time** — aim for 5 high-signal
findings, not 50.

## Correctness
- Does the change do what the PR description claims?
- Are edge cases (empty input, nulls, concurrency) handled?

## Security
- Any secrets, tokens, or credentials in the diff?
- Untrusted input reaching a sink (SQL, shell, fetch)?

## Tests
- New branches covered by assertions?
- Are tests meaningful (not just snapshot churn)?

## Scope
- Does the diff stay within the stated intent?
- Flag out-of-scope changes separately rather than blocking.`;

const NO_THEN_CHAINS = `# House rule: async/await over .then() chains

This codebase uses \`async\`/\`await\` throughout. Flag a promise \`.then()\` /
\`.catch()\` chain added in the diff and show the \`await\` equivalent.

- A single \`.catch()\` attached to a fire-and-forget call is fine — say so rather
  than flagging it.
- \`Promise.all\` / \`Promise.allSettled\` are not chains; leave them alone.
- Severity is SUGGESTION unless the chain drops an error on the floor, which is a
  WARNING because the failure becomes invisible at runtime.`;

const SECRET_LEAKAGE_GATE = `# Secret leakage gate

Flag any credential material introduced by the diff.

- Provider key shapes: \`sk_live\`, \`sk-\`, \`service_role\`, \`ghp_\`, \`github_pat_\`,
  AWS \`AKIA\` ids, and any 32+ char high-entropy literal assigned to a name
  containing key/token/secret/password.
- A secret in a \`NEXT_PUBLIC_\` variable is CRITICAL regardless of its shape: that
  prefix ships the value to the browser bundle.
- A real value committed to \`.env.example\`, a test fixture, or a snapshot counts.
  "It is only a test key" is not a mitigation — rotate-ability is the point.
- A placeholder that is obviously not a credential (\`your-key-here\`, \`xxx\`) is not
  a finding.

Cite the exact file and line. Say what to do: remove the literal, read it from the
secrets provider, and rotate the exposed value.`;

const LETHAL_TRIFECTA = `# Lethal trifecta

Flag a change that brings all three of these together in one execution path:

1. **Private data access** — reads secrets, user records, or internal APIs.
2. **Untrusted input** — a PR body, issue text, web page, file, or model output
   reaches that path.
3. **An exfil path** — the result can leave: an outbound request, a webhook, a
   log line shipped off-box, a rendered link.

All three, in one path, is CRITICAL: untrusted text can steer the code into
sending private data somewhere the author did not intend.

Two of the three is at most a WARNING, and say which leg is missing. This
combination is rare — classify conservatively rather than labelling every fetch
call a trifecta.`;

const PHANTOM_API_GATE = `# Phantom API gate

Flag an import or call in the diff that names something which does not exist in
the resolved dependency tree or the repository.

- An import from a package that is not in \`package.json\`.
- A named import a package does not export, or one added in a version newer than
  the range the manifest pins.
- A method invented on a real object — the plausible-sounding one a model
  hallucinates.

Cite the import line and the symbol. If you cannot see the package's exports in
the provided context, say so and lower confidence rather than guessing.`;

const TEST_COVERAGE_NUDGE = `# Test coverage nudge

For each behavioural change in the diff, check the tests that ship with it.

- A new conditional branch, \`catch\`, early return, or \`switch\` arm with no test
  exercising it is a finding — name the branch and the input that reaches it.
- A test that only covers the happy path when the function has a documented
  failure mode is a finding: name the boundary that is untested (empty input,
  zero, a null, the limit, a duplicate, a concurrent second call).
- An assertion-free test — one that calls the code and asserts nothing, or only
  that it did not throw — does not count as coverage.
- Do not ask for a coverage percentage and do not ask for tests on pure renames,
  moves, or formatting.

Severity is SUGGESTION for a missing edge case, WARNING when the untested branch
is the error-handling path.`;

const EDGE_CASE_COVERAGE = `# Edge case coverage

For each function the diff adds or changes, work out its boundaries and check the
tests reach them.

- Empty and absent: \`[]\`, \`""\`, \`null\`, \`undefined\`, a missing optional field.
- Numeric edges: 0, negative, the exact limit, one past the limit, overflow.
- Collections: a single element, duplicates, an unsorted input where order matters.
- Time and ordering: a second call before the first resolves, a retry, an expired
  token, a clock that moved backwards.
- Failure: the dependency throws, times out, or returns a shape the code did not
  expect.

Name the specific boundary and the input that reaches it — "add edge case tests"
is not a finding. If a boundary is genuinely unreachable, say why instead of
reporting it.

Severity is SUGGESTION for a missing boundary on a pure function, WARNING when
the unhandled boundary can reach production data.`;

const MOCK_OVERUSE_GATE = `# Mock overuse gate

A test that mocks the thing it is testing asserts only that the mock was called.
Flag tests in the diff that verify their own scaffolding.

- The unit under test is itself mocked or stubbed.
- Every collaborator is mocked and the only assertions are \`toHaveBeenCalled\` /
  \`toHaveBeenCalledWith\` — the test would still pass if the implementation
  returned nothing.
- A mock hard-codes a response shape that no longer matches the real contract, so
  the test survives a breaking change.
- A pure function is mocked instead of being called.

Mocking the network, the clock, the filesystem and the LLM is correct and is NOT a
finding — this repo's own tests do exactly that.

Say which collaborator should be real, and what the test would then prove.
Severity is WARNING when the test cannot fail for the reason it exists.`;

const UNCOVERED_BRANCHES = `# Uncovered branches

Every branch the diff introduces should have a test that takes it.

- A new \`if\` / \`else\` / ternary / \`switch\` arm.
- An early return or a guard clause.
- A \`catch\`, and any error path that changes the response.
- A short-circuit that hides work: \`a && b()\`, \`x ?? fallback()\`.

For each uncovered branch name the file, the condition, and the input that would
enter it. Do not report a coverage percentage and do not ask for tests on renames,
moves or formatting.

Severity is SUGGESTION for a branch whose both sides are trivially safe, WARNING
when the untested branch is the error-handling path — that is the one that only
runs when something has already gone wrong.`;

const API_CONTRACT_GUARD = `# API contract guard

Treat every exported route, handler signature, and shared schema as a published
contract. Flag a change that breaks an existing caller.

- A route path, method, or status code that changed.
- A request field that became required, changed type, or was removed; a response
  field that was removed or renamed.
- A Zod schema in the shared contracts package whose existing symbol was reshaped
  rather than extended with a new one.
- A default that changed value, which silently alters behaviour for callers that
  omit the field.

For each, name the caller that breaks — the client hook, the test, the other
module — or say explicitly that you could not find one in the provided context.
A breaking change with a migration path in the same diff is a SUGGESTION; one
without is a WARNING, and CRITICAL when the caller is outside this repository and
cannot be updated in lockstep.`;

const API_ROUTE_REMOVAL = `# Breaking change: removed or reshaped public surface

An exported route, handler, or function is a published contract the moment
anything outside its own file calls it. Flag a change in this diff that would
break an existing caller.

What breaks a caller:

- A route path, HTTP method, or success status code that changed.
- An exported function whose parameter list gained a REQUIRED parameter, lost
  one, or reordered them. A new optional parameter at the end does not.
- An export that was removed or renamed, including a re-export from a barrel.
- A default value that changed, which silently alters behaviour for every caller
  that omits the field.

For each, name the call site that now breaks — the module, the test, the client
hook — and cite its \`file:line\` from the diff or the context you were given.

Two rules that keep this precise:

- A change that updates every call site in the same diff is **not** a break. Say
  so in one line and move on.
- If you cannot see a call site, say you could not find one rather than assuming
  there is none. The caller may live in a file this review was not given.

When a call site is left stale, the finding is the **stale call site**, not the
signature — that is where the failure happens and that is the line to cite.`;

const API_RESPONSE_SCHEMA = `# Breaking change: response shape

The shape of a response is part of the contract, and changing it breaks every
consumer that reads the old shape. Flag a change in this diff that alters what a
caller receives.

What counts as a change of shape:

- A field removed or renamed.
- A field whose type changed, including \`string\` to \`number\` and a scalar
  becoming an object or array.
- A field that became required, or a required one that became optional or
  nullable — both break someone, in opposite directions.
- A collection whose envelope changed: a bare array wrapped in an object, or an
  object flattened into an array.

**The strongest signal is disagreement.** When a declared schema and the code
that produces the response no longer describe the same object, that is the
finding — even when neither side looks wrong on its own. Compare the handler's
returned object against the schema, type, or contract it claims to satisfy, and
name both \`file:line\` positions: the one that declares the shape and the one
that produces it.

A response that gains a new optional field breaks nobody. Do not flag it.`;

const API_SEMVER_DISCIPLINE = `# Semver discipline for a published contract

A change to a published contract has to be visible in the version. Flag a diff
that makes a breaking change without saying so.

Which bump a change demands:

- **Major** — a removal, a rename, a new required field or parameter, a changed
  type, a changed default, a changed status code, or a narrowed accepted input.
- **Minor** — new optional surface: an added endpoint, an added optional field,
  a widened accepted input.
- **Patch** — behaviour unchanged from a caller's point of view.

Then check whether the diff carries it. The version lives in \`package.json\`,
and the human-readable record in a changelog; a breaking change with neither
touched in the same diff is the finding. Cite the \`file:line\` of the breaking
change itself, and state which bump it demands and what the diff actually did.

Do not speculate about a version file you were not shown — if the diff does not
include one, say that the bump could not be verified rather than asserting it is
missing.`;

const API_DEPRECATION_POLICY = `# Deprecate, do not silently remove

Removing or renaming public surface without a deprecation path turns a caller's
working code into a runtime or compile failure with no warning. Flag it.

What a deprecation looks like here:

- The old name survives as a thin wrapper that forwards to the new one.
- It is marked \`@deprecated\` with a JSDoc line naming the replacement.
- The removal is scheduled, not simultaneous — the wrapper goes in a later
  release, not this one.

So: a rename where the old name is gone from the diff **is** a silent removal,
however good the new name is. Cite the line the old name disappeared from, name
the replacement, and say what the forwarding wrapper would be.

Two things not to flag: surface that is internal to the module changing it, and
a name that already carries a \`@deprecated\` marker and is now being removed on
schedule — that is the policy working, not a violation of it.`;

/**
 * The seeded skill set. Mirrors the six skills in the product design, plus
 * `api-contract-guard`, which the API Contract reviewer needs to demonstrate the
 * with-skills / without-skills contrast.
 *
 * L02 adds three finer-grained API-contract skills alongside that guard. They
 * seed UNLINKED: the lesson's experiment is to attach them by hand in the agent
 * editor's Skills tab and watch a run change, which cannot be demonstrated if
 * the seed has already done it. The fourth of the set,
 * `api-semver-discipline`, is deliberately NOT seeded at all — it ships as
 * `docs/skills/api-semver-discipline.md` to be brought in through
 * `POST /skills/import`, so the import path is exercised on a real file and its
 * untrusted-wrapping is visible in the run trace.
 *
 * `phantom-api-gate` seeds DISABLED on purpose: the Skills page needs one row in
 * the disabled state for its dimmed-card treatment to be visible, and it is the
 * one skill here whose source is external.
 */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description:
      'Rubric for evaluating overall PR quality across correctness, tests, and clarity.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: PR_QUALITY_RUBRIC,
  },
  {
    name: 'no-then-chains',
    description: 'House rule: always use async/await instead of .then() chains.',
    type: 'convention',
    source: 'extracted',
    enabled: true,
    body: NO_THEN_CHAINS,
    evidenceFiles: ['src/api/users.ts', 'src/lib/redis.ts'],
  },
  {
    name: 'secret-leakage-gate',
    description: 'Detects sk_live, service_role, and NEXT_PUBLIC_ secret patterns in diffs.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: SECRET_LEAKAGE_GATE,
  },
  {
    name: 'lethal-trifecta',
    description: 'Flags PRs combining private data access, untrusted input, and an exfil path.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: LETHAL_TRIFECTA,
  },
  {
    name: 'phantom-api-gate',
    description: "Detects imports of functions/modules that don't exist in the resolved deps.",
    type: 'security',
    source: 'imported_url',
    enabled: false,
    body: PHANTOM_API_GATE,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Suggests tests when new branches lack assertions.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: TEST_COVERAGE_NUDGE,
  },
  {
    name: 'edge-case-coverage',
    description: 'Checks that tests reach the boundaries of each changed function.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: EDGE_CASE_COVERAGE,
  },
  {
    name: 'mock-overuse-gate',
    description: 'Flags tests that mock the thing under test and assert only on the mock.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: MOCK_OVERUSE_GATE,
  },
  {
    name: 'uncovered-branches',
    description: 'Names each branch the diff adds that no test takes.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: UNCOVERED_BRANCHES,
  },
  {
    name: 'api-contract-guard',
    description: 'Flags breaking changes to route signatures, shared schemas, and defaults.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: API_CONTRACT_GUARD,
  },
  {
    name: 'api-route-removal',
    description: 'Flags a removed, renamed or reshaped export and names the call site it breaks.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: API_ROUTE_REMOVAL,
  },
  {
    name: 'api-response-schema',
    description: 'Flags a response whose shape no longer matches the contract it claims.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: API_RESPONSE_SCHEMA,
  },
  {
    name: 'api-deprecation-policy',
    description: 'Flags a rename or removal with no forwarding wrapper and no @deprecated marker.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: API_DEPRECATION_POLICY,
  },
];

/**
 * The one skill of the L02 API-contract set that is NOT seeded.
 *
 * Exported so the file on disk and this text cannot drift: `docs/skills/` holds
 * the importable copy, and a test asserts the two are identical. Importing it
 * through the UI is a lesson step, and it is also the only way to see what the
 * import path really does — an imported body is recorded as external, starts
 * disabled, and is delimiter-wrapped as untrusted before it reaches a prompt.
 */
export const IMPORTABLE_SEMVER_SKILL = API_SEMVER_DISCIPLINE;
