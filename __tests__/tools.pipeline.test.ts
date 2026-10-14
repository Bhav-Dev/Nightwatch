import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { decodeWav, encodeWav } from '../src/domain/audio/wav';
import { synthesiseNightAudio } from '../src/native/audioCapture';
import { evaluateManifest, formatReport } from '../tools/eval/evaluate';
import { parseManifest, type Manifest } from '../tools/eval/manifest';
import { assignSplits } from '../tools/eval/split';
import { proposeFromWav } from '../tools/labelling/propose';
import { readMonoChunks, wavInfo } from '../tools/labelling/wavStream';

const SR = 16_000;
let dir: string;
let night: Float32Array;
/** Ten minutes of synthetic night: snoring from 120 s to 360 s, written once as night.wav. */
let nightWav: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightwatch-tools-'));
  night = synthesiseNightAudio(0, 600);
  nightWav = path.join(dir, 'night.wav');
  fs.writeFileSync(nightWav, encodeWav(night, SR));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return name;
}

/** A WAV header with a LIST chunk before data and a data size left at 0, as a killed recorder leaves it. */
function stereoWavWithJunk(left: number[], right: number[]): Buffer {
  const frames = left.length;
  const list = Buffer.from('LIST\x04\x00\x00\x00INFO', 'latin1');
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(2, 10);
  fmt.writeUInt32LE(8000, 12);
  fmt.writeUInt32LE(8000 * 4, 16);
  fmt.writeUInt16LE(4, 20);
  fmt.writeUInt16LE(16, 22);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0, 'latin1');
  dataHead.writeUInt32LE(0, 4);
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(left[i] * 32767), i * 4);
    data.writeInt16LE(Math.round(right[i] * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + list.length + fmt.length + dataHead.length + data.length, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, list, fmt, dataHead, data]);
}

describe('streaming WAV reader', () => {
  it('reads the same samples as decodeWav, in chunks', () => {
    const whole = decodeWav(new Uint8Array(fs.readFileSync(nightWav))).samples;
    const chunk = 7 * SR + 123;
    let chunks = 0;
    let total = 0;
    for (const c of readMonoChunks(nightWav, chunk)) {
      expect(c.startFrame).toBe(chunks * chunk);
      // Spot-check the head and tail of every chunk rather than 9.6 M expect calls.
      expect(Array.from(c.samples.subarray(0, 20))).toEqual(Array.from(whole.subarray(c.startFrame, c.startFrame + 20)));
      const end = c.startFrame + c.samples.length;
      expect(Array.from(c.samples.subarray(-20))).toEqual(Array.from(whole.subarray(end - 20, end)));
      total += c.samples.length;
      chunks++;
    }
    expect(chunks).toBe(Math.ceil(whole.length / chunk));
    expect(total).toBe(whole.length);
  });

  it('mono-mixes stereo, skips unknown chunks and recovers a zero data size', () => {
    const file = path.join(dir, 'stereo.wav');
    fs.writeFileSync(file, stereoWavWithJunk([0.5, -0.5, 0.25], [0.5, 0.5, -0.25]));
    const info = wavInfo(file);
    expect(info).toMatchObject({ sampleRate: 8000, channels: 2, frames: 3 });
    const [chunk] = [...readMonoChunks(file, 16)];
    expect(Array.from(chunk.samples).map((x) => Math.round(x * 100) / 100)).toEqual([0.5, 0, 0]);
  });

  it('refuses files that are not WAV', () => {
    const file = path.join(dir, 'not.wav');
    fs.writeFileSync(file, 'hello, this is not audio at all');
    expect(() => wavInfo(file)).toThrow(/not a WAV/);
  });
});

describe('propose', () => {
  it('proposes the synthetic snoring stretch as one region', () => {
    const p = proposeFromWav(nightWav);
    expect(p).toMatchObject({ version: 1, source: 'night.wav', durationS: 600, sampleRate: SR, detector: 'heuristic-v0' });
    expect(p.regions).toHaveLength(1);
    const [r] = p.regions;
    expect(r.startS).toBeGreaterThanOrEqual(115);
    expect(r.startS).toBeLessThanOrEqual(130);
    expect(r.endS).toBeGreaterThanOrEqual(350);
    expect(r.endS).toBeLessThanOrEqual(365);
    expect(r.peakDb).toBeGreaterThan(20);
    expect(p.levelDb).toHaveLength(600);
  });

  it('works at other sample rates', () => {
    // Halve the 16 kHz night to 8 kHz; the snore harmonics (110 to 330 Hz) survive a two-tap average.
    const y = new Float32Array(night.length / 2);
    for (let i = 0; i < y.length; i++) y[i] = (night[2 * i] + night[2 * i + 1]) / 2;
    const file = path.join(dir, 'night-8k.wav');
    fs.writeFileSync(file, encodeWav(y, 8_000));
    const p = proposeFromWav(file, { includeLevels: false });
    expect(p.sampleRate).toBe(8_000);
    expect(p.durationS).toBe(600);
    expect(p.levelDb).toBeUndefined();
    expect(p.regions).toHaveLength(1);
    expect(p.regions[0].startS).toBeLessThanOrEqual(130);
    expect(p.regions[0].endS).toBeGreaterThanOrEqual(350);
  });
});

describe('evaluate', () => {
  const labels = (source: string, events: { startS: number; endS: number }[]) => ({
    version: 1,
    source,
    durationS: 600,
    labeller: 'test',
    events,
  });

  it('runs the built-in detector on WAVs and passes the gate when labels agree', () => {
    const manifest: Manifest = parseManifest({
      version: 1,
      nights: [
        { id: 'b', volunteer: 'v1', split: 'heldout', wav: 'night.wav', labels: writeJson('b.labels.json', labels('night.wav', [{ startS: 120, endS: 360 }])) },
        { id: 't', volunteer: 'v2', split: 'train', labels: 'missing-is-fine-for-train.json' },
      ],
    });
    const report = evaluateManifest(manifest, dir, { split: 'heldout' });
    expect(report.nights.map((n) => n.id)).toEqual(['b']);
    expect(report.nights[0].detector).toBe('heuristic-v0');
    expect(report.pooled.event.agreement).toBe(1);
    expect(report.pooled.frame.f1).toBeGreaterThan(0.9);
    expect(report.gate.pass).toBe(true);
    expect(formatReport(report)).toMatch(/Phase 1 gate: pass/);
  });

  it('reads external predictions and fails the gate when they disagree', () => {
    const predDir = path.join(dir, 'preds');
    fs.mkdirSync(predDir, { recursive: true });
    fs.writeFileSync(
      path.join(predDir, 'c.json'),
      JSON.stringify({ version: 1, source: 'night-c.wav', durationS: 600, detector: 'model-x', regions: [{ startS: 300, endS: 420 }] }),
    );
    const manifest = parseManifest({
      version: 1,
      nights: [{ id: 'c', volunteer: 'v3', split: 'heldout', labels: writeJson('c.labels.json', labels('night-c.wav', [{ startS: 100, endS: 200 }, { startS: 300, endS: 400 }])) }],
    });
    const report = evaluateManifest(manifest, dir, { split: 'heldout', predictionsDir: predDir });
    expect(report.nights[0].detector).toBe('model-x');
    expect(report.pooled.event).toMatchObject({ labelled: 2, matchedLabelled: 1, predicted: 1, correctPredicted: 1 });
    expect(report.gate.pass).toBe(false);
    expect(formatReport(report)).toMatch(/Phase 1 gate: fail/);
  });

  it('refuses a manifest with a volunteer in both splits', () => {
    const manifest = parseManifest({
      version: 1,
      nights: [
        { id: 'a', volunteer: 'v1', split: 'heldout', labels: 'a.json' },
        { id: 'b', volunteer: 'v1', split: 'train', labels: 'b.json' },
      ],
    });
    expect(() => evaluateManifest(manifest, dir, { split: 'heldout' })).toThrow(/both train and held-out/);
  });

  it('explains when a night has neither a recording nor predictions', () => {
    const manifest = parseManifest({
      version: 1,
      nights: [{ id: 'gone', volunteer: 'v1', split: 'heldout', labels: writeJson('gone.labels.json', labels('gone.wav', [])) }],
    });
    expect(() => evaluateManifest(manifest, dir, { split: 'heldout' })).toThrow(/needs a wav or a predictions file/);
  });
});

describe('split', () => {
  const nights = (counts: Record<string, number>, splits: Record<string, 'train' | 'heldout'> = {}) =>
    parseManifest({
      version: 1,
      nights: Object.entries(counts).flatMap(([v, n]) =>
        Array.from({ length: n }, (_, i) => ({ id: `${v}-${i}`, volunteer: v, labels: `${v}-${i}.json`, ...(splits[v] ? { split: splits[v] } : {}) })),
      ),
    });

  it('first split puts about a third of nights in held-out with no volunteer in both', () => {
    const r = assignSplits(nights({ v1: 4, v2: 4, v3: 3, v4: 4, v5: 5, v6: 4, v7: 3, v8: 3 }), { seed: 7 });
    expect(r.firstSplit).toBe(true);
    expect(r.heldoutNights).toBe(10);
    expect(r.trainNights).toBe(20);
    for (const v of r.heldoutVolunteers) expect(r.trainVolunteers).not.toContain(v);
    const perVolunteer = new Map<string, Set<string>>();
    for (const n of r.manifest.nights) perVolunteer.set(n.volunteer, (perVolunteer.get(n.volunteer) ?? new Set()).add(n.split!));
    for (const s of perVolunteer.values()) expect(s.size).toBe(1);
  });

  it('is reproducible for a seed', () => {
    const m = nights({ a: 4, b: 4, c: 3, d: 4, e: 5, f: 4, g: 3, h: 3 });
    expect(assignSplits(m, { seed: 3 }).heldoutVolunteers).toEqual(assignSplits(m, { seed: 3 }).heldoutVolunteers);
  });

  it('never moves held-out volunteers and sends new volunteers to train', () => {
    const m = nights({ v1: 4, v2: 6, v3: 5, v9: 8, v10: 2 }, { v1: 'heldout', v2: 'heldout', v3: 'train' });
    const r = assignSplits(m, { heldoutNights: 15 });
    expect(r.firstSplit).toBe(false);
    expect(r.heldoutVolunteers).toEqual(['v1', 'v2']);
    expect(r.assigned).toEqual([
      { volunteer: 'v10', nights: 2, split: 'train' },
      { volunteer: 'v9', nights: 8, split: 'train' },
    ]);
  });

  it('gives new nights of a known volunteer that volunteer’s split', () => {
    const m = parseManifest({
      version: 1,
      nights: [
        { id: 'a1', volunteer: 'a', split: 'heldout', labels: 'x' },
        { id: 'a2', volunteer: 'a', labels: 'x' },
        { id: 'b1', volunteer: 'b', split: 'train', labels: 'x' },
      ],
    });
    expect(assignSplits(m).manifest.nights.map((n) => n.split)).toEqual(['heldout', 'heldout', 'train']);
  });

  it('keeps at least one volunteer for training on a first split', () => {
    const r = assignSplits(nights({ a: 1, b: 1 }), { heldoutNights: 10 });
    expect(r.trainVolunteers).toHaveLength(1);
    expect(r.heldoutVolunteers).toHaveLength(1);
  });
});
