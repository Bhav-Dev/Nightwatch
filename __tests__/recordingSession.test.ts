import { latestNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { openSessions, sessionFrames } from '../src/data/sessionRepo';
import { setPendingTick } from '../src/data/logRepo';
import type { AudioCapture, CaptureListener } from '../src/native/audioCapture';
import { CAPTURE_SAMPLE_RATE, synthesiseNightAudio } from '../src/native/audioCapture';
import { finaliseSession, recoverAbandonedSessions, RecordingSession } from '../src/recording/recordingSession';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `id-${++n}`;

/** A capture the test drives by hand. */
class FakeCapture implements AudioCapture {
  listener: CaptureListener | null = null;
  stopped = false;
  async requestPermission() {
    return true;
  }
  async start(listener: CaptureListener) {
    this.listener = listener;
  }
  async stop() {
    this.stopped = true;
  }
  isRecording() {
    return this.listener !== null && !this.stopped;
  }
  /** Feeds `seconds` of synthetic audio starting at `startS`, one second at a time. */
  feed(startS: number, seconds: number) {
    for (let s = startS; s < startS + seconds; s++) {
      this.listener?.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    }
  }
}

async function setup() {
  const db = openTestDb();
  await migrate(db);
  const capture = new FakeCapture();
  const start = new Date(2026, 9, 14, 23, 0, 0);
  const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId, now: () => start });
  return { db, capture, session };
}

describe('RecordingSession', () => {
  it('records, scores and saves a clean night with tonight’s log', async () => {
    const { db, capture, session } = await setup();
    await setPendingTick(db, { itemId: 'side_sleeping', type: 'remedy', value: null }, true);
    capture.feed(0, 600); // snoring from 120 s to 360 s
    expect(session.elapsedS).toBe(600);

    const result = (await session.finish())!;
    expect(capture.stopped).toBe(true);
    expect(result.partial).toBe(false);

    const night = await latestNight(db);
    expect(night).toMatchObject({ id: result.nightId, date: '2026-10-14', partial: 0, interrupted_at_s: null });
    expect(night?.event_count).toBe(1);
    expect(night?.duration_s).toBe(600);
    const logged = await db.getAllAsync<{ remedy_id: string }>('SELECT remedy_id FROM remedy_log WHERE night_id = ?', [result.nightId]);
    expect(logged.map((r) => r.remedy_id)).toEqual(['side_sleeping']);
    expect(await openSessions(db)).toEqual([]);
  });

  it('persists features in batches while recording', async () => {
    const { db, capture, session } = await setup();
    capture.feed(0, 65);
    await new Promise((r) => setTimeout(r, 10));
    expect((await sessionFrames(db, session.id)).length).toBe(60);
    await session.discard();
    expect(await openSessions(db)).toEqual([]);
  });

  it('marks a night with a capture gap as partial and records where it stopped', async () => {
    const { db, capture, session } = await setup();
    capture.feed(0, 300);
    capture.listener?.onInterrupted?.({ startS: 300, endS: 400, cause: 'microphone_taken' });
    capture.feed(400, 200);
    const result = (await session.finish())!;
    expect(result.partial).toBe(true);
    const night = await latestNight(db);
    expect(night).toMatchObject({ partial: 1, interrupted_at_s: 300, interrupt_cause: 'microphone_taken', time_in_bed_s: 500 });
  });

  it('saves nothing when stopped before any audio arrived', async () => {
    const { db, session } = await setup();
    expect(await session.finish()).toBeNull();
    expect(await latestNight(db)).toBeNull();
    expect(await openSessions(db)).toEqual([]);
  });
});

describe('recovery at launch', () => {
  it('turns a session the app never stopped into a partial night', async () => {
    const { db, capture } = await setup();
    capture.feed(0, 90);
    await new Promise((r) => setTimeout(r, 10));

    // Simulate a fresh launch: the module-level live id would be null, so finalise directly.
    const sessions = await openSessions(db);
    expect(sessions).toHaveLength(1);
    const result = await finaliseSession(db, sessions[0].id, { newId, abandoned: true });
    expect(result?.partial).toBe(true);
    const night = await latestNight(db);
    expect(night).toMatchObject({ interrupt_cause: 'app_closed', interrupted_at_s: 90, duration_s: 90 });
  });

  it('leaves the live session alone and drops empty abandoned ones', async () => {
    const { db } = await setup(); // live session in this runtime
    await db.runAsync(
      "INSERT INTO recording_session (id, started_at, sensitivity, updated_at) VALUES ('empty', 0, 'normal', 0)",
      [],
    );
    expect(await recoverAbandonedSessions(db, newId)).toEqual([]);
    const left = await openSessions(db);
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe('empty');
  });
});
