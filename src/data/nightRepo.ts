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
  source: 'local' | 'remote';
  health_imported_at: number | null;
  detector: string | null;
  /** Sleep sounds played from the phone ('white' | 'pink' | 'brown'), until this second of the night. */
  sleep_sound: string | null;
  sleep_sound_until_s: number | null;
}

export interface SaveNightInput {
  id: string;
  startedAt: Date;
  endedAt: Date;
  partial: boolean;
  analysis: NightAnalysis;
  newId: () => string;
  interruption?: { atS: number; cause: InterruptCause } | null;
  detector?: string | null;
  sleepSound?: { kind: string; untilS: number } | null;
}

/** Writes a scored night with its events and bins in one transaction. */
export async function saveNight(db: Db, input: SaveNightInput): Promise<NightRow> {
  const { id, startedAt, endedAt, partial, analysis, newId, interruption, detector, sleepSound } = input;
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
         interrupted_at_s, interrupt_cause, detector, sleep_sound, sleep_sound_until_s)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        detector ?? null,
        sleepSound?.kind ?? null,
        sleepSound?.untilS ?? null,
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

/** SQL for bumping a night's version: strictly increasing even within one second. */
const BUMP = 'updated_at = MAX(updated_at + 1, ?)';
const nowS = () => Math.floor(Date.now() / 1000);

export async function getNight(db: Db, id: string): Promise<NightRow | null> {
  return db.getFirstAsync<NightRow>('SELECT * FROM night WHERE id = ?', [id]);
}

export async function listNights(db: Db, limit = 365): Promise<NightRow[]> {
  return db.getAllAsync<NightRow>('SELECT * FROM night ORDER BY started_at DESC LIMIT ?', [limit]);
}

export interface EventRow {
  id: string;
  night_id: string;
  start_s: number;
  end_s: number;
  peak_db: number;
  mean_db: number;
  intensity: 'quiet' | 'light' | 'loud' | 'epic';
  clip_path: string | null;
}

export async function nightEvents(db: Db, nightId: string): Promise<EventRow[]> {
  return db.getAllAsync<EventRow>('SELECT * FROM event WHERE night_id = ? ORDER BY start_s', [nightId]);
}

/** "Was this your typical night?" — false keeps the night out of community figures. */
export async function setTypical(db: Db, nightId: string, typical: boolean): Promise<void> {
  await db.runAsync(`UPDATE night SET typical = ?, ${BUMP} WHERE id = ?`, [typical ? 1 : 0, nowS(), nightId]);
}

export async function nightLog(db: Db, nightId: string): Promise<{ remedies: string[]; factors: { id: string; value: string | null }[] }> {
  const remedies = await db.getAllAsync<{ remedy_id: string }>('SELECT remedy_id FROM remedy_log WHERE night_id = ?', [nightId]);
  const factors = await db.getAllAsync<{ factor_id: string; value: string | null }>('SELECT factor_id, value FROM factor_log WHERE night_id = ?', [nightId]);
  return { remedies: remedies.map((r) => r.remedy_id), factors: factors.map((f) => ({ id: f.factor_id, value: f.value })) };
}

/** Edits a night's log (allowed until noon the next day) and marks the night for sync. */
export async function setNightTick(
  db: Db,
  nightId: string,
  tick: { itemId: string; type: 'remedy' | 'factor'; value: string | null },
  on: boolean,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (tick.type === 'remedy') {
      if (on) await db.runAsync('INSERT OR IGNORE INTO remedy_log (night_id, remedy_id) VALUES (?, ?)', [nightId, tick.itemId]);
      else await db.runAsync('DELETE FROM remedy_log WHERE night_id = ? AND remedy_id = ?', [nightId, tick.itemId]);
    } else if (on) {
      await db.runAsync(
        'INSERT INTO factor_log (night_id, factor_id, value) VALUES (?, ?, ?) ON CONFLICT(night_id, factor_id) DO UPDATE SET value = excluded.value',
        [nightId, tick.itemId, tick.value],
      );
    } else {
      await db.runAsync('DELETE FROM factor_log WHERE night_id = ? AND factor_id = ?', [nightId, tick.itemId]);
    }
    await db.runAsync(`UPDATE night SET ${BUMP} WHERE id = ?`, [nowS(), nightId]);
  });
}

/** The log stays editable until noon local time on the day after the night's date. */
export function logEditable(nightDate: string, now = new Date()): boolean {
  const d = nightDate.slice(0, 10);
  const deadline = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1, 12, 0, 0);
  return now < deadline;
}

/** Deletes a night here and queues the deletion for the server. Clip and sound files are the caller's job. */
export async function deleteNight(db: Db, nightId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM night WHERE id = ?', [nightId]);
    for (const t of ['event', 'bin', 'health_sample', 'health_summary', 'remedy_log', 'factor_log', 'clip', 'sound_segment', 'night_weather']) {
      await db.runAsync(`DELETE FROM ${t} WHERE night_id = ?`, [nightId]);
    }
    await db.runAsync('INSERT OR IGNORE INTO sync_tombstone (night_id) VALUES (?)', [nightId]);
  });
}
