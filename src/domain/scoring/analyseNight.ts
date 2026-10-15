import {
  BIN_S,
  FLOOR_PERCENTILE,
  MIN_COUNTED_NIGHT_S,
  SCORE_VERSION,
  SNORE_THRESHOLD,
} from './constants';
import { buildEvents, densify, detectEventSpans } from './events';
import { meanEventDb, scoreLabel, snoreScore } from './score';
import type { Bin, Frame, Gap, NightAnalysis, Sensitivity, SnoreEvent } from './types';

export interface NightInput {
  /** Wall-clock seconds from Start to Stop. */
  durationS: number;
  frames: Frame[];
  gaps?: Gap[];
  partial?: boolean;
  sensitivity?: Sensitivity;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function buildBins(durationS: number, levelAboveFloor: number[], events: SnoreEvent[]): Bin[] {
  const binCount = Math.ceil(durationS / BIN_S);
  const inEvent = new Uint8Array(durationS);
  for (const e of events) inEvent.fill(1, e.startS, e.endS);

  const bins: Bin[] = [];
  for (let index = 0; index < binCount; index++) {
    const from = index * BIN_S;
    const to = Math.min(durationS, from + BIN_S);
    let sum = 0;
    let n = 0;
    let max = 0;
    let snoreS = 0;
    for (let t = from; t < to; t++) {
      snoreS += inEvent[t];
      const level = levelAboveFloor[t];
      if (Number.isNaN(level)) continue;
      sum += level;
      n++;
      max = Math.max(max, level);
    }
    bins.push({ index, meanDb: n > 0 ? sum / n : 0, maxDb: max, snoreS });
  }
  return bins;
}

/** Scores a night from per-second frame features. Pure: the same input always gives the same output. */
export function analyseNight(input: NightInput): NightAnalysis {
  const durationS = Math.max(0, Math.floor(input.durationS));
  const threshold = SNORE_THRESHOLD[input.sensitivity ?? 'normal'];
  const { level, prob } = densify(input.frames, durationS);

  const recordedLevels = level.filter((l) => !Number.isNaN(l));
  const floorDb = percentile(recordedLevels, FLOOR_PERCENTILE);
  const aboveFloor = level.map((l) => (Number.isNaN(l) ? l : Math.max(0, l - floorDb)));

  const isSnore = prob.map((p, t) => !Number.isNaN(level[t]) && p >= threshold);
  const events = buildEvents(detectEventSpans(isSnore), aboveFloor);

  const gapS = (input.gaps ?? []).reduce((s, g) => s + Math.max(0, g.endS - g.startS), 0);
  const timeInBedS = Math.max(0, durationS - gapS);
  const snoringS = events.reduce((s, e) => s + (e.endS - e.startS), 0);
  const pctSnoring = timeInBedS > 0 ? Math.min(1, snoringS / timeInBedS) : 0;
  const meanDb = meanEventDb(events);
  const score = snoreScore(pctSnoring, meanDb);

  return {
    scoreVersion: SCORE_VERSION,
    floorDb,
    timeInBedS,
    events,
    bins: buildBins(durationS, aboveFloor, events),
    pctSnoring,
    meanEventDb: meanDb,
    maxDb: events.reduce((m, e) => Math.max(m, e.peakDb), 0),
    score,
    label: scoreLabel(score),
    countsTowardAverages: timeInBedS >= MIN_COUNTED_NIGHT_S,
  };
}

/**
 * Rescores a stored night from its events alone (used when SCORE_VERSION changes).
 * Never needs audio or frames.
 */
export function rescoreFromEvents(events: SnoreEvent[], timeInBedS: number): number {
  const snoringS = events.reduce((s, e) => s + (e.endS - e.startS), 0);
  const pct = timeInBedS > 0 ? Math.min(1, snoringS / timeInBedS) : 0;
  return snoreScore(pct, meanEventDb(events));
}
