/**
 * A calm night sky: deep indigo behind everything, frosted cards, and warm honey for
 * the one thing to tap. Surfaces are slightly see-through so the sky shows through them.
 */
export const colors = {
  bg: '#0B1026',
  surface: 'rgba(28, 36, 80, 0.62)',
  surfaceRaised: 'rgba(46, 56, 112, 0.72)',
  border: 'rgba(170, 182, 255, 0.12)',
  borderStrong: 'rgba(170, 182, 255, 0.24)',
  text: '#F4F1FF',
  textMuted: '#AAB1D6',
  textFaint: '#7E87B2',
  /** Honey: the primary action and the brand colour. */
  accent: '#F6C85F',
  accentText: '#1F1A0C',
  /** Improvement (a lower score) in community and personal results. */
  good: '#5FD8B0',
  /** A higher score with a remedy or factor. */
  worse: '#FF9C8F',
  info: '#BFC8FF',
  danger: '#FF9C8F',
  warningSurface: 'rgba(84, 70, 22, 0.6)',
  tabBar: 'rgba(8, 11, 30, 0.96)',
};

/** Sky gradients, top to bottom. */
export const sky = {
  /** Most screens: a starry indigo night. */
  night: ['#1E2459', '#111639', '#090C1F'],
  /** While recording: nearly black, so the screen does not light the room. */
  deep: ['#07080F', '#030409'],
  /** Remedies, Trends and the screens opened from them: the same indigo, without the night sky. */
  plain: ['#121838', '#0B1026'],
  /** This morning: a sunrise, warm apricot at the top through coral and rose to a dusky blue. */
  dawn: ['#F9C59A', '#EE9A8F', '#B07597', '#4B4A88', '#1F2558'],
  // This morning, following the weather (sun and clouds, rain, snow and fog are drawn on top).
  dawnPartly: ['#F9C59A', '#EE9A8F', '#B07597', '#4B4A88', '#1F2558'],
  dawnCloudy: ['#E3C7B8', '#C4A6AE', '#8F86A8', '#4A4E7E', '#212855'],
  dawnRain: ['#A3B1C6', '#8290AE', '#606C94', '#3B4473', '#1E2650'],
  dawnSnow: ['#EEF2F8', '#CDD6E6', '#9AA6C6', '#58628F', '#252D5A'],
  dawnFog: ['#DCD5DB', '#C0B8C5', '#918BA4', '#4F517A', '#242A55'],
} as const;

export type SkyVariant = keyof typeof sky;

/** The morning sky for the weather (a plain sunrise when there is no weather). */
export function morningSky(condition: string | null): SkyVariant {
  switch (condition) {
    case 'partly':
      return 'dawnPartly';
    case 'cloudy':
      return 'dawnCloudy';
    case 'rain':
    case 'thunder':
      return 'dawnRain';
    case 'snow':
      return 'dawnSnow';
    case 'fog':
      return 'dawnFog';
    default:
      return 'dawn';
  }
}

export const isMorningSky = (v: SkyVariant) => v.startsWith('dawn');

/**
 * What sits directly on the sky. The sunrise is bright at the top, so its header text and icons
 * are dark, and its cards are more solid so their text stays crisp on the warm colours.
 */
const NIGHT_TONES = { title: '#F4F1FF', eyebrow: '#F6C85F', icon: '#AAB1D6', card: 'rgba(28, 36, 80, 0.62)', statusBar: 'light' as const };
const MORNING_TONES = { title: '#2A1F3D', eyebrow: '#8A3F2C', icon: '#3A2E4F', card: 'rgba(28, 26, 66, 0.86)', statusBar: 'dark' as const };
const COOL_MORNING_TONES = { ...MORNING_TONES, eyebrow: '#3E4C78' };

export const onSky: Record<SkyVariant, { title: string; eyebrow: string; icon: string; card: string; statusBar: 'light' | 'dark' }> = {
  night: NIGHT_TONES,
  deep: NIGHT_TONES,
  plain: NIGHT_TONES,
  dawn: MORNING_TONES,
  dawnPartly: MORNING_TONES,
  dawnCloudy: MORNING_TONES,
  dawnRain: COOL_MORNING_TONES,
  dawnSnow: COOL_MORNING_TONES,
  dawnFog: MORNING_TONES,
};

/** Rounded, friendly headings (loaded in the root layout); body text stays the system font. */
export const fonts = {
  heading: 'Nunito_800ExtraBold',
  headingSemi: 'Nunito_700Bold',
};

/**
 * Snore intensity is a magnitude, so it is one hue (moonlight gold) stepping from dim to bright,
 * never a set of unrelated colours.
 */
export const intensityColor = {
  quiet: '#5C5236',
  light: '#9A8344',
  loud: '#D9B45C',
  epic: '#FFE6A8',
} as const;

/**
 * One colour per kind of moment on the morning timeline, its filter chips and its list. They
 * differ in lightness as well as hue, and each is also drawn as its own shape (snoring fills the
 * outline, movement is a tick, possibly awake a band, other sounds a mark above).
 */
export const momentColor = {
  snore: '#F6C85F',
  move: '#F08A3C',
  awake: '#E8546B',
  other: '#9FB0FF',
} as const;

/** Honey, light to deep: the logo's cell outline and the honeycomb pieces (src/ui/Hive.tsx). */
export const honey = ['#FFE9AE', '#F6C85F', '#E9A23F'] as const;

export const radius = { card: 24, chip: 999, button: 18 };

export const space = (n: number) => n * 4;
