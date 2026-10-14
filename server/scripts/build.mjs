// Bundles the Node entry points into dist/ (VPS). Dependencies stay in node_modules
// (`npm ci --omit=dev`); only our code and ../shared are bundled.
import { build } from 'esbuild';

await build({
  entryPoints: {
    node: 'src/node.ts',
    aggregate: 'src/jobs/aggregate.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
