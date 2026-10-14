/**
 * Supabase Edge entry point for the nightly aggregation (Deno), called by pg_cron + pg_net
 * with the x-aggregate-secret header (see server/README.md). Same job code as the VPS CLI.
 * Reads only NIGHTWATCH_-prefixed secrets and refuses to run outside the nightwatch schema.
 *
 * Not run in this repo's CI (no Deno there).
 */
import { systemClock } from '../../../server/src/clock.ts';
import { postgresSql } from '../../../server/src/db/postgres.ts';
import { assertSchema, schemaFromEnv } from '../../../server/src/db/schema.ts';
import { createAggregateHandler } from '../../../server/src/jobs/aggregateHttp.ts';
import { scopedEnv } from '../../../server/src/scopedEnv.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Response | Promise<Response>): unknown };

const env = scopedEnv(Deno.env.toObject());
if (!env.DATABASE_URL) throw new Error('NIGHTWATCH_DATABASE_URL must be set (the nightwatch_app role)');
const sql = postgresSql(env.DATABASE_URL, { max: 1, prepare: false });
await assertSchema(sql, schemaFromEnv(env));

Deno.serve(createAggregateHandler({ sql, clock: systemClock, secret: env.AGGREGATE_SECRET || null }));
