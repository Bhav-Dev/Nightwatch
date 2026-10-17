import type { WeatherHour, WeatherResponse } from '../../shared/api.ts';
import { WEATHER_ATTRIBUTION, weatherArea, weatherAreaKey } from '../../shared/weather.ts';
import type { Deps } from './deps.ts';
import { HttpError } from './errors.ts';

/**
 * Forecasts from MET Norway's Locationforecast, cached per weather area. Their terms: identify
 * the app with a contact, cache until Expires, revalidate with If-Modified-Since, stay well under
 * 20 requests a second in total, and credit them (CC BY 4.0). Apps call this server, never MET
 * directly, so users' IP addresses and positions never reach MET.
 */
export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
/** Upstream requests per second across every instance; a tenth of MET's limit leaves room. */
export const UPSTREAM_PER_SECOND = 2;
/** Hours of forecast served: enough for a night and the next morning. */
export const FORECAST_HOURS = 48;
/** If MET sends no Expires header, keep a forecast this long. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

interface MetTimestep {
  time: string;
  data?: {
    instant?: { details?: { air_temperature?: number; relative_humidity?: number; cloud_area_fraction?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
}

interface MetResponse {
  properties?: { meta?: { updated_at?: string }; timeseries?: MetTimestep[] };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** MET's GeoJSON to the hourly series the app needs. */
export function simplifyForecast(raw: MetResponse, area: { lat: number; lon: number }): WeatherResponse {
  const hours: WeatherHour[] = (raw.properties?.timeseries ?? []).slice(0, FORECAST_HOURS).map((t) => ({
    time: t.time,
    tempC: num(t.data?.instant?.details?.air_temperature),
    humidity: num(t.data?.instant?.details?.relative_humidity),
    cloud: num(t.data?.instant?.details?.cloud_area_fraction),
    precipMm: num(t.data?.next_1_hours?.details?.precipitation_amount),
    symbol: t.data?.next_1_hours?.summary?.symbol_code ?? null,
  }));
  return { area, hours, updatedAt: raw.properties?.meta?.updated_at ?? null, attribution: WEATHER_ATTRIBUTION };
}

export async function forecastFor(deps: Deps, lat: number, lon: number): Promise<WeatherResponse> {
  const area = weatherArea(lat, lon);
  const key = weatherAreaKey(area);
  const now = deps.clock.now();
  const [cached] = await deps.sql.query<{ body: string; expires_at: Date | string; last_modified: string | null }>(
    'SELECT body, expires_at, last_modified FROM weather_cache WHERE area = $1',
    [key],
  );
  if (cached && new Date(cached.expires_at).getTime() > now.getTime()) return JSON.parse(cached.body) as WeatherResponse;

  // Gently, across every instance; a slightly old forecast is better than none.
  const gate = await deps.rateLimiter.hit('weather:upstream', UPSTREAM_PER_SECOND, 1);
  if (!gate.allowed) {
    if (cached) return JSON.parse(cached.body) as WeatherResponse;
    throw new HttpError(503, 'weather_busy', 'The weather is busy right now. Try again shortly.', { 'Retry-After': '2' });
  }

  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${MET_URL}?lat=${area.lat}&lon=${area.lon}`, {
      headers: {
        'User-Agent': `SnoreHive/1.0 ${deps.config.weatherContact}`,
        ...(cached?.last_modified ? { 'If-Modified-Since': cached.last_modified } : {}),
      },
    });
  } catch {
    if (cached) return JSON.parse(cached.body) as WeatherResponse;
    throw new HttpError(502, 'weather_unavailable', 'The weather could not be fetched. Try again later.');
  }

  const expires = Date.parse(res.headers.get('Expires') ?? '');
  const expiresAt = new Date(Number.isFinite(expires) && expires > now.getTime() ? expires : now.getTime() + DEFAULT_TTL_MS).toISOString();

  if (res.status === 304 && cached) {
    await deps.sql.query('UPDATE weather_cache SET expires_at = $2::timestamptz, fetched_at = $3::timestamptz WHERE area = $1', [
      key,
      expiresAt,
      now.toISOString(),
    ]);
    return JSON.parse(cached.body) as WeatherResponse;
  }
  if (!res.ok) {
    if (cached) return JSON.parse(cached.body) as WeatherResponse;
    throw new HttpError(502, 'weather_unavailable', 'The weather could not be fetched. Try again later.');
  }

  const body = simplifyForecast((await res.json()) as MetResponse, area);
  await deps.sql.query(
    `INSERT INTO weather_cache (area, body, expires_at, last_modified, fetched_at)
     VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz)
     ON CONFLICT (area) DO UPDATE SET body = EXCLUDED.body, expires_at = EXCLUDED.expires_at,
       last_modified = EXCLUDED.last_modified, fetched_at = EXCLUDED.fetched_at`,
    [key, JSON.stringify(body), expiresAt, res.headers.get('Last-Modified'), now.toISOString()],
  );
  return body;
}
