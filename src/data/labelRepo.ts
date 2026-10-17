import { applyLabels, rescoreNight, type SoundLabel, type SoundLabelValue } from '../domain/scoring/corrections';
import type { SnoreEvent } from '../domain/scoring/types';
import type { Db } from './db';
import type { EventRow } from './nightRepo';

export interface SoundLabelRow {
  id: string;
  night_id: string;
  start_s: number;
  end_s: number;
  label: SoundLabelValue;
  peak_db: number;
  mean_db: number;
  /** 'clip' or 'moment'. */
  source: string;
  created_at: number;
}

const BUMP = 'updated_at = MAX(updated_at + 1, ?)';
const nowS = () => Math.floor(Date.now() / 1000);

/** A night's answers, in the order they were given. */
export async function nightLabels(db: Db, nightId: string): Promise<SoundLabelRow[]> {
  return db.getAllAsync<SoundLabelRow>('SELECT * FROM sound_label WHERE night_id = ? ORDER BY created_at, rowid', [nightId]);
}

/** Every answer on this phone: the labelled examples for training and checking the detector. */
export async function allLabels(db: Db): Promise<SoundLabelRow[]> {
  return db.getAllAsync<SoundLabelRow>('SELECT * FROM sound_label ORDER BY night_id, created_at, rowid', []);
}

/** The detector's events for a night: the snapshot once the night is corrected, else the events themselves. */
export async function detectedEvents(db: Db, nightId: string): Promise<SnoreEvent[]> {
  const snap = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM night WHERE id = ? AND detector_score IS NOT NULL', [nightId]);
  const table = snap?.n ? 'event_detected' : 'event';
  const rows = await db.getAllAsync<Omit<EventRow, 'clip_path'>>(
    `SELECT id, night_id, start_s, end_s, peak_db, mean_db, intensity FROM ${table} WHERE night_id = ? ORDER BY start_s`,
    [nightId],
  );
  return rows.map((r) => ({ startS: r.start_s, endS: r.end_s, peakDb: r.peak_db, meanDb: r.mean_db, intensity: r.intensity }));
}

/**
 * Loudness above the night's floor for a stretch, used when the user says it was snoring.
 * Per-second levels are not kept after the night is saved, so this comes from the 5-minute bins
 * (and the clip's own peak when there is one).
 */
export async function stretchLoudness(
  db: Db,
  nightId: string,
  startS: number,
  endS: number,
  clipPeakAboveFloorDb?: number,
): Promise<{ peakDb: number; meanDb: number }> {
  const bins = await db.getAllAsync<{ mean_db: number; max_db: number }>(
    'SELECT mean_db, max_db FROM bin WHERE night_id = ? AND idx >= ? AND idx <= ?',
    [nightId, Math.floor(startS / 300), Math.floor(Math.max(startS, endS - 1) / 300)],
  );
  const binPeak = bins.reduce((m, b) => Math.max(m, b.max_db), 0);
  const peakDb = clipPeakAboveFloorDb !== undefined ? Math.max(0, clipPeakAboveFloorDb) : binPeak;
  const meanDb = Math.min(peakDb, bins.reduce((m, b) => Math.max(m, b.mean_db), 0));
  return { peakDb, meanDb };
}

/**
 * Records an answer and rebuilds the night from the detector's events plus every answer:
 * events, timeline bins, score and time snoring. The night is marked for sync.
 */
export async function addLabel(
  db: Db,
  input: { id: string; nightId: string; startS: number; endS: number; label: SoundLabelValue; peakDb: number; meanDb: number; source: string; now?: number },
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sound_label (id, night_id, start_s, end_s, label, peak_db, mean_db, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.nightId, input.startS, input.endS, input.label, input.peakDb, input.meanDb, input.source, input.now ?? nowS()],
    );
    await rebuildNight(db, input.nightId);
  });
}

/** Undoes the answers for a stretch (all answers overlapping it), restoring what the detector heard there. */
export async function clearLabels(db: Db, nightId: string, startS: number, endS: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM sound_label WHERE night_id = ? AND start_s < ? AND end_s > ?', [nightId, endS, startS]);
    await rebuildNight(db, nightId);
  });
}

async function rebuildNight(db: Db, nightId: string): Promise<void> {
  const night = await db.getFirstAsync<{ score: number; time_in_bed_s: number; detector_score: number | null }>(
    'SELECT score, time_in_bed_s, detector_score FROM night WHERE id = ?',
    [nightId],
  );
  if (!night) throw new Error(`night ${nightId} not found`);
  if (night.detector_score === null) {
    // First answer for this night: keep the detector's own events and score.
    await db.runAsync('DELETE FROM event_detected WHERE night_id = ?', [nightId]);
    await db.runAsync(
      `INSERT INTO event_detected (id, night_id, start_s, end_s, peak_db, mean_db, intensity)
       SELECT id, night_id, start_s, end_s, peak_db, mean_db, intensity FROM event WHERE night_id = ?`,
      [nightId],
    );
    await db.runAsync('UPDATE night SET detector_score = score WHERE id = ?', [nightId]);
  }
  const detected = await detectedEvents(db, nightId);
  const labels: SoundLabel[] = (await nightLabels(db, nightId)).map((l) => ({
    startS: l.start_s,
    endS: l.end_s,
    label: l.label,
    peakDb: l.peak_db,
    meanDb: l.mean_db,
  }));
  const events = applyLabels(detected, labels);
  const binCount = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM bin WHERE night_id = ?', [nightId]))?.n ?? 0;
  const r = rescoreNight(events, night.time_in_bed_s, binCount);

  // Each event links to the loudest kept clip it overlaps, as at Stop.
  const clips = await db.getAllAsync<{ start_s: number; end_s: number; path: string }>(
    'SELECT start_s, end_s, path FROM clip WHERE night_id = ? ORDER BY peak_db DESC',
    [nightId],
  );
  await db.runAsync('DELETE FROM event WHERE night_id = ?', [nightId]);
  for (const [i, e] of events.entries()) {
    const clip = clips.find((c) => c.start_s < e.endS && c.end_s > e.startS);
    await db.runAsync(
      'INSERT INTO event (id, night_id, start_s, end_s, peak_db, mean_db, intensity, clip_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`${nightId}:${i}:${e.startS}`, nightId, e.startS, e.endS, e.peakDb, e.meanDb, e.intensity, clip?.path ?? null],
    );
  }
  for (const [idx, s] of r.binSnoreS.entries()) {
    await db.runAsync('UPDATE bin SET snore_s = ? WHERE night_id = ? AND idx = ?', [s, nightId, idx]);
  }
  await db.runAsync(`UPDATE night SET score = ?, pct_snoring = ?, max_db = ?, event_count = ?, ${BUMP} WHERE id = ?`, [
    r.score,
    r.pctSnoring,
    r.maxDb,
    r.eventCount,
    nowS(),
    nightId,
  ]);
  if (labels.length === 0) {
    // Every answer undone: the night is the detector's again.
    await db.runAsync('DELETE FROM event_detected WHERE night_id = ?', [nightId]);
    await db.runAsync('UPDATE night SET detector_score = NULL WHERE id = ?', [nightId]);
  }
}
