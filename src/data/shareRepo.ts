import { periodSummary, type PeriodSummary } from '../domain/shareCard';
import type { Db } from './db';

/** Scores of the counted nights before a night, most recent first, for "my quietest night in N nights". */
export async function earlierScores(db: Db, startedAt: number, limit = 120): Promise<number[]> {
  const rows = await db.getAllAsync<{ score: number }>(
    'SELECT score FROM night WHERE started_at < ? AND counts_toward_averages = 1 ORDER BY started_at DESC LIMIT ?',
    [startedAt, limit],
  );
  return rows.map((r) => r.score);
}

/** The last `days` days for a week or month card, with the period before for comparison. */
export async function loadPeriodSummary(db: Db, days: number, today = new Date()): Promise<PeriodSummary> {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (2 * days - 1));
  const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const rows = await db.getAllAsync<{ date: string; score: number; counts_toward_averages: number }>(
    'SELECT date, score, counts_toward_averages FROM night WHERE substr(date, 1, 10) >= ? ORDER BY started_at',
    [fromKey],
  );
  return periodSummary(
    rows.map((r) => ({ date: r.date, score: r.score, counts: r.counts_toward_averages === 1 })),
    days,
    today,
  );
}
