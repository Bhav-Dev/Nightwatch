import { enrichedHistory } from '../src/data/historyRepo';
import { getNight, saveNight, setCheckIn } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { autoFactorId, autoFactorsFor, usualFloorDb } from '../src/domain/autoFactors';
import { patterns, type NightWithCheckIn } from '../src/domain/patterns';
import { analyseNight } from '../src/domain/scoring';
import { morningSummary } from '../src/domain/summary';
import { openTestDb } from './helpers/nodeDb';

const H = 3600;
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime() / 1000;

describe('factors read from the night', () => {
  it('tells early and late bedtimes, and short and long nights', () => {
    expect(autoFactorsFor({ startedAtS: at(14, 22, 30), timeInBedS: 8.5 * H, floorDb: -60 }, -60)).toEqual(['early_bed', 'long_night']);
    expect(autoFactorsFor({ startedAtS: at(15, 0, 40), timeInBedS: 5 * H, floorDb: -60 }, -60)).toEqual(['late_bed', 'short_night']);
    expect(autoFactorsFor({ startedAtS: at(14, 23, 30), timeInBedS: 7 * H, floorDb: -60 }, -60)).toEqual([]);
  });

  it('counts a weekend night by the evening it began', () => {
    // 16 October 2026 is a Friday: bed at 1am on Saturday is still Friday night.
    expect(autoFactorsFor({ startedAtS: at(16, 23), timeInBedS: 7 * H, floorDb: null }, null)).toContain('weekend');
    expect(autoFactorsFor({ startedAtS: at(17, 1), timeInBedS: 7 * H, floorDb: null }, null)).toContain('weekend');
    expect(autoFactorsFor({ startedAtS: at(19, 1), timeInBedS: 7 * H, floorDb: null }, null)).not.toContain('weekend');
  });

  it('notices a noisier room than usual', () => {
    const usual = usualFloorDb([{ floorDb: -62 }, { floorDb: -60 }, { floorDb: -61 }]);
    expect(autoFactorsFor({ startedAtS: at(14, 23, 30), timeInBedS: 7 * H, floorDb: -54 }, usual)).toEqual(['noisy_room']);
    expect(autoFactorsFor({ startedAtS: at(14, 23, 30), timeInBedS: 7 * H, floorDb: -58 }, usual)).toEqual([]);
  });
});

/** Nights with a factor score 10 higher and feel less rested; nights without are the baseline. */
function history(): NightWithCheckIn[] {
  return Array.from({ length: 12 }, (_, i) => {
    const late = i % 2 === 0;
    return {
      id: `n${i}`,
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      score: late ? 40 : 30,
      pct_snoring: 0.1,
      duration_s: 7 * H,
      partial: false,
      typical: true,
      remedies: [],
      factors: [...(late ? [{ id: autoFactorId('late_bed'), value: null }] : []), ...(i < 2 ? [{ id: 'alcohol', value: '2' }] : [])],
      rested: late ? 2 : 4,
    };
  });
}

describe('your patterns', () => {
  it('compares each factor against your own nights, on score and on how rested you felt', () => {
    const [first, second] = patterns(history());
    expect(first).toEqual({ id: 'auto:late_bed', nightsWith: 6, nightsWithout: 6, scoreDiff: 10, restedDiff: -2 });
    // Too few nights to compare yet, so it comes after the ones with a result.
    expect(second).toMatchObject({ id: 'alcohol', nightsWith: 2, scoreDiff: null });
  });

  it('puts the strongest night factor in the summary', () => {
    const lines = morningSummary({
      startedAtEpochS: at(19, 0, 40),
      pctSnoring: 0.1,
      events: [],
      health: null,
      factorsLogged: [],
      remediesLogged: [],
      history: history(),
      experiment: null,
      autoFactors: ['late_bed'],
    });
    expect(lines).toContain('You went to bed after midnight; your after-midnight nights average 10 points higher.');
  });
});

describe('the morning check-in', () => {
  it('is kept with the night and joins its history entry with the night’s own factors', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `id${++n}`;
    const analysis = analyseNight({ durationS: 7 * H, frames: [] });
    const startedAt = new Date(at(17, 0, 30) * 1000);
    await saveNight(db, { id: 'night1', startedAt, endedAt: new Date(startedAt.getTime() + 7 * H * 1000), partial: false, analysis, newId, interruption: null, detector: 'test' });
    await setCheckIn(db, 'night1', 'rested', 4);
    await setCheckIn(db, 'night1', 'partner_slept', 3);
    const night = await getNight(db, 'night1');
    expect([night?.rested, night?.partner_slept]).toEqual([4, 3]);
    const [entry] = await enrichedHistory(db);
    expect(entry.rested).toBe(4);
    expect(entry.factors.map((f) => f.id)).toEqual(expect.arrayContaining(['auto:late_bed', 'auto:weekend']));
    await setCheckIn(db, 'night1', 'rested', null);
    expect((await getNight(db, 'night1'))?.rested).toBeNull();
  });
});
