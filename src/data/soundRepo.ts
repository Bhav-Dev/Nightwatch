import type { Db } from './db';

export interface SoundSegmentRow {
  id: string;
  session_id: string | null;
  night_id: string | null;
  start_s: number;
  end_s: number;
  codec: string;
  path: string;
  bytes: number;
  created_at: number;
}

export async function insertSoundSegment(db: Db, row: Omit<SoundSegmentRow, 'night_id'>): Promise<void> {
  await db.runAsync(
    `INSERT INTO sound_segment (id, session_id, night_id, start_s, end_s, codec, path, bytes, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.start_s, row.end_s, row.codec, row.path, row.bytes, row.created_at],
  );
}

export async function sessionSoundSegments(db: Db, sessionId: string): Promise<SoundSegmentRow[]> {
  return db.getAllAsync<SoundSegmentRow>('SELECT * FROM sound_segment WHERE session_id = ? ORDER BY start_s', [sessionId]);
}

export async function attachSoundToNight(db: Db, sessionId: string, nightId: string): Promise<void> {
  await db.runAsync('UPDATE sound_segment SET night_id = ?, session_id = NULL WHERE session_id = ?', [nightId, sessionId]);
}

/** A night's sound, in time order. */
export async function nightSoundSegments(db: Db, nightId: string): Promise<SoundSegmentRow[]> {
  return db.getAllAsync<SoundSegmentRow>('SELECT * FROM sound_segment WHERE night_id = ? ORDER BY start_s', [nightId]);
}

export async function deleteSoundSegmentRow(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM sound_segment WHERE id = ?', [id]);
}

/** Settings → Delete sound recordings. Files are the caller's job. */
export async function deleteAllSoundRows(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM sound_segment', []);
}

export async function allSoundPaths(db: Db): Promise<string[]> {
  return (await db.getAllAsync<{ path: string }>('SELECT path FROM sound_segment', [])).map((r) => r.path);
}

export async function soundStorageBytes(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COALESCE(SUM(bytes), 0) AS n FROM sound_segment', []))?.n ?? 0;
}

/** Segments of nights that started before `beforeEpochS`: past the keeping period. */
export async function expiredSoundSegments(db: Db, beforeEpochS: number): Promise<SoundSegmentRow[]> {
  return db.getAllAsync<SoundSegmentRow>(
    `SELECT s.* FROM sound_segment s JOIN night n ON n.id = s.night_id WHERE n.started_at < ? ORDER BY n.started_at, s.start_s`,
    [beforeEpochS],
  );
}
