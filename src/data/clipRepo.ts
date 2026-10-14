import type { ClipCodec } from '../clips/codec';
import type { Db } from './db';

export interface ClipRow {
  id: string;
  session_id: string | null;
  night_id: string | null;
  start_s: number;
  end_s: number;
  peak_s: number;
  peak_db: number;
  codec: ClipCodec;
  sample_rate: number;
  path: string;
  bytes: number;
  saved: number;
  created_at: number;
}

export async function insertClip(db: Db, row: Omit<ClipRow, 'saved'>): Promise<void> {
  await db.runAsync(
    `INSERT INTO clip (id, session_id, night_id, start_s, end_s, peak_s, peak_db, codec, sample_rate, path, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.night_id, row.start_s, row.end_s, row.peak_s, row.peak_db, row.codec, row.sample_rate, row.path, row.bytes, row.created_at],
  );
}

export async function getClip(db: Db, id: string): Promise<ClipRow | null> {
  return db.getFirstAsync<ClipRow>('SELECT * FROM clip WHERE id = ?', [id]);
}

export async function deleteClipRow(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM clip WHERE id = ?', [id]);
}

export async function sessionClips(db: Db, sessionId: string): Promise<ClipRow[]> {
  return db.getAllAsync<ClipRow>('SELECT * FROM clip WHERE session_id = ? ORDER BY start_s', [sessionId]);
}

/** A night's clips, loudest first. */
export async function nightClips(db: Db, nightId: string): Promise<ClipRow[]> {
  return db.getAllAsync<ClipRow>('SELECT * FROM clip WHERE night_id = ? ORDER BY peak_db DESC', [nightId]);
}

export async function attachClipsToNight(db: Db, sessionId: string, nightId: string): Promise<void> {
  await db.runAsync('UPDATE clip SET night_id = ?, session_id = NULL WHERE session_id = ?', [nightId, sessionId]);
}

export async function setClipSaved(db: Db, id: string, saved: boolean): Promise<void> {
  await db.runAsync('UPDATE clip SET saved = ? WHERE id = ?', [saved ? 1 : 0, id]);
}

export async function clipsWithCodecOtherThan(db: Db, codec: ClipCodec): Promise<ClipRow[]> {
  return db.getAllAsync<ClipRow>('SELECT * FROM clip WHERE codec != ?', [codec]);
}

export async function replaceClipFile(db: Db, id: string, codec: ClipCodec, path: string, bytes: number): Promise<void> {
  await db.runAsync('UPDATE clip SET codec = ?, path = ?, bytes = ? WHERE id = ?', [codec, path, bytes, id]);
}

export async function clipStorageBytes(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>('SELECT SUM(bytes) AS total FROM clip', []);
  return row?.total ?? 0;
}

export async function allClipPaths(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ path: string }>('SELECT path FROM clip', []);
  return rows.map((r) => r.path);
}
