# Metrics — what each number means, and where it lies

Every field `scan.mjs` emits, what it measures, and the reading that would be wrong.
Read the relevant row before quoting a number in a report.

## Size

| Field | Measures | Reads wrong as |
|---|---|---|
| `selfBytes` | Files in the package's own directory, excluding any nested `node_modules` | "what this dependency costs" — it is the tip only. `@modelcontextprotocol/sdk` is 4.2 MB self and 14.0 MB with its 92 transitive packages. |
| `closureBytes` | `selfBytes` of the package plus every package reachable through `dependencies` + `optionalDependencies`, deduplicated by real path | "what removing it saves" — see **Closures overlap** below. |
| `transitiveCount` | Packages in that closure, minus the package itself | — |
| `installedBytes` | Deduplicated union closure of **all** the package's direct deps | "disk usage of `node_modules/`" — close, but it excludes files no dependency claims (`.bin`, pnpm's `.modules.yaml`). Measured: 1.46 GB across the six packages against 1.53 GB by `du`. |

### Closures overlap — the one that produces a wrong recommendation

Closure sizes **do not add up**. Two dependencies that both pull in `esbuild` each
report its bytes. Sum a column of them and you get a number larger than the disk.

The consequence that matters: **`closureBytes` is an upper bound on what a removal
saves, not the saving.** Remove a 49 MB dependency whose closure it shares with
another and disk may barely move. When a P1 item claims a byte saving, the honest
figure is the difference between two `installedBytes` runs, and if that has not been
measured the item says *up to* N MB.

### Why not `du`

`du -sk` on a pnpm dependency reports **0**. Every top-level entry in a pnpm
`node_modules` is a symlink into `.pnpm/`, and `du` does not follow symlinks.
`du -skL` does follow, but has no portable `--exclude` on macOS/BSD, so it
double-counts npm's occasional nested `node_modules`. This repo runs both managers,
so neither invocation is correct everywhere. `scan.mjs` walks in JS instead: skip any
directory named `node_modules`, never follow a symlink, cache by resolved path. The
whole repo takes about 2 seconds.

### What the byte counts are not

Not bundle size. `selfBytes` counts everything in the published tarball — ESM and CJS
builds, source maps, TypeScript sources, the README. A 3.5 MB `zod` contributes a
fraction of that to a browser bundle after tree-shaking and minification. **Install
weight and shipped weight are different measurements**, and only `client/`'s
`dependencies` have a shipped weight at all. For that number, build and read
`.next/analyze` or the build output — this scanner cannot tell you.

## Usage

| Field | Measures | Reads wrong as |
|---|---|---|
| `importedInFiles` | Files matching a loose import/require regex, product **and** test | "how much we use it". A single import in a barrel that re-exports to forty callers counts as one file. |
| `referencedInConfig` | Name appears in a `scripts` value or a root config file | — |
| `hasBin` | Package declares a `bin` | — |
| `frameworkRuntime` | On the known list of packages a framework loads for you | — |
| `undeclared` | Line-anchored import in a **non-test** file, of a package no `dependencies` block declares | — |
| `unusedCandidates` | Declared, zero imports, no config reference, no bin, not `@types/*`, not a framework runtime | **"unused"**. It is a candidate. Step 4 of the skill exists because three candidates on this tree had three different correct answers. |

### The two regexes, and why there are two

A loose regex over everything answers *is this used at all* and tolerates false
positives, because a false positive there only fails to flag something.

The undeclared check accuses a package of a missing dependency, so a false positive
there wastes a reader's time and costs the report credibility. It uses a
line-anchored regex over non-test files only. The reason is specific to this repo:
whole source files are embedded in prompt templates and eval fixtures as string
literals, and the loose regex duly reports `react` imported by `server/` and
`fastify` by `evals/` — quoted example code, not edges.

**A quiet check is the design.** `undeclared` reporting nothing on a clean tree is
the expected state. If it ever fires, it is worth a look.

### What no static scan can see

`server/src/adapters/codeindex/ripgrep.ts:33` reads:

```ts
const mod = (await import(/* @vite-ignore */ '@vscode/ripgrep' as string)) as { rgPath?: string };
```

A dynamic import whose specifier is cast to `string` is deliberately opaque — that is
the point of the cast. No regex, and no bundler either, resolves it. This is why the
skill requires a `grep -ran "import("` pass before any removal recommendation, and why
`@vscode/ripgrep` is a permanent entry on the report's *Deliberately not recommended* list.

`grep` needs `-a`. Two source files in `server/src/modules/` contain a NUL byte, so
`grep` treats them as binary and reports nothing — a clean result from a file that was
never read (`server/INSIGHTS.md`, 2026-08-19).

## Cross-package

| Field | Measures | Reads wrong as |
|---|---|---|
| `versionDrift` | One dependency name installed at 2+ versions across the six packages | "duplication in a bundle". These are six separate installs by design — the packages are not a workspace. Drift on `@types/node` costs nothing at runtime; drift on a library with a runtime contract can cost a lot. **Split the two in the report.** |
| `sharedDeps` | Declared by 3+ packages | — |
| `aliases` | tsconfig `paths`, `crossPackage: true` when the target leaves the package | — |

The tsconfig aliases are the **only** representation of our internal architecture in
the dependency data. `server/` consumes `reviewer-core/` as **source** through
`@devdigest/reviewer-core`, with no build step and no entry in any `dependencies`
block — so every dependency tool in existence reports the two as unrelated. They are
not. The same holds for the two hand-synced `vendor/shared` copies, which are a
duplicated contract that appears nowhere in a dependency graph.
