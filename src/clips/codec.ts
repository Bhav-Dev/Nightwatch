import { decodeWav, encodeWav } from '../domain/audio/wav';

/**
 * Clip codecs. Clips are WAV today (16 kHz mono 16-bit: 32 KB a second, about 480 KB for a
 * 15-second clip, so five clips stay well under the 5 MB a night budget). The spec's target
 * is 48 kbps Opus (about 90 KB a clip). Everything that touches clips goes through this
 * registry, and every stored clip records its codec, so adding Opus is:
 *
 * 1. register an encoder for 'opus' (a native encoder module, or a WASM/JS libopus build),
 * 2. set PREFERRED_CODEC to 'opus',
 * 3. run `transcodeClips` once (it is idempotent) to convert existing WAV clips.
 *
 * Playback needs no change: expo-audio plays both on iOS and Android (Ogg Opus on iOS 17+;
 * use a .caf container for older iOS if needed).
 */

export type ClipCodec = 'wav' | 'opus';

export interface ClipEncoder {
  codec: ClipCodec;
  extension: string;
  mimeType: string;
  encode(samples: Float32Array, sampleRate: number): Promise<Uint8Array>;
}

export interface ClipDecoder {
  codec: ClipCodec;
  decode(bytes: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number }>;
}

export const wavEncoder: ClipEncoder = {
  codec: 'wav',
  extension: 'wav',
  mimeType: 'audio/wav',
  encode: async (samples, sampleRate) => encodeWav(samples, sampleRate),
};

export const wavDecoder: ClipDecoder = {
  codec: 'wav',
  decode: async (bytes) => {
    const d = decodeWav(bytes);
    return { samples: d.samples, sampleRate: d.sampleRate };
  },
};

/** Target bitrate for Opus clips once an encoder exists. */
export const OPUS_TARGET_KBPS = 48;

const encoders = new Map<ClipCodec, ClipEncoder>([['wav', wavEncoder]]);
const decoders = new Map<ClipCodec, ClipDecoder>([['wav', wavDecoder]]);

/** The codec new clips are written with. Change to 'opus' once its encoder is registered. */
export let PREFERRED_CODEC: ClipCodec = 'wav';

export function registerEncoder(e: ClipEncoder): void {
  encoders.set(e.codec, e);
}

export function registerDecoder(d: ClipDecoder): void {
  decoders.set(d.codec, d);
}

export function setPreferredCodec(codec: ClipCodec): void {
  if (!encoders.has(codec)) throw new Error(`no encoder registered for ${codec}`);
  PREFERRED_CODEC = codec;
}

export function encoderFor(codec: ClipCodec = PREFERRED_CODEC): ClipEncoder {
  const e = encoders.get(codec);
  if (!e) throw new Error(`no encoder registered for ${codec}`);
  return e;
}

export function decoderFor(codec: ClipCodec): ClipDecoder {
  const d = decoders.get(codec);
  if (!d) throw new Error(`no decoder registered for ${codec}`);
  return d;
}
