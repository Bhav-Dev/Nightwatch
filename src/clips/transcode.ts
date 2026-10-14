import { clipsWithCodecOtherThan, replaceClipFile } from '../data/clipRepo';
import type { Db } from '../data/db';
import type { ClipFiles } from './clipFiles';
import { decoderFor, encoderFor, PREFERRED_CODEC } from './codec';

/**
 * Re-encodes every stored clip that is not in the preferred codec. Idempotent: run it after
 * switching PREFERRED_CODEC (for example to Opus) and again any time; already-converted clips
 * are skipped. A clip whose conversion fails is left as it was.
 */
export async function transcodeClips(db: Db, files: ClipFiles): Promise<{ converted: number; failed: number }> {
  const target = encoderFor(PREFERRED_CODEC);
  let converted = 0;
  let failed = 0;
  for (const clip of await clipsWithCodecOtherThan(db, target.codec)) {
    try {
      const { samples, sampleRate } = await decoderFor(clip.codec).decode(await files.read(clip.path));
      const encoded = await target.encode(samples, sampleRate);
      const written = await files.write(`${clip.id}.${target.extension}`, encoded);
      await replaceClipFile(db, clip.id, target.codec, written.path, written.bytes);
      if (written.path !== clip.path) await files.remove(clip.path);
      converted++;
    } catch (e) {
      console.warn(`Could not transcode clip ${clip.id}`, e);
      failed++;
    }
  }
  return { converted, failed };
}
