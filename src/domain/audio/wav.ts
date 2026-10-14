/**
 * 16-bit PCM WAV encode and decode. Clips are WAV for now; the codec is recorded with each
 * clip so they can move to Opus later without guessing (see src/clips/codec.ts).
 */

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  /** Mono samples in [-1, 1]; multi-channel files are averaged down. */
  samples: Float32Array;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
  }
  return new Uint8Array(buf);
}

/** Decodes 16-bit PCM (format 1) or 32-bit float (format 3) WAV. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) => String.fromCharCode(...bytes.subarray(off, off + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bytesPerSample * channels));
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (f * channels + c) * bytesPerSample;
          if (format === 1 && bits === 16) sum += v.getInt16(p, true) / 32768;
          else if (format === 3 && bits === 32) sum += v.getFloat32(p, true);
          else throw new Error(`unsupported WAV format ${format}/${bits}-bit`);
        }
        out[f] = sum / channels;
      }
      return { sampleRate, channels, samples: out };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
