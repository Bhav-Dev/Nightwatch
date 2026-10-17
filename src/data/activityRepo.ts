import type { Movement, Span } from '../domain/activity';
import type { Db } from './db';

export interface ActivityRow {
  id: string;
  night_id: string;
  kind: 'movement' | 'phone';
  start_s: number;
  end_s: number;
  peak_db: number | null;
}

/** Saves what else the night held: movement heard in the audio, and phone use. */
export async function saveNightActivity(
  db: Db,
  nightId: string,
  activity: { movement: readonly Movement[]; phone: readonly Span[] },
  newId: () => string,
): Promise<void> {
  for (const m of activity.movement) {
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES (?, ?, 'movement', ?, ?, ?)", [
      newId(),
      nightId,
      m.startS,
      m.endS,
      m.peakDb,
    ]);
  }
  for (const p of activity.phone) {
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES (?, ?, 'phone', ?, ?, NULL)", [
      newId(),
      nightId,
      p.startS,
      p.endS,
    ]);
  }
  await db.runAsync('UPDATE night SET activity_checked = 1 WHERE id = ?', [nightId]);
}

export async function nightActivity(db: Db, nightId: string): Promise<ActivityRow[]> {
  return db.getAllAsync<ActivityRow>('SELECT * FROM night_activity WHERE night_id = ? ORDER BY start_s', [nightId]);
}
