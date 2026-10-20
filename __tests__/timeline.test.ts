import { buildMoments, countByKind, momentAt, momentTimes, neighbour, shownMoments } from '../src/domain/moments';
import { colourRuns, labelX, OUTLINE_MIN, outlineAmplitudes, outlinePath } from '../src/ui/timelineShape';

describe('timeline outline', () => {
  it('scales mean level above the floor, with a visible minimum and a ceiling', () => {
    expect(outlineAmplitudes([0, 10, 20, 40, -3, Number.NaN])).toEqual([OUTLINE_MIN, 0.5, 1, 1, OUTLINE_MIN, OUTLINE_MIN]);
  });

  it('draws a closed shape across the full width, mirrored around the centre line', () => {
    const d = outlinePath([0.2, 1, 0.5], 300, 60, 50);
    expect(d.startsWith('M0.0,')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    const ys = [...d.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((m) => Number(m[2]));
    // Every point stays inside the band, and the shape is symmetric: the top and bottom
    // extremes are the same distance from the centre.
    expect(Math.min(...ys)).toBeCloseTo(60 - 50, 1);
    expect(Math.max(...ys)).toBeCloseTo(60 + 50, 1);
    expect(d).toContain('300.0,');
  });

  it('draws nothing for an empty night', () => {
    expect(outlinePath([], 300, 60, 50)).toBe('');
  });

  it('merges neighbouring bins of the same intensity into one fill', () => {
    expect(colourRuns(['loud', 'loud', null, 'light', 'loud', 'loud'])).toEqual([
      { start: 0, end: 2, key: 'loud' },
      { start: 3, end: 4, key: 'light' },
      { start: 4, end: 6, key: 'loud' },
    ]);
  });

  it('keeps hour labels inside the chart', () => {
    expect(labelX(0, 300)).toBe(14);
    expect(labelX(150, 300)).toBe(150);
    expect(labelX(299, 300)).toBe(286);
  });
});

describe('the night in moments, with movement and waking', () => {
  const start = new Date(2026, 9, 14, 23, 0, 0).getTime() / 1000;
  const moments = buildMoments({
    snoring: [{ startS: 3600, endS: 3700, peakDb: 22 }],
    other: [{ startS: 600, endS: 615, peakDb: 30 }],
    recorded: [{ startS: 590, endS: 900 }],
    answered: [{ startS: 3600, endS: 3700 }],
    movement: [{ startS: 800, endS: 806, peakDb: 9 }],
    // Awake from 50 minutes in to 70, around the snoring at an hour.
    awake: [{ startS: 3000, endS: 4200 }],
  });

  it('adds movement and possibly awake, and keeps recorded sound out of a movement', () => {
    expect(moments.map((m) => [m.kind, m.startS, m.endS])).toEqual([
      ['sound', 590, 600],
      ['other', 600, 615],
      ['sound', 615, 800],
      ['move', 800, 806],
      ['sound', 806, 900],
      ['awake', 3000, 4200],
      ['snore', 3600, 3700],
    ]);
    // Only snoring and other sounds can be answered for.
    expect(moments.find((m) => m.kind === 'awake')?.answered).toBe(false);
    expect(moments.find((m) => m.kind === 'snore')?.answered).toBe(true);
  });

  it('counts and filters the kinds shown, never listing recorded sound alone', () => {
    expect(countByKind(moments)).toEqual({ snore: 1, move: 1, awake: 1, other: 1 });
    expect(shownMoments(moments, new Set(['move', 'snore'])).map((m) => m.kind)).toEqual(['move', 'snore']);
    expect(shownMoments(moments, new Set(['snore', 'move', 'awake', 'other']))).toHaveLength(4);
  });

  it('finds the snore inside a stretch of being awake, and steps only through what is shown', () => {
    expect(momentAt(moments, 3650)?.kind).toBe('snore');
    expect(momentAt(moments, 3100)?.kind).toBe('awake');
    const onlySnoring = shownMoments(moments, new Set(['snore']));
    expect(neighbour(onlySnoring, 0, 1)?.kind).toBe('snore');
    expect(neighbour(onlySnoring, 3700, 1)).toBeNull();
  });

  it('adds seconds to the time only when two moments share a minute', () => {
    const times = momentTimes(
      [
        { startS: 2 * 3600 + 5, endS: 2 * 3600 + 20, kind: 'other', peakDb: 30, answered: false },
        { startS: 2 * 3600 + 40, endS: 2 * 3600 + 55, kind: 'other', peakDb: 29, answered: false },
        { startS: 3 * 3600, endS: 3 * 3600 + 6, kind: 'move', peakDb: null, answered: false },
      ],
      start,
    );
    expect(times).toEqual(['01:00:05', '01:00:40', '02:00']);
  });
});
