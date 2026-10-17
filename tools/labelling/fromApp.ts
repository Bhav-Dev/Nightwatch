/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { LabellingNight } from '../../src/data/labellingExport';
import { listTar, type TarEntry } from '../../src/data/tar';
import type { SoundLabelValue } from '../../src/domain/scoring/corrections';
import { type Proposals, type Region, wavFeatures } from './propose';

/**
 * Turns an "Export nights for labelling" archive from the app into the labelling inputs: per
 * night, `<volunteer>-n<k>.wav` (16 kHz mono 16-bit, silence where nothing was recorded) and
 * `<volunteer>-n<k>.proposals.json` pre-filled with what the app detected and the stretches the
 * user answered. The archive is read in place (only headers and one segment at a time are in
 * memory); segments are decoded with ffmpeg, which must be on PATH.
 */

export const WAV_RATE = 16_000;
const BYTES_PER_S = WAV_RATE * 2;

/** A night with less of its time recorded than this was probably not recorded in labelling mode. */
const LOW_COVERAGE = 0.9;

/** One stretch of the output WAV: silence where nothing was recorded, or (part of) a segment. */
export type Piece =
  | { kind: 'silence'; startS: number; endS: number }
  /** Seconds [startS, endS) of the night from `file`, starting `skipS` seconds into its audio. */
  | { kind: 'segment'; file: string; startS: number; endS: number; skipS: number };

/**
 * Lays the night's segments on a timeline of `durationS` seconds and fills every gap with
 * silence. Segments are taken in time order; a segment that overlaps the one before starts where
 * that one ended, and anything past the end of the night is cut.
 */
export function gapPlan(durationS: number, segments: readonly { file: string; startS: number; endS: number }[]): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const seg of [...segments].sort((a, b) => a.startS - b.startS)) {
    const startS = Math.max(seg.startS, at);
    const endS = Math.min(seg.endS, durationS);
    if (endS <= startS) continue;
    if (startS > at) pieces.push({ kind: 'silence', startS: at, endS: startS });
    pieces.push({ kind: 'segment', file: seg.file, startS, endS, skipS: startS - seg.startS });
    at = endS;
  }
  if (at < durationS) pieces.push({ kind: 'silence', startS: at, endS: durationS });
  return pieces;
}

/**
 * Exactly `seconds` of 16-bit PCM from decoded audio, starting `skipS` seconds in: cut when the
 * decoder gave more (AAC pads the end), zero-padded when it gave less. Keeps every segment on its
 * recorded seconds, so small decoder differences never add up over the night.
 */
export function fitPcm(pcm: Uint8Array, skipS: number, seconds: number): Uint8Array {
  const out = new Uint8Array(seconds * BYTES_PER_S);
  const from = Math.min(pcm.length, skipS * BYTES_PER_S);
  out.set(pcm.subarray(from, Math.min(pcm.length, from + out.length)));
  return out;
}

export interface ProposalRegion extends Region {
  /** The user's answer for this stretch in the app ('snore' or 'not_snore'). label.html does not read it. */
  answer?: SoundLabelValue;
}

/** The proposals format, with the user's answers on the regions they touch. */
export type AppProposals = Omit<Proposals, 'regions'> & { regions: ProposalRegion[] };

/**
 * Proposals for the labelling page from what the app knew: the detector's events, plus every
 * stretch the user answered that no event covers. Each region an answer touches carries that
 * answer (the latest one wins). The proposals format has no way to mark a region as already
 * decided, so the page shows all of them as undecided.
 */
export function proposalsFromNight(night: LabellingNight, source: string, levelDb?: number[]): AppProposals {
  const clamp = (s: number) => Math.min(night.durationS, Math.max(0, s));
  const regions: ProposalRegion[] = night.events
    .map((e) => ({ startS: clamp(e.startS), endS: clamp(e.endS), peakDb: e.peakDb }))
    .filter((r) => r.endS > r.startS);
  for (const a of night.answers) {
    const startS = clamp(a.startS);
    const endS = clamp(a.endS);
    if (endS <= startS) continue;
    const hits = regions.filter((r) => r.startS < endS && r.endS > startS);
    if (hits.length > 0) for (const r of hits) r.answer = a.label;
    else regions.push({ startS, endS, answer: a.label });
  }
  regions.sort((a, b) => a.startS - b.startS || a.endS - b.endS);
  return {
    version: 1,
    source,
    durationS: night.durationS,
    sampleRate: WAV_RATE,
    detector: `app:${night.detector ?? 'unknown'}`,
    regions,
    ...(levelDb ? { levelDb } : {}),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Checks a night.json from the archive. */
export function parseNight(json: unknown, where: string): LabellingNight {
  if (!isObj(json) || json.version !== 1) throw new Error(`${where}: not a night.json from the app (version 1)`);
  if (typeof json.start !== 'string' || !isNum(json.durationS) || json.durationS <= 0) throw new Error(`${where}: needs start and durationS`);
  for (const key of ['segments', 'events', 'answers'] as const) {
    if (!Array.isArray(json[key])) throw new Error(`${where}: ${key} must be an array`);
  }
  for (const [i, s] of (json.segments as unknown[]).entries()) {
    if (!isObj(s) || typeof s.file !== 'string' || !isNum(s.startS) || !isNum(s.endS)) throw new Error(`${where}: segments[${i}] needs file, startS and endS`);
  }
  return json as unknown as LabellingNight;
}

/**
 * Night numbers for the archive's nights in time order: counting up from `first`, or one entry
 * per night from `list` ("4,5,-,6", where "-" skips that night).
 */
export function nightNumbers(count: number, opts: { first?: number; list?: string }): (number | null)[] {
  if (opts.list === undefined) {
    const first = opts.first ?? 1;
    if (!Number.isInteger(first) || first < 1) throw new Error('--first must be a whole number from 1');
    return Array.from({ length: count }, (_, i) => first + i);
  }
  const parts = opts.list.split(',').map((p) => p.trim());
  if (parts.length !== count) throw new Error(`--nights lists ${plural(parts.length, 'entry', 'entries')} but the archive has ${plural(count, 'night', 'nights')} (use - to skip one)`);
  const numbers = parts.map((p) => {
    if (p === '-') return null;
    if (!/^[1-9]\d*$/.test(p)) throw new Error(`--nights: "${p}" is not a night number or -`);
    return Number(p);
  });
  const used = numbers.filter((k): k is number => k !== null);
  if (new Set(used).size !== used.length) throw new Error('--nights uses a number twice');
  return numbers;
}

export interface ArchiveNight {
  /** The night's folder in the archive. */
  dir: string;
  night: LabellingNight;
  /** The night's files by name (night.json, segment-001.m4a, ...). */
  files: Map<string, TarEntry>;
}

function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  return buf.subarray(0, fs.readSync(fd, buf, 0, length, offset));
}

/** The nights in an archive, in time order. */
export function readArchive(archive: string): ArchiveNight[] {
  const fd = fs.openSync(archive, 'r');
  try {
    const entries = listTar((offset, length) => readAt(fd, offset, length), fs.fstatSync(fd).size);
    const byDir = new Map<string, Map<string, TarEntry>>();
    for (const e of entries) {
      const slash = e.name.lastIndexOf('/');
      const dir = e.name.slice(0, slash + 1);
      if (!byDir.has(dir)) byDir.set(dir, new Map());
      byDir.get(dir)!.set(e.name.slice(slash + 1), e);
    }
    const nights: ArchiveNight[] = [];
    for (const [dir, files] of byDir) {
      const entry = files.get('night.json');
      if (!entry) continue;
      const where = `${dir}night.json`;
      let json: unknown;
      try {
        json = JSON.parse(readAt(fd, entry.offset, entry.size).toString('utf8'));
      } catch (err) {
        throw new Error(`${where}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const night = parseNight(json, where);
      for (const s of night.segments) if (!files.has(s.file)) throw new Error(`${where}: ${s.file} is not in the archive`);
      nights.push({ dir: dir.replace(/\/$/, ''), night, files });
    }
    if (nights.length === 0) throw new Error(`${archive}: no nights found (is this an "Export nights for labelling" file?)`);
    return nights.sort((a, b) => Date.parse(a.night.start) - Date.parse(b.night.start));
  } finally {
    fs.closeSync(fd);
  }
}

/** Seconds of the night covered by its segments. */
export function recordedSeconds(night: LabellingNight): number {
  return gapPlan(night.durationS, night.segments).reduce((s, p) => s + (p.kind === 'segment' ? p.endS - p.startS : 0), 0);
}

/** Decodes an audio file to 16 kHz mono 16-bit little-endian PCM. */
export type Decoder = (file: string) => Uint8Array;

export const FFMPEG_MISSING =
  'ffmpeg was not found. Install it so that `ffmpeg -version` works in this terminal ' +
  '(Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg, Linux: your package manager), then run again.';

export function ffmpegAvailable(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

export const ffmpegDecoder: Decoder = (file) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(WAV_RATE), 'pipe:1'], {
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) throw (r.error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(FFMPEG_MISSING) : r.error;
  if (r.status !== 0) throw new Error(`ffmpeg could not decode it: ${r.stderr.toString().trim() || `exit code ${r.status}`}`);
  return r.stdout;
};

function wavHeader(dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(WAV_RATE, 24);
  h.writeUInt32LE(BYTES_PER_S, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/**
 * Writes one night as a WAV, following its gap plan: silence is written as zeros, and each
 * segment is copied out of the archive to a temporary file, decoded and fitted to its seconds.
 * A segment that cannot be decoded becomes silence, with a warning. The WAV is written under a
 * temporary name and renamed once complete.
 */
export function writeNightWav(archive: string, an: ArchiveNight, wavPath: string, decode: Decoder, warn: (msg: string) => void): void {
  const dataBytes = an.night.durationS * BYTES_PER_S;
  if (36 + dataBytes > 0xffffffff) throw new Error(`${an.dir}: the night is too long for one WAV file`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snorehive-fromapp-'));
  const partial = `${wavPath}.partial`;
  const src = fs.openSync(archive, 'r');
  const out = fs.openSync(partial, 'w');
  try {
    fs.writeSync(out, wavHeader(dataBytes));
    const silence = Buffer.alloc(60 * BYTES_PER_S);
    for (const p of gapPlan(an.night.durationS, an.night.segments)) {
      let pcm: Uint8Array | null = null;
      if (p.kind === 'segment') {
        const entry = an.files.get(p.file)!;
        const tmp = path.join(tmpDir, path.basename(p.file));
        fs.writeFileSync(tmp, readAt(src, entry.offset, entry.size));
        try {
          pcm = fitPcm(decode(tmp), p.skipS, p.endS - p.startS);
        } catch (err) {
          if (err instanceof Error && err.message === FFMPEG_MISSING) throw err;
          warn(`${an.dir}/${p.file}: ${err instanceof Error ? err.message : String(err)}; its ${p.endS - p.startS} s are silence`);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      }
      if (pcm) {
        fs.writeSync(out, pcm);
      } else {
        for (let left = (p.endS - p.startS) * BYTES_PER_S; left > 0; left -= silence.length) {
          fs.writeSync(out, silence, 0, Math.min(left, silence.length));
        }
      }
    }
  } catch (err) {
    fs.closeSync(out);
    fs.rmSync(partial, { force: true });
    throw err;
  } finally {
    fs.closeSync(src);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.closeSync(out);
  fs.renameSync(partial, wavPath);
}

export interface ConvertOptions {
  archive: string;
  volunteer: string;
  /** Night number for each of the archive's nights in time order; null skips that night. */
  numbers: (number | null)[];
  outDir: string;
  /** Include per-second levels so the labelling page draws the overview at once (default true). */
  levels?: boolean;
  /** Replace existing files with the same names. */
  force?: boolean;
  decode?: Decoder;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface ConvertedNight {
  id: string;
  wav: string;
  proposals: string;
  recordedS: number;
  regions: number;
}

/** Writes the WAV and proposals for each numbered night. */
export function convertArchive(opts: ConvertOptions, nights = readArchive(opts.archive)): ConvertedNight[] {
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? ((m: string) => console.warn(`Warning: ${m}`));
  if (opts.numbers.length !== nights.length) throw new Error(`${opts.numbers.length} night numbers for ${nights.length} nights`);
  const jobs = nights.flatMap((an, i) => {
    const k = opts.numbers[i];
    if (k === null) return [];
    const id = `${opts.volunteer}-n${k}`;
    return [{ an, id, wav: path.join(opts.outDir, `${id}.wav`), proposals: path.join(opts.outDir, `${id}.proposals.json`) }];
  });
  if (!opts.force) {
    const existing = jobs.flatMap((j) => [j.wav, j.proposals]).filter((f) => fs.existsSync(f));
    if (existing.length > 0) throw new Error(`${existing.map((f) => path.basename(f)).join(', ')} already exist in ${opts.outDir}; check the night numbers, or use --force to replace them`);
  }
  fs.mkdirSync(opts.outDir, { recursive: true });
  const done: ConvertedNight[] = [];
  for (const j of jobs) {
    const started = Date.now();
    const recordedS = recordedSeconds(j.an.night);
    const coverage = recordedS / j.an.night.durationS;
    if (coverage < LOW_COVERAGE) {
      warn(`${j.id} (${j.an.dir}): only ${Math.round(coverage * 100)}% of the night was recorded; it was probably recorded without labelling mode, so the quiet stretches are silence`);
    }
    writeNightWav(opts.archive, j.an, j.wav, opts.decode ?? ffmpegDecoder, warn);
    const levelDb = opts.levels === false ? undefined : wavFeatures(j.wav).frames.map((f) => Math.round(f.features.levelDb * 10) / 10);
    const proposals = proposalsFromNight(j.an.night, path.basename(j.wav), levelDb);
    fs.writeFileSync(j.proposals, JSON.stringify(proposals) + '\n');
    const answered = proposals.regions.filter((r) => r.answer).length;
    log(
      `${j.id}: ${j.an.night.start}, ${(j.an.night.durationS / 3600).toFixed(2)} h, ${Math.round(coverage * 100)}% recorded, ` +
        `${proposals.regions.length} regions (${answered} answered in the app) in ${((Date.now() - started) / 1000).toFixed(1)} s → ${j.wav}`,
    );
    done.push({ id: j.id, wav: j.wav, proposals: j.proposals, recordedS, regions: proposals.regions.length });
  }
  return done;
}

const USAGE = `Usage:
  npx tsx tools/labelling/fromApp.ts <export.tar> --list
  npx tsx tools/labelling/fromApp.ts <export.tar> --volunteer <code> [--first <k> | --nights <k,k,...>]
                                     [--out <dir>] [--no-levels] [--force]

Turns an "Export nights for labelling" file from the app into <code>-n<k>.wav (16 kHz mono,
silence where nothing was recorded) and <code>-n<k>.proposals.json for label.html, one pair per
night. Nights are taken in time order and numbered from --first (default 1), or by --nights with
one entry per night, "-" to skip one. --list shows the nights without converting anything.
Default output: the archive's folder. Needs ffmpeg on PATH.`;

export function main(argv: string[]): number {
  const args = [...argv];
  const positional: string[] = [];
  let volunteer: string | undefined;
  let first: number | undefined;
  let list: string | undefined;
  let outDir: string | undefined;
  let levels = true;
  let force = false;
  let listOnly = false;
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === '--volunteer') volunteer = args.shift();
    else if (a === '--first') first = Number(args.shift());
    else if (a === '--nights') list = args.shift() ?? '';
    else if (a === '--out') outDir = args.shift();
    else if (a === '--no-levels') levels = false;
    else if (a === '--force') force = true;
    else if (a === '--list') listOnly = true;
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      return 0;
    } else if (a.startsWith('--')) {
      console.error(`Unknown option ${a}\n\n${USAGE}`);
      return 2;
    } else positional.push(a);
  }
  if (positional.length !== 1 || outDir === '') {
    console.error(USAGE);
    return 2;
  }
  const archive = positional[0];
  const nights = readArchive(archive);

  if (listOnly) {
    for (const [i, { dir, night }] of nights.entries()) {
      const recorded = Math.round((100 * recordedSeconds(night)) / night.durationS);
      console.log(
        `${i + 1}. ${dir.slice(dir.lastIndexOf('/') + 1)}  starts ${night.start}  ${(night.durationS / 3600).toFixed(2)} h  ` +
          `${recorded}% recorded  ${plural(night.events.length, 'event', 'events')}  ${plural(night.answers.length, 'answer', 'answers')}`,
      );
    }
    return 0;
  }
  if (!volunteer || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(volunteer)) {
    console.error('Give the volunteer code with --volunteer (for example v03); letters, digits, - and _ only, never a name.');
    return 2;
  }
  if (first !== undefined && list !== undefined) {
    console.error('Use --first or --nights, not both.');
    return 2;
  }
  const numbers = nightNumbers(nights.length, { first, list });
  if (!ffmpegAvailable()) {
    console.error(FFMPEG_MISSING);
    return 2;
  }
  const done = convertArchive({ archive, volunteer, numbers, outDir: outDir ?? path.dirname(path.resolve(archive)), levels, force }, nights);
  console.log(`${done.length} of ${plural(nights.length, 'night', 'nights')} written. Open tools/labelling/label.html and choose each WAV with its proposals file.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
