import { localDateKey, nightDateWithSuffix } from '../domain/nightDate';
import type { Bin, NightAnalysis } from '../domain/scoring';
import type { Db } from './db';
import type { InterruptCause } from './sessionRepo';

export interface NightRow {
  id: string;
  date: string;
  started_at: number;
  ended_at: number;
  duration_s: number;
  time_in_bed_s: number;
  score: number;
  score_version: number;
  pct_snoring: number;
  event_count: number;
  max_db: number;
  floor_db: number;
  partial: number;
  counts_toward_averages: number;
  typical: number | null;
  summary_text: string | null;
  updated_at: number;
  synced_at: number | null;
  /** Offset into the night (s) where recording first stopped unexpectedly; null for clean nights. */
  interrupted_at_s: number | null;
  interrupt_cause: InterruptCause | null;
}

export interface SaveNightInput {
  id: string;
  startedAt: Date;
  endedAt: Date;
  partial: boolean;
  analysis: NightAnalysis;
  newId: () => string;
  interruption?: { atS: number; cause: InterruptCause } | null;
}

/** Writes a scored night with its events and bins in one transaction. */
export async function saveNight(db: Db, input: SaveNightInput): Promise<NightRow> {
  const { id, startedAt, endedAt, partial, analysis, newId, interruption } = input;
  const baseDate = localDateKey(startedAt);
  const sameDate = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM night WHERE date = ? OR date LIKE ? || '#%'",
    [baseDate, baseDate],
  );
  const date = nightDateWithSuffix(baseDate, sameDate?.n ?? 0);
  const startedS = Math.floor(startedAt.getTime() / 1000);
  const endedS = Math.floor(endedAt.getTime() / 1000);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO night (id, date, started_at, ended_at, duration_s, time_in_bed_s, score, score_version,
         pct_snoring, event_count, max_db, floor_db, partial, counts_toward_averages, updated_at,
         interrupted_at_s, interrupt_cause)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        date,
        startedS,
        endedS,
        endedS - startedS,
        analysis.timeInBedS,
        analysis.score,
        analysis.scoreVersion,
        analysis.pctSnoring,
        analysis.events.length,
        analysis.maxDb,
        analysis.floorDb,
        partial ? 1 : 0,
        analysis.countsTowardAverages ? 1 : 0,
        endedS,
        interruption?.atS ?? null,
        interruption?.cause ?? null,
      ],
    );
    for (const e of analysis.events) {
      await db.runAsync(
        `INSERT INTO event (id, night_id, start_s, end_s, peak_db, mean_db, intensity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), id, e.startS, e.endS, e.peakDb, e.meanDb, e.intensity],
      );
    }
    for (const b of analysis.bins) {
      await db.runAsync(
        'INSERT INTO bin (night_id, idx, mean_db, max_db, snore_s) VALUES (?, ?, ?, ?, ?)',
        [id, b.index, b.meanDb, b.maxDb, b.snoreS],
      );
    }
  });

  const saved = await db.getFirstAsync<NightRow>('SELECT * FROM night WHERE id = ?', [id]);
  if (!saved) throw new Error(`night ${id} was not saved`);
  return saved;
}

export async function latestNight(db: Db): Promise<NightRow | null> {
  return db.getFirstAsync<NightRow>('SELECT * FROM night ORDER BY started_at DESC LIMIT 1', []);
}

export async function nightBins(db: Db, nightId: string): Promise<Bin[]> {
  const rows = await db.getAllAsync<{ idx: number; mean_db: number; max_db: number; snore_s: number }>(
    'SELECT idx, mean_db, max_db, snore_s FROM bin WHERE night_id = ? ORDER BY idx',
    [nightId],
  );
  return rows.map((r) => ({ index: r.idx, meanDb: r.mean_db, maxDb: r.max_db, snoreS: r.snore_s }));
}

/** Mean score over the last `n` nights that count toward averages (partial nights under 3 hours do not). */
export async function averageScore(db: Db, n: number): Promise<number | null> {
  const row = await db.getFirstAsync<{ avg: number | null }>(
    `SELECT AVG(score) AS avg FROM (
       SELECT score FROM night WHERE counts_toward_averages = 1 ORDER BY started_at DESC LIMIT ?
     )`,
    [n],
  );
  return row?.avg ?? null;
}
