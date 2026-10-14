import type { Clock } from './clock.ts';
import type { Sql } from './db/sql.ts';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends. */
  retryAfterS: number;
}

export interface RateLimiter {
  /** Counts one hit against `key` and says whether it is within `limit` per `windowS`. */
  hit(key: string, limit: number, windowS: number): Promise<RateLimitResult>;
}

/**
 * Fixed-window counters in Postgres. A table rather than memory because Edge functions keep
 * no state between requests; one upsert per hit is cheap. Old windows are removed by the
 * nightly job.
 */
export class PgRateLimiter implements RateLimiter {
  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
  ) {}

  async hit(key: string, limit: number, windowS: number): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const windowMs = windowS * 1000;
    const start = Math.floor(now / windowMs) * windowMs;
    const [row] = await this.sql.query<{ count: number }>(
      `INSERT INTO rate_limit (key, window_start, count) VALUES ($1, $2::timestamptz, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit.count + 1
       RETURNING count`,
      [key, new Date(start).toISOString()],
    );
    return { allowed: row.count <= limit, retryAfterS: Math.ceil((start + windowMs - now) / 1000) };
  }
}

/** For tests that are not about rate limiting. */
export const unlimited: RateLimiter = { hit: async () => ({ allowed: true, retryAfterS: 0 }) };
