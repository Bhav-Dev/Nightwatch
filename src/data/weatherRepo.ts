import type { WeatherResponse } from '../../shared/api';
import type { NightWeather } from '../domain/weather';
import type { Db } from './db';

export interface NightWeatherRow {
  night_id: string;
  temp_mean_c: number | null;
  temp_min_c: number | null;
  humidity_mean: number | null;
  morning_symbol: string | null;
  morning_temp_c: number | null;
  area: string | null;
  fetched_at: number;
}

export async function saveSessionForecast(db: Db, sessionId: string, forecast: WeatherResponse, fetchedAt: number): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO session_weather (session_id, forecast, fetched_at) VALUES (?, ?, ?)', [
    sessionId,
    JSON.stringify(forecast),
    fetchedAt,
  ]);
}

export async function sessionForecast(db: Db, sessionId: string): Promise<{ forecast: WeatherResponse; fetchedAt: number } | null> {
  const row = await db.getFirstAsync<{ forecast: string; fetched_at: number }>('SELECT forecast, fetched_at FROM session_weather WHERE session_id = ?', [sessionId]);
  return row ? { forecast: JSON.parse(row.forecast) as WeatherResponse, fetchedAt: row.fetched_at } : null;
}

export async function deleteSessionForecast(db: Db, sessionId: string): Promise<void> {
  await db.runAsync('DELETE FROM session_weather WHERE session_id = ?', [sessionId]);
}

export async function saveNightWeather(db: Db, nightId: string, w: NightWeather, area: string | null, fetchedAt: number): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO night_weather (night_id, temp_mean_c, temp_min_c, humidity_mean, morning_symbol, morning_temp_c, area, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nightId, w.tempMeanC, w.tempMinC, w.humidityMean, w.morningSymbol, w.morningTempC, area, fetchedAt],
  );
}

/** A fresher look at the morning, from a forecast fetched on opening This Morning. */
export async function updateMorningWeather(db: Db, nightId: string, symbol: string | null, tempC: number | null, area: string | null, fetchedAt: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO night_weather (night_id, morning_symbol, morning_temp_c, area, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (night_id) DO UPDATE SET morning_symbol = excluded.morning_symbol, morning_temp_c = excluded.morning_temp_c, fetched_at = excluded.fetched_at`,
    [nightId, symbol, tempC, area, fetchedAt],
  );
}

export async function nightWeather(db: Db, nightId: string): Promise<NightWeatherRow | null> {
  return db.getFirstAsync<NightWeatherRow>('SELECT * FROM night_weather WHERE night_id = ?', [nightId]);
}

export async function allNightWeather(db: Db): Promise<NightWeatherRow[]> {
  return db.getAllAsync<NightWeatherRow>('SELECT * FROM night_weather', []);
}
