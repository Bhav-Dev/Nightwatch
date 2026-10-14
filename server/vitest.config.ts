import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM Postgres per file; the aggregation suite seeds 500 contributors.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
