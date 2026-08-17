import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * mcp-server — a local stdio MCP server over the DevDigest HTTP API.
 *
 * Shaped after `reviewer-core/eslint.config.js` (same npm-managed toolchain,
 * same type-aware setup), plus the one rule this package lives or dies by:
 * **stdout is the JSON-RPC transport**. A single stray byte on stdout corrupts
 * the protocol frame and the client drops the connection, so `console.*` is an
 * error everywhere (tests included) and `process.stdout` is reachable only from
 * `src/log.ts` (the one writer) and `src/index.ts` (the composition root).
 *
 * Neither rule can be complete on its own: eslint sees only this package's own
 * source, so a dependency logging at import time gets past it. That hole is
 * closed at runtime by `redirectConsoleToStderr()` in `src/log.ts`.
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
      // Real but cosmetic; warn, matching server/ and reviewer-core/.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // HTTP responses arrive untyped and are parsed at the boundary; the parse
      // sites are where these fire. Visible, not blocking.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      // stdout is the protocol channel. Nothing writes to it but the transport.
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'stdout',
          message:
            'stdout carries the MCP JSON-RPC frames. Log through `logger` from src/log.ts (stderr) instead.',
        },
      ],
    },
  },

  {
    // The two files allowed to name a stream: the logger that owns stderr, and
    // the composition root that hands stdout to StdioServerTransport.
    files: ['src/log.ts', 'src/index.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    files: ['test/**'],
    rules: {
      // `no-console` stays ON here on purpose: a debug print left in a test is
      // exactly the byte that breaks a stdio handshake somewhere else.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  { files: ['*.js', '*.mjs'], ...tseslint.configs.disableTypeChecked },
);
