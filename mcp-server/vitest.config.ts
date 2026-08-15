import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@devdigest/shared` path mapping in tsconfig.json. Without
      // it the suite cannot resolve what `tsc` happily typechecks — the alias
      // points outside this package, at the canonical (read-only) contracts.
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
