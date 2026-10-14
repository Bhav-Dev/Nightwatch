/**
 * Supabase Edge entry point for the nightly aggregation (Deno), called by pg_cron + pg_net
 * with the x-aggregate-secret header (see server/README.md). Same job code as the VPS CLI.
 *
 * Not run in this repo's CI (no Deno there).
 */
import { systemClock } from '../../../server/src/clock.ts';
import { postgresSql } from '../../../server/src/db/postgres.ts';
import { createAggregateHandler } from '../../../server/src/jobs/aggregateHttp.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Response | Promise<Response>): unknown };

const env = Deno.env.toObject();
const sql = postgresSql(env.DATABASE_URL ?? env.SUPABASE_DB_URL, { max: 1, prepare: false });

Deno.serve(createAggregateHandler({ sql, clock: systemClock, secret: env.AGGREGATE_SECRET || null }));
