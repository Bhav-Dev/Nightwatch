import type { FrameFeatures } from '../domain/audio/features';
import type { Db } from './db';

export type InterruptCause = 'stalled' | 'microphone_taken' | 'app_closed';

export interface SessionRow {
  id: string;
  started_at: number;
  sensitivity: string;
  last_frame_t: number | null;
  updated_at: number;
  /** Id of the online model scoring this session, if any. */
  detector: string | null;
}

export interface SessionGap {
  startS: number;
  endS: number;
  cause: InterruptCause;
}

export async function createSession(
  db: Db,
  id: string,
  startedAt: Date,
  sensitivity: string,
  detector: string | null = null,
): Promise<void> {
  const s = Math.floor(startedAt.getTime() / 1000);
  await db.runAsync(
    'INSERT INTO recording_session (id, started_at, sensitivity, updated_at, detector) VALUES (?, ?, ?, ?, ?)',
    [id, s, sensitivity, s, detector],
  );
}

export interface StoredFrame {
  t: number;
  features: FrameFeatures;
  /** Online model output, or null when the heuristic will label this second at Stop. */
  snoreProb: number | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Appends a batch of per-second features (a few dozen at a time, so a kill loses little). */
export async function appendFrames(
  db: Db,
  sessionId: string,
  frames: { t: number; features: FrameFeatures; snoreProb?: number | null }[],
  now: Date,
): Promise<void> {
  if (frames.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const { t, features, snoreProb } of frames) {
      await db.runAsync(
        `INSERT OR REPLACE INTO session_frame (session_id, t, level_db, centroid_hz, envelope, snore_prob) VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, t, features.levelDb, features.centroidHz, JSON.stringify(features.envelopeDb.map(round1)), snoreProb ?? null],
      );
    }
    await db.runAsync('UPDATE recording_session SET last_frame_t = MAX(COALESCE(last_frame_t, 0), ?), updated_at = ? WHERE id = ?', [
      Math.max(...frames.map((f) => f.t)),
      Math.floor(now.getTime() / 1000),
      sessionId,
    ]);
  });
}

export async function appendGap(db: Db, sessionId: string, gap: SessionGap): Promise<void> {
  await db.runAsync('INSERT INTO session_gap (session_id, start_s, end_s, cause) VALUES (?, ?, ?, ?)', [
    sessionId,
    gap.startS,
    gap.endS,
    gap.cause,
  ]);
}

export async function openSessions(db: Db): Promise<SessionRow[]> {
  return db.getAllAsync<SessionRow>('SELECT * FROM recording_session ORDER BY started_at', []);
}

export async function sessionFrames(db: Db, sessionId: string): Promise<StoredFrame[]> {
  const rows = await db.getAllAsync<{ t: number; level_db: number; centroid_hz: number; envelope: string; snore_prob: number | null }>(
    'SELECT t, level_db, centroid_hz, envelope, snore_prob FROM session_frame WHERE session_id = ? ORDER BY t',
    [sessionId],
  );
  return rows.map((r) => ({
    t: r.t,
    features: { levelDb: r.level_db, centroidHz: r.centroid_hz, envelopeDb: JSON.parse(r.envelope) as number[] },
    snoreProb: r.snore_prob,
  }));
}

export async function sessionGaps(db: Db, sessionId: string): Promise<SessionGap[]> {
  const rows = await db.getAllAsync<{ start_s: number; end_s: number; cause: InterruptCause }>(
    'SELECT start_s, end_s, cause FROM session_gap WHERE session_id = ? ORDER BY start_s',
    [sessionId],
  );
  return rows.map((r) => ({ startS: r.start_s, endS: r.end_s, cause: r.cause }));
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM session_frame WHERE session_id = ?', [sessionId]);
    await db.runAsync('DELETE FROM session_gap WHERE session_id = ?', [sessionId]);
    await db.runAsync('DELETE FROM recording_session WHERE id = ?', [sessionId]);
  });
}
