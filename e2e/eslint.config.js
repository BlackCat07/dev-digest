import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * e2e — the deterministic browser harness (`run.ts` + `specs/*.flow.json`).
 *
 * Not type-aware: this package is two files and a JSON loader, and its failure
 * mode is a red flow, not a type error. The value here is catching an unused
 * binding or a typo in the harness before a CI run spends minutes on the stack.
 */
export default tseslint.config(
  { ignores: ['node_modules/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // The harness reports progress on stdout — that is its interface.
      'no-console': 'off',
    },
  },
);
