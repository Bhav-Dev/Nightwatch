import { commitPendingLog } from '../data/logRepo';
import { saveNight } from '../data/nightRepo';
import type { Db } from '../data/db';
import {
  appendFrames,
  appendGap,
  createSession,
  deleteSession,
  type InterruptCause,
  openSessions,
  type SessionRow,
  sessionFrames,
  sessionGaps,
} from '../data/sessionRepo';
import { type FrameFeatures, frameFeatures } from '../domain/audio/features';
import { classifyNightHeuristic } from '../domain/detection/heuristic';
import { analyseNight, type Sensitivity } from '../domain/scoring';
import type { AudioCapture } from '../native/audioCapture';

/** Features are written to SQLite in batches this size, so a killed app loses at most this many seconds. */
export const PERSIST_EVERY_S = 30;

/** Id of the session this JS runtime is recording; any other open session was abandoned. */
let liveSessionId: string | null = null;

export interface FinishedNight {
  nightId: string;
  partial: boolean;
}

/**
 * One overnight recording: capture → per-second features → SQLite, then scoring at Stop.
 * Free of React Native imports so it can be tested with a fake capture and node:sqlite.
 */
export class RecordingSession {
  private pending: { t: number; features: FrameFeatures }[] = [];
  private writes: Promise<void> = Promise.resolve();
  private lastLevel: number | null = null;
  private lastT = -1;

  private constructor(
    private readonly db: Db,
    private readonly capture: AudioCapture,
    readonly id: string,
    readonly startedAt: Date,
    private readonly newId: () => string,
    private readonly now: () => Date,
  ) {}

  static async begin(opts: {
    db: Db;
    capture: AudioCapture;
    sensitivity: Sensitivity;
    newId: () => string;
    now?: () => Date;
  }): Promise<RecordingSession> {
    const now = opts.now ?? (() => new Date());
    const startedAt = now();
    const session = new RecordingSession(opts.db, opts.capture, opts.newId(), startedAt, opts.newId, now);
    await createSession(opts.db, session.id, startedAt, opts.sensitivity);
    liveSessionId = session.id;
    try {
      await opts.capture.start({
        onWindow: ({ startS, samples, sampleRate }) => {
          const seconds = Math.floor(samples.length / sampleRate);
          for (let s = 0; s < seconds; s++) {
            const features = frameFeatures(samples.subarray(s * sampleRate, (s + 1) * sampleRate), sampleRate);
            session.pending.push({ t: startS + s, features });
            session.lastLevel = features.levelDb;
            session.lastT = startS + s;
          }
          if (session.pending.length >= PERSIST_EVERY_S) session.flush();
        },
        onInterrupted: (gap) => {
          session.enqueue(() => appendGap(opts.db, session.id, gap));
        },
      });
    } catch (e) {
      liveSessionId = null;
      await deleteSession(opts.db, session.id);
      throw e;
    }
    return session;
  }

  /** Seconds captured so far (the clock shown on the Recording view). */
  get elapsedS(): number {
    return this.lastT + 1;
  }

  /** Level of the latest second, dB full scale, for the live meter. */
  get lastLevelDb(): number | null {
    return this.lastLevel;
  }

  /**
   * Stops capture, scores the night, saves it with tonight's log and clears the session.
   * Resolves null if nothing was captured (nothing is saved).
   */
  async finish(): Promise<FinishedNight | null> {
    await this.capture.stop();
    this.flush();
    await this.writes;
    liveSessionId = null;
    return finaliseSession(this.db, this.id, { newId: this.newId });
  }

  /** Stops capture and throws the recording away. */
  async discard(): Promise<void> {
    await this.capture.stop();
    await this.writes;
    liveSessionId = null;
    await deleteSession(this.db, this.id);
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const at = this.now();
    this.enqueue(() => appendFrames(this.db, this.id, batch, at));
  }

  /** Serialises writes so batches land in order and finish() can wait for them. */
  private enqueue(write: () => Promise<void>): void {
    this.writes = this.writes.then(write).catch((e) => {
      console.warn('Recording write failed', e);
    });
  }
}

/**
 * Scores a stored session and saves it as a night. Used at Stop, and at launch for a
 * session the app never got to stop (killed overnight), which becomes a partial night.
 */
export async function finaliseSession(
  db: Db,
  sessionId: string,
  opts: { newId: () => string; abandoned?: boolean },
): Promise<FinishedNight | null> {
  const session = (await openSessions(db)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`no recording session ${sessionId}`);
  const frames = await sessionFrames(db, sessionId);
  if (frames.length === 0) {
    // Stopped before a single second was captured: there is no night to keep.
    await deleteSession(db, sessionId);
    return null;
  }
  const gaps = await sessionGaps(db, sessionId);
  const durationS = frames.length > 0 ? frames[frames.length - 1].t + 1 : 0;

  let interruption: { atS: number; cause: InterruptCause } | null = gaps[0]
    ? { atS: gaps[0].startS, cause: gaps[0].cause }
    : null;
  if (opts.abandoned && !interruption) interruption = { atS: durationS, cause: 'app_closed' };
  const partial = interruption !== null;

  const analysis = analyseNight({
    durationS,
    frames: classifyNightHeuristic(frames),
    gaps: gaps.filter((g) => g.endS <= durationS),
    partial,
    sensitivity: session.sensitivity as Sensitivity,
  });
  const startedAt = new Date(session.started_at * 1000);
  const nightId = opts.newId();
  await saveNight(db, {
    id: nightId,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationS * 1000),
    partial,
    analysis,
    newId: opts.newId,
    interruption,
  });
  await commitPendingLog(db, nightId);
  await deleteSession(db, sessionId);
  return { nightId, partial };
}

/**
 * At launch: turns any session left open by a killed app into a partial night (or drops it
 * if nothing was captured). Returns the nights it saved.
 */
export async function recoverAbandonedSessions(db: Db, newId: () => string): Promise<FinishedNight[]> {
  const saved: FinishedNight[] = [];
  const abandoned = (await openSessions(db)).filter((s: SessionRow) => s.id !== liveSessionId);
  for (const s of abandoned) {
    const night = await finaliseSession(db, s.id, { newId, abandoned: true });
    if (night) saved.push(night);
  }
  return saved;
}
