/**
 * Turns the microphone stream's small buffers (about 100 ms each) into whole 1-second
 * frames, and notices when audio stopped arriving.
 *
 * Two kinds of gap are detected:
 * - a jump in the stream clock (the OS paused or killed capture, then it resumed or was
 *   restarted), and
 * - digital silence: Android hands a backgrounded or call-preempted app all-zero buffers
 *   instead of an error. Real rooms are never exactly zero.
 */

export type GapCause = 'stalled' | 'microphone_taken';

export interface AssembledGap {
  startS: number;
  endS: number;
  cause: GapCause;
}

export interface AssemblerSink {
  onFrame(t: number, samples: Float32Array, sampleRate: number): void;
  onGap(gap: AssembledGap): void;
}

/** A clock jump longer than this is treated as an interruption. */
export const MAX_CLOCK_JUMP_S = 2;
/** This many consecutive all-zero seconds count as the microphone being taken away. */
export const MIN_SILENT_RUN_S = 2;

export class FrameAssembler {
  private sampleRate = 0;
  private pending: Float32Array = new Float32Array(0);
  private pendingFill = 0;
  /** Session offset (s) of the first sample in `pending`; an integer. */
  private nextFrameT = 0;
  /** Session offset (s) where the stream clock says the next buffer should start. */
  private expectedS: number | null = null;
  private silentRunStart: number | null = null;
  private silentRunLength = 0;

  constructor(private readonly sink: AssemblerSink) {}

  /**
   * @param offsetS session offset in seconds of the first sample in `samples`
   *   (stream timestamp plus the wall-clock offset of the stream's start).
   */
  push(samples: Float32Array, sampleRate: number, offsetS: number): void {
    if (sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
      this.pending = new Float32Array(sampleRate);
      this.pendingFill = 0;
    }

    if (this.expectedS !== null && offsetS - this.expectedS > MAX_CLOCK_JUMP_S) {
      this.flushSilentRun();
      const resumeAt = Math.ceil(offsetS);
      this.sink.onGap({ startS: this.nextFrameT, endS: resumeAt, cause: 'stalled' });
      this.pendingFill = 0;
      this.nextFrameT = resumeAt;
      // Drop the samples before the next whole second so frames stay aligned to seconds.
      const skip = Math.min(samples.length, Math.round((resumeAt - offsetS) * sampleRate));
      samples = samples.subarray(skip);
    }
    this.expectedS = offsetS + samples.length / sampleRate;

    let i = 0;
    while (i < samples.length) {
      const take = Math.min(samples.length - i, sampleRate - this.pendingFill);
      this.pending.set(samples.subarray(i, i + take), this.pendingFill);
      this.pendingFill += take;
      i += take;
      if (this.pendingFill === sampleRate) {
        this.emitFrame(this.pending.slice());
        this.pendingFill = 0;
      }
    }
  }

  /** Call at Stop: closes any open silent run. A partial last second is dropped. */
  finish(): void {
    this.flushSilentRun();
  }

  private emitFrame(frame: Float32Array): void {
    const t = this.nextFrameT++;
    if (isDigitalSilence(frame)) {
      if (this.silentRunStart === null) this.silentRunStart = t;
      this.silentRunLength++;
      return;
    }
    this.flushSilentRun();
    this.sink.onFrame(t, frame, this.sampleRate);
  }

  private flushSilentRun(): void {
    if (this.silentRunStart === null) return;
    const start = this.silentRunStart;
    const length = this.silentRunLength;
    this.silentRunStart = null;
    this.silentRunLength = 0;
    if (length >= MIN_SILENT_RUN_S) {
      this.sink.onGap({ startS: start, endS: start + length, cause: 'microphone_taken' });
    }
    // A lone zero second is not worth a gap; it is simply not recorded (no frame).
  }
}

function isDigitalSilence(frame: Float32Array): boolean {
  for (let i = 0; i < frame.length; i++) if (frame[i] !== 0) return false;
  return true;
}

/** Converts little-endian int16 PCM (the first `byteLength` bytes of `data`) to floats in [-1, 1). */
export function int16ToFloat32(data: ArrayBuffer, byteLength = data.byteLength): Float32Array {
  const ints = new Int16Array(data, 0, byteLength >> 1);
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = ints[i] / 32768;
  return out;
}
