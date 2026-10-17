import { nightActivity } from '../src/data/activityRepo';
import { deleteNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { addPhoneUse, appendFrames, createSession } from '../src/data/sessionRepo';
import {
  detectMovement,
  MOVEMENT,
  phoneUseInNight,
  possiblyAwake,
  restlessStretches,
  turnedOverAndQuiet,
} from '../src/domain/activity';
import type { FrameFeatures } from '../src/domain/audio/features';
import type { AlignedSample } from '../src/domain/health';
import { durationWords, morningSummary } from '../src/domain/summary';
import { finaliseSession } from '../src/recording/recordingSession';
import { openTestDb } from './helpers/nodeDb';

const FLOOR = -60;
const quiet: FrameFeatures = { levelDb: FLOOR, centroidHz: 800, envelopeDb: Array(10).fill(FLOOR) };
/** A rustle: 12 dB over the room, broadband, uneven within the second. */
const rustle: FrameFeatures = { levelDb: FLOOR + 12, centroidHz: 3000, envelopeDb: [-60, -46, -52, -44, -58, -47, -55, -45, -59, -50] };
/** A fan or television: loud and bright but steady. */
const steady: FrameFeatures = { levelDb: FLOOR + 12, centroidHz: 3000, envelopeDb: Array(10).fill(FLOOR + 12) };

function night(seconds: number, at: Record<number, FrameFeatures>) {
  return Array.from({ length: seconds }, (_, t) => ({ t, features: at[t] ?? quiet }));
}
const spanOf = (from: number, to: number, f: FrameFeatures) => Object.fromEntries(Array.from({ length: to - from }, (_, i) => [from + i, f]));

describe('movement heard in the audio', () => {
  it('finds a short rustle as one movement', () => {
    const frames = night(7200, spanOf(1000, 1004, rustle));
    expect(detectMovement(frames, [], { durationS: 7200 })).toEqual([{ startS: 1000, endS: 1004, peakDb: 12 }]);
  });

  it('joins rustles a second or two apart', () => {
    const frames = night(7200, { ...spanOf(1000, 1002, rustle), ...spanOf(1003, 1005, rustle) });
    expect(detectMovement(frames, [], { durationS: 7200 })).toHaveLength(1);
  });

  it('leaves out long sounds, steady noise, snoring and the ends of the night', () => {
    const frames = night(7200, {
      ...spanOf(2000, 2000 + MOVEMENT.maxBurstS + 5, rustle), // talking or a television
      ...spanOf(3000, 3004, steady),
      ...spanOf(4000, 4003, rustle), // counted as snoring below
      ...spanOf(30, 33, rustle), // settling down
      ...spanOf(7150, 7153, rustle), // reaching for the phone
    });
    const snoring = [4000, 4001, 4002].map((t) => ({ t, snoreProb: 1 }));
    expect(detectMovement(frames, snoring, { durationS: 7200 })).toEqual([]);
  });

  it('measures against sleep sounds while they play', () => {
    const underSound = { levelDb: FLOOR + 10, centroidHz: 2500, envelopeDb: Array(10).fill(FLOOR + 10) };
    const soft = { ...rustle, levelDb: FLOOR + 12 }; // only 2 dB over the sound
    const loud = { ...rustle, levelDb: FLOOR + 18 };
    const sounds = spanOf(0, 1800, underSound);
    const frames = night(7200, { ...sounds, ...spanOf(600, 603, soft), ...spanOf(900, 903, loud) });
    expect(detectMovement(frames, [], { durationS: 7200, maskedUntilS: 1800 }).map((m) => m.startS)).toEqual([900]);
  });
});

describe('restless stretches', () => {
  it('needs three movements within 10 minutes', () => {
    const m = (s: number) => ({ startS: s, endS: s + 3 });
    expect(restlessStretches([m(100), m(300), m(500)])).toEqual([{ startS: 100, endS: 503 }]);
    expect(restlessStretches([m(100), m(900), m(2000)])).toEqual([]);
    expect(restlessStretches([m(100), m(200), m(300), m(650), m(800)])).toEqual([{ startS: 100, endS: 803 }]);
  });
});

describe('possibly awake', () => {
  it('drops phone use right after Start and just before Stop', () => {
    expect(phoneUseInNight([{ startS: 10, endS: 60 }, { startS: 3000, endS: 3100 }, { startS: 7100, endS: 7190 }], 7200)).toEqual([{ startS: 3000, endS: 3100 }]);
  });

  it('joins phone use and the watch saying awake, ignoring brief stirs', () => {
    const watch: AlignedSample[] = [
      { kind: 'sleep_stage', startS: 3050, endS: 3300, value: null, stage: 'awake' },
      { kind: 'sleep_stage', startS: 5000, endS: 5060, value: null, stage: 'awake' },
      { kind: 'sleep_stage', startS: 5060, endS: 6000, value: null, stage: 'deep' },
    ];
    expect(possiblyAwake([{ startS: 3000, endS: 3100 }], watch)).toEqual([{ startS: 3000, endS: 3300 }]);
  });
});

describe('turned over, and the snoring stopped', () => {
  const snoring = [{ startS: 3000, endS: 3600 }, { startS: 6000, endS: 6300 }];

  it('finds a movement as a long stretch of snoring ends, followed by quiet', () => {
    expect(turnedOverAndQuiet([{ startS: 3605, endS: 3608 }], snoring, 8 * 3600)).toEqual({ atS: 3605, quietS: 2392, toEnd: false });
  });

  it('ignores a movement the snoring carried on through', () => {
    expect(turnedOverAndQuiet([{ startS: 3200, endS: 3203 }], snoring, 8 * 3600)).toBeNull();
  });

  it('says when it stayed quiet for the rest of the night', () => {
    expect(turnedOverAndQuiet([{ startS: 6302, endS: 6305 }], snoring, 8 * 3600)).toEqual({ atS: 6302, quietS: 8 * 3600 - 6305, toEnd: true });
  });

  it('puts it in the morning summary', () => {
    const lines = morningSummary({
      startedAtEpochS: new Date(2026, 9, 16, 23, 0).getTime() / 1000,
      pctSnoring: 0.1,
      events: snoring.map((s) => ({ ...s, intensity: 'loud' as const })),
      health: null,
      factorsLogged: [],
      remediesLogged: [],
      history: [],
      experiment: null,
      turnedOver: { atS: 3605, quietS: 2392, toEnd: false },
    });
    expect(lines[1]).toBe('Snoring stopped after we heard you turn over at 0:00, and it stayed quiet for 40 minutes.');
  });

  it('words durations plainly', () => {
    expect(durationWords(60)).toBe('1 minute');
    expect(durationWords(2392)).toBe('40 minutes');
    expect(durationWords(3600)).toBe('1 hour');
    expect(durationWords(5 * 3600 + 20 * 60)).toBe('5 hours 20 minutes');
    expect(durationWords(2 * 3600 - 60)).toBe('2 hours');
  });
});

describe('saving the night', () => {
  it('keeps movement and phone use with the night, and deletes them with it', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `id${++n}`;
    await createSession(db, 's1', new Date(2026, 9, 16, 23, 0), 'normal');
    const frames = night(3 * 3600, spanOf(4000, 4003, rustle));
    await appendFrames(db, 's1', frames, new Date());
    await addPhoneUse(db, 's1', 20, 70); // right after Start: dropped
    await addPhoneUse(db, 's1', 5000, 5200);
    const result = await finaliseSession(db, 's1', { newId });
    const rows = await nightActivity(db, result!.nightId);
    expect(rows.map((r) => [r.kind, r.start_s, r.end_s])).toEqual([
      ['movement', 4000, 4003],
      ['phone', 5000, 5200],
    ]);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM session_mark', [])).toEqual({ n: 0 });
    // Marked as looked at, so This Morning knows "none" means none.
    expect(await db.getFirstAsync('SELECT activity_checked FROM night WHERE id = ?', [result!.nightId])).toEqual({ activity_checked: 1 });
    await deleteNight(db, result!.nightId);
    expect(await nightActivity(db, result!.nightId)).toEqual([]);
  });
});
