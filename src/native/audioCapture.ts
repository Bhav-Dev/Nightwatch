import type { AssembledGap } from '../domain/audio/frameAssembler';

/**
 * Overnight audio capture. Implementations deliver mono PCM aligned to whole seconds and
 * report stretches where nothing was captured. JS turns each second into a few features
 * and drops the audio straight away.
 */

export const CAPTURE_SAMPLE_RATE = 16_000;
export const CAPTURE_WINDOW_S = 30;

export interface CaptureWindow {
  /** Offset in seconds of the first sample from the start of the session; an integer. */
  startS: number;
  /** Mono PCM in [-1, 1], a whole number of seconds long. */
  samples: Float32Array;
  sampleRate: number;
}

export type CaptureInterruption = AssembledGap;

export interface CaptureListener {
  onWindow(window: CaptureWindow): void;
  onInterrupted?(interruption: CaptureInterruption): void;
}

export interface AudioCapture {
  /** Asks for microphone permission if needed. Resolves false if denied. */
  requestPermission(): Promise<boolean>;
  start(listener: CaptureListener): Promise<void>;
  stop(): Promise<void>;
  isRecording(): boolean;
}

/**
 * Emits synthetic windows on a timer: background noise with a stretch of breathing-rate
 * snoring. Lets the app and the analysis pipeline run in Expo Go and in CI.
 */
export class SimulatedCapture implements AudioCapture {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStartS = 0;

  constructor(
    private readonly windowEveryMs = 1000,
    private readonly synth: (startS: number, seconds: number) => Float32Array = synthesiseNightAudio,
  ) {}

  async requestPermission(): Promise<boolean> {
    return true;
  }

  async start(listener: CaptureListener): Promise<void> {
    this.nextStartS = 0;
    this.timer = setInterval(() => {
      const startS = this.nextStartS;
      this.nextStartS += CAPTURE_WINDOW_S;
      listener.onWindow({ startS, samples: this.synth(startS, CAPTURE_WINDOW_S), sampleRate: CAPTURE_SAMPLE_RATE });
    }, this.windowEveryMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRecording(): boolean {
    return this.timer !== null;
  }
}

/** Deterministic pseudo-random noise so synthetic nights are reproducible. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

export interface SynthOptions {
  /** Background noise amplitude (RMS-ish), default 0.002. */
  noiseAmp?: number;
  /** Snore amplitude, default 0.1. */
  snoreAmp?: number;
  /** Breath period in seconds, default 4. */
  breathPeriodS?: number;
  /** Seconds of each breath with audible snoring, default 1.6. */
  snoreOnS?: number;
  /** Whether second `t` is inside a snoring stretch. Default: minutes 2 to 6 of every 10. */
  snoringAt?: (t: number) => boolean;
}

/**
 * Synthetic bedroom audio: low-level broadband noise, and during snoring stretches a
 * low-pitched harmonic sound gated at breathing rate.
 */
export function synthesiseNightAudio(startS: number, seconds: number, opts: SynthOptions = {}): Float32Array {
  const {
    noiseAmp = 0.002,
    snoreAmp = 0.1,
    breathPeriodS = 4,
    snoreOnS = 1.6,
    snoringAt = (t: number) => t % 600 >= 120 && t % 600 < 360,
  } = opts;
  const sr = CAPTURE_SAMPLE_RATE;
  const out = new Float32Array(seconds * sr);
  const rand = noise(startS + 1);
  for (let i = 0; i < out.length; i++) {
    const t = startS + i / sr;
    let x = noiseAmp * rand();
    if (snoringAt(Math.floor(t)) && t % breathPeriodS < snoreOnS) {
      const f0 = 110;
      x +=
        snoreAmp *
        (0.6 * Math.sin(2 * Math.PI * f0 * t) +
          0.3 * Math.sin(2 * Math.PI * 2 * f0 * t) +
          0.1 * Math.sin(2 * Math.PI * 3 * f0 * t)) *
        (1 + 0.3 * rand());
    }
    out[i] = x;
  }
  return out;
}
