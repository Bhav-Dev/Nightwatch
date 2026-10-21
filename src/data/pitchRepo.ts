import { nightPitch, type PitchStretch } from '../domain/pitch';
import type { Db } from './db';

/** Saves the pitch of each stretch of snoring the detector found, when the night is saved. */
export async function saveSnorePitch(db: Db, nightId: string, stretches: readonly PitchStretch[]): Promise<void> {
  for (const s of stretches) {
    await db.runAsync('INSERT INTO snore_pitch (night_id, start_s, end_s, hz, seconds) VALUES (?, ?, ?, ?, ?)', [
      nightId,
      s.startS,
      s.endS,
      s.hz,
      s.seconds,
    ]);
  }
}

type Row = { night_id: string; start_s: number; end_s: number; hz: number; seconds: number };
const toStretch = (r: Row): PitchStretch => ({ startS: r.start_s, endS: r.end_s, hz: r.hz, seconds: r.seconds });

/** A night's snore pitch stretches, in time order (empty on nights recorded before pitch was measured). */
export async function nightPitchStretches(db: Db, nightId: string): Promise<PitchStretch[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM snore_pitch WHERE night_id = ? ORDER BY start_s', [nightId]);
  return rows.map(toStretch);
}

/**
 * Each night's pitch, from the stretches that are still snoring after the user's answers, oldest
 * night first. Nights without enough snoring with a pitch are null.
 */
export async function nightlyPitch(db: Db, sinceDate?: string): Promise<{ nightId: string; date: string; pitch: { hz: number; seconds: number } | null }[]> {
  const nights = await db.getAllAsync<{ id: string; date: string }>(
    `SELECT id, date FROM night WHERE source = 'local' ${sinceDate ? 'AND date >= ?' : ''} ORDER BY started_at`,
    sinceDate ? [sinceDate] : [],
  );
  const rows = await db.getAllAsync<Row>('SELECT * FROM snore_pitch ORDER BY night_id, start_s', []);
  const events = await db.getAllAsync<{ night_id: string; start_s: number; end_s: number }>('SELECT night_id, start_s, end_s FROM event', []);
  const stretches = new Map<string, PitchStretch[]>();
  for (const r of rows) stretches.set(r.night_id, [...(stretches.get(r.night_id) ?? []), toStretch(r)]);
  const snoring = new Map<string, { startS: number; endS: number }[]>();
  for (const e of events) snoring.set(e.night_id, [...(snoring.get(e.night_id) ?? []), { startS: e.start_s, endS: e.end_s }]);
  return nights.map((n) => ({ nightId: n.id, date: n.date, pitch: nightPitch(stretches.get(n.id) ?? [], snoring.get(n.id) ?? []) }));
}
