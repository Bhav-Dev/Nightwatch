/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FrameFeatures } from '../../src/domain/audio/features';
import { FrameFeatureBuffer } from '../../src/domain/audio/frameBuffer';
import { classifyNightHeuristic } from '../../src/domain/detection/heuristic';
import { analyseNight } from '../../src/domain/scoring';
import { readMonoChunks, wavInfo } from './wavStream';

export const DETECTOR_ID = 'heuristic-v0';

export interface Region {
  startS: number;
  endS: number;
  /** Loudest second in the region, dB above the night's floor. */
  peakDb?: number;
}

/**
 * Output of a detector over one night. The same shape is the predictions format that
 * tools/eval/evaluate.ts reads, so any future model only has to write this file.
 */
export interface Proposals {
  version: 1;
  source: string;
  durationS: number;
  sampleRate: number;
  detector: string;
  regions: Region[];
  /** A-weighted level per second (dBFS, 0.1 dB steps), so the labelling page can draw the overview without scanning the WAV. */
  levelDb?: number[];
}

/** Seconds of audio read per chunk. Memory use is about chunk × sample rate × (4 + bytes per frame). */
const CHUNK_S = 30;

/**
 * Per-second features for a whole WAV, read in 30-second chunks. Only the features are
 * kept (about 150 bytes a second, ~4 MB for 8 hours); a trailing part-second is dropped,
 * as on the device.
 */
export function wavFeatures(wavPath: string): { sampleRate: number; durationS: number; frames: { t: number; features: FrameFeatures }[] } {
  const info = wavInfo(wavPath);
  const buffer = new FrameFeatureBuffer(info.sampleRate);
  for (const chunk of readMonoChunks(wavPath, CHUNK_S * info.sampleRate)) {
    buffer.addWindow(chunk.startFrame / info.sampleRate, chunk.samples);
  }
  return { sampleRate: info.sampleRate, durationS: info.frames / info.sampleRate, frames: buffer.entries() };
}

/** Runs v0 and the app's event rules over per-second features. */
export function heuristicRegions(frames: { t: number; features: FrameFeatures }[], durationS: number): Region[] {
  const night = analyseNight({ durationS, frames: classifyNightHeuristic(frames) });
  return night.events.map((e) => ({ startS: e.startS, endS: e.endS, peakDb: Math.round(e.peakDb * 10) / 10 }));
}

export function proposeFromWav(wavPath: string, opts: { source?: string; includeLevels?: boolean } = {}): Proposals {
  const { sampleRate, durationS, frames } = wavFeatures(wavPath);
  return {
    version: 1,
    // Basename only: proposals and labels outlive the recording and should not carry local paths.
    source: opts.source ?? path.basename(wavPath),
    durationS,
    sampleRate,
    detector: DETECTOR_ID,
    regions: heuristicRegions(frames, durationS),
    ...(opts.includeLevels === false ? {} : { levelDb: frames.map((f) => Math.round(f.features.levelDb * 10) / 10) }),
  };
}

const USAGE = `Usage: npx tsx tools/labelling/propose.ts <night.wav> [--out proposals.json] [--no-levels]

Runs detection v0 over a WAV and writes the proposed snore regions for labelling.
Default output: <night>.proposals.json next to the WAV.`;

export function main(argv: string[]): number {
  const args = [...argv];
  let out: string | undefined;
  let includeLevels = true;
  const positional: string[] = [];
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === '--out') out = args.shift();
    else if (a === '--no-levels') includeLevels = false;
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      return 0;
    } else positional.push(a);
  }
  if (positional.length !== 1 || (out !== undefined && out === '')) {
    console.error(USAGE);
    return 2;
  }
  const wavPath = positional[0];
  const outPath = out ?? wavPath.replace(/\.wav$/i, '') + '.proposals.json';
  const started = Date.now();
  const proposals = proposeFromWav(wavPath, { includeLevels });
  fs.writeFileSync(outPath, JSON.stringify(proposals) + '\n');
  const hours = (proposals.durationS / 3600).toFixed(2);
  console.log(
    `${proposals.source}: ${hours} h at ${proposals.sampleRate} Hz, ${proposals.regions.length} regions proposed ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)} s → ${outPath}`,
  );
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
