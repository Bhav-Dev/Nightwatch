import type { Sensitivity } from './types';

/** Stored with every night; bump when the formula changes and rescore from stored bins and events. */
export const SCORE_VERSION = 1;

export const SNORE_THRESHOLD: Record<Sensitivity, number> = {
  low: 0.7,
  normal: 0.6,
  high: 0.5,
};

/** Non-snore gaps of up to this many seconds do not break a run of snore frames. */
export const MAX_GAP_S = 5;
/** A run must last at least this long to count as an event. */
export const MIN_EVENT_S = 10;
/** Events separated by less than this merge into one. */
export const MERGE_WITHIN_S = 20;

/** Noise floor: this percentile of frame levels over the night. */
export const FLOOR_PERCENTILE = 0.05;

export const BIN_S = 5 * 60;

/** Partial nights shorter than this are scored but excluded from averages. */
export const MIN_COUNTED_NIGHT_S = 3 * 60 * 60;

/** pct_snoring at which the time component saturates. */
export const PCT_SATURATION = 0.5;
/** Mean event level (dB above floor) at which the loudness component saturates. */
export const LOUDNESS_SATURATION_DB = 30;
export const PCT_WEIGHT = 0.6;
export const LOUDNESS_WEIGHT = 0.4;
