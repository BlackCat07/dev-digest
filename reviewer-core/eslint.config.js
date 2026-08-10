import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * reviewer-core — the domain core (`diff → prompt → LLM → grounded findings`).
 *
 * Type-aware, because the one thing worth catching here is a dropped promise in
 * the review pipeline. The purity laws (no DB, no filesystem, no `process.env`)
 * are NOT enforced here — `server/.dependency-cruiser.cjs` owns them via the
 * `core-stays-pure` rule, which can see the whole import graph.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // An adapter implements an async port even when its body never awaits.
      '@typescript-eslint/require-await': 'off',
      // Real but cosmetic; a couple in the tests. Warn, matching server/.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // LLM output arrives untyped; law 7 says parse it, and the parse sites are
      // where these fire. Visible, not blocking.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
    },
  },

  {
    files: ['test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  { files: ['*.js', '*.mjs'], ...tseslint.configs.disableTypeChecked },
);
