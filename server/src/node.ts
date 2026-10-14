/**
 * VPS entry point: `node dist/node.js` (or `npm run dev`). Reads configuration from the
 * environment; see README for the variables.
 */
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { postgresSql } from './db/postgres.ts';
import { depsFromEnv } from './env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = postgresSql(url, {
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  prepare: process.env.DATABASE_PREPARE !== 'false',
});
const app = createApp(depsFromEnv(process.env, sql));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Nightwatch API listening on http://${info.address}:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void sql.close().then(() => process.exit(0));
  });
}
