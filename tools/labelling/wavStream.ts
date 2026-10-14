/// <reference types="node" />
import * as fs from 'node:fs';

/**
 * Streaming WAV reader for the labelling tools. `decodeWav` in src/domain/audio/wav.ts
 * needs the whole file in memory and then a Float32 copy of it; an 8-hour 16 kHz night is
 * about 920 MB of int16, which would mean nearly 3 GB of heap. This reads the header, then
 * hands out mono-mixed Float32 chunks so memory stays at one chunk.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = integer PCM, 3 = IEEE float (WAVE_FORMAT_EXTENSIBLE is resolved to its sub-format). */
  format: 1 | 3;
  /** Byte offset of the first sample in the file. */
  dataOffset: number;
  /** Sample frames (one sample per channel) in the data chunk. */
  frames: number;
  blockAlign: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset);
  return buf.subarray(0, n);
}

export function readWavInfo(fd: number): WavInfo {
  const fileSize = fs.fstatSync(fd).size;
  const head = readAt(fd, 0, 12);
  const riff = head.toString('latin1', 0, 4);
  if (riff === 'RF64') throw new Error('RF64 (WAV over 4 GB) is not supported; split the night into files under 4 GB');
  if (head.length < 12 || riff !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }

  let off = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'frames'> | null = null;
  while (off + 8 <= fileSize) {
    const chunk = readAt(fd, off, 8);
    const id = chunk.toString('latin1', 0, 4);
    const size = chunk.readUInt32LE(4);
    const body = off + 8;
    if (id === 'fmt ') {
      const f = readAt(fd, body, Math.min(size, 40));
      let format = f.readUInt16LE(0);
      const channels = f.readUInt16LE(2);
      const sampleRate = f.readUInt32LE(4);
      const blockAlign = f.readUInt16LE(12);
      const bitsPerSample = f.readUInt16LE(14);
      // The first two bytes of the sub-format GUID carry the real format code.
      if (format === WAVE_FORMAT_EXTENSIBLE && f.length >= 26) format = f.readUInt16LE(24);
      const supported =
        (format === WAVE_FORMAT_PCM && [8, 16, 24, 32].includes(bitsPerSample)) ||
        (format === WAVE_FORMAT_IEEE_FLOAT && [32, 64].includes(bitsPerSample));
      if (!supported) throw new Error(`unsupported WAV format ${format}/${bitsPerSample}-bit`);
      if (channels < 1 || sampleRate < 1) throw new Error('WAV fmt chunk is invalid');
      fmt = { sampleRate, channels, bitsPerSample, format: format as 1 | 3, blockAlign };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data chunk comes before fmt chunk');
      // Recorders that were killed mid-night often leave the size as 0 or 0xFFFFFFFF;
      // trust the file length in that case so the night is still usable.
      const available = fileSize - body;
      const bytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      return { ...fmt, dataOffset: body, frames: Math.floor(bytes / fmt.blockAlign) };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Mono-mixes raw interleaved sample bytes into [-1, 1] floats. */
export function bytesToMono(bytes: Buffer, info: WavInfo, out: Float32Array): number {
  const { channels, bitsPerSample, format, blockAlign } = info;
  const bps = bitsPerSample / 8;
  const frames = Math.min(out.length, Math.floor(bytes.length / blockAlign));
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = f * blockAlign + c * bps;
      if (format === WAVE_FORMAT_IEEE_FLOAT) {
        sum += bitsPerSample === 32 ? bytes.readFloatLE(p) : bytes.readDoubleLE(p);
      } else if (bitsPerSample === 16) {
        sum += bytes.readInt16LE(p) / 32768;
      } else if (bitsPerSample === 24) {
        sum += bytes.readIntLE(p, 3) / 8388608;
      } else if (bitsPerSample === 32) {
        sum += bytes.readInt32LE(p) / 2147483648;
      } else {
        sum += (bytes[p] - 128) / 128;
      }
    }
    out[f] = sum / channels;
  }
  return frames;
}

/**
 * Yields consecutive mono chunks of `chunkFrames` samples (the last may be shorter).
 * The yielded array is reused between iterations; copy it if you need to keep it.
 */
export function* readMonoChunks(path: string, chunkFrames: number): Generator<{ info: WavInfo; startFrame: number; samples: Float32Array }> {
  const fd = fs.openSync(path, 'r');
  try {
    const info = readWavInfo(fd);
    const raw = Buffer.alloc(chunkFrames * info.blockAlign);
    const mono = new Float32Array(chunkFrames);
    for (let start = 0; start < info.frames; start += chunkFrames) {
      const want = Math.min(chunkFrames, info.frames - start) * info.blockAlign;
      const n = fs.readSync(fd, raw, 0, want, info.dataOffset + start * info.blockAlign);
      const frames = bytesToMono(raw.subarray(0, n), info, mono);
      if (frames === 0) break;
      yield { info, startFrame: start, samples: mono.subarray(0, frames) };
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function wavInfo(path: string): WavInfo {
  const fd = fs.openSync(path, 'r');
  try {
    return readWavInfo(fd);
  } finally {
    fs.closeSync(fd);
  }
}
