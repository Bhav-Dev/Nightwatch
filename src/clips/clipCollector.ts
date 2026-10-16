/**
 * Picks the loudest moments of the night while recording, before the audio is thrown away.
 *
 * The real events are only known at Stop (the noise floor needs the whole night), so this
 * keeps a provisional list: a rolling buffer of the last 30 seconds of PCM, a slow estimate of
 * the room's quiet level, and up to MAX_CANDIDATES clips around the loudest seconds that were
 * well above it. At Stop, clips that overlap real events are kept (the top 5 plus any the user
 * saves), and so are the 3 loudest that were not counted as snoring ("other sounds", so the
 * user can check what was left out); the rest are deleted.
 */

export const CLIP_BEFORE_S = 7;
export const CLIP_AFTER_S = 8;
export const MAX_CANDIDATES = 10;
/** A second must be this far above the running quiet level to be a candidate. */
export const CANDIDATE_ABOVE_QUIET_DB = 10;
const RING_S = CLIP_BEFORE_S + CLIP_AFTER_S + 15;

export interface ClipCandidate {
  id: string;
  startS: number;
  endS: number;
  peakS: number;
  peakDb: number;
}

export interface ClipCollectorSink {
  /** Write the clip; resolves when stored. */
  save(candidate: ClipCandidate, samples: Float32Array, sampleRate: number): Promise<void>;
  /** A stored clip was displaced by a louder one. */
  drop(id: string): Promise<void>;
}

interface Pending {
  candidate: ClipCandidate;
}

export class ClipCollector {
  private sampleRate = 0;
  private ring: Float32Array = new Float32Array(0);
  /** Session second held at each ring slot, or -1. */
  private ringT: Int32Array = new Int32Array(0);
  private quietDb: number | null = null;
  private kept: ClipCandidate[] = [];
  private pending: Pending | null = null;

  constructor(
    private readonly sink: ClipCollectorSink,
    private readonly newId: () => string,
  ) {}

  /**
   * Feed one whole second. `levelDb` is its A-weighted level; `snoreLike` lets a classifier
   * veto obvious non-snore sounds (null = no opinion).
   */
  addSecond(t: number, samples: Float32Array, sampleRate: number, levelDb: number, snoreLike: boolean | null = null): void {
    if (sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
      this.ring = new Float32Array(RING_S * sampleRate);
      this.ringT = new Int32Array(RING_S).fill(-1);
    }
    const slot = t % RING_S;
    this.ring.set(samples.subarray(0, sampleRate), slot * sampleRate);
    this.ringT[slot] = t;

    // Quiet level: falls quickly to quieter seconds, rises slowly, so snoring does not drag it up.
    if (this.quietDb === null) this.quietDb = levelDb;
    else this.quietDb = levelDb < this.quietDb ? levelDb : this.quietDb + (levelDb - this.quietDb) * 0.002;

    const loud = levelDb - this.quietDb >= CANDIDATE_ABOVE_QUIET_DB && snoreLike !== false;

    if (this.pending) {
      const p = this.pending.candidate;
      if (loud && t <= p.endS && levelDb > p.peakDb) {
        // A louder second inside the window being collected: re-centre on it.
        p.peakS = t;
        p.peakDb = levelDb;
        p.startS = Math.max(0, t - CLIP_BEFORE_S);
        p.endS = t + CLIP_AFTER_S;
      }
      if (t >= p.endS - 1) this.complete();
      return;
    }

    if (!loud || !this.worthKeeping(t, levelDb)) return;
    this.pending = {
      candidate: {
        id: this.newId(),
        startS: Math.max(0, t - CLIP_BEFORE_S),
        endS: t + CLIP_AFTER_S,
        peakS: t,
        peakDb: levelDb,
      },
    };
  }

  /** At Stop: finish a clip in progress with whatever audio there is. */
  async finish(): Promise<void> {
    if (this.pending) this.complete();
    await this.writes;
  }

  get candidates(): readonly ClipCandidate[] {
    return this.kept;
  }

  private writes: Promise<void> = Promise.resolve();

  private worthKeeping(t: number, levelDb: number): boolean {
    const overlapping = this.kept.find((k) => t - CLIP_BEFORE_S < k.endS && t + CLIP_AFTER_S > k.startS);
    if (overlapping) return levelDb > overlapping.peakDb;
    if (this.kept.length < MAX_CANDIDATES) return true;
    return levelDb > Math.min(...this.kept.map((k) => k.peakDb));
  }

  private complete(): void {
    const c = this.pending!.candidate;
    this.pending = null;
    const lastT = Math.max(...this.ringT);
    c.endS = Math.min(c.endS, lastT + 1);
    const seconds = c.endS - c.startS;
    const out = new Float32Array(seconds * this.sampleRate);
    let filled = 0;
    for (let t = c.startS; t < c.endS; t++) {
      const slot = t % RING_S;
      if (this.ringT[slot] !== t) continue; // fell out of the ring or was never captured
      out.set(this.ring.subarray(slot * this.sampleRate, (slot + 1) * this.sampleRate), (t - c.startS) * this.sampleRate);
      filled++;
    }
    if (filled === 0) return;

    // Displace an overlapping quieter clip, or the quietest one when full.
    const displaced: ClipCandidate[] = this.kept.filter((k) => c.startS < k.endS && c.endS > k.startS);
    this.kept = this.kept.filter((k) => !displaced.includes(k));
    if (this.kept.length >= MAX_CANDIDATES) {
      const quietest = this.kept.reduce((a, b) => (a.peakDb <= b.peakDb ? a : b));
      displaced.push(quietest);
      this.kept = this.kept.filter((k) => k !== quietest);
    }
    this.kept.push(c);

    const sampleRate = this.sampleRate;
    this.writes = this.writes
      .then(async () => {
        for (const d of displaced) await this.sink.drop(d.id);
        await this.sink.save(c, out, sampleRate);
      })
      .catch((e) => console.warn('Clip write failed', e));
  }
}

/**
 * At Stop: which candidate clips to keep. A clip is kept when it overlaps a real event; the
 * five loudest such clips plus any the user saved. Returns the ids to keep and, for each event
 * index, the id of the loudest clip overlapping it.
 */
export function selectClips(
  candidates: readonly { id: string; startS: number; endS: number; peakDb: number; saved?: boolean }[],
  events: readonly { startS: number; endS: number }[],
  keep = 5,
  keepOther = 3,
): { keepIds: Set<string>; otherIds: Set<string>; clipForEvent: (string | null)[] } {
  const overlapsEvent = (c: { startS: number; endS: number }) => events.some((e) => c.startS < e.endS && c.endS > e.startS);
  const ranked = candidates.filter(overlapsEvent).sort((a, b) => b.peakDb - a.peakDb);
  const keepIds = new Set([...ranked.slice(0, keep).map((c) => c.id), ...candidates.filter((c) => c.saved).map((c) => c.id)]);
  // The loudest moments that were not counted as snoring, so the user can hear what was left
  // out and judge whether the detector missed something.
  const otherIds = new Set(
    candidates
      .filter((c) => !overlapsEvent(c) && !keepIds.has(c.id))
      .sort((a, b) => b.peakDb - a.peakDb)
      .slice(0, keepOther)
      .map((c) => c.id),
  );
  const clipForEvent = events.map((e) => {
    const best = ranked.find((c) => keepIds.has(c.id) && c.startS < e.endS && c.endS > e.startS);
    return best?.id ?? null;
  });
  return { keepIds, otherIds, clipForEvent };
}
