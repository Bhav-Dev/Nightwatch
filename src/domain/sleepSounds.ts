/**
 * Sleep sounds: steady noise only. Rhythmic sounds (waves, music, rain with thunder) are left out
 * on purpose: the phone's own microphone hears them, and a slow rise and fall at breathing pace
 * looks like snoring. Steady noise just raises the room's level, which the analysis allows for.
 */
export type SleepSoundKind = 'white' | 'pink' | 'brown';

export const SLEEP_SOUNDS: { kind: SleepSoundKind; name: string; short: string; description: string }[] = [
  { kind: 'pink', name: 'Pink noise', short: 'Pink', description: 'Soft and even, like steady rain' },
  { kind: 'brown', name: 'Brown noise', short: 'Brown', description: 'Deep and low, like a distant waterfall' },
  { kind: 'white', name: 'White noise', short: 'White', description: 'Bright and even, like a fan' },
];

export const sleepSoundName = (kind: string | null): string => SLEEP_SOUNDS.find((s) => s.kind === kind)?.name ?? 'Sleep sounds';

/** The sound stops after this long, so the rest of the night records cleanly. */
export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const;
export const DEFAULT_SLEEP_TIMER_MINUTES = 30;
/** The last stretch of the timer fades out rather than stopping suddenly. */
export const SLEEP_SOUND_FADE_S = 60;
/** Level of the generated noise (0 to 1) before the phone's own volume. */
export const SLEEP_SOUND_GAIN = 0.35;
export const SLEEP_SOUND_PREVIEW_S = 12;
