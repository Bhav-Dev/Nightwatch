import { clockTimeAt } from './interruption';

/**
 * The morning screen's "Loudest moments": the loudest few clips, listed in the order they
 * happened. Clips that fall in the same minute show seconds, so they never look like duplicates.
 */
export function clipsForDisplay<T extends { peak_s: number; peak_db: number }>(
  clips: readonly T[],
  startedAtS: number,
  max = 5,
): { clip: T; time: string }[] {
  const shown = [...clips]
    .sort((a, b) => b.peak_db - a.peak_db)
    .slice(0, max)
    .sort((a, b) => a.peak_s - b.peak_s);
  const minutes = shown.map((c) => clockTimeAt(startedAtS, c.peak_s));
  return shown.map((clip, i) => ({
    clip,
    time:
      minutes.filter((m) => m === minutes[i]).length > 1 ? clockTimeAt(startedAtS, clip.peak_s, { seconds: true }) : minutes[i],
  }));
}
