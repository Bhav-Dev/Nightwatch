import { describe, expect, it } from 'vitest';

import { PgRateLimiter } from '../src/rateLimit.ts';
import { night } from './fixtures.ts';
import { harness } from './helpers.ts';

describe('rate limits', () => {
  it('counts fixed hourly windows in Postgres', async () => {
    const h = await harness();
    const limiter = new PgRateLimiter(h.sql, h.clock);
    h.clock.t = new Date('2026-10-14T04:59:00Z');
    expect(await limiter.hit('k', 2, 3600)).toEqual({ allowed: true, retryAfterS: 60 });
    expect((await limiter.hit('k', 2, 3600)).allowed).toBe(true);
    expect(await limiter.hit('k', 2, 3600)).toEqual({ allowed: false, retryAfterS: 60 });
    h.clock.advance(60_000);
    expect((await limiter.hit('k', 2, 3600)).allowed).toBe(true);
  });

  it('allows 60 syncs an hour per device', async () => {
    const h = await harness();
    h.deps.rateLimiter = new PgRateLimiter(h.sql, h.clock);
    const { token } = await h.user();
    const body = { device_id: 'phone', nights: [night()] };
    for (let i = 0; i < 60; i++) expect((await h.call('POST', '/v1/sync/nights', { token, body })).status).toBe(200);
    const over = await h.call('POST', '/v1/sync/nights', { token, body });
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBeTruthy();
    expect((await h.call('POST', '/v1/sync/nights', { token, body: { ...body, device_id: 'tablet' } })).status).toBe(200);
  });

  it('allows 120 aggregate reads an hour per user', async () => {
    const h = await harness();
    h.deps.rateLimiter = new PgRateLimiter(h.sql, h.clock);
    const { token } = await h.user();
    for (let i = 0; i < 120; i++) expect((await h.call('GET', '/v1/aggregates', { token })).status).toBe(200);
    expect((await h.call('GET', '/v1/aggregates/side_sleeping', { token })).status).toBe(429);
    const other = await h.user();
    expect((await h.call('GET', '/v1/aggregates', { token: other.token })).status).toBe(200);
  });
});
