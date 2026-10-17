import type { FrameFeatures } from './audio/features';
import { modulationDepthDb } from './detection/heuristic';
import type { AlignedSample } from './health';
import { percentile } from './scoring/analyseNight';
import { FLOOR_PERCENTILE } from './scoring/constants';

/**
 * What else happened in the night, found without a model (docs/night-events-design.md, the first
 * step): tossing and turning heard in the audio, restless stretches, and when the person was
 * possibly awake. All of it is an estimate, and the copy says so ("we heard", "possibly awake").
 */

export interface Span {
  startS: number;
  endS: number;
}

export interface Movement extends Span {
  /** Loudness above the night's floor, dB. */
  peakDb: number;
}

/**
 * Turning over is a short rustle: louder than the room, broadband (well above snoring's pitch),
 * uneven within the second, and over in seconds. Anything longer (talking, a television) is
 * something else and is left out.
 */
export const MOVEMENT = {
  minAboveFloorDb: 6,
  minCentroidHz: 1500,
  minModulationDb: 2,
  /** Rustling seconds this close together are one movement. */
  joinGapS: 2,
  maxBurstS: 15,
  /** Settling down and reaching for the phone at either end of the night are not counted. */
  edgeS: 120,
} as const;

/** Movements in a night, from the per-second features kept while recording. Runs at Stop. */
export function detectMovement(
  frames: readonly { t: number; features: FrameFeatures }[],
  snoring: readonly { t: number; snoreProb: number }[],
  opts: { durationS: number; maskedUntilS?: number },
): Movement[] {
  if (frames.length === 0) return [];
  const nightFloorDb = percentile(
    frames.map((f) => f.features.levelDb),
    FLOOR_PERCENTILE,
  );
  // Under sleep sounds a rustle has to stand out from the sound, as snoring does.
  const masked = opts.maskedUntilS ?? 0;
  const maskedLevels = masked > 0 ? frames.filter((f) => f.t < masked).map((f) => f.features.levelDb) : [];
  const maskedFloorDb = maskedLevels.length > 0 ? Math.max(nightFloorDb, percentile(maskedLevels, FLOOR_PERCENTILE)) : nightFloorDb;
  const snoreAt = new Set(snoring.filter((s) => s.snoreProb >= 0.5).map((s) => s.t));

  const out: Movement[] = [];
  const keep = (run: Movement | null) => {
    if (run && run.endS - run.startS <= MOVEMENT.maxBurstS) out.push(run);
  };
  let run = null as Movement | null;
  for (const f of frames) {
    if (f.t < MOVEMENT.edgeS || f.t >= opts.durationS - MOVEMENT.edgeS) continue;
    const above = f.features.levelDb - (f.t < masked ? maskedFloorDb : nightFloorDb);
    const rustle =
      above >= MOVEMENT.minAboveFloorDb &&
      f.features.centroidHz >= MOVEMENT.minCentroidHz &&
      !snoreAt.has(f.t) &&
      modulationDepthDb(f.features.envelopeDb) >= MOVEMENT.minModulationDb;
    if (!rustle) continue;
    if (run && f.t - run.endS <= MOVEMENT.joinGapS) {
      run = { ...run, endS: f.t + 1, peakDb: Math.max(run.peakDb, above) };
    } else {
      keep(run);
      run = { startS: f.t, endS: f.t + 1, peakDb: above };
    }
  }
  keep(run);
  return out;
}

/** Three or more movements within 10 minutes make a restless stretch. */
export const RESTLESS = { windowS: 600, minCount: 3 } as const;

export function restlessStretches(movements: readonly Span[]): Span[] {
  const sorted = [...movements].sort((a, b) => a.startS - b.startS);
  const stretches: Span[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].startS - sorted[i].startS <= RESTLESS.windowS) j++;
    if (j - i + 1 < RESTLESS.minCount) continue;
    const span = { startS: sorted[i].startS, endS: sorted[j].endS };
    const last = stretches[stretches.length - 1];
    if (last && span.startS <= last.endS) last.endS = Math.max(last.endS, span.endS);
    else stretches.push(span);
  }
  return stretches;
}

/** Phone use during recording counts once it is clear of settling down and of stopping in the morning. */
export const PHONE_USE = { fromStartS: 120, beforeEndS: 180 } as const;

export function phoneUseInNight(uses: readonly Span[], durationS: number): Span[] {
  return uses.filter((u) => u.startS >= PHONE_USE.fromStartS && u.endS <= durationS - PHONE_USE.beforeEndS && u.endS > u.startS);
}

/** A watch has to say awake for this long to count; brief stirs are part of normal sleep. */
export const WATCH_AWAKE_MIN_S = 120;

/**
 * When the person was possibly awake: the phone was in use, or a watch said awake. Never stated
 * as certain. Stretches within a minute of each other are joined.
 */
export function possiblyAwake(phone: readonly Span[], watch: readonly AlignedSample[]): Span[] {
  const spans = [
    ...phone,
    ...watch.filter((s) => s.kind === 'sleep_stage' && s.stage === 'awake' && s.endS - s.startS >= WATCH_AWAKE_MIN_S),
  ]
    .map((s) => ({ startS: s.startS, endS: s.endS }))
    .sort((a, b) => a.startS - b.startS);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.startS <= last.endS + 60) last.endS = Math.max(last.endS, s.endS);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * "Turned over, and the snoring stopped": a movement after at least 2 minutes of snoring in the
 * 10 minutes before it, with no snoring carrying on a minute past it and then at least 15 minutes
 * of quiet. Evidence for side sleeping. The longest such quiet is the one reported.
 */
export const TURNED_OVER = { lookBackS: 600, minSnoringBeforeS: 120, graceS: 60, minQuietS: 900 } as const;

export function turnedOverAndQuiet(
  movements: readonly Span[],
  snoring: readonly Span[],
  durationS: number,
): { atS: number; quietS: number; toEnd: boolean } | null {
  const overlap = (a: Span, from: number, to: number) => Math.max(0, Math.min(a.endS, to) - Math.max(a.startS, from));
  let best: { atS: number; quietS: number; toEnd: boolean } | null = null;
  for (const m of movements) {
    const before = snoring.reduce((s, e) => s + overlap(e, m.startS - TURNED_OVER.lookBackS, m.startS + TURNED_OVER.graceS), 0);
    if (before < TURNED_OVER.minSnoringBeforeS) continue;
    const settled = m.endS + TURNED_OVER.graceS;
    if (snoring.some((e) => e.startS < settled && e.endS > settled)) continue;
    const next = snoring.filter((e) => e.startS >= settled).reduce((min, e) => Math.min(min, e.startS), Number.POSITIVE_INFINITY);
    const toEnd = next === Number.POSITIVE_INFINITY;
    const quietS = (toEnd ? durationS : next) - m.endS;
    if (quietS < TURNED_OVER.minQuietS) continue;
    if (!best || quietS > best.quietS) best = { atS: m.startS, quietS, toEnd };
  }
  return best;
}
