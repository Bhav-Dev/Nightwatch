import type { WeatherHour } from '../../shared/api';

/**
 * The weather around a night, from the forecast fetched when recording starts: what the morning
 * sky looks like, a short description ("Light rain, 9°C"), and the night's temperature and
 * humidity, which become factors the summary can compare nights by.
 */

export type WeatherCondition = 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'thunder';

/** MET Norway symbol codes ("lightrainshowers_day") without the time-of-day suffix. */
const baseSymbol = (symbol: string) => symbol.split('_')[0];

export function conditionFor(symbol: string | null): WeatherCondition | null {
  if (!symbol) return null;
  const s = baseSymbol(symbol);
  if (s.includes('thunder')) return 'thunder';
  if (s.includes('snow') || s.includes('sleet')) return 'snow';
  if (s.includes('rain')) return 'rain';
  if (s === 'fog') return 'fog';
  if (s === 'cloudy') return 'cloudy';
  if (s === 'partlycloudy' || s === 'fair') return 'partly';
  if (s === 'clearsky') return 'clear';
  return null;
}

const WORDS: Record<string, string> = {
  clearsky: 'Clear',
  fair: 'Mostly clear',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  lightrain: 'Light rain',
  rain: 'Rain',
  heavyrain: 'Heavy rain',
  lightrainshowers: 'Light showers',
  rainshowers: 'Showers',
  heavyrainshowers: 'Heavy showers',
  lightsleet: 'Light sleet',
  sleet: 'Sleet',
  heavysleet: 'Heavy sleet',
  lightsleetshowers: 'Sleet showers',
  sleetshowers: 'Sleet showers',
  heavysleetshowers: 'Heavy sleet showers',
  lightsnow: 'Light snow',
  snow: 'Snow',
  heavysnow: 'Heavy snow',
  lightsnowshowers: 'Snow showers',
  snowshowers: 'Snow showers',
  heavysnowshowers: 'Heavy snow showers',
};

/** "Light rain, 9°C" (or "Sunny, 14°C" for a clear morning). */
export function describeWeather(symbol: string | null, tempC: number | null): string | null {
  if (!symbol) return null;
  const s = baseSymbol(symbol);
  const daytime = symbol.endsWith('_day');
  let words = WORDS[s] ?? (s.includes('thunder') ? 'Thunder' : null);
  if (s === 'clearsky' && daytime) words = 'Sunny';
  if (s === 'fair' && daytime) words = 'Mostly sunny';
  if (!words) return null;
  return tempC === null ? words : `${words}, ${Math.round(tempC)}°C`;
}

export interface NightWeather {
  /** Mean and lowest temperature while recording, °C. */
  tempMeanC: number | null;
  tempMinC: number | null;
  /** Mean relative humidity while recording, percent. */
  humidityMean: number | null;
  /** The hour the night ended in: what the morning is like. */
  morningSymbol: string | null;
  morningTempC: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The night's weather from an hourly forecast, for the hours overlapping [startS, endS) (epoch seconds). */
export function summariseNightWeather(hours: readonly WeatherHour[], startS: number, endS: number): NightWeather {
  const during = hours.filter((h) => {
    const t = Date.parse(h.time) / 1000;
    return t + 3600 > startS && t < endS;
  });
  const temps = during.map((h) => h.tempC).filter((v): v is number => v !== null);
  const humid = during.map((h) => h.humidity).filter((v): v is number => v !== null);
  // The morning: the hour the night ended in, or the first hour after it.
  const morning =
    hours.find((h) => {
      const t = Date.parse(h.time) / 1000;
      return t <= endS && t + 3600 > endS;
    }) ?? hours.find((h) => Date.parse(h.time) / 1000 >= endS) ?? null;
  return {
    tempMeanC: mean(temps),
    tempMinC: temps.length ? Math.min(...temps) : null,
    humidityMean: mean(humid),
    morningSymbol: morning?.symbol ?? null,
    morningTempC: morning?.tempC ?? null,
  };
}

/** Bands a night's weather falls into, compared like factors once there are enough nights. */
export type WeatherBand = 'cold' | 'warm' | 'humid' | 'dry';

export const WEATHER_BANDS = { coldBelowC: 5, warmFromC: 18, humidFromPct: 90, dryUpToPct: 60 } as const;

export function weatherBands(w: Pick<NightWeather, 'tempMeanC' | 'humidityMean'>): WeatherBand[] {
  const out: WeatherBand[] = [];
  if (w.tempMeanC !== null && w.tempMeanC < WEATHER_BANDS.coldBelowC) out.push('cold');
  if (w.tempMeanC !== null && w.tempMeanC >= WEATHER_BANDS.warmFromC) out.push('warm');
  if (w.humidityMean !== null && w.humidityMean >= WEATHER_BANDS.humidFromPct) out.push('humid');
  if (w.humidityMean !== null && w.humidityMean <= WEATHER_BANDS.dryUpToPct) out.push('dry');
  return out;
}

/** The id a band is compared under, alongside logged factors. */
export const weatherFactorId = (band: WeatherBand) => `weather:${band}`;

/** Marks a night that has weather at all, so bands are only compared among such nights. */
export const WEATHER_KNOWN_ID = 'weather:known';

/** The factor ids a night's weather adds to its history entry (none without weather). */
export function weatherFactorIds(w: Pick<NightWeather, 'tempMeanC' | 'humidityMean'> | null): string[] {
  if (!w || (w.tempMeanC === null && w.humidityMean === null)) return [];
  return [WEATHER_KNOWN_ID, ...weatherBands(w).map(weatherFactorId)];
}
