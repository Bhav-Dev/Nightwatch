import { clipsForDisplay } from '../src/domain/clipList';
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

describe('loudest moments list', () => {
  const start = new Date(2026, 9, 14, 23, 0, 0).getTime() / 1000;
  const clip = (id: string, peakS: number, peakDb: number) => ({ id, peak_s: peakS, peak_db: peakDb });

  it('keeps the five loudest, in the order they happened', () => {
    const clips = [clip('a', 3600, 30), clip('b', 600, 28), clip('c', 7200, 35), clip('d', 60, 10), clip('e', 5400, 26), clip('f', 1800, 27)];
    expect(clipsForDisplay(clips, start).map((x) => x.clip.id)).toEqual(['b', 'f', 'a', 'e', 'c']);
  });

  it('adds seconds only when two clips share a minute', () => {
    const shown = clipsForDisplay([clip('a', 2 * 3600 + 5, 30), clip('b', 2 * 3600 + 40, 29), clip('c', 3 * 3600, 28)], start);
    expect(shown.map((x) => x.time)).toEqual(['01:00:05', '01:00:40', '02:00']);
  });
});
