import type { FrameFeatures } from './audio/features';

/**
 * Snore pitch: the strongest frequency of each snoring second (FrameFeatures.peakHz), summed up
 * per stretch of snoring when the night is saved, per night, and across nights for the snore
 * profile. A phone across the bedroom hears a rough version of the sound, so the pitch is
 * described in words, as a clue to talk about and never as a finding about the airway.
 */

export type PitchBand = 'low' | 'mid' | 'high';

/**
 * Where the words change. Studies that recorded snoring during sleep endoscopy found snoring from
 * the soft palate at low peak frequencies (a couple of hundred hertz) and snoring from the tongue
 * base much higher (often over a kilohertz), with mixed snoring in between.
 */
export const PITCH_BAND_HZ = { lowBelow: 300, highFrom: 800 } as const;

/** A stretch needs this many snoring seconds with a pitch before its pitch is kept. */
export const MIN_STRETCH_PITCH_S = 5;
/** A night needs this many snoring seconds with a pitch before it has a pitch of its own. */
export const MIN_NIGHT_PITCH_S = 30;
/** Nights with a pitch needed before the profile describes it. */
export const MIN_PROFILE_PITCH_NIGHTS = 3;

export function pitchBand(hz: number): PitchBand {
  return hz < PITCH_BAND_HZ.lowBelow ? 'low' : hz < PITCH_BAND_HZ.highFrom ? 'mid' : 'high';
}

/** The words for each band. `linked` is what research often links it with: never a finding. */
export const PITCH_WORDS: Record<PitchBand, { short: string; title: string; linked: string }> = {
  low: {
    short: 'low and fluttery',
    title: 'Low and fluttery',
    linked: 'Low, fluttery snoring is often linked with the soft palate at the back of the roof of the mouth vibrating.',
  },
  mid: {
    short: 'mid-pitched',
    title: 'Mid-pitched',
    linked: 'Snoring in the middle range can come from more than one place, or from a mix of them.',
  },
  high: {
    short: 'higher and harsher',
    title: 'Higher and harsher',
    linked: 'Higher, harsher snoring is often linked with the throat narrowing lower down, around the base of the tongue.',
  },
};

export interface PitchStretch {
  startS: number;
  endS: number;
  /** The median strongest frequency of the stretch's snoring seconds, Hz. */
  hz: number;
  /** Snoring seconds that had a pitch: the stretch's weight in a night's pitch. */
  seconds: number;
}

/** The middle value, with each value counted `weight` times. Null when there is nothing to weigh. */
export function weightedMedian(values: readonly { value: number; weight: number }[]): number | null {
  const sorted = values.filter((v) => v.weight > 0 && Number.isFinite(v.value)).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return null;
  let seen = 0;
  for (const v of sorted) {
    seen += v.weight;
    if (seen >= total / 2) return v.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * When a night is saved: the pitch of each stretch of snoring, from its snoring seconds. Seconds
 * without a pitch (stored before it was measured, or silent) are left out; so is a stretch with
 * too few seconds to trust.
 */
export function stretchPitches(
  frames: readonly { t: number; features: FrameFeatures }[],
  snoring: readonly { t: number; snoreProb: number }[],
  stretches: readonly { startS: number; endS: number }[],
): PitchStretch[] {
  const snoringAt = new Set(snoring.filter((s) => s.snoreProb >= 0.5).map((s) => s.t));
  const byT = new Map(frames.map((f) => [f.t, f.features]));
  const out: PitchStretch[] = [];
  for (const s of stretches) {
    const hz: { value: number; weight: number }[] = [];
    for (let t = s.startS; t < s.endS; t++) {
      const peak = byT.get(t)?.peakHz;
      if (snoringAt.has(t) && peak !== undefined && peak > 0) hz.push({ value: peak, weight: 1 });
    }
    const median = weightedMedian(hz);
    if (median !== null && hz.length >= MIN_STRETCH_PITCH_S) out.push({ startS: s.startS, endS: s.endS, hz: median, seconds: hz.length });
  }
  return out;
}

const overlaps = (a: { startS: number; endS: number }, b: { startS: number; endS: number }) => a.startS < b.endS && a.endS > b.startS;

/** The pitch of a stretch of the night (a moment): the stretches inside it, weighted by their seconds. */
export function pitchIn(stretches: readonly PitchStretch[], range: { startS: number; endS: number }): number | null {
  return weightedMedian(stretches.filter((s) => overlaps(s, range)).map((s) => ({ value: s.hz, weight: s.seconds })));
}

/**
 * A night's pitch, from the stretches that are still snoring after the user's answers (a stretch
 * they said was not snoring no longer counts). Null below MIN_NIGHT_PITCH_S seconds.
 */
export function nightPitch(
  stretches: readonly PitchStretch[],
  snoring: readonly { startS: number; endS: number }[],
): { hz: number; seconds: number } | null {
  const kept = stretches.filter((s) => snoring.some((e) => overlaps(s, e)));
  const seconds = kept.reduce((n, s) => n + s.seconds, 0);
  const hz = weightedMedian(kept.map((s) => ({ value: s.hz, weight: s.seconds })));
  return hz !== null && seconds >= MIN_NIGHT_PITCH_S ? { hz, seconds } : null;
}

export type ProfilePitch =
  | { band: PitchBand; hz: number; nights: number; spread: { band: PitchBand; nights: number }[] }
  | { band: null; nights: number };

/**
 * Across nights: the middle of the nightly pitches once there are MIN_PROFILE_PITCH_NIGHTS of them,
 * and how many nights fell in each band (snoring can change from night to night).
 */
export function profilePitch(nights: readonly ({ hz: number } | null)[]): ProfilePitch {
  const hz = nights.filter((n): n is { hz: number } => n !== null).map((n) => n.hz);
  if (hz.length < MIN_PROFILE_PITCH_NIGHTS) return { band: null, nights: hz.length };
  const middle = weightedMedian(hz.map((value) => ({ value, weight: 1 })))!;
  const spread = (['low', 'mid', 'high'] as const)
    .map((band) => ({ band, nights: hz.filter((x) => pitchBand(x) === band).length }))
    .filter((s) => s.nights > 0);
  return { band: pitchBand(middle), hz: middle, nights: hz.length, spread };
}

/** "around 140 Hz", rounded to a sensible step so it does not look more exact than it is. */
export function pitchHzWords(hz: number): string {
  const step = hz < 500 ? 10 : 50;
  return `around ${Math.round(hz / step) * step} Hz`;
}
