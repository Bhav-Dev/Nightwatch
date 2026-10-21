import type { Movement, Span } from '../domain/activity';
import type { BreathingStretch } from '../domain/breathing';
import type { Db } from './db';

export interface ActivityRow {
  id: string;
  night_id: string;
  kind: 'movement' | 'phone' | 'breathing';
  start_s: number;
  end_s: number;
  peak_db: number | null;
}

/** Saves what else the night held: movement and heavy breathing heard in the audio, and phone use. */
export async function saveNightActivity(
  db: Db,
  nightId: string,
  activity: { movement: readonly Movement[]; phone: readonly Span[]; breathing?: readonly BreathingStretch[] },
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
  for (const b of activity.breathing ?? []) {
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES (?, ?, 'breathing', ?, ?, ?)", [
      newId(),
      nightId,
      b.startS,
      b.endS,
      b.peakDb,
    ]);
  }
  await db.runAsync('UPDATE night SET activity_checked = 1 WHERE id = ?', [nightId]);
  if (activity.breathing) await db.runAsync('UPDATE night SET breathing_checked = 1 WHERE id = ?', [nightId]);
}

export async function nightActivity(db: Db, nightId: string): Promise<ActivityRow[]> {
  return db.getAllAsync<ActivityRow>('SELECT * FROM night_activity WHERE night_id = ? ORDER BY start_s', [nightId]);
}
