/** Profile bands. Only bands ever leave the phone; exact height and weight never do. */

export const AGE_BANDS = ['18-29', '30-39', '40-49', '50-59', '60+'] as const;
export const SEXES = ['female', 'male', 'other'] as const;
export const HEIGHT_BANDS = ['<160', '160-169', '170-179', '180-189', '190+'] as const;
export const WEIGHT_BANDS = ['<60', '60-74', '75-89', '90-104', '105-119', '120+'] as const;
export const BMI_BANDS = ['<25', '25-30', '30-35', '35+'] as const;
export const POSITIONS = ['back', 'side', 'front', 'mixed'] as const;
export const PAUSES = ['yes', 'no', 'not_sure'] as const;

export type AgeBand = (typeof AGE_BANDS)[number];
export type Sex = (typeof SEXES)[number];
export type HeightBand = (typeof HEIGHT_BANDS)[number];
export type WeightBand = (typeof WEIGHT_BANDS)[number];
export type BmiBand = (typeof BMI_BANDS)[number];
export type Position = (typeof POSITIONS)[number];
export type Pauses = (typeof PAUSES)[number];

export interface ProfileBands {
  age_band: AgeBand | null;
  sex: Sex | null;
  height_band: HeightBand | null;
  weight_band: WeightBand | null;
  bmi_band: BmiBand | null;
  position: Position | null;
  pauses_reported: Pauses | null;
  apnoea_dx: boolean | null;
  cpap: boolean | null;
}

export const EMPTY_PROFILE: ProfileBands = {
  age_band: null,
  sex: null,
  height_band: null,
  weight_band: null,
  bmi_band: null,
  position: null,
  pauses_reported: null,
  apnoea_dx: null,
  cpap: null,
};

export function ageBand(age: number): AgeBand {
  if (age < 30) return '18-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  return '60+';
}

export function heightBand(cm: number): HeightBand {
  if (cm < 160) return '<160';
  if (cm < 170) return '160-169';
  if (cm < 180) return '170-179';
  if (cm < 190) return '180-189';
  return '190+';
}

export function weightBand(kg: number): WeightBand {
  if (kg < 60) return '<60';
  if (kg < 75) return '60-74';
  if (kg < 90) return '75-89';
  if (kg < 105) return '90-104';
  if (kg < 120) return '105-119';
  return '120+';
}

/** BMI band from exact values, computed on the phone; the exact values are then discarded. */
export function bmiBand(heightCm: number, weightKg: number): BmiBand {
  const bmi = weightKg / (heightCm / 100) ** 2;
  if (bmi < 25) return '<25';
  if (bmi < 30) return '25-30';
  if (bmi < 35) return '30-35';
  return '35+';
}

/** Segment dimensions the dashboard can slice by, in key order. */
export const SEGMENT_DIMENSIONS = ['age', 'sex', 'bmi', 'position', 'pauses', 'apnoea'] as const;
export type SegmentDimension = (typeof SEGMENT_DIMENSIONS)[number];

/** The dimensions that make up "people like you". */
export const LIKE_YOU_DIMENSIONS: SegmentDimension[] = ['age', 'bmi', 'position'];

function dimensionValue(p: ProfileBands, d: SegmentDimension): string | null {
  switch (d) {
    case 'age':
      return p.age_band;
    case 'sex':
      return p.sex;
    case 'bmi':
      return p.bmi_band;
    case 'position':
      return p.position;
    case 'pauses':
      return p.pauses_reported;
    case 'apnoea':
      return p.apnoea_dx === null && p.cpap === null ? null : p.apnoea_dx || p.cpap ? 'yes' : 'no';
  }
}

/**
 * Segment key such as "age:40-49|bmi:25-30|position:back", or null when any requested
 * dimension is missing from the profile.
 */
export function segmentKey(p: ProfileBands, dims: readonly SegmentDimension[] = LIKE_YOU_DIMENSIONS): string | null {
  const parts: string[] = [];
  for (const d of SEGMENT_DIMENSIONS) {
    if (!dims.includes(d)) continue;
    const v = dimensionValue(p, d);
    if (v === null) return null;
    parts.push(`${d}:${v}`);
  }
  return parts.join('|');
}

/** Every segment a contributor belongs to: each single dimension plus the "like you" combination. */
export function segmentsFor(p: ProfileBands): string[] {
  const keys = new Set<string>();
  for (const d of SEGMENT_DIMENSIONS) {
    const k = segmentKey(p, [d]);
    if (k) keys.add(k);
  }
  const likeYou = segmentKey(p, LIKE_YOU_DIMENSIONS);
  if (likeYou) keys.add(likeYou);
  return [...keys];
}

export function isSegmentKey(s: string): boolean {
  return s === 'all' || /^([a-z]+:[^|:]+)(\|[a-z]+:[^|:]+)*$/.test(s);
}
