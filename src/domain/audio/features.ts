import { RealPowerSpectrum } from './fft';

export const SAMPLE_RATE = 16_000;
/** Sub-blocks per frame for the loudness envelope (100 ms each at 1-second frames). */
export const ENVELOPE_RATE_HZ = 10;

const FFT_SIZE = 1024;
const EPS = 1e-12;

/**
 * The band searched for a sound's strongest frequency: above mains hum (50 or 60 Hz) and up to
 * where snoring stops (snoring research measures its "peak frequency" well under 2 kHz).
 */
export const PEAK_MIN_HZ = 70;
export const PEAK_MAX_HZ = 2000;

export interface FrameFeatures {
  /** A-weighted RMS level, dB relative to full scale. */
  levelDb: number;
  /** Spectral centroid of the frame, Hz. */
  centroidHz: number;
  /** Unweighted RMS level of each 100 ms sub-block, dB. */
  envelopeDb: number[];
  /**
   * The strongest frequency between PEAK_MIN_HZ and PEAK_MAX_HZ, Hz: for a snore, its pitch (the
   * "peak frequency" snoring research uses). Missing on seconds stored before it was measured.
   */
  peakHz?: number;
}

/** IEC 61672 A-weighting as a linear power gain. */
export function aWeightingPowerGain(f: number): number {
  if (f <= 0) return 0;
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  // +2.00 dB normalises the curve to 0 dB at 1 kHz.
  const gainDb = 20 * Math.log10(ra) + 2.0;
  return 10 ** (gainDb / 10);
}

let aWeightTable: { sampleRate: number; gains: Float64Array } | null = null;
function aWeights(sampleRate: number): Float64Array {
  if (aWeightTable?.sampleRate !== sampleRate) {
    const gains = new Float64Array(FFT_SIZE / 2 + 1);
    for (let k = 0; k <= FFT_SIZE / 2; k++) gains[k] = aWeightingPowerGain((k * sampleRate) / FFT_SIZE);
    aWeightTable = { sampleRate, gains };
  }
  return aWeightTable.gains;
}

const hann = (() => {
  const w = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  return w;
})();
const hannPower = hann.reduce((s, x) => s + x * x, 0) / FFT_SIZE;

/**
 * The strongest frequency between PEAK_MIN_HZ and PEAK_MAX_HZ in a power spectrum summed over a
 * frame's blocks, placed between bins by a parabola through the peak's log power and its
 * neighbours. 0 when the frame is silent.
 */
function strongestFrequency(spectrum: Float64Array, sampleRate: number): number {
  const binHz = sampleRate / FFT_SIZE;
  const lo = Math.max(1, Math.ceil(PEAK_MIN_HZ / binHz));
  const hi = Math.min(FFT_SIZE / 2 - 1, Math.floor(PEAK_MAX_HZ / binHz));
  let best = lo;
  for (let k = lo + 1; k <= hi; k++) if (spectrum[k] > spectrum[best]) best = k;
  if (spectrum[best] <= 0) return 0;
  const a = Math.log(spectrum[best - 1] + EPS);
  const b = Math.log(spectrum[best] + EPS);
  const c = Math.log(spectrum[best + 1] + EPS);
  const curve = a - 2 * b + c;
  const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
  return (best + shift) * binHz;
}

/**
 * Scales |X[k]|² of a Hann-windowed block to a one-sided power spectrum whose sum over k is the
 * mean-square of the block.
 */
const powerScale = (() => {
  const g = new Float64Array(FFT_SIZE / 2 + 1);
  for (let k = 1; k <= FFT_SIZE / 2; k++) g[k] = (k === FFT_SIZE / 2 ? 1 : 2) / (FFT_SIZE * FFT_SIZE * hannPower);
  return g;
})();

// Every second of the night goes through here, so the FFT plan and the spectrum are made once
// and reused (frameFeatures is synchronous, so one set is enough).
const spectrumPlan = new RealPowerSpectrum(FFT_SIZE);
const spectrum = new Float64Array(FFT_SIZE / 2 + 1);

/** Features for one frame of mono PCM in [-1, 1]. Typically 1 second (16,000 samples). */
export function frameFeatures(samples: Float32Array, sampleRate = SAMPLE_RATE): FrameFeatures {
  const weights = aWeights(sampleRate);
  spectrum.fill(0);
  let blocks = 0;
  for (let off = 0; off + FFT_SIZE <= samples.length; off += FFT_SIZE) {
    spectrumPlan.accumulate(samples, off, hann, powerScale, spectrum);
    blocks++;
  }
  // Level and centroid are sums over the blocks' spectra, so they are taken once from the total.
  let weightedPower = 0;
  let centroidNum = 0;
  let centroidDen = 0;
  const binHz = sampleRate / FFT_SIZE;
  for (let k = 1; k <= FFT_SIZE / 2; k++) {
    const p = spectrum[k];
    weightedPower += p * weights[k];
    centroidNum += p * k * binHz;
    centroidDen += p;
  }

  const sub = Math.floor(samples.length / ENVELOPE_RATE_HZ);
  const envelopeDb: number[] = [];
  for (let b = 0; b < ENVELOPE_RATE_HZ && sub > 0; b++) {
    let ms = 0;
    for (let i = b * sub; i < (b + 1) * sub; i++) ms += samples[i] * samples[i];
    envelopeDb.push(10 * Math.log10(ms / sub + EPS));
  }

  return {
    levelDb: 10 * Math.log10((blocks > 0 ? weightedPower / blocks : 0) + EPS),
    centroidHz: centroidDen > 0 ? centroidNum / centroidDen : 0,
    envelopeDb,
    peakHz: blocks > 0 ? strongestFrequency(spectrum, sampleRate) : 0,
  };
}
