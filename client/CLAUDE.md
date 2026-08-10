# client — `@devdigest/web`, Next.js 15 on :3000

Stack: Next 15 App Router · React 19 · TanStack Query · next-intl · Tailwind 4 (token
layer only, see Conventions) · vitest 2 + jsdom.

## Commands

```sh
pnpm dev · pnpm build · pnpm start
pnpm typecheck
pnpm test          # vitest + jsdom, fetch mocked — no API, no DB needed
```

## Map

```
src/app/                      routes; page.tsx is a thin entry, view lives in _components/
src/app/**/_components/<Name>/  colocated feature unit (see Conventions)
src/components/               cross-cutting chrome: app-shell (nav, breadcrumbs,
                              g-then-key shortcuts) · diff-viewer · mermaid-diagram
src/lib/api.ts                apiFetch + ApiError — the only place fetch is called
src/lib/hooks/*               TanStack Query hooks: core agents reviews trace repo-intel
src/lib/                      providers.tsx · theme.tsx · toast.tsx · repo-context.tsx
src/i18n/request.ts           next-intl setup · messages/en/<namespace>.json
src/vendor/ui/                @devdigest/ui — vendored design system + @theme tokens
src/vendor/shared/            @devdigest/shared — copy of server's contracts (see Do-not-touch)
src/test/setup.ts             jsdom shims
```

## Conventions

- **Routes are thin.** `page.tsx` awaits `params`, renders one view from `_components/`,
  and nothing else — every entry is 7–17 lines.
- **Do NOT wrap a view in `<Suspense>` just because it reads `useSearchParams()`.** That
  bailout rule applies to *statically* prerendered routes; every route here that reads search
  params is dynamic (`ƒ`, because of `[repoId]`/`[id]`), so the hook is free. Adding the
  boundary makes the server emit the fallback **instead of** the screen — a blank first paint.
  If a static route ever needs the hook, `next build` fails loudly and the boundary goes
  there.
- **Error and 404 boundaries are files, not page branches.** `app/error.tsx` catches render
  throws below the root layout, `app/global-error.tsx` catches the root layout itself (it
  replaces the layout, so it ships its own `<html>`/`<body>` and hard-coded colours — the one
  place the token/`styles.ts` rule cannot apply). A repo-scoped screen that finds no repo for
  `:repoId` calls `notFound()` and `app/repos/[repoId]/not-found.tsx` renders the copy for
  every screen below `/repos`. There are deliberately **no** per-segment `error.tsx` or
  `loading.tsx` files: with one root layout a segment boundary preserves nothing extra, and
  screen data is client-side (TanStack Query), so a `loading.tsx` would flash a second
  loader in front of the view's own skeleton.
- **Colocated feature unit** — every non-trivial component is a folder:
  `<Name>/{<Name>.tsx, index.ts, styles.ts, constants.ts, helpers.ts, <Name>.test.tsx}`.
  Import through the `index.ts` barrel, never the inner file. Nest deeper with a
  child `_components/`. Follow this shape for new components rather than a lone `.tsx`.
- **Styling is `styles.ts`, not utility classes.** Each unit exports `const s` of
  `CSSProperties` objects (values may be functions of props) built from CSS custom
  properties — `var(--border)`, `var(--bg-elevated)`, `var(--accent)`. Tailwind 4 *is*
  loaded (via `@import "tailwindcss"` + `@theme` in `src/vendor/ui/styles.css`), but
  feature components use these style objects. Don't convert either way.
  **Where inline `style={{…}}` is still fine** — the tree has ~85 of them and they are not
  85 violations: a one-off token pass-through on a vendor primitive
  (`<Icon.Shield style={{ color: "var(--crit)" }} />`), or a single throwaway property on a
  wrapper that owns no other styling. It stops being fine when the object describes
  **layout** (padding/flex/grid/max-width), when the same literal appears twice, or when it
  is passed to a memoised child — a new object every render defeats the memo. Those three
  belong in `styles.ts`; `global-error.tsx` is the one exemption, and says why in the file.
- **Never call `fetch` in a component.** Data goes through a hook in `src/lib/hooks/*`
  → `apiFetch`. `ApiError` carries `status`/`code` so the error UX can branch
  (toast vs inline vs full-screen); preserve that when adding endpoints.
- **UI text goes in `messages/en/<namespace>.json`** and is read via next-intl, not
  written as inline literals.
- Data hooks are `"use client"`, so most feature views are client components; the
  route entry stays a server component. Keep the boundary at the view, not deeper.

## Gotchas

- **`vitest.config.ts` duplicates the tsconfig path aliases** (`@`, `@devdigest/shared`,
  `@devdigest/ui`). Adding an alias to `tsconfig.json` alone typechecks but fails at
  test runtime — add it in both.
- **`src/vendor/shared` is a hand-made copy of `server/src/vendor/shared` and is behind**
  it (no `openrouter` in `LLMProvider.id`, no `sessionId`, no `CommitFile`). There is no
  sync script and no CI check, so a client/server type mismatch is usually this drift.
  Surface it; syncing is coordination-only.
- **`apiFetch` sets `content-type: application/json` only when a body is actually sent** —
  a body-less POST (refresh, reindex, generate) otherwise trips Fastify's "Body cannot be
  empty when content-type is application/json". Don't "simplify" that conditional.
- **`NEXT_PUBLIC_API_BASE` is inlined via `next.config.mjs` `env`** (default
  `http://localhost:3001`), so changing it needs a dev-server restart, not just a reload.
- `src/test/setup.ts` stubs `ResizeObserver` — recharts/mermaid need it under jsdom.
  A new chart component failing in tests usually wants a shim here, not a mock.
- **`messages/en/` carries namespaces no screen uses yet** (blast, eval, memory, skills,
  compose, ci, …). They belong to later lessons — not dead files to delete.

## Do not touch

- `src/vendor/ui/**` — vendored design system shared across screens. Extend via a new
  file; don't restyle a primitive to suit one feature.
- `src/vendor/shared/**` — mirror of the server's canonical contracts; coordination only.

## Deeper context

- UI route map + which API each route leans on, error-UX taxonomy → `README.md`
- Component/interaction test approach → `README.md#testing`, `../TESTING.md`
- Where a component folder goes, and the list-column invariant → `docs/feature-unit.md`
- Curated deep-dives → `docs/README.md`
- What a feature must do → `specs/README.md`
