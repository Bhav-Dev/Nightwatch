import { getNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { analyseNight } from '../src/domain/scoring';
import type { Frame } from '../src/domain/scoring/types';
import { CAPTURE_SAMPLE_RATE, synthesiseNightAudio, type AudioCapture, type CaptureListener } from '../src/native/audioCapture';
import { RecordingSession } from '../src/recording/recordingSession';
import { openTestDb } from './helpers/nodeDb';

const FLOOR = -60;

/** Four hours: sleep sounds (15 dB over the room) for the first 30 minutes, snoring at 20 dB in and after them. */
function night(snoreProb: (t: number) => number): Frame[] {
  return Array.from({ length: 4 * 3600 }, (_, t) => {
    const underSound = t < 1800;
    const snoring = (t >= 600 && t < 900) || (t >= 5000 && t < 5300);
    const levelDb = snoring ? FLOOR + 20 : underSound ? FLOOR + 15 : FLOOR;
    return { t, levelDb, snoreProb: snoring ? snoreProb(t) : 0 };
  });
}

describe('snoring under sleep sounds', () => {
  it('is measured against the sound, not the quiet room', () => {
    const masked = analyseNight({ durationS: 4 * 3600, frames: night(() => 1), maskedUntilS: 1800 });
    expect(masked.events).toHaveLength(2);
    expect(masked.events[0].peakDb).toBeCloseTo(5, 0); // 20 dB over the room, 5 over the sound
    expect(masked.events[1].peakDb).toBeCloseTo(20, 0);

    const unmasked = analyseNight({ durationS: 4 * 3600, frames: night(() => 1) });
    expect(unmasked.events[0].peakDb).toBeCloseTo(20, 0);
  });

  it('needs a surer model score while the sound plays', () => {
    const analysis = analyseNight({ durationS: 4 * 3600, frames: night(() => 0.7), maskedUntilS: 1800 });
    // 0.7 clears the normal 0.6 bar after the sound stopped, but not the raised bar under it.
    expect(analysis.events.map((e) => e.startS)).toEqual([5000]);
  });
});

class FakeCapture implements AudioCapture {
  listener: CaptureListener | null = null;
  async requestPermission() {
    return true;
  }
  async start(l: CaptureListener) {
    this.listener = l;
  }
  async stop() {}
  isRecording() {
    return true;
  }
}

describe('sleep sounds in a recorded night', () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  it('saves which sound played and until when, never past the end of the night', async () => {
    const db = openTestDb();
    await migrate(db);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId });
    session.setSleepSound('pink', 45 * 60);
    for (let s = 0; s < 600; s++) capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    const finished = await session.finish();
    const row = await getNight(db, finished!.nightId);
    expect(row).toMatchObject({ sleep_sound: 'pink', sleep_sound_until_s: 600 });
  });

  it('records nothing when no sound played', async () => {
    const db = openTestDb();
    await migrate(db);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId });
    for (let s = 0; s < 120; s++) capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    const finished = await session.finish();
    expect(await getNight(db, finished!.nightId)).toMatchObject({ sleep_sound: null, sleep_sound_until_s: null });
  });
});
