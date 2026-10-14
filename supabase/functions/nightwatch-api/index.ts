/**
 * Supabase Edge entry point for the HTTP API (Deno). The app is the same code the VPS runs;
 * only the wiring differs.
 *
 * Built for a shared Supabase project:
 * - the function is named nightwatch-api so it cannot clash with another app's functions, and
 *   Supabase serves it under /nightwatch-api/, hence the default API_BASE_PATH, giving
 *   https://<ref>.supabase.co/functions/v1/nightwatch-api/v1/...;
 * - only NIGHTWATCH_-prefixed secrets are read (secrets are project-wide);
 * - the database connection must be the nightwatch_app role; Supabase's own SUPABASE_DB_URL
 *   (the project owner) is deliberately not used, and the schema check refuses to start on
 *   anything that would resolve tables outside the nightwatch schema.
 *
 * Not run in this repo's CI (no Deno there); see server/README.md.
 */
import { createApp } from '../../../server/src/app.ts';
import { postgresSql } from '../../../server/src/db/postgres.ts';
import { assertSchema, schemaFromEnv } from '../../../server/src/db/schema.ts';
import { depsFromEnv } from '../../../server/src/env.ts';
import { scopedEnv } from '../../../server/src/scopedEnv.ts';

// Typed here so the file also passes a Node TypeScript check, which has no Deno globals.
declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Response | Promise<Response>): unknown };

const env: Record<string, string | undefined> = { API_BASE_PATH: '/nightwatch-api', ...scopedEnv(Deno.env.toObject()) };
if (!env.DATABASE_URL) throw new Error('NIGHTWATCH_DATABASE_URL must be set (the nightwatch_app role, via the transaction pooler)');
// Transaction pooler (port 6543) for many concurrent isolates; it needs prepared statements off.
const sql = postgresSql(env.DATABASE_URL, { max: 1, prepare: false });
await assertSchema(sql, schemaFromEnv(env));
const app = createApp(depsFromEnv(env, sql));

Deno.serve(app.fetch);
