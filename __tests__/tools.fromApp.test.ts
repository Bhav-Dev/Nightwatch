import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { LabellingNight } from '../src/data/labellingExport';
import { addLabel } from '../src/data/labelRepo';
import { planLabellingExport } from '../src/data/labellingExport';
import { nightEvents, saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { attachSoundToNight, insertSoundSegment } from '../src/data/soundRepo';
import { writeTar } from '../src/data/tar';
import { encodeWav } from '../src/domain/audio/wav';
import { analyseNight } from '../src/domain/scoring';
import { synthesiseNightAudio } from '../src/native/audioCapture';
import { parsePredictions } from '../tools/eval/manifest';
import { convertArchive, fitPcm, gapPlan, main, nightNumbers, proposalsFromNight, readArchive, type Decoder } from '../tools/labelling/fromApp';
import { proposeFromWav } from '../tools/labelling/propose';
import { fixtureNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

const SR = 16_000;

function night(over: Partial<LabellingNight> = {}): LabellingNight {
  return {
    version: 1,
    nightId: 'n1',
    start: '2026-10-15T23:04:00+01:00',
    durationS: 1000,
    partial: false,
    detector: 'heuristic-v0',
    sleepSound: null,
    segments: [],
    events: [],
    answers: [],
    clips: [],
    ...over,
  };
}

describe('gap plan', () => {
  it('fills the unrecorded stretches with silence, in time order', () => {
    const plan = gapPlan(100, [
      { file: 'd', startS: 90, endS: 120 },
      { file: 'a', startS: 10, endS: 30 },
      { file: 'b', startS: 30, endS: 50 },
      { file: 'c', startS: 45, endS: 70 },
      { file: 'inside', startS: 50, endS: 60 },
    ]);
    expect(plan).toEqual([
      { kind: 'silence', startS: 0, endS: 10 },
      { kind: 'segment', file: 'a', startS: 10, endS: 30, skipS: 0 },
      { kind: 'segment', file: 'b', startS: 30, endS: 50, skipS: 0 },
      // Overlaps b: starts where b ended, 5 s into its own audio.
      { kind: 'segment', file: 'c', startS: 50, endS: 70, skipS: 5 },
      { kind: 'silence', startS: 70, endS: 90 },
      // Runs past the end of the night: cut.
      { kind: 'segment', file: 'd', startS: 90, endS: 100, skipS: 0 },
    ]);
  });

  it('is all silence without segments, and covers the night exactly', () => {
    expect(gapPlan(60, [])).toEqual([{ kind: 'silence', startS: 0, endS: 60 }]);
    const plan = gapPlan(700, [{ file: 'a', startS: 0, endS: 300 }, { file: 'b', startS: 300, endS: 600 }]);
    expect(plan.reduce((s, p) => s + p.endS - p.startS, 0)).toBe(700);
  });

  it('fits decoded audio to its seconds: cut when longer, padded with silence when shorter', () => {
    const pcm = Uint8Array.from({ length: 3 * SR * 2 + 100 }, (_, i) => (i % 250) + 1);
    const cut = fitPcm(pcm, 1, 2);
    expect(cut.length).toBe(2 * SR * 2);
    expect(cut[0]).toBe(pcm[SR * 2]);
    const padded = fitPcm(pcm, 2, 2);
    expect(padded.length).toBe(2 * SR * 2);
    expect(padded.subarray(SR * 2 + 100).every((b) => b === 0)).toBe(true);
    expect(padded[SR * 2 + 99]).not.toBe(0);
  });
});

describe('proposals from the app', () => {
  it('takes the detector’s events and adds the stretches the user answered', () => {
    const p = proposalsFromNight(
      night({
        events: [
          { startS: 100, endS: 160, peakDb: 14.2, meanDb: 9 },
          { startS: 300, endS: 340, peakDb: 20, meanDb: 12 },
          { startS: 900, endS: 1200, peakDb: 8, meanDb: 6 },
        ],
        answers: [
          { startS: 100, endS: 160, label: 'not_snore', source: 'clip' },
          { startS: 500, endS: 530, label: 'snore', source: 'moment' },
          { startS: 300, endS: 340, label: 'not_snore', source: 'clip' },
          // A later answer for the same stretch wins.
          { startS: 300, endS: 340, label: 'snore', source: 'clip' },
          { startS: 520, endS: 525, label: 'not_snore', source: 'moment' },
        ],
      }),
      'v03-n2.wav',
      [-60, -59.5],
    );
    expect(p).toMatchObject({ version: 1, source: 'v03-n2.wav', durationS: 1000, sampleRate: 16000, detector: 'app:heuristic-v0', levelDb: [-60, -59.5] });
    expect(p.regions).toEqual([
      { startS: 100, endS: 160, peakDb: 14.2, answer: 'not_snore' },
      { startS: 300, endS: 340, peakDb: 20, answer: 'snore' },
      { startS: 500, endS: 530, answer: 'not_snore' },
      { startS: 900, endS: 1000, peakDb: 8 },
    ]);
    // The same file works as predictions for tools/eval.
    expect(parsePredictions(JSON.parse(JSON.stringify(p))).regions).toHaveLength(4);
  });
});

describe('night numbers', () => {
  it('counts up from the first number, or follows a list with skips', () => {
    expect(nightNumbers(3, {})).toEqual([1, 2, 3]);
    expect(nightNumbers(3, { first: 4 })).toEqual([4, 5, 6]);
    expect(nightNumbers(3, { list: '4, -, 5' })).toEqual([4, null, 5]);
  });
  it('refuses lists that do not fit the archive', () => {
    expect(() => nightNumbers(2, { list: '1,2,3' })).toThrow(/3 entries.*2 nights/);
    expect(() => nightNumbers(2, { list: '1,1' })).toThrow(/twice/);
    expect(() => nightNumbers(2, { list: '1,x' })).toThrow(/"x"/);
    expect(() => nightNumbers(2, { first: 0 })).toThrow(/--first/);
  });
});

describe('from an app export to labelling inputs', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snorehive-fromapp-test-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Stands in for ffmpeg: the "m4a" files here are WAVs; returns their samples plus decoder padding. */
  const decode: Decoder = (file) => {
    const bytes = fs.readFileSync(file);
    return Buffer.concat([bytes.subarray(44), Buffer.alloc(2048)]);
  };

  it('builds a WAV with silence in the gaps and proposals the labelling page can load', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `id-${++n}`;
    const audio = synthesiseNightAudio(0, 600);
    const segment = async (nightId: string, startS: number, endS: number) => {
      const file = path.join(dir, `${newId()}.m4a`);
      fs.writeFileSync(file, encodeWav(audio.subarray(startS * SR, endS * SR), SR));
      await insertSoundSegment(db, { id: newId(), session_id: `s-${nightId}`, start_s: startS, end_s: endS, codec: 'aac', path: file, bytes: 1, created_at: 0 });
    };
    const addNight = async (id: string, startedAt: Date, segments: [number, number][]) => {
      const analysis = analyseNight({ durationS: 600, frames: fixtureNight(600, [{ startS: 120, durationS: 60, db: 15 }, { startS: 400, durationS: 40, db: 15 }]) });
      await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 600_000), partial: false, analysis, newId, detector: 'heuristic-v0' });
      for (const [a, b] of segments) await segment(id, a, b);
      await attachSoundToNight(db, `s-${id}`, id);
    };
    // Night a: recorded in labelling mode, with an interruption from 500 to 560 s.
    await addNight('a', new Date(2026, 9, 14, 23, 4), [[0, 300], [300, 500], [560, 600]]);
    // Night b: only the parts with sound (labelling mode was off).
    await addNight('b', new Date(2026, 9, 15, 23, 30), [[110, 210]]);
    const first = (await nightEvents(db, 'a'))[0];
    await addLabel(db, { id: newId(), nightId: 'a', startS: first.start_s, endS: first.end_s, label: 'not_snore', peakDb: 0, meanDb: 0, source: 'clip', now: 1 });
    await addLabel(db, { id: newId(), nightId: 'a', startS: 250, endS: 270, label: 'snore', peakDb: 8, meanDb: 6, source: 'moment', now: 2 });

    // The archive, written the way the phone writes it.
    const plan = (await planLabellingExport(db, { count: 7, fileSize: (p) => (fs.existsSync(p) ? fs.statSync(p).size : null), now: new Date(2026, 9, 17, 9) }))!;
    const archive = path.join(dir, plan.fileName);
    const fd = fs.openSync(archive, 'w');
    await writeTar(plan.inputs, (b) => void fs.writeSync(fd, b), {
      mtimeS: 0,
      open: (p) => {
        const data = fs.readFileSync(p);
        let at = 0;
        return { read: (k) => data.subarray(at, (at = Math.min(data.length, at + k))), close: () => undefined };
      },
    });
    fs.closeSync(fd);
    expect(fs.statSync(archive).size).toBe(plan.totalBytes);

    const nights = readArchive(archive);
    expect(nights.map((x) => x.night.nightId)).toEqual(['a', 'b']);

    const out = path.join(dir, 'out');
    const logs: string[] = [];
    const warnings: string[] = [];
    const done = convertArchive({ archive, volunteer: 'v07', numbers: [3, 4], outDir: out, decode, log: (m) => void logs.push(m), warn: (m) => void warnings.push(m) });
    expect(done.map((d) => d.id)).toEqual(['v07-n3', 'v07-n4']);
    expect(done[0].recordedS).toBe(540);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/v07-n4.*17% of the night/);

    // The WAV: 600 s at 16 kHz, the recorded seconds where they were recorded, silence in the gap.
    const wav = fs.readFileSync(path.join(out, 'v07-n3.wav'));
    expect(wav.length).toBe(44 + 600 * SR * 2);
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(SR);
    const source = Buffer.from(encodeWav(audio, SR).subarray(44));
    const at = (s: number) => 44 + s * SR * 2;
    expect(wav.subarray(at(0), at(500)).equals(source.subarray(0, 500 * SR * 2))).toBe(true);
    expect(wav.subarray(at(500), at(560)).every((b) => b === 0)).toBe(true);
    expect(wav.subarray(at(560), at(600)).equals(source.subarray(560 * SR * 2))).toBe(true);
    expect(fs.existsSync(path.join(out, 'v07-n3.wav.partial'))).toBe(false);

    // The proposals: the detector's events, the answered stretch, and levels for the overview.
    const proposals = JSON.parse(fs.readFileSync(path.join(out, 'v07-n3.proposals.json'), 'utf8'));
    expect(parsePredictions(proposals).regions.length).toBe(proposals.regions.length);
    expect(proposals).toMatchObject({ version: 1, source: 'v07-n3.wav', durationS: 600, sampleRate: 16000, detector: 'app:heuristic-v0' });
    expect(proposals.levelDb).toHaveLength(600);
    expect(proposals.levelDb[530]).toBeLessThan(-100);
    expect(proposals.regions).toContainEqual(expect.objectContaining({ startS: first.start_s, endS: first.end_s, answer: 'not_snore' }));
    expect(proposals.regions).toContainEqual({ startS: 250, endS: 270, answer: 'snore' });

    // v0 on the built WAV ignores the silence filled in for the gap: it finds the snoring at the
    // same loudness above the floor as on the original, unbroken audio.
    const original = path.join(dir, 'original.wav');
    fs.writeFileSync(original, encodeWav(audio, SR));
    const fromOriginal = proposeFromWav(original, { includeLevels: false }).regions;
    const fromBuilt = proposeFromWav(path.join(out, 'v07-n3.wav'), { includeLevels: false }).regions;
    expect(fromBuilt).toHaveLength(fromOriginal.length);
    for (const [i, r] of fromBuilt.entries()) {
      expect(Math.abs(r.startS - fromOriginal[i].startS)).toBeLessThanOrEqual(2);
      expect(Math.abs(r.endS - fromOriginal[i].endS)).toBeLessThanOrEqual(2);
      expect(Math.abs(r.peakDb! - fromOriginal[i].peakDb!)).toBeLessThan(3);
    }

    // Existing files are not replaced without --force.
    expect(() => convertArchive({ archive, volunteer: 'v07', numbers: [3, null], outDir: out, decode, log: () => undefined })).toThrow(/already exist/);
    expect(convertArchive({ archive, volunteer: 'v07', numbers: [3, null], outDir: out, decode, force: true, levels: false, log: () => undefined })).toHaveLength(1);

    // --list needs nothing but the archive.
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m: string) => void lines.push(m));
    try {
      expect(main([archive, '--list'])).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^1\. 2026-10-14-2304 .*90% recorded .*2 answers/);
  });

  it('asks for a volunteer code and refuses bad arguments', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(main([])).toBe(2);
      expect(main(['x.tar', '--bogus'])).toBe(2);
    } finally {
      err.mockRestore();
    }
  });
});
