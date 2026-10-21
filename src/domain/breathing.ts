import { ENVELOPE_RATE_HZ, type FrameFeatures } from './audio/features';
import { modulationDepthDb, periodicity } from './detection/heuristic';
import { percentile } from './scoring/analyseNight';
import { FLOOR_PERCENTILE } from './scoring/constants';

/**
 * Heavy breathing: breathing loud enough to stand out from the room, that is not snoring. Found
 * without a model, like movement (docs/night-events-design.md), and kept on the cautious side: a
 * second counts only when all of these hold, and only long stretches of such seconds are kept.
 * - It is at least 6 dB above the night's floor.
 * - It is broadband, like air rushing (a spectral centroid of 1.5 to 5 kHz). Snoring's signature
 *   is a low, buzzing sound, so anything with snoring's low centroid is left to the snoring detector.
 * - Its loudness rises and falls with breathing: the envelope over the surrounding 14 seconds
 *   repeats every 1.5 to 6 seconds, more regularly than the snoring rule asks for, and more
 *   strongly than at any faster rhythm (a ticking clock or panting repeats at breathing's pace too).
 * - It is not snoring, and not within a few seconds of snoring (the breath between snores).
 * It is an estimate, and the words say so ("we heard"); it says nothing about health.
 */
export const HEAVY_BREATHING = {
  minAboveFloorDb: 6,
  minCentroidHz: 1500,
  maxCentroidHz: 5000,
  contextS: 14,
  minPeriodS: 1.5,
  maxPeriodS: 6,
  minAutocorrelation: 0.4,
  /** Rhythms from this period up to minPeriodS are faster than breathing. */
  fastPeriodS: 0.5,
  minModulationDb: 3,
  /** Breathing seconds this close together are one stretch. */
  joinGapS: 5,
  /** Shorter stretches are left out: a few loud breaths are not heavy breathing. */
  minStretchS: 20,
  /** Stretches closer than this become one. */
  mergeWithinS: 20,
  /** Seconds kept clear around snoring: breathing right next to a snore belongs to it. */
  snoreGuardS: 5,
  /** Settling down and getting up at either end of the night are not counted. */
  edgeS: 120,
} as const;

export interface BreathingStretch {
  startS: number;
  endS: number;
  /** Loudness above the night's floor, dB. */
  peakDb: number;
}

/** Heavy breathing in a night, from the per-second features kept while recording. Runs at Stop. */
export function detectHeavyBreathing(
  frames: readonly { t: number; features: FrameFeatures }[],
  snoring: readonly { t: number; snoreProb: number }[],
  opts: { durationS: number; maskedUntilS?: number },
): BreathingStretch[] {
  if (frames.length === 0) return [];
  const H = HEAVY_BREATHING;
  const nightFloorDb = percentile(
    frames.map((f) => f.features.levelDb),
    FLOOR_PERCENTILE,
  );
  // Under sleep sounds, breathing has to stand out from the sound, as snoring does.
  const masked = opts.maskedUntilS ?? 0;
  const maskedLevels = masked > 0 ? frames.filter((f) => f.t < masked).map((f) => f.features.levelDb) : [];
  const maskedFloorDb = maskedLevels.length > 0 ? Math.max(nightFloorDb, percentile(maskedLevels, FLOOR_PERCENTILE)) : nightFloorDb;
  const nearSnore = new Set<number>();
  for (const s of snoring) {
    if (s.snoreProb < 0.5) continue;
    for (let t = s.t - H.snoreGuardS; t <= s.t + H.snoreGuardS; t++) nearSnore.add(t);
  }

  const half = Math.floor(H.contextS / 2);
  const minLag = Math.round(H.minPeriodS * ENVELOPE_RATE_HZ);
  const maxLag = Math.round(H.maxPeriodS * ENVELOPE_RATE_HZ);
  const fastLag = Math.round(H.fastPeriodS * ENVELOPE_RATE_HZ);
  const breathing: { t: number; above: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const { t, features: f } = frames[i];
    if (t < H.edgeS || t >= opts.durationS - H.edgeS || nearSnore.has(t)) continue;
    const above = f.levelDb - (t < masked ? maskedFloorDb : nightFloorDb);
    if (above < H.minAboveFloorDb || f.centroidHz < H.minCentroidHz || f.centroidHz > H.maxCentroidHz) continue;
    const context: number[] = [];
    for (let j = Math.max(0, i - half); j < Math.min(frames.length, i + half); j++) {
      // Only seconds next to each other: a gap in the recording breaks the rhythm.
      if (Math.abs(frames[j].t - t) <= half) context.push(...frames[j].features.envelopeDb);
    }
    if (modulationDepthDb(context) < H.minModulationDb) continue;
    const rhythm = periodicity(context, minLag, maxLag);
    if (rhythm < H.minAutocorrelation || periodicity(context, fastLag, minLag - 1) >= rhythm) continue;
    breathing.push({ t, above });
  }

  // Seconds into stretches (bridging short gaps), long enough ones kept, near ones joined.
  const runs: BreathingStretch[] = [];
  for (const b of breathing) {
    const last = runs[runs.length - 1];
    if (last && b.t - last.endS <= H.joinGapS) {
      last.endS = b.t + 1;
      last.peakDb = Math.max(last.peakDb, b.above);
    } else runs.push({ startS: b.t, endS: b.t + 1, peakDb: b.above });
  }
  const merged: BreathingStretch[] = [];
  for (const r of runs.filter((x) => x.endS - x.startS >= H.minStretchS)) {
    const last = merged[merged.length - 1];
    if (last && r.startS - last.endS < H.mergeWithinS) {
      last.endS = r.endS;
      last.peakDb = Math.max(last.peakDb, r.peakDb);
    } else merged.push({ ...r });
  }
  return merged;
}

/**
 * Movement heard during heavy breathing is the breathing: each loud breath can sound like a
 * rustle. Movements inside a stretch of it, or within half its context of either end (where the
 * stretch starts and ends is known only to a few seconds), are left out.
 */
export function withoutHeavyBreathing<T extends { startS: number; endS: number }>(movements: readonly T[], breathing: readonly BreathingStretch[]): T[] {
  const margin = HEAVY_BREATHING.contextS / 2;
  return movements.filter((m) => !breathing.some((b) => m.startS < b.endS + margin && m.endS > b.startS - margin));
}
