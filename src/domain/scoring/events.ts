import { MAX_GAP_S, MERGE_WITHIN_S, MIN_EVENT_S } from './constants';
import type { Frame, Intensity, SnoreEvent } from './types';

export function intensityFor(dbAboveFloor: number): Intensity {
  if (dbAboveFloor >= 30) return 'epic';
  if (dbAboveFloor >= 20) return 'loud';
  if (dbAboveFloor >= 10) return 'light';
  return 'quiet';
}

interface Span {
  startS: number;
  endS: number;
}

/**
 * Turns per-second snore decisions into events.
 *
 * 1. Runs of snore frames, bridging non-snore gaps of up to MAX_GAP_S.
 * 2. Runs shorter than MIN_EVENT_S are dropped.
 * 3. Surviving runs separated by less than MERGE_WITHIN_S merge.
 *
 * Frames missing from the input (an interrupted stretch) count as non-snore.
 */
export function detectEventSpans(isSnore: boolean[]): Span[] {
  const runs: Span[] = [];
  let runStart = -1;
  let lastSnore = -1;
  for (let t = 0; t < isSnore.length; t++) {
    if (!isSnore[t]) continue;
    if (runStart >= 0 && t - lastSnore - 1 <= MAX_GAP_S) {
      lastSnore = t;
      continue;
    }
    if (runStart >= 0) runs.push({ startS: runStart, endS: lastSnore + 1 });
    runStart = t;
    lastSnore = t;
  }
  if (runStart >= 0) runs.push({ startS: runStart, endS: lastSnore + 1 });

  const long = runs.filter((r) => r.endS - r.startS >= MIN_EVENT_S);

  const merged: Span[] = [];
  for (const run of long) {
    const prev = merged[merged.length - 1];
    if (prev && run.startS - prev.endS < MERGE_WITHIN_S) {
      prev.endS = run.endS;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Builds events with levels relative to the floor, from a dense per-second level array (NaN where not recorded). */
export function buildEvents(spans: Span[], levelAboveFloor: number[]): SnoreEvent[] {
  return spans.map(({ startS, endS }) => {
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let t = startS; t < endS; t++) {
      const level = levelAboveFloor[t];
      if (Number.isNaN(level)) continue;
      peak = Math.max(peak, level);
      sum += level;
      n++;
    }
    const meanDb = n > 0 ? sum / n : 0;
    return { startS, endS, peakDb: peak, meanDb, intensity: intensityFor(peak) };
  });
}

export function densify(frames: Frame[], durationS: number): { level: number[]; prob: number[] } {
  const level = new Array<number>(durationS).fill(Number.NaN);
  const prob = new Array<number>(durationS).fill(0);
  for (const f of frames) {
    if (f.t < 0 || f.t >= durationS) continue;
    level[f.t] = f.levelDb;
    prob[f.t] = f.snoreProb;
  }
  return { level, prob };
}
