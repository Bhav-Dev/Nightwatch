import type { Db } from '../data/db';
import { deleteSoundSegmentRow, expiredSoundSegments } from '../data/soundRepo';
import { SOUND_KEEP_DAYS } from './soundRecorder';

/**
 * Deletes the sound of nights older than the keeping period (files and rows). Scores,
 * timelines and clips are untouched. Returns how many segments were removed.
 */
export async function pruneOldSound(
  db: Db,
  removeFile: (path: string) => Promise<void> | void,
  now: Date = new Date(),
  keepDays = SOUND_KEEP_DAYS,
): Promise<number> {
  const expired = await expiredSoundSegments(db, Math.floor(now.getTime() / 1000) - keepDays * 86_400);
  for (const s of expired) {
    await removeFile(s.path);
    await deleteSoundSegmentRow(db, s.id);
  }
  return expired.length;
}
