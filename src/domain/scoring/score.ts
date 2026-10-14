import {
  LOUDNESS_SATURATION_DB,
  LOUDNESS_WEIGHT,
  PCT_SATURATION,
  PCT_WEIGHT,
} from './constants';
import type { ScoreLabel, SnoreEvent } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Event-duration-weighted mean of event mean levels above floor. */
export function meanEventDb(events: SnoreEvent[]): number {
  let weighted = 0;
  let total = 0;
  for (const e of events) {
    const d = e.endS - e.startS;
    weighted += e.meanDb * d;
    total += d;
  }
  return total > 0 ? weighted / total : 0;
}

/** score = clamp(0.6 × pct_component + 0.4 × loudness_component, 0, 100), rounded to an integer. */
export function snoreScore(pctSnoring: number, meanEventDbAboveFloor: number): number {
  const pctComponent = 100 * Math.min(pctSnoring / PCT_SATURATION, 1);
  const loudnessComponent = 100 * Math.min(meanEventDbAboveFloor / LOUDNESS_SATURATION_DB, 1);
  return Math.round(clamp(PCT_WEIGHT * pctComponent + LOUDNESS_WEIGHT * loudnessComponent, 0, 100));
}

export function scoreLabel(score: number): ScoreLabel {
  if (score <= 20) return 'Quiet';
  if (score <= 40) return 'Light';
  if (score <= 60) return 'Moderate';
  if (score <= 80) return 'Loud';
  return 'Epic';
}
