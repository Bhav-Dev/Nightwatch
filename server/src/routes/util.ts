import type { Deps } from '../deps.ts';
import { HttpError } from '../errors.ts';

/** Counts a hit and throws 429 with Retry-After when over the limit. */
export async function rateLimit(deps: Deps, key: string, perHour: number, message: string): Promise<void> {
  const res = await deps.rateLimiter.hit(key, perHour, 3600);
  if (!res.allowed) {
    throw new HttpError(429, 'rate_limited', message, { 'Retry-After': String(res.retryAfterS) });
  }
}

/** Whether the user has the paid entitlement right now (a cancelled plan runs to expiry). */
export async function hasActiveSubscription(deps: Deps, userId: string): Promise<boolean> {
  const [row] = await deps.sql.query<{ active: boolean }>(
    `SELECT active AND (expires_at IS NULL OR expires_at > $2::timestamptz) AS active
     FROM subscription WHERE user_id = $1`,
    [userId, deps.clock.now().toISOString()],
  );
  return row?.active ?? false;
}

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();
