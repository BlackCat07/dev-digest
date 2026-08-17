# Project map — the adapter

Everything else in this skill is project-neutral. This file is the one you edit when you copy
the skill into another product. Fill every row; an unfilled row is where an agent guesses.

| Question | This project |
|---|---|
| Design-system import | `import { Button, Card } from "@devdigest/ui"` — the single barrel, never a layer file. Alias in `client/tsconfig.json` **and** `client/vitest.config.ts` (both, or tests fail at runtime) |
| Stylesheet | `src/vendor/ui/styles.css`, imported once at the app root |
| Where the system lives | `client/src/vendor/ui/` — **do not edit**; extend by a new file |
| Where a feature component goes | colocated unit folder: `src/app/**/_components/<Name>/{<Name>.tsx, index.ts, styles.ts, constants.ts, helpers.ts, <Name>.test.tsx}`, imported through `index.ts`. Depth follows the route that renders it — details in `client/docs/feature-unit.md` |
| How styles are written | `styles.ts` exporting `const s` of `CSSProperties` objects (values may be functions of props), built from token `var(...)`. Tailwind 4 is loaded for the `@theme` token layer only — feature components do not use utility classes |
| Inline `style={{…}}` | fine for a one-off token pass-through on a vendor primitive or a single throwaway property; **not** for layout (padding/flex/grid/max-width), not for a literal used twice, not for a memoised child |
| Shared numbers | `constants.ts` next to the component (`GRID`, `COLUMN_KEYS`, `CONTROL_HEIGHT`, `CARD_GRID_COLS`); cross-route helpers in `src/lib/` |
| UI copy | **next-intl** — `messages/en/<namespace>.json`, read via `useTranslations("<namespace>")`. A feature gets its **own** namespace file; do not append to another feature's. No inline string literals |
| Data | a hook in `src/lib/hooks/*` → `src/lib/api.ts` (`apiFetch`). Never `fetch` in a component. `ApiError` carries `status`/`code` so the error UX can branch — `status: 0` means unreachable, which is the full-screen case |
| App frame | `src/components/app-shell` wraps the vendored `AppFrame`; the scroll container is an inner `<main style={{overflow:"auto"}}>`, **not** the window |
| Drift gate | `/showcase` renders every export in both themes; `src/test/smoke.test.tsx` mounts it, so a broken export fails CI. Add new system components to the showcase |
| Checks | `cd client && pnpm typecheck && pnpm test` (vitest + jsdom, fetch mocked) |
| Test notes | `@testing-library/user-event` is **not** a dependency — use `fireEvent`; `src/test/setup.ts` shims `ResizeObserver` and `scrollIntoView` |
| Journal | `client/INSIGHTS.md` — read before the work, append-only after it (the `engineering-insights` skill owns the procedure) |

## Precedence when skills disagree

1. This project's `CLAUDE.md` and the package's `CLAUDE.md`.
2. **This skill** for tokens, spacing, layout and screen composition.
3. `frontend-ui-architecture` for where a file goes; `react-best-practices` /
   `next-best-practices` for correctness.
4. General UI/UX skills (`ui-ux-pro-max`, `web-design-guidelines`) as **reviewers only** —
   accessibility, interaction and chart questions. They must not choose a palette, a font
   pairing or a visual style, and must not write a `design-system/` directory: that decision is
   already made and vendored here.

## Copying this skill to another product

1. Copy the whole folder into that repo's `.claude/skills/`.
2. Rewrite **this file** for that project. Keep the row list; change the answers.
3. If the product has no design system yet, start from `assets/tokens.css` (this copy ships it),
   then decide what the four domain-semantic slots mean in that domain before building a screen.
   **If the target already has the token layer, delete `assets/` from its copy** and say so in
   its `project-map.md` — a second copy of a token file is a thing that drifts.
4. Leave the rest untouched, so an improvement to a recipe can be carried across by copying one
   file.
