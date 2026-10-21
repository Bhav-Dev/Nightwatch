import { nightEvents } from '../src/data/nightRepo';
import { nightlyPitch, nightPitchStretches } from '../src/data/pitchRepo';
import { migrate } from '../src/data/schema';
import { appendFrames, createSession, sessionFrames } from '../src/data/sessionRepo';
import { frameFeatures, type FrameFeatures, SAMPLE_RATE } from '../src/domain/audio/features';
import { FrameFeatureBuffer } from '../src/domain/audio/frameBuffer';
import {
  MIN_NIGHT_PITCH_S,
  nightPitch,
  pitchBand,
  pitchHzWords,
  pitchIn,
  type PitchStretch,
  profilePitch,
  stretchPitches,
  weightedMedian,
} from '../src/domain/pitch';
import { synthesiseNightAudio } from '../src/native/audioCapture';
import { finaliseSession } from '../src/recording/recordingSession';
import { openTestDb } from './helpers/nodeDb';

const tone = (parts: { hz: number; amp: number }[]) => {
  const a = new Float32Array(SAMPLE_RATE);
  for (let i = 0; i < a.length; i++) for (const p of parts) a[i] += p.amp * Math.sin((2 * Math.PI * p.hz * i) / SAMPLE_RATE);
  return a;
};

describe('the strongest frequency of a second', () => {
  it('finds a tone to within a couple of hertz, between the spectrum bins', () => {
    for (const hz of [110, 137, 190, 450, 1000, 1243]) {
      expect(Math.abs(frameFeatures(tone([{ hz, amp: 0.3 }])).peakHz! - hz)).toBeLessThan(2);
    }
  });

  it('looks past mains hum to the snore above it', () => {
    const peak = frameFeatures(tone([{ hz: 50, amp: 0.2 }, { hz: 150, amp: 0.1 }])).peakHz!;
    expect(Math.abs(peak - 150)).toBeLessThan(2);
  });

  it('is 0 for silence', () => {
    expect(frameFeatures(new Float32Array(SAMPLE_RATE)).peakHz).toBe(0);
  });

  it('hears the synthetic snore at its 110 Hz pitch', () => {
    // Second 120 is the start of a breath in the first stretch of snoring.
    const peak = frameFeatures(synthesiseNightAudio(120, 1, {})).peakHz!;
    expect(Math.abs(peak - 110)).toBeLessThan(3);
  });
});

describe('pitch in words', () => {
  it('puts pitches into low, mid and high', () => {
    // Peak frequencies reported for soft palate, mixed and tongue base snoring.
    expect(pitchBand(137)).toBe('low');
    expect(pitchBand(299)).toBe('low');
    expect(pitchBand(300)).toBe('mid');
    expect(pitchBand(799)).toBe('mid');
    expect(pitchBand(800)).toBe('high');
    expect(pitchBand(1243)).toBe('high');
  });

  it('rounds the hertz so they do not look more exact than they are', () => {
    expect(pitchHzWords(137)).toBe('around 140 Hz');
    expect(pitchHzWords(494)).toBe('around 490 Hz');
    expect(pitchHzWords(1243)).toBe('around 1250 Hz');
  });
});

describe('weighted median', () => {
  it('counts each value by its weight, and skips what cannot be weighed', () => {
    expect(weightedMedian([])).toBeNull();
    expect(weightedMedian([{ value: 100, weight: 0 }])).toBeNull();
    expect(weightedMedian([{ value: 100, weight: 1 }, { value: 900, weight: 3 }])).toBe(900);
    expect(weightedMedian([{ value: 100, weight: 3 }, { value: 900, weight: 1 }, { value: Number.NaN, weight: 5 }])).toBe(100);
    expect(weightedMedian([{ value: 300, weight: 1 }, { value: 100, weight: 1 }, { value: 200, weight: 1 }])).toBe(200);
  });
});

const quiet: FrameFeatures = { levelDb: -60, centroidHz: 800, envelopeDb: Array(10).fill(-60) };

describe('the pitch of each stretch of snoring', () => {
  const frames = Array.from({ length: 400 }, (_, t) => ({
    t,
    features: { ...quiet, peakHz: t < 100 ? 140 : t < 200 ? 1200 : t < 300 ? 0 : undefined },
  }));
  const snoringSeconds = (from: number, to: number, every = 1) =>
    Array.from({ length: to - from }, (_, i) => ({ t: from + i, snoreProb: i % every === 0 ? 0.9 : 0.1 }));

  it('takes the middle pitch of the snoring seconds only', () => {
    // Snoring on every other second, with a loud non-snore in between.
    const mixed = frames.map((f) => (f.t >= 10 && f.t < 40 && f.t % 2 === 1 ? { ...f, features: { ...f.features, peakHz: 3000 } } : f));
    expect(stretchPitches(mixed, snoringSeconds(10, 40, 2), [{ startS: 10, endS: 40 }])).toEqual([{ startS: 10, endS: 40, hz: 140, seconds: 15 }]);
  });

  it('leaves out stretches with too few snoring seconds with a pitch', () => {
    const snoring = [...snoringSeconds(50, 54), ...snoringSeconds(250, 290), ...snoringSeconds(310, 350), ...snoringSeconds(150, 170)];
    expect(
      stretchPitches(frames, snoring, [
        { startS: 50, endS: 54 }, // 4 seconds
        { startS: 250, endS: 290 }, // silent
        { startS: 310, endS: 350 }, // stored before pitch was measured
        { startS: 150, endS: 170 },
      ]),
    ).toEqual([{ startS: 150, endS: 170, hz: 1200, seconds: 20 }]);
  });

  it('gives a moment the pitch of the stretches inside it', () => {
    const stretches: PitchStretch[] = [
      { startS: 100, endS: 160, hz: 150, seconds: 50 },
      { startS: 400, endS: 430, hz: 900, seconds: 20 },
    ];
    expect(pitchIn(stretches, { startS: 120, endS: 140 })).toBe(150);
    expect(pitchIn(stretches, { startS: 0, endS: 1000 })).toBe(150);
    expect(pitchIn(stretches, { startS: 200, endS: 300 })).toBeNull();
  });
});

describe('a night’s pitch', () => {
  const stretches: PitchStretch[] = [
    { startS: 1000, endS: 1060, hz: 150, seconds: 25 },
    { startS: 2000, endS: 2060, hz: 1100, seconds: 60 },
    { startS: 3000, endS: 3040, hz: 160, seconds: 20 },
  ];

  it('counts only the stretches still snoring after the user’s answers', () => {
    expect(nightPitch(stretches, [{ startS: 1000, endS: 1060 }, { startS: 2000, endS: 2060 }, { startS: 3000, endS: 3040 }])).toEqual({ hz: 1100, seconds: 105 });
    // "Not snoring" for the long, high stretch takes it out.
    expect(nightPitch(stretches, [{ startS: 1000, endS: 1060 }, { startS: 3000, endS: 3040 }])).toEqual({ hz: 150, seconds: 45 });
  });

  it('needs enough snoring to have a pitch', () => {
    expect(nightPitch(stretches, [{ startS: 1000, endS: 1060 }])).toBeNull();
    expect(MIN_NIGHT_PITCH_S).toBeGreaterThan(25);
  });
});

describe('the profile’s pitch across nights', () => {
  it('needs three nights with a pitch', () => {
    expect(profilePitch([{ hz: 140 }, null, { hz: 150 }])).toEqual({ band: null, nights: 2 });
  });

  it('takes the middle night and says how the nights spread', () => {
    expect(profilePitch([{ hz: 140 }, { hz: 1200 }, null, { hz: 160 }, { hz: 450 }, { hz: 150 }])).toEqual({
      band: 'low',
      hz: 160,
      nights: 5,
      spread: [
        { band: 'low', nights: 3 },
        { band: 'mid', nights: 1 },
        { band: 'high', nights: 1 },
      ],
    });
  });
});

describe('pitch through a recorded night', () => {
  it('stores each second’s pitch, then keeps a pitch for each stretch of snoring with the night', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `id${++n}`;
    const buf = new FrameFeatureBuffer();
    // Snoring from 2 to 6 minutes and from 12 to 16 minutes.
    for (let start = 0; start < 1200; start += 30) buf.addWindow(start, synthesiseNightAudio(start, 30, {}));
    await createSession(db, 's1', new Date(2026, 9, 20, 23, 0), 'normal');
    await appendFrames(db, 's1', buf.entries(), new Date());
    const stored = await sessionFrames(db, 's1');
    expect(Math.abs(stored[120].features.peakHz! - 110)).toBeLessThan(3);

    const result = await finaliseSession(db, 's1', { newId });
    const events = await nightEvents(db, result!.nightId);
    const pitch = await nightPitchStretches(db, result!.nightId);
    expect(pitch).toHaveLength(events.length);
    expect(events.length).toBeGreaterThan(0);
    for (const p of pitch) expect(Math.abs(p.hz - 110)).toBeLessThan(3);
    const [nightly] = await nightlyPitch(db);
    expect(nightly.nightId).toBe(result!.nightId);
    expect(pitchBand(nightly.pitch!.hz)).toBe('low');
    expect(nightly.pitch!.seconds).toBeGreaterThanOrEqual(MIN_NIGHT_PITCH_S);

    // "Not snoring" for every stretch: the night no longer has a pitch.
    await db.runAsync('DELETE FROM event WHERE night_id = ?', [result!.nightId]);
    expect((await nightlyPitch(db))[0].pitch).toBeNull();
  });

  it('reads seconds stored before the pitch was measured as having none', async () => {
    const db = openTestDb();
    await migrate(db);
    await createSession(db, 's1', new Date(2026, 9, 20, 23, 0), 'normal');
    await appendFrames(db, 's1', [{ t: 0, features: quiet }], new Date());
    const [frame] = await sessionFrames(db, 's1');
    expect(frame.features).toEqual(quiet);
    expect('peakHz' in frame.features).toBe(false);
  });
});
