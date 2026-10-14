/** Palette taken from the Nightwatch screen mockups. */
export const colors = {
  bg: '#0F1629',
  surface: '#161E33',
  surfaceRaised: '#1E2740',
  border: '#27314A',
  borderStrong: '#2A3450',
  text: '#F4F1EA',
  textMuted: '#9AA3B8',
  textFaint: '#6B7590',
  accent: '#F2B544',
  accentText: '#1A1407',
  /** Improvement (a lower score) in community and personal results. */
  good: '#4FD1A5',
  /** A higher score with a remedy or factor. */
  worse: '#ff8a80',
  info: '#C3CAFF',
  danger: '#ff8a80',
  warningSurface: '#2A2614',
};

/**
 * Snore intensity is a magnitude, so it is one hue (amber) stepping from dim to bright on the
 * dark surface, never a set of unrelated colours.
 */
export const intensityColor = {
  quiet: '#5A4A26',
  light: '#93722C',
  loud: '#D39B35',
  epic: '#FFD98A',
} as const;

export const radius = { card: 22, chip: 999, button: 16 };

export const space = (n: number) => n * 4;
