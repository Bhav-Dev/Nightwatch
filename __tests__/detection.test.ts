import { aWeightingPowerGain, frameFeatures, SAMPLE_RATE } from '../src/domain/audio/features';
import { FrameFeatureBuffer } from '../src/domain/audio/frameBuffer';
import { classifyNightHeuristic, periodicity } from '../src/domain/detection/heuristic';
import { analyseNight } from '../src/domain/scoring';
import { synthesiseNightAudio } from '../src/native/audioCapture';

const sine = (hz: number, amp: number) => {
  const a = new Float32Array(SAMPLE_RATE);
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return a;
};

describe('frame features', () => {
  it('A-weighting is 0 dB at 1 kHz and strongly attenuates low frequencies', () => {
    expect(10 * Math.log10(aWeightingPowerGain(1000))).toBeCloseTo(0, 1);
    expect(10 * Math.log10(aWeightingPowerGain(100))).toBeCloseTo(-19.1, 0);
  });

  it('a full-scale 1 kHz sine is about -3 dBFS RMS', () => {
    expect(frameFeatures(sine(1000, 1)).levelDb).toBeCloseTo(-3, 0);
  });

  it('spectral centroid tracks pitch', () => {
    expect(frameFeatures(sine(200, 0.5)).centroidHz).toBeLessThan(400);
    expect(frameFeatures(sine(3000, 0.5)).centroidHz).toBeGreaterThan(2500);
  });
});

describe('periodicity', () => {
  it('finds a 4 second rhythm in a 10 Hz envelope', () => {
    const env = Array.from({ length: 100 }, (_, i) => (i % 40 < 16 ? -20 : -50));
    expect(periodicity(env, 10, 50)).toBeGreaterThan(0.5);
  });

  it('ignores a flat envelope', () => {
    expect(periodicity(new Array(100).fill(-40), 10, 50)).toBe(0);
  });
});

describe('heuristic detector v0 on synthetic audio', () => {
  const featuresFor = (seconds: number, opts: Parameters<typeof synthesiseNightAudio>[2]) => {
    const buf = new FrameFeatureBuffer();
    for (let start = 0; start < seconds; start += 30) {
      buf.addWindow(start, synthesiseNightAudio(start, 30, opts));
    }
    return buf.entries();
  };

  it('finds the snoring stretch and nothing else', () => {
    // Snoring from 120 s to 360 s of a 600 s recording.
    const frames = classifyNightHeuristic(featuresFor(600, {}));
    const night = analyseNight({ durationS: 600, frames });
    expect(night.events.length).toBe(1);
    const [e] = night.events;
    expect(e.startS).toBeGreaterThanOrEqual(115);
    expect(e.startS).toBeLessThanOrEqual(130);
    expect(e.endS).toBeGreaterThanOrEqual(350);
    expect(e.endS).toBeLessThanOrEqual(365);
  });

  it('rejects steady loud low-frequency noise (no breathing rhythm)', () => {
    const frames = classifyNightHeuristic(
      featuresFor(300, { snoringAt: (t) => t >= 60, breathPeriodS: 1, snoreOnS: 1 }),
    );
    expect(analyseNight({ durationS: 300, frames }).events).toHaveLength(0);
  });

  it('rejects a quiet room', () => {
    const frames = classifyNightHeuristic(featuresFor(300, { snoringAt: () => false }));
    expect(frames.every((f) => f.snoreProb === 0)).toBe(true);
  });
});

describe('periodicity edge cases', () => {
  it('a single step from quiet to loud is not a rhythm', () => {
    const step = Array.from({ length: 100 }, (_, i) => (i < 50 ? -60 : -20));
    expect(periodicity(step, 10, 50)).toBeLessThan(0.3);
  });
});
