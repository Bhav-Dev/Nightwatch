import {
  eventCounts,
  eventMetrics,
  evaluateNight,
  frameCounts,
  frameMetrics,
  perSecondLabels,
  phase1Gate,
  poolNights,
} from '../tools/eval/metrics';

describe('perSecondLabels', () => {
  it('marks seconds whose midpoint lies inside an event', () => {
    expect(Array.from(perSecondLabels([{ startS: 2, endS: 5 }], 8))).toEqual([0, 0, 1, 1, 1, 0, 0, 0]);
  });

  it('rounds fractional edges to the nearest second boundary', () => {
    // [1.4, 3.6): midpoints 1.5, 2.5, 3.5 are inside.
    expect(Array.from(perSecondLabels([{ startS: 1.4, endS: 3.6 }], 6))).toEqual([0, 1, 1, 1, 0, 0]);
    // [1.6, 3.4): only 2.5 is inside.
    expect(Array.from(perSecondLabels([{ startS: 1.6, endS: 3.4 }], 6))).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('clips events to the night and ignores a trailing part-second', () => {
    expect(Array.from(perSecondLabels([{ startS: 3, endS: 99 }], 5.7))).toEqual([0, 0, 0, 1, 1]);
  });
});

describe('frame metrics', () => {
  it('counts and scores snore as the positive class', () => {
    const labelled = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
    const predicted = Uint8Array.from([0, 1, 1, 1, 1, 1, 0, 0]);
    const m = frameMetrics(frameCounts(labelled, predicted));
    expect(m).toMatchObject({ tp: 3, fp: 2, fn: 1, tn: 2 });
    expect(m.precision).toBeCloseTo(3 / 5);
    expect(m.recall).toBeCloseTo(3 / 4);
    expect(m.f1).toBeCloseTo(6 / 9);
  });

  it('reports undefined values as null rather than guessing', () => {
    const m = frameMetrics(frameCounts(new Uint8Array(4), new Uint8Array(4)));
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.f1).toBeNull();
    const onlyFalseAlarms = frameMetrics(frameCounts(new Uint8Array(2), Uint8Array.from([1, 0])));
    expect(onlyFalseAlarms.precision).toBe(0);
    expect(onlyFalseAlarms.recall).toBeNull();
    expect(onlyFalseAlarms.f1).toBe(0);
  });

  it('rejects arrays of different length', () => {
    expect(() => frameCounts(new Uint8Array(3), new Uint8Array(4))).toThrow(/length/);
  });
});

describe('event matching', () => {
  it('matches a labelled event covered by half its duration or more', () => {
    const labelled = [{ startS: 100, endS: 200 }];
    expect(eventCounts(labelled, [{ startS: 150, endS: 260 }]).matchedLabelled).toBe(1); // exactly 50%
    expect(eventCounts(labelled, [{ startS: 151, endS: 260 }]).matchedLabelled).toBe(0); // 49%
  });

  it('needs a single predicted event to reach the overlap, not several fragments', () => {
    const labelled = [{ startS: 0, endS: 100 }];
    const fragments = [
      { startS: 0, endS: 30 },
      { startS: 40, endS: 70 },
    ];
    expect(eventCounts(labelled, fragments).matchedLabelled).toBe(0);
  });

  it('lets one long prediction match several labelled events but counts it once for precision', () => {
    const labelled = [
      { startS: 0, endS: 40 },
      { startS: 60, endS: 100 },
    ];
    const c = eventCounts(labelled, [{ startS: 0, endS: 100 }]);
    expect(c).toEqual({ labelled: 2, matchedLabelled: 2, predicted: 1, correctPredicted: 0 });
    const m = eventMetrics(c);
    expect(m.agreement).toBe(1);
    // The merged prediction is only 40% covered by either labelled event.
    expect(m.precision).toBe(0);
  });

  it('measures event precision against the predicted event duration', () => {
    const labelled = [{ startS: 100, endS: 400 }];
    const predicted = [
      { startS: 120, endS: 160 }, // fully inside: correct
      { startS: 380, endS: 440 }, // 20 of 60 s inside: wrong
      { startS: 900, endS: 950 }, // nowhere near: wrong
    ];
    const m = eventMetrics(eventCounts(labelled, predicted));
    expect(m.correctPredicted).toBe(1);
    expect(m.precision).toBeCloseTo(1 / 3);
    // 40 s of a 300 s labelled event is not a match.
    expect(m.agreement).toBe(0);
  });

  it('agreement is undefined with no labelled events', () => {
    expect(eventMetrics(eventCounts([], [{ startS: 0, endS: 10 }])).agreement).toBeNull();
  });
});

describe('pooling and the Phase 1 gate', () => {
  it('pools by summing counts, so long nights weigh more', () => {
    const a = evaluateNight([{ startS: 0, endS: 100 }], [{ startS: 0, endS: 100 }], 1000);
    const b = evaluateNight([{ startS: 0, endS: 10 }], [], 100);
    const pooled = poolNights([a, b]);
    expect(pooled.frame).toMatchObject({ tp: 100, fp: 0, fn: 10 });
    expect(pooled.frame.f1).toBeCloseTo(200 / 210);
    expect(pooled.event.labelled).toBe(2);
    expect(pooled.event.agreement).toBe(0.5);
  });

  it('passes at the thresholds and fails just below', () => {
    const at = poolNights([]);
    at.event.agreement = 0.85;
    at.frame.f1 = 0.8;
    expect(phase1Gate(at).pass).toBe(true);
    const below = { ...at, frame: { ...at.frame, f1: 0.799 } };
    const result = phase1Gate(below);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/frame F1/);
  });

  it('fails when a metric is undefined', () => {
    const r = phase1Gate(poolNights([evaluateNight([], [], 100)]));
    expect(r.pass).toBe(false);
    expect(r.reasons).toHaveLength(2);
  });
});
