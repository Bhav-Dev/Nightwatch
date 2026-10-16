import { nextQuietLevel } from '../domain/audio/quietLevel';

/**
 * Keeps the parts of the night with sound in them, compressed, so they can be played back in
 * the morning; silence is never written. Each stretch of sound becomes a segment file: it
 * starts a few seconds before the first loud second (so the start of a snore is not cut off),
 * carries on through short pauses (snoring has quiet gaps between breaths), and ends once the
 * room has been quiet for a while. A segment is capped at a few minutes, so a phone that dies
 * mid-night loses at most the segment being written. No React Native imports: the encoder is
 * injected (native AAC in the app, a fake in tests).
 */

/** A second this much louder than the room's quiet level starts or extends a segment. */
export const SOUND_ABOVE_QUIET_DB = 6;
/** Seconds kept from just before the first loud second. */
export const SOUND_PRE_ROLL_S = 3;
/** Quiet seconds after the last loud one before the segment ends. */
export const SOUND_HANGOVER_S = 8;
/** Longest segment; continuous sound carries on into a new segment. */
export const SOUND_MAX_SEGMENT_S = 300;
/** AAC bit rate: practically indistinguishable from the 16 kHz source for snoring. */
export const SOUND_BITRATE = 24_000;
/** Nights whose sound is kept before it is deleted (scores, timelines and saved clips stay). */
export const SOUND_KEEP_DAYS = 30;

export interface SegmentWriter {
  /** Starts a new compressed file for segment `id`. Calls are applied in order. */
  begin(id: string, sampleRate: number): void;
  /** Appends 16-bit mono PCM to the open file. */
  write(pcm: Int16Array): void;
  /** Finishes the open file: its path and size (0 bytes when nothing usable was written). */
  end(): Promise<{ path: string; bytes: number }>;
}

export interface SoundSegment {
  id: string;
  /** Seconds from the start of the session, half-open: [startS, endS). */
  startS: number;
  endS: number;
  path: string;
  bytes: number;
}

/** Float PCM in [-1, 1] to 16-bit integers. */
export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(s * 32767);
  }
  return out;
}

export class SoundRecorder {
  private quietDb: number | null = null;
  private preRoll: { t: number; pcm: Int16Array }[] = [];
  private open: { id: string; startS: number; nextT: number; lastLoudT: number } | null = null;
  /** Set when a segment hit the length cap mid-sound, so the next second starts a new one. */
  private carry: { nextT: number; lastLoudT: number } | null = null;
  private closing: Promise<void> = Promise.resolve();

  constructor(
    private readonly writer: SegmentWriter,
    private readonly newId: () => string,
    private readonly onSegment: (segment: SoundSegment) => Promise<void>,
  ) {}

  /** Feed one whole second of audio and its level (dB). */
  addSecond(t: number, samples: Float32Array, sampleRate: number, levelDb: number): void {
    const pcm = toPcm16(samples.subarray(0, sampleRate));
    const finite = Number.isFinite(levelDb);
    if (finite) this.quietDb = nextQuietLevel(this.quietDb, levelDb);
    const loud = finite && this.quietDb !== null && levelDb - this.quietDb >= SOUND_ABOVE_QUIET_DB;

    // A jump in time (an interruption) ends the open segment where the audio stopped.
    if (this.open && t !== this.open.nextT) this.close();
    if (this.carry && t !== this.carry.nextT) this.carry = null;

    if (!this.open) {
      if (!loud && !this.carry) {
        this.preRoll.push({ t, pcm });
        if (this.preRoll.length > SOUND_PRE_ROLL_S) this.preRoll.shift();
        return;
      }
      // Lead in with the seconds just before, as long as they run straight up to this one.
      const lead: { t: number; pcm: Int16Array }[] = [];
      if (!this.carry) {
        for (let i = this.preRoll.length - 1; i >= 0 && this.preRoll[i].t === t - lead.length - 1; i--) lead.unshift(this.preRoll[i]);
      }
      const id = this.newId();
      this.writer.begin(id, sampleRate);
      for (const p of lead) this.writer.write(p.pcm);
      this.open = { id, startS: lead[0]?.t ?? t, nextT: t, lastLoudT: this.carry?.lastLoudT ?? t };
      this.carry = null;
      this.preRoll = [];
    }

    const open = this.open;
    this.writer.write(pcm);
    open.nextT = t + 1;
    if (loud) open.lastLoudT = t;
    if (t - open.lastLoudT >= SOUND_HANGOVER_S) {
      this.close();
    } else if (open.nextT - open.startS >= SOUND_MAX_SEGMENT_S) {
      const { lastLoudT } = open;
      this.close();
      this.carry = { nextT: t + 1, lastLoudT };
    }
  }

  /** At Stop: closes the open segment and waits until every segment is stored. */
  async finish(): Promise<void> {
    if (this.open) this.close();
    this.carry = null;
    this.preRoll = [];
    await this.closing;
  }

  private close(): void {
    const segment = this.open!;
    this.open = null;
    // end() is called now, before any later begin(), so the encoder sees calls in order.
    const ended = this.writer.end();
    ended.catch(() => undefined);
    this.closing = this.closing
      .then(async () => {
        const { path, bytes } = await ended;
        if (bytes > 0) await this.onSegment({ id: segment.id, startS: segment.startS, endS: segment.nextT, path, bytes });
      })
      .catch((e) => console.warn('Sound segment failed', e));
  }
}
