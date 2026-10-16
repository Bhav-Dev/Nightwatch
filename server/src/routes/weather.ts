import { Hono } from 'hono';

import type { AppEnv, Deps } from '../deps.ts';
import { badRequest } from '../errors.ts';
import { forecastFor } from '../weather.ts';
import { rateLimit } from './util.ts';

/** Requests per hour from one device: a phone needs this once or twice a night. */
export const WEATHER_PER_HOUR = 20;

/**
 * GET /v1/weather?lat=&lon=: public (weather is not personal), limited per device. The position
 * is rounded to the weather area before anything else touches it.
 */
export function weatherRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.get('/weather', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw badRequest('lat and lon are required, in degrees.', 'invalid_location');
    }
    const device = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    await rateLimit(deps, `weather:${device}`, WEATHER_PER_HOUR, 'Too many weather requests. Try again later.');
    return c.json(await forecastFor(deps, lat, lon), 200, { 'Cache-Control': 'public, max-age=900' });
  });
  return r;
}
