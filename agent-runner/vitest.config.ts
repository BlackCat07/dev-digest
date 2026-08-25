import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Same aliases tsconfig.json declares. An alias added to one only and not
      // the other type-checks and then fails at test runtime.
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
