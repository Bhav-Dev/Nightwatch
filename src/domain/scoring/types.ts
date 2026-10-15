/** One second of analysed audio. Raw audio is never kept; only these features are. */
export interface Frame {
  /** Offset in seconds from the start of the night. */
  t: number;
  /** A-weighted RMS level in dB (relative to digital full scale; only differences are used). */
  levelDb: number;
  /** Classifier probability that this frame is snoring, 0 to 1. */
  snoreProb: number;
}

/** A stretch of the night when nothing was recorded (call, battery saver, OS kill). */
export interface Gap {
  startS: number;
  endS: number;
}

export type Sensitivity = 'low' | 'normal' | 'high';

export type Intensity = 'quiet' | 'light' | 'loud' | 'epic';

export type ScoreLabel = 'Quiet' | 'Light' | 'Moderate' | 'Loud' | 'Epic';

export interface SnoreEvent {
  /** Offset from night start, inclusive. */
  startS: number;
  /** Offset from night start, exclusive. */
  endS: number;
  /** dB above the night's noise floor. */
  peakDb: number;
  meanDb: number;
  intensity: Intensity;
}

export interface Bin {
  index: number;
  meanDb: number;
  maxDb: number;
  snoreS: number;
}

export interface NightAnalysis {
  scoreVersion: number;
  floorDb: number;
  timeInBedS: number;
  events: SnoreEvent[];
  bins: Bin[];
  pctSnoring: number;
  meanEventDb: number;
  maxDb: number;
  score: number;
  label: ScoreLabel;
  /** False for nights under 3 hours in bed, interrupted or not: scored, but kept out of averages and trends. */
  countsTowardAverages: boolean;
}
