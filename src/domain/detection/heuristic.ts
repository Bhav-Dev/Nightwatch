import { ENVELOPE_RATE_HZ, type FrameFeatures } from '../audio/features';
import { FLOOR_PERCENTILE } from '../scoring/constants';
import { percentile } from '../scoring/analyseNight';
import type { Frame } from '../scoring/types';

/**
 * Detection v0: an energy-and-periodicity heuristic used to propose candidate regions
 * for human labelling. Not for release; v1 is an on-device classifier.
 *
 * A frame is snore-like when all three hold:
 * - its level is at least 8 dB above the night's floor,
 * - its spectral centroid is under 1.5 kHz,
 * - the loudness envelope over the surrounding 10 seconds repeats with a period of
 *   1 to 5 seconds (0.2 to 1.0 Hz), i.e. it follows breathing.
 */
export const HEURISTIC = {
  minAboveFloorDb: 8,
  maxCentroidHz: 1500,
  contextS: 10,
  minPeriodS: 1,
  maxPeriodS: 5,
  minAutocorrelation: 0.3,
  /** Breathing gates snoring on and off; steady noise barely moves the envelope. */
  minModulationDb: 3,
} as const;

/**
 * Strength of a repeating rhythm in a series: the highest normalised autocorrelation at a
 * lag in [minLag, maxLag], counting only peaks that come after the autocorrelation has
 * dipped below zero. A single step (quiet to loud) or slow drift decays without a later
 * peak, so it scores 0.
 */
export function periodicity(series: number[], minLag: number, maxLag: number): number {
  const n = series.length;
  if (n < 2 * minLag) return 0;
  const mean = series.reduce((s, x) => s + x, 0) / n;
  const x = series.map((v) => v - mean);
  const energy = x.reduce((s, v) => s + v * v, 0);
  if (energy <= 1e-9) return 0;
  let dipped = false;
  let best = 0;
  for (let lag = 1; lag <= Math.min(maxLag, n - 1); lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += x[i] * x[i + lag];
    const r = acc / energy;
    if (r < 0) dipped = true;
    if (dipped && lag >= minLag) best = Math.max(best, r);
  }
  return best;
}

/** Standard deviation of a series; for an envelope in dB, how strongly the level swings. */
export function modulationDepthDb(series: number[]): number {
  if (series.length === 0) return 0;
  const mean = series.reduce((s, x) => s + x, 0) / series.length;
  return Math.sqrt(series.reduce((s, x) => s + (x - mean) ** 2, 0) / series.length);
}

/**
 * Labels a whole night of frame features (ordered by second). The floor needs the full night, so this runs
 * once at Stop over the features kept during recording (the audio itself is long gone).
 */
export function classifyNightHeuristic(frames: { t: number; features: FrameFeatures }[]): Frame[] {
  const features = frames.map((f) => f.features);
  const floorDb = percentile(
    features.map((f) => f.levelDb),
    FLOOR_PERCENTILE,
  );
  const half = Math.floor(HEURISTIC.contextS / 2);
  const minLag = HEURISTIC.minPeriodS * ENVELOPE_RATE_HZ;
  const maxLag = HEURISTIC.maxPeriodS * ENVELOPE_RATE_HZ;

  return features.map((f, i) => {
    let snore = f.levelDb - floorDb >= HEURISTIC.minAboveFloorDb && f.centroidHz < HEURISTIC.maxCentroidHz;
    if (snore) {
      const context: number[] = [];
      for (let j = Math.max(0, i - half); j < Math.min(features.length, i + half); j++) {
        context.push(...features[j].envelopeDb);
      }
      snore =
        modulationDepthDb(context) >= HEURISTIC.minModulationDb &&
        periodicity(context, minLag, maxLag) >= HEURISTIC.minAutocorrelation;
    }
    return { t: frames[i].t, levelDb: f.levelDb, snoreProb: snore ? 1 : 0 };
  });
}
