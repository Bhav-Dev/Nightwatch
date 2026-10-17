import { ClipCollector, selectClips } from '../clips/clipCollector';
import type { ClipFiles } from '../clips/clipFiles';
import { encoderFor } from '../clips/codec';
import { attachClipsToNight, deleteClipRow, getClip, insertClip, markOtherClip, sessionClips } from '../data/clipRepo';
import { saveNightActivity } from '../data/activityRepo';
import { commitPendingLog } from '../data/logRepo';
import { saveNight } from '../data/nightRepo';
import type { Db } from '../data/db';
import { attachSoundToNight, deleteSoundSegmentRow, insertSoundSegment, sessionSoundSegments } from '../data/soundRepo';
import { deleteSessionForecast, saveNightWeather, saveSessionForecast, sessionForecast } from '../data/weatherRepo';
import type { WeatherResponse } from '../../shared/api';
import { weatherAreaKey } from '../../shared/weather';
import { summariseNightWeather } from '../domain/weather';
import {
  addPhoneUse,
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
  sessionPhoneUse,
  setSessionSleepSound,
} from '../data/sessionRepo';
import { detectMovement, phoneUseInNight } from '../domain/activity';
import { frameFeatures } from '../domain/audio/features';
import { HEURISTIC_DETECTOR_ID, type OnlineSnoreScorer } from '../domain/detection/classifier';
import { classifyNightHeuristic, HEURISTIC } from '../domain/detection/heuristic';
import { analyseNight, type Sensitivity } from '../domain/scoring';
import type { AudioCapture } from '../native/audioCapture';
import { type SegmentWriter, SoundRecorder } from './soundRecorder';

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
  private sound: SoundRecorder | null = null;
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
    /** Compresses the parts of the night with sound for playback; null keeps no sound. */
    sound?: SegmentWriter | null;
    /** Labelling mode (internal builds): keep every second of sound, not only the parts with sound. */
    keepAllSound?: boolean;
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
    if (opts.sound) {
      session.sound = new SoundRecorder(opts.sound, opts.newId, (s) =>
        insertSoundSegment(opts.db, {
          id: s.id,
          session_id: session.id,
          start_s: s.startS,
          end_s: s.endS,
          codec: 'aac',
          path: s.path,
          bytes: s.bytes,
          created_at: Math.floor(now().getTime() / 1000),
        }),
        opts.keepAllSound ?? false,
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
            session.sound?.addSecond(startS + s, second, sampleRate, features.levelDb);
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
   * Notes that sleep sounds play until `untilS` (seconds from the start), so the analysis can
   * allow for them; call again with the real stop time if they end early. null clears it.
   */
  setSleepSound(kind: string | null, untilS: number | null): void {
    this.enqueue(() => setSessionSleepSound(this.db, this.id, kind, kind ? untilS : null));
  }

  /** Notes a stretch (seconds from the start) when the phone was picked up and used. */
  markPhoneUse(startS: number, endS: number): void {
    if (endS > startS) this.enqueue(() => addPhoneUse(this.db, this.id, startS, endS));
  }

  /** Keeps the forecast fetched for tonight; the night's weather is worked out from it at Stop. */
  setForecast(forecast: WeatherResponse): void {
    const at = Math.floor(this.now().getTime() / 1000);
    this.enqueue(() => saveSessionForecast(this.db, this.id, forecast, at));
  }

  /**
   * Stops capture, scores the night, saves it with tonight's log and clears the session.
   * Resolves null if nothing was captured (nothing is saved).
   */
  async finish(): Promise<FinishedNight | null> {
    await this.capture.stop();
    this.flush();
    await this.clips?.finish();
    await this.sound?.finish();
    await this.writes;
    liveSessionId = null;
    return finaliseSession(this.db, this.id, { newId: this.newId, files: this.files });
  }

  /** Stops capture and throws the recording away. */
  async discard(): Promise<void> {
    await this.capture.stop();
    await this.clips?.finish();
    await this.sound?.finish();
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

  // Sleep sounds: up to when they stopped (or the night ended, if sooner).
  const sleepSound =
    session.sleep_sound && session.sleep_sound_until_s !== null
      ? { kind: session.sleep_sound, untilS: Math.min(session.sleep_sound_until_s, durationS) }
      : null;
  const maskedUntilS = sleepSound?.untilS ?? 0;

  // A model's per-second output wins when it covered the whole night.
  const modelCovered = frames.every((f) => f.snoreProb !== null);
  const scored = modelCovered
    ? frames.map((f) => ({ t: f.t, levelDb: f.features.levelDb, snoreProb: f.snoreProb! }))
    : classifyNightHeuristic(frames, { maskedUntilS });
  const analysis = analyseNight({
    durationS,
    frames: scored,
    gaps: gaps.filter((g) => g.endS <= durationS),
    partial,
    sensitivity: session.sensitivity as Sensitivity,
    maskedUntilS,
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
    sleepSound,
  });
  // Tossing and turning heard in the audio, and when the phone was in use (docs/night-events-design.md).
  await saveNightActivity(
    db,
    nightId,
    {
      movement: detectMovement(frames, scored, { durationS, maskedUntilS }),
      phone: phoneUseInNight(await sessionPhoneUse(db, sessionId), durationS),
    },
    opts.newId,
  );
  await keepClipsForEvents(db, sessionId, nightId, analysis.events, opts.files ?? null);
  await attachSoundToNight(db, sessionId, nightId);
  const weather = await sessionForecast(db, sessionId);
  if (weather) {
    const startS = session.started_at;
    const summary = summariseNightWeather(weather.forecast.hours, startS, startS + durationS);
    await saveNightWeather(db, nightId, summary, weatherAreaKey(weather.forecast.area), weather.fetchedAt);
    await deleteSessionForecast(db, sessionId);
  }
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
  const { keepIds, otherIds, clipForEvent } = selectClips(
    clips.map((c) => ({ id: c.id, startS: c.start_s, endS: c.end_s, peakDb: c.peak_db, saved: c.saved === 1 })),
    events,
  );
  for (const c of clips) {
    if (keepIds.has(c.id)) continue;
    if (otherIds.has(c.id)) {
      await markOtherClip(db, c.id);
      continue;
    }
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
  for (const s of await sessionSoundSegments(db, sessionId)) {
    if (files) await files.remove(s.path);
    await deleteSoundSegmentRow(db, s.id);
  }
  await deleteSessionForecast(db, sessionId);
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
