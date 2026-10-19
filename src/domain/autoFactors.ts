import { percentile } from './scoring/analyseNight';

/**
 * Factors read from the night itself, so they need no logging: when the person went to bed, how
 * long they were in bed, weekend nights, and a noisier room than usual. Like the weather, they
 * join each night's factors on this phone and are compared with the same within-person rule as
 * logged factors.
 */
export type AutoFactor = 'early_bed' | 'late_bed' | 'short_night' | 'long_night' | 'weekend' | 'noisy_room';

export const AUTO_FACTORS = {
  /** Bed from 6pm up to this hour is an early night. */
  earlyBedBeforeHour: 23,
  /** Bed from midnight up to this hour is a late one. */
  lateBedUntilHour: 5,
  shortUnderS: 6 * 3600,
  longFromS: 8 * 3600,
  /** The room's quiet level this far above the person's usual counts as noisier. */
  noisyAboveUsualDb: 6,
} as const;

export const autoFactorId = (f: AutoFactor) => `auto:${f}`;

export const AUTO_FACTOR_WORDS: Record<AutoFactor, { name: string; tonight: string; nights: string }> = {
  early_bed: { name: 'Bed before 11pm', tonight: 'You went to bed before 11pm', nights: 'early nights' },
  late_bed: { name: 'Bed after midnight', tonight: 'You went to bed after midnight', nights: 'after-midnight nights' },
  short_night: { name: 'Under 6 hours in bed', tonight: 'It was a short night', nights: 'short nights' },
  long_night: { name: '8 hours or more in bed', tonight: 'It was a long night', nights: 'long nights' },
  weekend: { name: 'Friday and Saturday nights', tonight: 'It was a weekend night', nights: 'weekend nights' },
  noisy_room: { name: 'Noisier room than usual', tonight: 'The room was noisier than usual', nights: 'noisier nights' },
};

export interface NightTiming {
  /** When recording started, epoch seconds (the phone's local time is used). */
  startedAtS: number;
  timeInBedS: number;
  /** The room's quiet level that night, dBFS. */
  floorDb: number | null;
}

/** The person's usual room level: the median of their nights' quiet levels. */
export function usualFloorDb(nights: readonly Pick<NightTiming, 'floorDb'>[]): number | null {
  const floors = nights.map((n) => n.floorDb).filter((f): f is number => f !== null);
  return floors.length ? percentile(floors, 50) : null;
}

export function autoFactorsFor(night: NightTiming, usualFloor: number | null): AutoFactor[] {
  const start = new Date(night.startedAtS * 1000);
  const hour = start.getHours();
  const out: AutoFactor[] = [];
  if (hour >= 18 && hour < AUTO_FACTORS.earlyBedBeforeHour) out.push('early_bed');
  if (hour < AUTO_FACTORS.lateBedUntilHour) out.push('late_bed');
  if (night.timeInBedS < AUTO_FACTORS.shortUnderS) out.push('short_night');
  if (night.timeInBedS >= AUTO_FACTORS.longFromS) out.push('long_night');
  // The night belongs to the evening it began: bed at 1am on Saturday is Friday night.
  const evening = new Date(start);
  if (hour < 12) evening.setDate(evening.getDate() - 1);
  if (evening.getDay() === 5 || evening.getDay() === 6) out.push('weekend');
  if (usualFloor !== null && night.floorDb !== null && night.floorDb >= usualFloor + AUTO_FACTORS.noisyAboveUsualDb) out.push('noisy_room');
  return out;
}
