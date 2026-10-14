import { detectEventSpans, intensityFor } from '../src/domain/scoring';

const snoreAt = (length: number, ranges: [number, number][]) => {
  const a = new Array<boolean>(length).fill(false);
  for (const [from, to] of ranges) for (let t = from; t < to; t++) a[t] = true;
  return a;
};

describe('event detection', () => {
  it('drops runs shorter than 10 seconds', () => {
    expect(detectEventSpans(snoreAt(100, [[10, 19]]))).toEqual([]);
    expect(detectEventSpans(snoreAt(100, [[10, 20]]))).toEqual([{ startS: 10, endS: 20 }]);
  });

  it('bridges gaps of up to 5 seconds inside a run', () => {
    // 6 s + 5 s gap + 6 s: one 17 s event.
    expect(detectEventSpans(snoreAt(100, [[0, 6], [11, 17]]))).toEqual([{ startS: 0, endS: 17 }]);
  });

  it('does not bridge a 6 second gap, so two short runs are both dropped', () => {
    expect(detectEventSpans(snoreAt(100, [[0, 6], [12, 18]]))).toEqual([]);
  });

  it('merges events separated by less than 20 seconds', () => {
    expect(detectEventSpans(snoreAt(200, [[0, 10], [29, 39]]))).toEqual([{ startS: 0, endS: 39 }]);
    expect(detectEventSpans(snoreAt(200, [[0, 10], [30, 40]]))).toEqual([
      { startS: 0, endS: 10 },
      { startS: 30, endS: 40 },
    ]);
  });

  it('labels intensity by dB above floor', () => {
    expect(intensityFor(0)).toBe('quiet');
    expect(intensityFor(9.9)).toBe('quiet');
    expect(intensityFor(10)).toBe('light');
    expect(intensityFor(20)).toBe('loud');
    expect(intensityFor(30)).toBe('epic');
    expect(intensityFor(45)).toBe('epic');
  });
});
