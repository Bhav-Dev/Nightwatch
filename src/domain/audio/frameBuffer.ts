import { frameFeatures, SAMPLE_RATE, type FrameFeatures } from './features';

/**
 * Collects per-second features from capture windows as they arrive, so the audio can be
 * discarded immediately. Gaps between windows (an interruption) are left as missing frames.
 */
export class FrameFeatureBuffer {
  private readonly frames = new Map<number, FrameFeatures>();

  constructor(private readonly sampleRate = SAMPLE_RATE) {}

  addWindow(startS: number, samples: Float32Array): void {
    const seconds = Math.floor(samples.length / this.sampleRate);
    for (let s = 0; s < seconds; s++) {
      const frame = samples.subarray(s * this.sampleRate, (s + 1) * this.sampleRate);
      this.frames.set(startS + s, frameFeatures(frame, this.sampleRate));
    }
  }

  get size(): number {
    return this.frames.size;
  }

  /** Features ordered by second, with `t` attached. */
  entries(): { t: number; features: FrameFeatures }[] {
    return [...this.frames.entries()].sort((a, b) => a[0] - b[0]).map(([t, features]) => ({ t, features }));
  }
}
