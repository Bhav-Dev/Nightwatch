/**
 * The nightly job behind an HTTP endpoint, for Supabase where pg_cron + pg_net call an Edge
 * function. Protected by a shared secret header, since the function is reachable publicly.
 */
import type { Clock } from '../clock.ts';
import { timingSafeEqual } from '../crypto.ts';
import type { Sql } from '../db/sql.ts';
import { runAggregation } from './aggregateJob.ts';

export const AGGREGATE_SECRET_HEADER = 'x-aggregate-secret';

export function createAggregateHandler(deps: { sql: Sql; clock: Clock; secret: string | null }) {
  return async (req: Request): Promise<Response> => {
    const error = (status: number, code: string, message: string) =>
      Response.json({ error: { code, message } }, { status });
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Use POST.');
    const given = req.headers.get(AGGREGATE_SECRET_HEADER) ?? '';
    if (!deps.secret || !timingSafeEqual(given, deps.secret)) return error(401, 'unauthorized', 'Wrong or missing secret.');

    let excludeDates: string[] = [];
    const text = await req.text();
    if (text.trim()) {
      try {
        const body = JSON.parse(text) as { exclude_dates?: unknown };
        if (body.exclude_dates !== undefined) {
          if (!Array.isArray(body.exclude_dates) || !body.exclude_dates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
            return error(400, 'invalid_request', 'exclude_dates must be a list of yyyy-mm-dd dates.');
          }
          excludeDates = body.exclude_dates as string[];
        }
      } catch {
        return error(400, 'invalid_json', 'Body must be JSON.');
      }
    }
    try {
      const result = await runAggregation(deps.sql, deps.clock, { excludeDates });
      return Response.json(result, { status: result.ok ? 200 : 500 });
    } catch (err) {
      console.error(err);
      return error(500, 'internal', err instanceof Error ? err.message : 'Aggregation failed.');
    }
  };
}
