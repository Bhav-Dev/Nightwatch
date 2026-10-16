/**
 * A calm night sky: deep indigo behind everything, frosted cards, and a warm moonlight gold for
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
  /** Moonlight gold: the primary action and the brand colour. */
  accent: '#F6D78E',
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
  /** This morning: a dusky dawn glow at the top fading into the night. */
  dawn: ['#6B4B63', '#33305F', '#0E1330'],
} as const;

export type SkyVariant = keyof typeof sky;

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

export const radius = { card: 24, chip: 999, button: 18 };

export const space = (n: number) => n * 4;
