/**
 * Weather areas: a position rounded to 0.1° (about 11 km north to south), so the forecast is
 * for a neighbourhood rather than a home, and everyone nearby shares one cached forecast. Used
 * by the app before a position leaves the phone, and again by the server.
 */
export const WEATHER_AREA_DECIMALS = 1;

export function weatherArea(lat: number, lon: number): { lat: number; lon: number } {
  const f = 10 ** WEATHER_AREA_DECIMALS;
  // Normalise -0 to 0 so the same area always has the same key.
  const round = (v: number) => Math.round(v * f) / f + 0;
  return { lat: round(lat), lon: round(lon) };
}

export const weatherAreaKey = (area: { lat: number; lon: number }) => `${area.lat.toFixed(WEATHER_AREA_DECIMALS)},${area.lon.toFixed(WEATHER_AREA_DECIMALS)}`;

export const WEATHER_ATTRIBUTION = 'Weather data from MET Norway (CC BY 4.0)';
/** MET Norway's licence page, linked from the attribution as the licence asks. */
export const WEATHER_LICENSE_URL = 'https://api.met.no/doc/License';
