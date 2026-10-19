import type { NightSummary } from '../../shared/remedyEffect';
import { autoFactorId, autoFactorsFor, usualFloorDb } from '../domain/autoFactors';
import type { NightWithCheckIn } from '../domain/patterns';
import { weatherFactorIds } from '../domain/weather';
import type { Db } from './db';
import { allNightWeather } from './weatherRepo';

interface Row {
  id: string;
  date: string;
  score: number;
  pct_snoring: number;
  time_in_bed_s: number;
  partial: number;
  typical: number | null;
}

/** Every night as the shared algorithm's NightSummary, oldest first. */
export async function nightSummaries(db: Db, sinceDate?: string): Promise<NightSummary[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT id, date, score, pct_snoring, time_in_bed_s, partial, typical FROM night ${sinceDate ? 'WHERE date >= ?' : ''} ORDER BY started_at`,
    sinceDate ? [sinceDate] : [],
  );
  const remedies = await db.getAllAsync<{ night_id: string; remedy_id: string }>('SELECT night_id, remedy_id FROM remedy_log', []);
  const factors = await db.getAllAsync<{ night_id: string; factor_id: string; value: string | null }>('SELECT night_id, factor_id, value FROM factor_log', []);
  const rByNight = new Map<string, string[]>();
  for (const r of remedies) rByNight.set(r.night_id, [...(rByNight.get(r.night_id) ?? []), r.remedy_id]);
  const fByNight = new Map<string, { id: string; value: string | null }[]>();
  for (const f of factors) fByNight.set(f.night_id, [...(fByNight.get(f.night_id) ?? []), { id: f.factor_id, value: f.value }]);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    score: r.score,
    pct_snoring: r.pct_snoring,
    duration_s: r.time_in_bed_s,
    partial: r.partial === 1,
    typical: r.typical === null ? null : r.typical === 1,
    remedies: rByNight.get(r.id) ?? [],
    factors: fByNight.get(r.id) ?? [],
  }));
}

/**
 * Every night with the factors read from it added to the logged ones (the weather's bands, and
 * bedtime, length, weekend and room noise), and the morning check-in. On this phone only: the
 * derived factors are compared like logged ones but never synced.
 */
export async function enrichedHistory(db: Db): Promise<NightWithCheckIn[]> {
  const base = await nightSummaries(db);
  const rows = await db.getAllAsync<{ id: string; started_at: number; time_in_bed_s: number; floor_db: number | null; rested: number | null }>(
    'SELECT id, started_at, time_in_bed_s, floor_db, rested FROM night',
    [],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const weather = new Map((await allNightWeather(db)).map((w) => [w.night_id, w]));
  const usual = usualFloorDb(rows.map((r) => ({ floorDb: r.floor_db })));
  return base.map((n) => {
    const r = byId.get(n.id);
    const w = weather.get(n.id);
    const derived = [
      ...weatherFactorIds(w ? { tempMeanC: w.temp_mean_c, humidityMean: w.humidity_mean } : null),
      ...(r ? autoFactorsFor({ startedAtS: r.started_at, timeInBedS: r.time_in_bed_s, floorDb: r.floor_db }, usual).map(autoFactorId) : []),
    ];
    return { ...n, factors: [...n.factors, ...derived.map((id) => ({ id, value: null }))], rested: r?.rested ?? null };
  });
}

export interface TrendPoint {
  id: string;
  date: string;
  score: number;
  pctSnoring: number;
  counts: boolean;
  /** The morning check-in, 1 to 5, or null if not answered. */
  rested: number | null;
}

type TrendRow = { id: string; date: string; score: number; pct_snoring: number; counts_toward_averages: number; rested: number | null };
const toTrendPoint = (r: TrendRow): TrendPoint => ({
  id: r.id,
  date: r.date,
  score: r.score,
  pctSnoring: r.pct_snoring,
  counts: r.counts_toward_averages === 1,
  rested: r.rested,
});

/** Nights in the last `days` days for the Trends chart, oldest first. */
export async function trendPoints(db: Db, days: number, today = new Date()): Promise<TrendPoint[]> {
  const from = new Date(today.getTime() - (days - 1) * 86_400_000);
  const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const rows = await db.getAllAsync<TrendRow>(
    'SELECT id, date, score, pct_snoring, counts_toward_averages, rested FROM night WHERE date >= ? ORDER BY started_at',
    [fromKey],
  );
  return rows.map(toTrendPoint);
}

/**
 * The last `days` days up to today, oldest first, each with the night started that day (the later
 * one if there were two), for the honeycomb of nights on Trends.
 */
export function nightsByDay(points: readonly TrendPoint[], days: number, today = new Date()): { key: string; night: { id: string; score: number } | null }[] {
  const byDate = new Map<string, TrendPoint>();
  for (const p of points) byDate.set(p.date.slice(0, 10), p);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const p = byDate.get(key);
    return { key, night: p ? { id: p.id, score: p.score } : null };
  });
}

/** Nights started between two local dates (yyyy-mm-dd, inclusive) for a custom range on Trends, oldest first. */
export async function trendPointsBetween(db: Db, fromKey: string, toKey: string): Promise<TrendPoint[]> {
  const rows = await db.getAllAsync<TrendRow>(
    'SELECT id, date, score, pct_snoring, counts_toward_averages, rested FROM night WHERE substr(date, 1, 10) BETWEEN ? AND ? ORDER BY started_at',
    [fromKey, toKey],
  );
  return rows.map(toTrendPoint);
}

/** Trailing moving average over the last `window` counted nights at each point (null until there are any). */
export function movingAverage(points: readonly TrendPoint[], window = 7, key: 'score' | 'pctSnoring' = 'score'): (number | null)[] {
  const out: (number | null)[] = [];
  const buf: number[] = [];
  for (const p of points) {
    if (p.counts) {
      buf.push(p[key]);
      if (buf.length > window) buf.shift();
    }
    out.push(buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : null);
  }
  return out;
}
