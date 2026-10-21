import { nightActivity, saveNightActivity } from '../src/data/activityRepo';
import { saveNight } from '../src/data/nightRepo';
import { MIGRATION_SQL, migrate } from '../src/data/schema';
import { appendFrames, createSession } from '../src/data/sessionRepo';
import { frameFeatures, type FrameFeatures, SAMPLE_RATE } from '../src/domain/audio/features';
import { FrameFeatureBuffer } from '../src/domain/audio/frameBuffer';
import { detectHeavyBreathing, withoutHeavyBreathing } from '../src/domain/breathing';
import { classifyNightHeuristic } from '../src/domain/detection/heuristic';
import { analyseNight } from '../src/domain/scoring';
import { synthesiseNightAudio } from '../src/native/audioCapture';
import { finaliseSession } from '../src/recording/recordingSession';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

const FLOOR = -60;
const quiet: FrameFeatures = { levelDb: FLOOR, centroidHz: 800, envelopeDb: Array(10).fill(FLOOR) };

/** Loud breathing: broadband, `over` dB above the room, loud for 1.6 s of every 4. */
function breath(t: number, over = 10, centroidHz = 2500): FrameFeatures {
  return {
    levelDb: FLOOR + over,
    centroidHz,
    envelopeDb: Array.from({ length: 10 }, (_, i) => ((t * 10 + i) % 40 < 16 ? FLOOR + over + 4 : FLOOR + 2)),
  };
}
/** A fan: as loud and as bright, but steady. */
const fan: FrameFeatures = { levelDb: FLOOR + 10, centroidHz: 2500, envelopeDb: Array(10).fill(FLOOR + 10) };

type Span = [from: number, to: number, make: (t: number) => FrameFeatures];
/** A night of quiet seconds, with the first span that covers a second deciding its features. */
function night(seconds: number, ...spans: Span[]) {
  return Array.from({ length: seconds }, (_, t) => {
    const span = spans.find(([from, to]) => t >= from && t < to);
    return { t, features: span ? span[2](t) : quiet };
  });
}
/**
 * The stretches found, checked against where the breathing was: where a stretch starts and ends is
 * known to a few seconds, as the rhythm is judged over the seconds around each one.
 */
function expectNear(found: { startS: number; endS: number }[], expected: [number, number][]) {
  expect(found).toHaveLength(expected.length);
  found.forEach((b, i) => {
    expect(b.startS).toBeGreaterThanOrEqual(expected[i][0]);
    expect(b.startS).toBeLessThanOrEqual(expected[i][0] + 5);
    expect(b.endS).toBeLessThanOrEqual(expected[i][1]);
    expect(b.endS).toBeGreaterThanOrEqual(expected[i][1] - 5);
  });
}

describe('heavy breathing heard in the audio', () => {
  it('finds a long stretch of loud breathing that rises and falls with each breath', () => {
    const found = detectHeavyBreathing(night(3600, [1000, 1100, breath]), [], { durationS: 3600 });
    expectNear(found, [[1000, 1100]]);
    expect(found[0].peakDb).toBe(10);
  });

  it('leaves out steady noise, low buzzing, a few loud breaths and the ends of the night', () => {
    const frames = night(
      3600,
      [600, 700, () => fan],
      [900, 1000, (t) => breath(t, 10, 600)], // snoring's low sound: the snoring detector's to find
      [1200, 1215, breath], // a few loud breaths
      [30, 110, breath], // settling down
      [3500, 3590, breath], // getting up
      // A faster rhythm than breathing (each second the same uneven sound), as from a clock or panting
      [1500, 1600, () => ({ levelDb: FLOOR + 10, centroidHz: 2500, envelopeDb: [-60, -46, -52, -44, -58, -47, -55, -45, -59, -50] })],
    );
    expect(detectHeavyBreathing(frames, [], { durationS: 3600 })).toEqual([]);
  });

  it('keeps clear of snoring and of the breaths between snores', () => {
    const frames = night(3600, [1000, 1200, breath]);
    // Snoring on every other breath for the first 100 seconds.
    const snoring = frames.filter((f) => f.t >= 1000 && f.t < 1100 && f.t % 8 === 0).map((f) => ({ t: f.t, snoreProb: 0.9 }));
    const [found, ...rest] = detectHeavyBreathing(frames, snoring, { durationS: 3600 });
    expect(rest).toEqual([]);
    expect(found.startS).toBeGreaterThan(1096 + 5);
    expect(found.endS).toBeGreaterThanOrEqual(1195);
    // A second the detector was unsure about is not snoring.
    const unsure = snoring.map((s) => ({ ...s, snoreProb: 0.3 }));
    expectNear(detectHeavyBreathing(frames, unsure, { durationS: 3600 }), [[1000, 1200]]);
  });

  it('joins stretches close together and keeps the rest apart', () => {
    const frames = night(3600, [1000, 1040, breath], [1050, 1090, breath], [1300, 1340, breath]);
    expectNear(detectHeavyBreathing(frames, [], { durationS: 3600 }), [
      [1000, 1090],
      [1300, 1340],
    ]);
  });

  it('measures against sleep sounds while they play', () => {
    const sound: FrameFeatures = { levelDb: FLOOR + 10, centroidHz: 2500, envelopeDb: Array(10).fill(FLOOR + 10) };
    // 2 dB over the sound, then 10 dB over it.
    const frames = night(3600, [400, 600, (t) => breath(t, 12)], [800, 1000, (t) => breath(t, 20)], [0, 1800, () => sound]);
    const underSound = detectHeavyBreathing(frames, [], { durationS: 3600, maskedUntilS: 1800 });
    expectNear(underSound, [[800, 1000]]);
    expect(underSound[0].peakDb).toBe(10);
    expectNear(detectHeavyBreathing(frames, [], { durationS: 3600 }), [
      [400, 600],
      [800, 1000],
    ]);
  });

  it('finds nothing in an empty recording', () => {
    expect(detectHeavyBreathing([], [], { durationS: 0 })).toEqual([]);
  });

  it('takes movement heard during heavy breathing to be the breathing', () => {
    const moves = [100, 993, 1050, 1105, 1200].map((s) => ({ startS: s, endS: s + 2, peakDb: 9 }));
    expect(withoutHeavyBreathing(moves, [{ startS: 1000, endS: 1100, peakDb: 10 }]).map((m) => m.startS)).toEqual([100, 1200]);
  });
});

/** Repeatable white noise in [-1, 1). */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

describe('heavy breathing in synthetic audio', () => {
  it('finds rushing air in time with breathing, and not snoring', () => {
    const rand = noise(7);
    const breathing = (t: number) => t >= 300 && t < 500;
    const frames = Array.from({ length: 900 }, (_, t) => {
      const samples = new Float32Array(SAMPLE_RATE);
      for (let i = 0; i < samples.length; i++) {
        const at = t + i / SAMPLE_RATE;
        samples[i] = 0.002 * rand() + (breathing(t) && at % 4 < 1.6 ? 0.03 * rand() : 0);
      }
      return { t, features: frameFeatures(samples) };
    });
    const scored = classifyNightHeuristic(frames);
    expect(scored.some((s) => s.snoreProb >= 0.5)).toBe(false);
    const [found, ...rest] = detectHeavyBreathing(frames, scored, { durationS: 900 });
    expect(rest).toEqual([]);
    // Quiet seconds between breaths are bridged; the last breath starts at 496.
    expect(found.startS).toBeGreaterThanOrEqual(300);
    expect(found.startS).toBeLessThan(310);
    expect(found.endS).toBe(498);
  });

  it('leaves snoring to the snoring detector', () => {
    const buf = new FrameFeatureBuffer();
    for (let start = 0; start < 600; start += 30) buf.addWindow(start, synthesiseNightAudio(start, 30, {}));
    const frames = buf.entries();
    const scored = classifyNightHeuristic(frames);
    expect(scored.filter((s) => s.snoreProb >= 0.5).length).toBeGreaterThan(60);
    expect(detectHeavyBreathing(frames, scored, { durationS: 600 })).toEqual([]);
  });
});

describe('keeping heavy breathing with the night', () => {
  it('saves it at Stop and marks the night as checked for it', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `id${++n}`;
    await createSession(db, 's1', new Date(2026, 9, 20, 23, 0), 'normal');
    await appendFrames(db, 's1', night(3 * 3600, [5000, 5100, breath]), new Date());
    const result = await finaliseSession(db, 's1', { newId });
    const rows = await nightActivity(db, result!.nightId);
    // Heard as heavy breathing, and not also as movement: each loud breath sounds like a rustle.
    expect(rows.map((r) => r.kind)).toEqual(['breathing']);
    expectNear(
      rows.map((r) => ({ startS: r.start_s, endS: r.end_s })),
      [[5000, 5100]],
    );
    expect(rows[0].peak_db).toBe(10);
    expect(await db.getFirstAsync('SELECT activity_checked, breathing_checked FROM night WHERE id = ?', [result!.nightId])).toEqual({
      activity_checked: 1,
      breathing_checked: 1,
    });
  });

  it('leaves a night saved without the check unmarked, so none is not read as none heard', async () => {
    const db = openTestDb();
    await migrate(db);
    const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.2, 15) });
    let n = 0;
    const newId = () => `x${++n}`;
    const startedAt = new Date(2026, 9, 12, 23, 0);
    await saveNight(db, { id: 'n1', startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
    await saveNightActivity(db, 'n1', { movement: [{ startS: 100, endS: 103, peakDb: 9 }], phone: [] }, newId);
    expect(await db.getFirstAsync('SELECT activity_checked, breathing_checked FROM night WHERE id = ?', ['n1'])).toEqual({
      activity_checked: 1,
      breathing_checked: null,
    });
  });
});

describe('the migration that adds heavy breathing', () => {
  it('rebuilds night activity with its rows, and lets it hold heavy breathing', async () => {
    const db = openTestDb();
    const at = MIGRATION_SQL.findIndex((sql) => sql.includes('night_activity_v2'));
    expect(at).toBeGreaterThan(0);
    await db.execAsync('PRAGMA foreign_keys = ON;');
    for (const sql of MIGRATION_SQL.slice(0, at)) await db.execAsync(sql);
    await db.execAsync(`PRAGMA user_version = ${at}`);

    const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.2, 15) });
    let n = 0;
    const newId = () => `x${++n}`;
    const startedAt = new Date(2026, 9, 12, 23, 0);
    await saveNight(db, { id: 'n1', startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES ('a1', 'n1', 'movement', 100, 103, 9)", []);
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES ('a2', 'n1', 'phone', 500, 600, NULL)", []);
    await expect(
      db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s) VALUES ('a3', 'n1', 'breathing', 700, 760)", []),
    ).rejects.toThrow();

    await migrate(db);
    expect(await nightActivity(db, 'n1')).toEqual([
      { id: 'a1', night_id: 'n1', kind: 'movement', start_s: 100, end_s: 103, peak_db: 9 },
      { id: 'a2', night_id: 'n1', kind: 'phone', start_s: 500, end_s: 600, peak_db: null },
    ]);
    await db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s, peak_db) VALUES ('a3', 'n1', 'breathing', 700, 760, 8)", []);
    await expect(db.runAsync("INSERT INTO night_activity (id, night_id, kind, start_s, end_s) VALUES ('a4', 'n1', 'talking', 800, 810)", [])).rejects.toThrow();
    expect((await nightActivity(db, 'n1')).map((r) => r.kind)).toEqual(['movement', 'phone', 'breathing']);
    // Older nights were not checked for heavy breathing.
    expect(await db.getFirstAsync('SELECT breathing_checked FROM night WHERE id = ?', ['n1'])).toEqual({ breathing_checked: null });
  });
});
