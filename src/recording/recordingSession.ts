import { ClipCollector, selectClips } from '../clips/clipCollector';
import type { ClipFiles } from '../clips/clipFiles';
import { encoderFor } from '../clips/codec';
import { attachClipsToNight, deleteClipRow, getClip, insertClip, sessionClips } from '../data/clipRepo';
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
  type StoredFrame,
  sessionFrames,
  sessionGaps,
} from '../data/sessionRepo';
import { frameFeatures } from '../domain/audio/features';
import { HEURISTIC_DETECTOR_ID, type OnlineSnoreScorer } from '../domain/detection/classifier';
import { classifyNightHeuristic, HEURISTIC } from '../domain/detection/heuristic';
import { analyseNight, type Sensitivity } from '../domain/scoring';
import type { AudioCapture } from '../native/audioCapture';

/** Features are written to SQLite in batches this size, so a killed app loses at most this many seconds. */
export const PERSIST_EVERY_S = 30;

/** Id of the session this JS runtime is recording; any other open session was abandoned. */
let liveSessionId: string | null = null;

export interface FinishedNight {
  nightId: string;
  partial: boolean;
  logged: { remedies: number; factors: number };
}

/**
 * One overnight recording: capture → per-second features → SQLite, then scoring at Stop.
 * Free of React Native imports so it can be tested with a fake capture and node:sqlite.
 */
export class RecordingSession {
  private pending: StoredFrame[] = [];
  private clips: ClipCollector | null = null;
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
    private readonly files: ClipFiles | null,
  ) {}

  static async begin(opts: {
    db: Db;
    capture: AudioCapture;
    sensitivity: Sensitivity;
    newId: () => string;
    now?: () => Date;
    /** Where clips are written; null records without clips. */
    files?: ClipFiles | null;
    /** An on-device model; without one the heuristic labels the night at Stop. */
    scorer?: OnlineSnoreScorer | null;
  }): Promise<RecordingSession> {
    const now = opts.now ?? (() => new Date());
    const startedAt = now();
    const files = opts.files ?? null;
    const session = new RecordingSession(opts.db, opts.capture, opts.newId(), startedAt, opts.newId, now, files);
    await createSession(opts.db, session.id, startedAt, opts.sensitivity, opts.scorer?.id ?? null);
    if (files) {
      session.clips = new ClipCollector(
        {
          save: async (c, samples, sampleRate) => {
            const encoder = encoderFor();
            const written = await files.write(`${c.id}.${encoder.extension}`, await encoder.encode(samples, sampleRate));
            await insertClip(opts.db, {
              id: c.id,
              session_id: session.id,
              night_id: null,
              start_s: c.startS,
              end_s: c.endS,
              peak_s: c.peakS,
              peak_db: c.peakDb,
              codec: encoder.codec,
              sample_rate: sampleRate,
              path: written.path,
              bytes: written.bytes,
              created_at: Math.floor(now().getTime() / 1000),
            });
          },
          drop: async (id) => {
            const row = await getClip(opts.db, id);
            if (!row) return;
            await files.remove(row.path);
            await deleteClipRow(opts.db, id);
          },
        },
        opts.newId,
      );
    }
    liveSessionId = session.id;
    try {
      await opts.capture.start({
        onWindow: ({ startS, samples, sampleRate }) => {
          const seconds = Math.floor(samples.length / sampleRate);
          for (let s = 0; s < seconds; s++) {
            const second = samples.subarray(s * sampleRate, (s + 1) * sampleRate);
            const features = frameFeatures(second, sampleRate);
            const snoreProb = opts.scorer?.score(second, sampleRate) ?? null;
            session.pending.push({ t: startS + s, features, snoreProb });
            session.clips?.addSecond(
              startS + s,
              second,
              sampleRate,
              features.levelDb,
              snoreProb !== null ? snoreProb >= 0.5 : features.centroidHz < HEURISTIC.maxCentroidHz,
            );
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
    await this.clips?.finish();
    await this.writes;
    liveSessionId = null;
    return finaliseSession(this.db, this.id, { newId: this.newId, files: this.files });
  }

  /** Stops capture and throws the recording away. */
  async discard(): Promise<void> {
    await this.capture.stop();
    await this.clips?.finish();
    await this.writes;
    liveSessionId = null;
    await deleteSessionAndClips(this.db, this.id, this.files);
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
  opts: { newId: () => string; abandoned?: boolean; files?: ClipFiles | null },
): Promise<FinishedNight | null> {
  const session = (await openSessions(db)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`no recording session ${sessionId}`);
  const frames = await sessionFrames(db, sessionId);
  if (frames.length === 0) {
    // Stopped before a single second was captured: there is no night to keep.
    await deleteSessionAndClips(db, sessionId, opts.files ?? null);
    return null;
  }
  const gaps = await sessionGaps(db, sessionId);
  const durationS = frames.length > 0 ? frames[frames.length - 1].t + 1 : 0;

  let interruption: { atS: number; cause: InterruptCause } | null = gaps[0]
    ? { atS: gaps[0].startS, cause: gaps[0].cause }
    : null;
  if (opts.abandoned && !interruption) interruption = { atS: durationS, cause: 'app_closed' };
  const partial = interruption !== null;

  // A model's per-second output wins when it covered the whole night.
  const modelCovered = frames.every((f) => f.snoreProb !== null);
  const analysis = analyseNight({
    durationS,
    frames: modelCovered
      ? frames.map((f) => ({ t: f.t, levelDb: f.features.levelDb, snoreProb: f.snoreProb! }))
      : classifyNightHeuristic(frames),
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
    detector: modelCovered ? (session.detector ?? 'model') : HEURISTIC_DETECTOR_ID,
  });
  await keepClipsForEvents(db, sessionId, nightId, analysis.events, opts.files ?? null);
  const logged = await commitPendingLog(db, nightId);
  await deleteSession(db, sessionId);
  return { nightId, partial, logged };
}

/** Keeps clips that overlap real events (top 5), links them to events, deletes the rest. */
async function keepClipsForEvents(
  db: Db,
  sessionId: string,
  nightId: string,
  events: readonly { startS: number; endS: number }[],
  files: ClipFiles | null,
): Promise<void> {
  const clips = await sessionClips(db, sessionId);
  if (clips.length === 0) return;
  const { keepIds, clipForEvent } = selectClips(
    clips.map((c) => ({ id: c.id, startS: c.start_s, endS: c.end_s, peakDb: c.peak_db, saved: c.saved === 1 })),
    events,
  );
  for (const c of clips) {
    if (keepIds.has(c.id)) continue;
    if (files) await files.remove(c.path);
    await deleteClipRow(db, c.id);
  }
  await attachClipsToNight(db, sessionId, nightId);
  const eventRows = await db.getAllAsync<{ id: string }>('SELECT id FROM event WHERE night_id = ? ORDER BY start_s', [nightId]);
  const pathById = new Map(clips.map((c) => [c.id, c.path]));
  for (let i = 0; i < eventRows.length; i++) {
    const clipId = clipForEvent[i];
    if (clipId) await db.runAsync('UPDATE event SET clip_path = ? WHERE id = ?', [pathById.get(clipId) ?? null, eventRows[i].id]);
  }
}

async function deleteSessionAndClips(db: Db, sessionId: string, files: ClipFiles | null): Promise<void> {
  for (const c of await sessionClips(db, sessionId)) {
    if (files) await files.remove(c.path);
    await deleteClipRow(db, c.id);
  }
  await deleteSession(db, sessionId);
}

/**
 * At launch: turns any session left open by a killed app into a partial night (or drops it
 * if nothing was captured). Returns the nights it saved.
 */
export async function recoverAbandonedSessions(
  db: Db,
  newId: () => string,
  files: ClipFiles | null = null,
): Promise<FinishedNight[]> {
  const saved: FinishedNight[] = [];
  const abandoned = (await openSessions(db)).filter((s: SessionRow) => s.id !== liveSessionId);
  for (const s of abandoned) {
    const night = await finaliseSession(db, s.id, { newId, abandoned: true, files });
    if (night) saved.push(night);
  }
  return saved;
}
