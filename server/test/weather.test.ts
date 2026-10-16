import { describe, expect, it } from 'vitest';

import { PgRateLimiter } from '../src/rateLimit.ts';
import { MET_URL, simplifyForecast } from '../src/weather.ts';
import { harness } from './helpers.ts';

/** A MET Norway compact response with a few hours. */
function metBody(firstHour = '2026-10-14T04:00:00Z', temp = 9.5) {
  const start = Date.parse(firstHour);
  return {
    properties: {
      meta: { updated_at: '2026-10-14T03:30:00Z' },
      timeseries: Array.from({ length: 60 }, (_, i) => ({
        time: new Date(start + i * 3600_000).toISOString().replace('.000', ''),
        data: {
          instant: { details: { air_temperature: temp + i * 0.1, relative_humidity: 82, cloud_area_fraction: 90 } },
          next_1_hours: { summary: { symbol_code: 'lightrain' }, details: { precipitation_amount: 0.4 } },
        },
      })),
    },
  };
}

/** Records every upstream call and answers from a queue of responses. */
function fakeMet(...responses: (() => Response)[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('unexpected upstream call');
    return next();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const ok = (body: unknown, expires: string, lastModified = 'Wed, 14 Oct 2026 03:30:00 GMT') => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { Expires: expires, 'Last-Modified': lastModified, 'Content-Type': 'application/json' } });

describe('weather', () => {
  it('asks MET Norway once per area, identified, with the position rounded', async () => {
    const met = fakeMet(ok(metBody(), 'Wed, 14 Oct 2026 04:30:00 GMT'));
    const h = await harness({ fetch: met.fetch });
    const a = await h.call('GET', '/v1/weather?lat=51.50735&lon=-0.12776');
    expect(a.status).toBe(200);
    expect(a.body.area).toEqual({ lat: 51.5, lon: -0.1 });
    expect(a.body.hours).toHaveLength(48);
    expect(a.body.hours[0]).toEqual({ time: '2026-10-14T04:00:00Z', tempC: 9.5, humidity: 82, cloud: 90, precipMm: 0.4, symbol: 'lightrain' });
    expect(a.body.attribution).toMatch(/MET Norway/);
    expect(met.calls[0].url).toBe(`${MET_URL}?lat=51.5&lon=-0.1`);
    expect(met.calls[0].headers['User-Agent']).toBe('Nightwatch/1.0 tests@example.com');

    // A neighbour in the same area, before the forecast expires: no second upstream call.
    const b = await h.call('GET', '/v1/weather?lat=51.52&lon=-0.08');
    expect(b.status).toBe(200);
    expect(met.calls).toHaveLength(1);
  });

  it('revalidates an expired forecast and keeps it when MET says it has not changed', async () => {
    const met = fakeMet(ok(metBody(), 'Wed, 14 Oct 2026 04:30:00 GMT'), () => new Response(null, { status: 304, headers: { Expires: 'Wed, 14 Oct 2026 05:30:00 GMT' } }));
    const h = await harness({ fetch: met.fetch });
    await h.call('GET', '/v1/weather?lat=59.91&lon=10.75');
    h.clock.advance(45 * 60_000);
    const again = await h.call('GET', '/v1/weather?lat=59.91&lon=10.75');
    expect(again.status).toBe(200);
    expect(again.body.hours[0].tempC).toBe(9.5);
    expect(met.calls[1].headers['If-Modified-Since']).toBe('Wed, 14 Oct 2026 03:30:00 GMT');
  });

  it('serves an old forecast when MET fails, and an error when there is none', async () => {
    const met = fakeMet(
      ok(metBody(), 'Wed, 14 Oct 2026 04:30:00 GMT'),
      () => new Response('down', { status: 503 }),
      () => {
        throw new Error('network');
      },
    );
    const h = await harness({ fetch: met.fetch });
    await h.call('GET', '/v1/weather?lat=40.71&lon=-74.0');
    h.clock.advance(2 * 3600_000);
    expect((await h.call('GET', '/v1/weather?lat=40.71&lon=-74.0')).status).toBe(200);
    const none = await h.call('GET', '/v1/weather?lat=-33.87&lon=151.21');
    expect(none.status).toBe(502);
    expect(none.body.error.code).toBe('weather_unavailable');
  });

  it('needs a valid position, and no sign-in', async () => {
    const h = await harness({ fetch: fakeMet().fetch });
    expect((await h.call('GET', '/v1/weather?lat=abc&lon=1')).status).toBe(400);
    expect((await h.call('GET', '/v1/weather?lat=91&lon=1')).status).toBe(400);
  });

  it('limits requests per device', async () => {
    const h = await harness({ fetch: fakeMet(ok(metBody(), 'Wed, 14 Oct 2026 04:30:00 GMT')).fetch });
    h.deps.rateLimiter = new PgRateLimiter(h.sql, h.clock);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await h.call('GET', '/v1/weather?lat=10&lon=10', { headers: { 'x-forwarded-for': '203.0.113.7' } })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('asks MET for new areas at no more than two a second in total', async () => {
    const responses = Array.from({ length: 3 }, () => ok(metBody(), 'Wed, 14 Oct 2026 04:30:00 GMT'));
    const h = await harness({ fetch: fakeMet(...responses).fetch });
    h.deps.rateLimiter = new PgRateLimiter(h.sql, h.clock);
    const at = (lat: number) => h.call('GET', `/v1/weather?lat=${lat}&lon=10`, { headers: { 'x-forwarded-for': `198.51.100.${lat}` } });
    expect((await at(1)).status).toBe(200);
    expect((await at(2)).status).toBe(200);
    const third = await at(3);
    expect(third.status).toBe(503);
    expect(third.body.error.code).toBe('weather_busy');
    h.clock.advance(1000);
    expect((await at(3)).status).toBe(200);
  });

  it('keeps 48 hours and tolerates missing values', () => {
    const body = simplifyForecast({ properties: { timeseries: [{ time: '2026-10-14T04:00:00Z', data: { instant: { details: {} } } }] } }, { lat: 1, lon: 2 });
    expect(body.hours).toEqual([{ time: '2026-10-14T04:00:00Z', tempC: null, humidity: null, cloud: null, precipMm: null, symbol: null }]);
    expect(body.updatedAt).toBeNull();
  });
});
