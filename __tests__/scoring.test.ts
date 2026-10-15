import {
  analyseNight,
  rescoreFromEvents,
  scoreLabel,
  snoreScore,
} from '../src/domain/scoring';
import { evenNight, fixtureNight } from './helpers/fixtureNight';

describe('snore score formula', () => {
  it('saturates at 50% of the night and 30 dB', () => {
    expect(snoreScore(0, 0)).toBe(0);
    expect(snoreScore(0.5, 30)).toBe(100);
    expect(snoreScore(0.9, 50)).toBe(100);
    // 0.6 × 50 + 0.4 × 50
    expect(snoreScore(0.25, 15)).toBe(50);
  });

  it('maps scores to labels at the band edges', () => {
    expect([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(scoreLabel)).toEqual([
      'Quiet', 'Quiet', 'Light', 'Light', 'Moderate', 'Moderate', 'Loud', 'Loud', 'Epic', 'Epic',
    ]);
  });
});

describe('fixture nights, one per label band', () => {
  // Expected = 0.6 × 100 × min(pct / 0.5, 1) + 0.4 × 100 × min(db / 30, 1)
  const cases = [
    { label: 'Quiet', pct: 0.05, db: 6, expected: 6 + 8 },
    { label: 'Light', pct: 0.15, db: 12, expected: 18 + 16 },
    { label: 'Moderate', pct: 0.25, db: 15, expected: 30 + 20 },
    { label: 'Loud', pct: 0.35, db: 24, expected: 42 + 32 },
    { label: 'Epic', pct: 0.45, db: 33, expected: 54 + 40 },
  ] as const;

  it.each(cases)('$label night scores $expected within 1 point', ({ label, pct, db, expected }) => {
    const frames = evenNight(8, pct, db);
    const night = analyseNight({ durationS: 8 * 3600, frames });
    expect(Math.abs(night.score - expected)).toBeLessThanOrEqual(1);
    expect(night.label).toBe(label);
    expect(night.bins).toHaveLength(96);
    expect(night.countsTowardAverages).toBe(true);
  });
});

describe('analyseNight', () => {
  it('measures levels relative to the 5th-percentile floor', () => {
    const frames = fixtureNight(3600, [{ startS: 600, durationS: 60, db: 22 }]);
    const night = analyseNight({ durationS: 3600, frames });
    expect(night.events).toHaveLength(1);
    expect(night.events[0]).toMatchObject({ startS: 600, endS: 660, intensity: 'loud' });
    expect(night.events[0].peakDb).toBeCloseTo(22);
    expect(night.maxDb).toBeCloseTo(22);
  });

  it('subtracts interrupted gaps from time in bed', () => {
    const frames = fixtureNight(4 * 3600, [{ startS: 0, durationS: 3600, db: 15 }]).filter(
      (f) => f.t < 2 * 3600 || f.t >= 3 * 3600,
    );
    const night = analyseNight({
      durationS: 4 * 3600,
      frames,
      gaps: [{ startS: 2 * 3600, endS: 3 * 3600 }],
      partial: true,
    });
    expect(night.timeInBedS).toBe(3 * 3600);
    expect(night.pctSnoring).toBeCloseTo(1 / 3);
    expect(night.countsTowardAverages).toBe(true);
  });

  it('scores a partial night under 3 hours but keeps it out of averages', () => {
    const frames = evenNight(2, 0.2, 15);
    const night = analyseNight({ durationS: 2 * 3600, frames, partial: true });
    expect(night.score).toBeGreaterThan(0);
    expect(night.countsTowardAverages).toBe(false);
  });

  it('keeps a short night out of averages even when it was not interrupted', () => {
    const night = analyseNight({ durationS: 2 * 3600, frames: evenNight(2, 0.2, 15) });
    expect(night.score).toBeGreaterThan(0);
    expect(night.countsTowardAverages).toBe(false);
  });

  it('counts a complete night of exactly 3 hours', () => {
    const night = analyseNight({ durationS: 3 * 3600, frames: evenNight(3, 0.2, 15) });
    expect(night.countsTowardAverages).toBe(true);
  });

  it('shifts the snore threshold with sensitivity', () => {
    const frames = fixtureNight(600, []).map((f) =>
      f.t >= 100 && f.t < 200 ? { ...f, levelDb: f.levelDb + 15, snoreProb: 0.55 } : f,
    );
    expect(analyseNight({ durationS: 600, frames, sensitivity: 'normal' }).events).toHaveLength(0);
    expect(analyseNight({ durationS: 600, frames, sensitivity: 'high' }).events).toHaveLength(1);
  });

  it('fills bin snore seconds from events', () => {
    const frames = fixtureNight(900, [{ startS: 280, durationS: 40, db: 12 }]);
    const night = analyseNight({ durationS: 900, frames });
    expect(night.bins.map((b) => b.snoreS)).toEqual([20, 20, 0]);
  });

  it('an empty night scores zero', () => {
    const night = analyseNight({ durationS: 0, frames: [] });
    expect(night.score).toBe(0);
    expect(night.bins).toEqual([]);
  });

  it('rescoring from stored events matches the original score', () => {
    const night = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.3, 18) });
    expect(rescoreFromEvents(night.events, night.timeInBedS)).toBe(night.score);
  });
});
