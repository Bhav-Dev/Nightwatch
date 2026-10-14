/**
 * Supabase Edge entry point for the HTTP API (Deno). The app is the same code the VPS runs;
 * only the wiring differs. Supabase serves this function under /api/, hence the default
 * API_BASE_PATH, giving https://<ref>.supabase.co/functions/v1/api/v1/...
 *
 * Not run in this repo's CI (no Deno there); see server/README.md.
 */
import { createApp } from '../../../server/src/app.ts';
import { postgresSql } from '../../../server/src/db/postgres.ts';
import { depsFromEnv } from '../../../server/src/env.ts';

// Typed here so the file also passes a Node TypeScript check, which has no Deno globals.
declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Response | Promise<Response>): unknown };

const env: Record<string, string | undefined> = { API_BASE_PATH: '/api', ...Deno.env.toObject() };
// SUPABASE_DB_URL is provided to every function. Use the transaction pooler (port 6543) in
// DATABASE_URL for many concurrent isolates; it needs prepared statements off.
const url = env.DATABASE_URL ?? env.SUPABASE_DB_URL;
if (!url) throw new Error('DATABASE_URL or SUPABASE_DB_URL must be set');
const sql = postgresSql(url, { max: 1, prepare: false });
const app = createApp(depsFromEnv(env, sql));

Deno.serve(app.fetch);
