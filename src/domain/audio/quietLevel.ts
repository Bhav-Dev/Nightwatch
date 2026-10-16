/**
 * Running estimate of a room's quiet level from per-second levels (dB): it falls straight to a
 * quieter second and rises slowly, so a long stretch of snoring does not drag it up. Shared by
 * the clip collector and the sound recorder, which both ask "is this second loud for this room?"
 */
export function nextQuietLevel(quietDb: number | null, levelDb: number, riseRate = 0.002): number {
  if (quietDb === null) return levelDb;
  return levelDb < quietDb ? levelDb : quietDb + (levelDb - quietDb) * riseRate;
}
