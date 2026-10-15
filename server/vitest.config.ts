import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Compile everything, shared/ included, with this tsconfig. Otherwise files in shared/ pick up the
  // app's root tsconfig, which extends expo/tsconfig.base and needs the app's packages installed.
  tsconfig: './tsconfig.json',
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM Postgres per file; the aggregation suite seeds 500 contributors.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
