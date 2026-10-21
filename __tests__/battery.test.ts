import { aWeightingPowerGain, ENVELOPE_RATE_HZ, frameFeatures, type FrameFeatures, PEAK_MAX_HZ, PEAK_MIN_HZ, SAMPLE_RATE } from '../src/domain/audio/features';
import { fft, RealPowerSpectrum } from '../src/domain/audio/fft';
import { detectMovement } from '../src/domain/activity';
import { detectHeavyBreathing } from '../src/domain/breathing';
import { classifyNightHeuristic } from '../src/domain/detection/heuristic';
import { stretchPitches } from '../src/domain/pitch';
import { analyseNight } from '../src/domain/scoring';
import type { Db } from '../src/data/db';
import { latestNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { appendFrames, createSession, sessionFrames } from '../src/data/sessionRepo';
import { int16ToFloat32 } from '../src/domain/audio/frameAssembler';
import { type AudioCapture, CAPTURE_SAMPLE_RATE, type CaptureListener, synthesiseNightAudio } from '../src/native/audioCapture';
import { PERSIST_EVERY_S, RecordingSession } from '../src/recording/recordingSession';
import { SOUND_PRE_ROLL_S, SoundRecorder } from '../src/recording/soundRecorder';
import { openTestDb } from './helpers/nodeDb';

/**
 * The per-second features as they were worked out before the FFT was made cheaper (a complex FFT
 * of every 1024-sample block, summed block by block). The faster version must give the same
 * numbers, so nights are scored exactly as before.
 */
function referenceFeatures(samples: Float32Array, sampleRate = SAMPLE_RATE): FrameFeatures {
  const N = 1024;
  const EPS = 1e-12;
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const hannPower = hann.reduce((s, x) => s + x * x, 0) / N;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const spectrum = new Float64Array(N / 2 + 1);
  let weightedPower = 0;
  let centroidNum = 0;
  let centroidDen = 0;
  let blocks = 0;
  for (let off = 0; off + N <= samples.length; off += N) {
    for (let i = 0; i < N; i++) {
      re[i] = samples[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k <= N / 2; k++) {
      const p = ((k === N / 2 ? 1 : 2) * (re[k] * re[k] + im[k] * im[k])) / (N * N * hannPower);
      weightedPower += p * aWeightingPowerGain((k * sampleRate) / N);
      centroidNum += p * ((k * sampleRate) / N);
      centroidDen += p;
      spectrum[k] += p;
    }
    blocks++;
  }
  const sub = Math.floor(samples.length / ENVELOPE_RATE_HZ);
  const envelopeDb: number[] = [];
  for (let b = 0; b < ENVELOPE_RATE_HZ && sub > 0; b++) {
    let ms = 0;
    for (let i = b * sub; i < (b + 1) * sub; i++) ms += samples[i] * samples[i];
    envelopeDb.push(10 * Math.log10(ms / sub + EPS));
  }
  let peakHz = 0;
  if (blocks > 0) {
    const binHz = sampleRate / N;
    const lo = Math.max(1, Math.ceil(PEAK_MIN_HZ / binHz));
    const hi = Math.min(N / 2 - 1, Math.floor(PEAK_MAX_HZ / binHz));
    let best = lo;
    for (let k = lo + 1; k <= hi; k++) if (spectrum[k] > spectrum[best]) best = k;
    if (spectrum[best] > 0) {
      const a = Math.log(spectrum[best - 1] + EPS);
      const b = Math.log(spectrum[best] + EPS);
      const c = Math.log(spectrum[best + 1] + EPS);
      const curve = a - 2 * b + c;
      const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
      peakHz = (best + shift) * binHz;
    }
  }
  return {
    levelDb: 10 * Math.log10((blocks > 0 ? weightedPower / blocks : 0) + EPS),
    centroidHz: centroidDen > 0 ? centroidNum / centroidDen : 0,
    envelopeDb,
    peakHz,
  };
}

function expectSameFeatures(got: FrameFeatures, want: FrameFeatures) {
  expect(Math.abs(got.levelDb - want.levelDb)).toBeLessThan(1e-9);
  expect(Math.abs(got.centroidHz - want.centroidHz)).toBeLessThan(1e-6);
  expect(Math.abs(got.peakHz! - want.peakHz!)).toBeLessThan(1e-6);
  expect(got.envelopeDb).toEqual(want.envelopeDb);
}

/** Every number rounded to 9 decimals, for comparing results that agree to rounding. */
const rounded = (x: unknown): unknown => JSON.parse(JSON.stringify(x), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v));

/** Deterministic noise in [-amp, amp]. */
function noise(length: number, amp: number, seed: number): Float32Array {
  let s = seed >>> 0 || 1;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = amp * (((s >>> 0) / 0xffffffff) * 2 - 1);
  }
  return out;
}

describe('the cheaper FFT', () => {
  it('gives the same power spectrum as the complex FFT', () => {
    for (const n of [4, 8, 64, 1024]) {
      const x = noise(n, 0.5, n);
      const window = new Float64Array(n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      const gain = new Float64Array(n / 2 + 1).fill(1);
      const got = new Float64Array(n / 2 + 1);
      new RealPowerSpectrum(n).accumulate(x, 0, window, gain, got);
      const re = Float64Array.from(x, (v, i) => v * window[i]);
      const im = new Float64Array(n);
      fft(re, im);
      for (let k = 1; k <= n / 2; k++) expect(got[k]).toBeCloseTo(re[k] * re[k] + im[k] * im[k], 9);
      expect(got[0]).toBe(0);
    }
  });

  it('adds blocks into the spectrum it is given, at any offset', () => {
    const plan = new RealPowerSpectrum(16);
    const x = noise(48, 0.3, 7);
    const window = new Float64Array(16).fill(1);
    const gain = new Float64Array(9).fill(2);
    const both = new Float64Array(9);
    plan.accumulate(x, 0, window, gain, both);
    plan.accumulate(x, 32, window, gain, both);
    const first = new Float64Array(9);
    const second = new Float64Array(9);
    plan.accumulate(x, 0, window, gain, first);
    plan.accumulate(x, 32, window, gain, second);
    for (let k = 1; k <= 8; k++) expect(both[k]).toBeCloseTo(first[k] + second[k], 12);
  });
});

describe('per-second features after the battery work', () => {
  it('match the earlier features on snoring, quiet, noise, tones and silence', () => {
    const seconds: Float32Array[] = [
      synthesiseNightAudio(0, 1),
      synthesiseNightAudio(120, 1),
      synthesiseNightAudio(121, 1),
      synthesiseNightAudio(130, 1, { snoreAmp: 0.6 }),
      noise(SAMPLE_RATE, 0.02, 3),
      noise(SAMPLE_RATE, 0.9, 4),
      Float32Array.from({ length: SAMPLE_RATE }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 137 * i) / SAMPLE_RATE)),
      new Float32Array(SAMPLE_RATE),
      noise(5000, 0.1, 5), // not a whole number of blocks
      noise(500, 0.1, 6), // shorter than a block
    ];
    for (const s of seconds) expectSameFeatures(frameFeatures(s), referenceFeatures(s));
    // Another sample rate takes another A-weighting table.
    const at8k = noise(8000, 0.2, 8);
    expectSameFeatures(frameFeatures(at8k, 8000), referenceFeatures(at8k, 8000));
    expectSameFeatures(frameFeatures(seconds[1]), referenceFeatures(seconds[1]));
  });

  it('do not keep anything from one second to the next', () => {
    const loud = synthesiseNightAudio(130, 1, { snoreAmp: 0.6 });
    const quiet = synthesiseNightAudio(0, 1);
    const alone = frameFeatures(quiet);
    frameFeatures(loud);
    expect(frameFeatures(quiet)).toEqual(alone);
  });

  it('score a night of synthetic audio exactly as before', () => {
    const durationS = 1200;
    const now: { t: number; features: FrameFeatures }[] = [];
    const before: { t: number; features: FrameFeatures }[] = [];
    for (let t = 0; t < durationS; t++) {
      const samples = synthesiseNightAudio(t, 1);
      now.push({ t, features: frameFeatures(samples) });
      before.push({ t, features: referenceFeatures(samples) });
    }
    const score = (frames: typeof now) => {
      const scored = classifyNightHeuristic(frames, { maskedUntilS: 0 });
      const analysis = analyseNight({ durationS, frames: scored, gaps: [], partial: false, sensitivity: 'normal', maskedUntilS: 0 });
      return {
        scored,
        analysis,
        breathing: detectHeavyBreathing(frames, scored, { durationS }),
        movement: detectMovement(frames, scored, { durationS }),
        pitch: stretchPitches(frames, scored, analysis.events),
      };
    };
    const a = score(now);
    const b = score(before);
    expect(a.scored.map((f) => f.snoreProb)).toEqual(b.scored.map((f) => f.snoreProb));
    expect(a.analysis.events.length).toBeGreaterThan(0);
    expect(a.pitch.length).toBeGreaterThan(0);
    // The same events, score, label, movement, breathing and pitch; the decibel figures agree to
    // rounding (about 1e-14).
    expect(rounded(a)).toEqual(rounded(b));
  }, 30_000);
});

/** A capture the test drives by hand, one second at a time as the phone delivers it. */
class FakeCapture implements AudioCapture {
  listener: CaptureListener | null = null;
  async requestPermission() {
    return true;
  }
  async start(listener: CaptureListener) {
    this.listener = listener;
  }
  async stop() {}
  isRecording() {
    return this.listener !== null;
  }
  /** Feeds synthetic audio, or the same second over and over when only the counts matter. */
  feed(startS: number, seconds: number, same?: Float32Array) {
    for (let s = startS; s < startS + seconds; s++) {
      this.listener?.onWindow({ startS: s, samples: same ?? synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    }
  }
}

/** Counts the calls into SQLite: each one is a trip to native code, each transaction a commit. */
function counting(db: Db) {
  const n = { statements: 0, transactions: 0 };
  const wrapped: Db = {
    execAsync: (sql) => (n.statements++, db.execAsync(sql)),
    runAsync: (sql, params) => (n.statements++, db.runAsync(sql, params)),
    getAllAsync: (sql, params) => (n.statements++, db.getAllAsync(sql, params)),
    getFirstAsync: (sql, params) => (n.statements++, db.getFirstAsync(sql, params)),
    withTransactionAsync: (task) => (n.transactions++, db.withTransactionAsync(task)),
  };
  return { db: wrapped, n };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('saving the night while recording', () => {
  let ids = 0;
  const newId = () => `b-${++ids}`;

  it('writes an hour of seconds in a minute’s batches of a couple of statements each', async () => {
    const raw = openTestDb();
    await migrate(raw);
    const { db, n } = counting(raw);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId });
    const before = { ...n };
    capture.feed(0, 3600, synthesiseNightAudio(0, 1));
    await settle();
    expect(n.transactions - before.transactions).toBe(3600 / PERSIST_EVERY_S);
    // One INSERT for the batch and one UPDATE of the session, every minute (was 31 every 30 s).
    expect(n.statements - before.statements).toBe((3600 / PERSIST_EVERY_S) * 2);
    expect((await sessionFrames(raw, session.id)).length).toBe(3600);
    await session.discard();
  }, 30_000);

  it('saves every second at Stop, including those since the last batch', async () => {
    const db = openTestDb();
    await migrate(db);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId });
    capture.feed(0, PERSIST_EVERY_S * 2 + 17);
    await session.finish();
    expect((await latestNight(db))?.duration_s).toBe(PERSIST_EVERY_S * 2 + 17);
  });

  it('saves the seconds since the last batch when asked, as the app leaves the screen', async () => {
    const db = openTestDb();
    await migrate(db);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId });
    capture.feed(0, 25);
    await settle();
    expect(await sessionFrames(db, session.id)).toEqual([]);
    session.persistNow();
    session.persistNow(); // nothing new: no second write
    await settle();
    expect((await sessionFrames(db, session.id)).map((f) => f.t)).toEqual(Array.from({ length: 25 }, (_, t) => t));
    capture.feed(25, PERSIST_EVERY_S);
    await settle();
    expect((await sessionFrames(db, session.id)).length).toBe(25 + PERSIST_EVERY_S);
    await session.discard();
  });

  it('stores a large batch over several INSERTs exactly as given', async () => {
    const db = openTestDb();
    await migrate(db);
    await createSession(db, 'big', new Date(2026, 9, 21, 23), 'normal');
    const frames = Array.from({ length: 250 }, (_, t) => ({
      t,
      features: {
        levelDb: -50 + t / 10,
        centroidHz: 300 + t,
        envelopeDb: Array.from({ length: 10 }, (_, i) => -50 + i + 0.04),
        ...(t % 3 === 0 ? {} : { peakHz: 110 + t / 7 }),
      },
      snoreProb: t % 5 === 0 ? 0.7 : null,
    }));
    await appendFrames(db, 'big', frames, new Date(2026, 9, 21, 23, 5));
    const stored = await sessionFrames(db, 'big');
    expect(stored.map((f) => f.t)).toEqual(frames.map((f) => f.t));
    expect(stored[1]).toEqual({
      t: 1,
      features: { levelDb: -49.9, centroidHz: 301, envelopeDb: [-50, -49, -48, -47, -46, -45, -44, -43, -42, -41], peakHz: 110.1 },
      snoreProb: null,
    });
    expect(stored[0].features.peakHz).toBeUndefined();
    expect(stored[0].snoreProb).toBe(0.7);
    const row = await db.getFirstAsync<{ last_frame_t: number }>('SELECT last_frame_t FROM recording_session WHERE id = ?', ['big']);
    expect(row?.last_frame_t).toBe(249);
  });
});

describe('sound kept from just before a stretch of sound', () => {
  it('holds its own copy of the quiet seconds, so a reused buffer does not change them', async () => {
    const rate = 4;
    const written: number[] = [];
    const rec = new SoundRecorder(
      { begin() {}, write: (pcm) => void written.push(pcm[0]), end: async () => ({ path: 'p', bytes: 1 }) },
      () => 'seg',
      async () => undefined,
    );
    const buffer = new Float32Array(rate);
    for (let t = 0; t < 10; t++) {
      buffer.fill(t / 100);
      rec.addSecond(t, buffer, rate, t < 9 ? -60 : -40);
    }
    await rec.finish();
    // The lead-in is the seconds just before the loud one, with what they held at the time.
    const first = 9 - SOUND_PRE_ROLL_S;
    expect(written).toEqual(Array.from({ length: SOUND_PRE_ROLL_S + 1 }, (_, i) => Math.round(Math.fround((first + i) / 100) * 32767)));
  });
});

describe('reading the microphone’s buffers in place', () => {
  it('converts only the whole samples it is told to', () => {
    const data = new Int16Array([16384, -32768, 32767, 0]).buffer;
    expect([...int16ToFloat32(data, 5)]).toEqual([0.5, -1]);
    expect(int16ToFloat32(data).length).toBe(4);
  });
});
