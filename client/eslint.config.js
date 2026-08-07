import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * client — `@devdigest/web`.
 *
 * The rule that justifies this file existing: **react-hooks/exhaustive-deps**.
 * `tsc` cannot see a stale closure in a dependency array, and this app has 14
 * `useEffect`s across polling, hover panels and shortcut handlers.
 *
 * Deliberately NOT type-aware (no `projectService`): the value here is the
 * React/Next rule sets, and a type-aware pass over a Next app costs seconds per
 * run for rules `pnpm typecheck` already covers.
 */
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      // Vendored design system + hand-made copy of the server contracts.
      // Coordination-only (see client/CLAUDE.md "Do not touch") — not ours to lint.
      'src/vendor/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The tree has zero `any` today (measured) — keep it that way.
      '@typescript-eslint/no-explicit-any': 'error',

      // Accessibility: the icon-only-button and label rules catch exactly what
      // `react-best-practices` calls out. Warnings, because a wall of a11y errors
      // on day one gets the whole config disabled instead of fixed.
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/no-autofocus': 'warn',

      // Console in the browser ships to users' devtools; `console.error` is a
      // deliberate escape hatch for an error boundary.
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // WARN, with a burn-down list. This rule (react-hooks v6) flags the
      // derive-don't-store antipattern `react-best-practices` calls the #1 one,
      // and it currently fires in 7 places: theme.tsx and repo-context.tsx
      // (reading localStorage/DOM into state on mount), MermaidDiagram,
      // FindingsPanel, ReviewRunAccordion, ConfigTab, lib/hooks/reviews.ts.
      // Each is a real refactor with its own behaviour to preserve, so they are
      // visible rather than blocking. Fix them one at a time, then make it an error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // next.config.mjs and friends run in Node, not the browser.
  {
    files: ['*.mjs', '*.js', '*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests: RTL renders and fixtures are loosely typed on purpose.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  { files: ['*.js', '*.mjs', '*.cjs'], ...tseslint.configs.disableTypeChecked },
);
