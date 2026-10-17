import { Directory, File, Paths } from 'expo-file-system';

import { SoundEncoder } from '../../modules/nightwatch-recording-service/src';
import type { Db } from '../data/db';
import { allSoundPaths } from '../data/soundRepo';
import { SOUND_BITRATE, type SegmentWriter } from '../recording/soundRecorder';
import { pruneOldSound } from '../recording/soundRetention';

/** True on builds with the native AAC encoder (Android and iOS, from this version on). */
export const soundRecordingAvailable = SoundEncoder.available;

const soundDir = () => new Directory(Paths.document, 'sounds');

/** Android's MediaMuxer wants a filesystem path, not a file:// URI (iOS takes either). */
const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** Writes sound segments as .m4a files in the app's document directory (never backed up to a server). */
export class NativeSegmentWriter implements SegmentWriter {
  private current: string | null = null;

  begin(id: string, sampleRate: number): void {
    const dir = soundDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `${id}.m4a`);
    this.current = file.uri;
    SoundEncoder.begin(toPath(file.uri), sampleRate, SOUND_BITRATE);
  }

  write(pcm: Int16Array): void {
    SoundEncoder.append(pcm);
  }

  async end(): Promise<{ path: string; bytes: number }> {
    const path = this.current ?? '';
    this.current = null;
    return { path, bytes: await SoundEncoder.end() };
  }
}

export function removeSoundFile(uri: string): void {
  const f = new File(uri);
  if (f.exists) f.delete();
}

/**
 * At launch: deletes sound older than the keeping period, and any file no night refers to (a
 * segment the app was killed in the middle of writing).
 */
export async function tidySoundFiles(db: Db): Promise<void> {
  await pruneOldSound(db, removeSoundFile);
  const dir = soundDir();
  if (!dir.exists) return;
  // Compare by file name, so a difference in how the URI is spelled can never delete a file in use.
  const known = new Set((await allSoundPaths(db)).map((p) => p.slice(p.lastIndexOf('/') + 1)));
  for (const item of dir.list()) {
    if (item instanceof File && !known.has(item.name)) item.delete();
  }
}
